var Editor = require("../editor");
var header = require('../header');
var files = require('../models');
var EventEmitter = require('component-emitter');
var emitter = new EventEmitter();

new Editor(emitter, files);
header(emitter, files);
