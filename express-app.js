var version = process.env.API_VERSION;

//module dependencies
var errorHandler = require('errorHandler');
var bodyParser = require('body-parser');
var toobusy = require('toobusy');
var express = require('express');
var morgan = require('morgan');
var path = require('path');

var app = express();

//Routes & API
var index = require('./routes/index');
//dont crash on overload
app.use(function(req, res, next) {
    if (toobusy()) {
        res.send(503, "We have too much traffic try again in a few seconds, sorry.");
    } else {
        next();
    }
});

process.on('uncaughtException', function(err){
    console.log(err);
    process.exit(0);
});

//static and port
app.enable('trust proxy', 1);
app.set('port', process.env.PORT || 3010);
app.set('view engine', 'ejs');

if(process.env.PORT){
    app.use(morgan('combined'));
}else{
    app.use(morgan('combined'));
    app.use(errorHandler({ dumpExceptions: false, showStack: false }));
}

//error management
app.use(function(err, req, res, next){
    if(err.stack)
        //console.log(err.stack);
    if(err && err.redirect)
        return res.redirect(err.redirect);
    else if(err == "503")
        return res.send('Token has expired. Please try again.');
    else if(err)
        return res.render('error', {error: err});
    else
        return res.send("An error occured. Please try again in a few seconds.");
});

if(process.env.PORT){
    app.set('views', __dirname + '/dist/views');
    app.use(express.static(path.join(__dirname, 'dist/public')));
} else{
    app.set('views', __dirname + '/views');
    app.use(express.static(path.join(__dirname, 'public')));
}


//routes
app.get('/money', index.protobox);
app.get('/', index.index);

module.exports = app;
