var CodeMirror = require('codemirror');
var $ = require('jquery');
var debounce = require('debounce');
var javascript = require('codemirror/mode/javascript/javascript');
var closeBrackets = require('codemirror/addon/edit/closebrackets');

/**
 * @constructor
 * @param {EventEmitter} emitter
 * @param {array<File>} files
 */
function Editor(emitter, files) {
  this.emitter = emitter;
  this.container = $('#editor');
  this.editor = new CodeMirror.fromTextArea($('#lightsource-text')[0], {
    gutters: ['CodeMirror-linenumbers', 'breakpoints'],
    lineNumbers: true,
    autoCloseBrackets: true,
    matchBrackets: true,
    styleActiveLine: true,
    indentUnit: 2,
    autofocus: true,
    mode: "javascript", // Default mode: plain text,
    theme: "lightsource-ambiance"
  });
  this.resize();
  this.emitter.on('component-header:file select', this.$onFileSelect.bind(this));
  this.$initFiles(files);
  // this.editor.on('gutterClick', this.$onGutterClick.bind(this));
  // this.editor.on('change', debounce(this.$updateFiles.bind(this)), 50);
  // this.emitter.on('component-header:file select', this.$onFileSelect.bind(this));
  // this.emitter.on('component-debugger:paused', this.$highlightLine.bind(this));
  // this.emitter.on('component-debugger:resumed', this.$removeHighlight.bind(this));
  // this.find('.run').on('click', this.$onRun.bind(this));
};

Editor.prototype.$initFiles = function(files) {
    this.files = files;
    for (var fileObject in files) {
        var doc = new CodeMirror.Doc(files[fileObject].text, files[fileObject].mode);
        //this.editor.swapDoc(doc);
        files[fileObject].cmDoc = doc;
    }
};

Editor.prototype.$onFileSelect = function (filename) {
  var file;
  for(var fileName in this.files) {
    if (this.files[fileName].filename === filename) {
        file = this.files[fileName];
    }
  }
  this.editor.swapDoc(file.cmDoc);
};

Editor.prototype.resize = function() {
    this.editor.setSize(this.container.width(), this.container.height());
};


module.exports = Editor;