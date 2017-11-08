var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var redis = require('redis');
// var client = redis.createClient();

var session = require('express-session');
var RedisStore = require('connect-redis')(session);

var app = express();

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
  store: new RedisStore({
    host: 'redis',
    port: 6379,
    // client: client,
    ttl: 260
  }),
  secret: 'password',
  resave: false,
  saveUninitialized: true,
}));

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
  res.render('index', { title: 'Server1' });
});

app.get('/login', function(req, res, next) {
  res.render('login');
});

app.post('/login', function(req, res, next) {
  req.session.login = true;
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
