var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var Redis = require('ioredis');
var session = require('express-session');
var RedisStore = require('connect-redis')(session);
var failover = require('./failover');
var ExpressBrute = require('express-brute');
var RedisBruteStore = require('express-brute-redis');

var app = express();

var serverName = process.env.SERVER_NAME || 'SERVER';

const node1 = {
  host: 'redis-node-1',
  port: '6379',
  label: 'redis-node-1',
  retry: 1000
};

const node2 = {
  host: 'redis-node-2',
  port: '6380',
  label: 'redis-node-2',
  retry: 1000
};

failover.init([node1, node2]).then(() => {
  failover.start();
  let store = new RedisStore({
    client: failover.currentMaster(),
    ttl: 260
  });
  let bruteStore = new RedisBruteStore({
    client: failover.currentMaster(),
    ttl: 260
  });
  let bruteforce = new ExpressBrute(bruteStore, {
    freeRetries: 3,
    minWait: 5*60*1000, // 5 minutes 
    maxWait: 60*60*1000, // 1 hour
  });
  // console.log('CURRENT MASTER===', failover.currentMaster())
  // view engine setup
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'jade');

  // uncomment after placing your favicon in /public
  //app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
  //app.use(logger('dev'));
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(cookieParser());

  let middleware = session({
    store: store,
    secret: 'password',
    resave: false,
    saveUninitialized: true,
  });

  app.use(middleware);

  app.use(function (req, res, next) {
    if (!req.session) {
      app._router.stack.forEach((route, i) => {
        if (route.handle.name === 'session') {
          store = new RedisStore({
            client: failover.currentMaster(),
            ttl: 260
          });
          middleware = session({
            store: store,
            secret: 'password',
            resave: false,
            saveUninitialized: true,
          });
          route.handle = middleware;
          middleware(req, res, next);
        }
        if (route.route && route.route.path && 
          route.route.methods.post && route.route.path === '/login') {
          bruteStore = new RedisBruteStore({
            client: failover.currentMaster(),
            ttl: 260
          });
          bruteforce = new ExpressBrute(bruteStore, {
            freeRetries: 3,
            minWait: 5*60*1000, // 5 minutes 
            maxWait: 60*60*1000, // 1 hour
          });
          route.route.stack[0].handle = bruteforce.prevent;
        }
      });
    } else {
      next() // otherwise continue  
    }
  })

  app.use(express.static(path.join(__dirname, 'public')));


  app.get('/', function(req, res, next) {
    res.redirect('/main');
  });

  app.get('/main', function(req, res, next) {
    if (!req.session.login) return res.redirect('/login');
    next();
  }, function(req, res, next) {
    store.all(function(err, sessions) {
      var users = sessions.filter(function(session) {
        return session.login;
      }).map(function(session) {
        return session.user;
      });
      res.render('index', { 
        title: serverName, 
        user: req.session.user,
        users: users
      });
    })
  });

  app.get('/login', function(req, res, next) {
    res.render('login');
  });
  
  // app.post('/auth',
  //   bruteforce.prevent, // error 403 if we hit this route too often
  //   function (req, res, next) {
  //     res.send('Success!');
  //   }
  // );

  app.post('/login', bruteforce.prevent, function(req, res, next) {
    if (req.body.password === 'test') {
      req.session.login = true;
      req.session.user = req.body.username
      res.redirect('/main');
    } else {
      res.redirect('/login');
    }
  });

  app.get('/logout', function(req, res, next) {
    delete req.session.login;
    res.redirect('/login');
  });

  // catch 404 and forward to error handler
  app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
  });

  // error handler
  app.use(function(err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render('error');
  });
  // console.log('ROUTES:', app._router.stack)
  // app._router.stack.forEach((route, i) => {
  //   if (route.route && route.route.path && route.route.path === '/login') {
  //     console.log('STACK===', route.route.stack)
  //     console.log('METHODS===', route.route.methods)
  //   }
  // });
}).catch((err) => {
  console.log('error occurs : ', err);
});

module.exports = app;
