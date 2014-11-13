var Editor = require("../editor");
var DevTools = require('../devtools');
var header = require('../header');
var files = require('../models');
var EventEmitter = require('component-emitter');
var emitter = new EventEmitter();

new Editor(emitter, files);
new DevTools(emitter, files);
header(emitter, files);


