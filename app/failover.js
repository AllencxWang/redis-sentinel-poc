'use strict';

const Redis = require('ioredis');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const ExpressBrute = require('express-brute');
const RedisBruteStore = require('express-brute-redis');
const EventEmitter = require('events');

const REDIS_KEY = 'MASTER_INFO';
const failover = new EventEmitter();

let failed = false;
let sessionMiddleware = null;

const sessionOpt = {
  secret: 'asulvIKJCLUDSA89hsadYz$4',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 60 * 1000 * 30
  },
  // name: config.common.cookieName,
};

const bruteForceOpt = {
  freeRetries: 3,
  minWait: 5*60*1000, // 5 minutes 
  maxWait: 60*60*1000, // 1 hour
};

const log = (...args) => {
  console.log.apply(null, args);
};

const swichRoleToMaster = (client) => {
  return new Promise((resolve, reject) => {
    client.slaveof('NO', 'ONE', (err) => {
      if (err) return reject(err);
      log('SET MASTER OPTION: ',JSON.stringify(client.extras.option));
      client.set(REDIS_KEY, JSON.stringify(client.extras.option));
      resolve();
    });
  });
};

const swichRoleToSlave = (client, master) => {
  return new Promise((resolve, reject) => {
    client.slaveof(master.host, master.port, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
};

const createSessionMiddleware = (option = {}) => {
  if (process.env.NODE_ENV !== 'mock') {
    option.store = new RedisStore({
      client: failover.currentMaster()
    });
    failover.store = option.store;
  }
  return session(option);
};

const createBruteForceObject = (option = {}) => {
  const store = process.env.NODE_ENV === 'mock' ?
    new ExpressBrute.MemoryStore() :
    new RedisBruteStore({
      client: failover.currentMaster()
    });
  return new ExpressBrute(store, option);
};

failover.events = {
  INITIALIZED: 'INITIALIZED',
  ERRORED: 'ERRORED',
  STARTED: 'STARTED',
};

failover.init = function(options) {
  let lastReadyNode = null;
  this.nodes = options.map((option, index) => {
    const label = option.label || `redis-node-${index+1}`;
    option.retryStrategy = (times) => {
      // log(`trying to reconnect with ${label} ...`);
      return option.retry || 1000;
    };

    const node = new Redis(option);
    node.extras = {
      isOnline: false,
      isMaster: false,
      isRecovering: false,
      label, 
      option,
      errHandler(err) {
        // no-op, just to eliminate [ioredis] Unhandled error event when the service restarted
        log(`connecting to ${node.extras.label} ...`);
      },
    };
    node.on('error', node.extras.errHandler);
    node.once('ready', () => {
      lastReadyNode = node;
      node.extras.isOnline = true;
    });
    return node;
  });
  
  // return a promise, this promise will only be resolved when
  // 1. all nodes are ready
  // 2. replication is done
  return new Promise((resolve, reject) => {
    (new Promise((resolve, reject) => {
      setTimeout(resolve, 5000); // wait for the ready signals
    })).then(() => {
      return lastReadyNode ? 
        new Promise((resolve, reject) => {
          lastReadyNode.get(REDIS_KEY, (err, result) => {
            log('GET MASTER OPTION:', err, result);
            if (err) return reject(err);
            resolve(result);
          });
        }) : Promise.resolve();
    }).then((result) => {
      // setup replication
      const promises = [];
      let masterOption = result ? JSON.parse(result) : null;
      this.nodes
        .filter((node) => node.extras.isOnline)
        .forEach((node) => {
          // get the current master info from the redis server
          // if there is no previous record in the redis server
          // select the first online node as the master
          masterOption = masterOption || node.extras.option;
          if (masterOption.host === node.extras.option.host &&
              masterOption.port === node.extras.option.port) {
            log(`@@@ ${node.extras.label} is the initial master @@@`);
            node.extras.isMaster = true;
          } else {
            promises.push(swichRoleToSlave(node, {
              host: masterOption.host, 
              port: masterOption.port
            }));
          }
        });
      Promise.all(promises)
        .then(() => {
          this.emit(this.events.INITIALIZED);
          resolve();
        })
        .catch((err) => {
          this.emit(this.events.ERRORED, err);
          reject();
        });
    }).catch((err) => {
      this.emit(this.events.ERRORED, err);
      reject();
    });
  });
};

failover.start = function(options) {
  return new Promise((resolve, reject) => {
    this.init(options).then(() => {
      this.nodes.forEach((node) => {
        node.removeListener('error', node.extras.errHandler);
        node.on('error', (err) => {
          // during the error period of a redis connection
          // the error handling logic will be only run once
          if (!node.extras.isRecovering) {
            log(`*** ${node.extras.label} is disconnected  *** `);
            node.extras.isRecovering = true;
            node.extras.isOnline = false;

            // when it's up again, switch its role to slave 
            node.once('ready', () => {
              log(`+++ ${node.extras.label} is recovered +++`);
              const master = this.currentMaster();
              node.extras.isRecovering = false;
              node.extras.isOnline = true;
              swichRoleToSlave(node, {
                host: master.extras.option.host,
                port: master.extras.option.port
              }).then(() => {
                log(`### ${node.extras.label} is now a slave of ${master.extras.label} ###`);
                // emit somthing
              }).catch((err) => {
                // emit somthing else
              });
            });

            if (node.extras.isMaster) {
              node.extras.isMaster = false;
              // re-elect a new master
              for (let candidate of this.nodes) {
                if (candidate.extras.isOnline && !candidate.extras.isMaster) {
                  candidate.extras.isMaster = true;
                  swichRoleToMaster(candidate).then(() => {
                    log(`/// ${candidate.extras.label} has been elected as the new master ///`);
                    // re-attach the slaves to the new master
                    const promises = [];
                    this.nodes
                      .filter((node) => node.extras.isMaster !== true)
                      .forEach((slave) => {
                        promises.push(swichRoleToSlave(slave, {
                          host: candidate.extras.option.host, 
                          port: candidate.extras.option.port
                        }));
                      });
                    Promise.all(promises).then(() => {
                      // emit somthing
                    }).catch((err) => {
                      // emit something else
                    });
                  });
                  break;
                }
              }
            } 
          }
        });
      });
      log('failover mechanism has been applied!!!');
      this.emit(this.events.STARTED);
      resolve();
    }).catch(reject);
  });
};

failover.currentMaster = function() {
  for (let node of this.nodes) {
    if (node.extras.isMaster) {
      return node;
    }
  }
};

failover.startSessions = function() {
  sessionMiddleware = createSessionMiddleware(sessionOpt);
  return function(req, res, next) {
    sessionMiddleware(req, res, (err) => {
      if (err) return next(err);
      if (!req.session) {
        failed = true;
        sessionMiddleware = createSessionMiddleware(sessionOpt);
        sessionMiddleware(req, res, next);
      } else {
        next();
      }
    });
  };
};

failover.preventBruteForce = function() {
  let bruteForce = createBruteForceObject(bruteForceOpt);
  return (req, res, next) => {
    if (failed === true) {
      bruteForce = createBruteForceObject(bruteForceOpt);
      failed = false;
    }
    bruteForce.prevent(req, res, next);
  };
};

module.exports = failover;