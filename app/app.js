var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var Redis = require('ioredis');
var session = require('express-session');
var RedisStore = require('connect-redis')(session);

var app = express();

var serverName = process.env.SERVER_NAME || 'SERVER';
var store = new RedisStore({
  // host: 'localhost',
  // port: 6379,
  // client: new Redis(6379, 'redis-master'),
  client: new Redis({
    sentinels: [{ host: 'redis-sentinel', port: 26379 }],
    name: 'mymaster'
  }),
  // client: new Redis(),
  ttl: 260
});
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
//app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());

app.use(session({
  store: store,
  secret: 'password',
  resave: false,
  saveUninitialized: true,
}));

// store.client.on('error', function(err){
//   console.log("Redis error " + err);
//   store.client = new Redis(6379, 'redis-slave');
// });

// app.use(session({
//   secret: 'keyboard cat',
//   resave: false,
//   saveUninitialized: true,
// }));

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

app.post('/login', function(req, res, next) {
  req.session.login = true;
  req.session.user = req.body.username
  res.redirect('/main');
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

module.exports = app;
