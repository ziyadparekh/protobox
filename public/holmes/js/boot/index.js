var Editor = require("../editor");
var EventEmitter = require('component-emitter');
var emitter = new EventEmitter();

new Editor(emitter);
