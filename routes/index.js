//Module dependencies
var pjson = require('../package.json');

exports.index = function(req, res){
    res.render('protobox');
};

exports.protobox = function(req, res){
    res.render('holmes');
};
