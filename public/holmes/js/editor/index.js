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
  this.editor.on('gutterClick', this.$onGutterClick.bind(this));
  this.editor.on('change', this.$updateFiles.bind(this));
  // this.emitter.on('component-header:file select', this.$onFileSelect.bind(this));
  this.emitter.on('component-debugger:paused', this.$highlightLine.bind(this));
  this.emitter.on('component-debugger:resumed', this.$removeHighlight.bind(this));
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

Editor.prototype.$setGutterMarker = function (lineno) {
  var info = this.editor.lineInfo(lineno);
  var marker = info.gutterMarkers ? null : this.$makeMarker();
  this.editor.setGutterMarker(lineno, 'breakpoints', marker);
  return !!marker;
};

Editor.prototype.$onGutterClick = function (_, n) {
  var set = this.$setGutterMarker(n);
  this.$setBreakpoint(this.currentFile(), n, set);
};

Editor.prototype.$setBreakpoint = function(file, lineno, set) {
  if (set) {
    file.breakpoints[lineno] = true;
    this.emitter.emit('component-editor:breakpoint add', lineno + 1);
  } else {
    file.breakpoints[lineno] = false;
    this.emitter.emit('component-editor:breakpoint remove', lineno + 1);
  }
};

Editor.prototype.$makeMarker = function() {
  return $('<div/>')
    .addClass('marker')
    .text('●')
    [0];
};

Editor.prototype.$removeHighlight = function () {
  if (this.$hLineno != null) {
    this.editor.removeLineClass(this.$hLineno, 'background', 'selected');
  }
};

Editor.prototype.$highlightLine = function(lineno) {
  this.$removeHighlight();
  if (lineno) {
    this.$hLineno = lineno - 1;
    this.editor.addLineClass(this.$hLineno, 'background', 'selected');
  }
};

/**
 * Get the active file.
 * @api
 */
Editor.prototype.currentFile = function() {
  var file;
  var doc = this.editor.getDoc();
  $.each(this.files, function (f, obj) {
    if (obj.cmDoc === doc) {
      file = obj;
    }
  });
  return file;
};

Editor.prototype.$updateFiles = function() {
  var self = this;
  if (this.timeout) {
    clearTimeout(this.timeout);
  }
  this.timeout = setTimeout(function () {
    for(var fileName in self.files) {
        self.files[fileName].text = self.files[fileName].cmDoc.getValue();
    }
    self.emitter.emit('component-editor:run', self.files);
  }, 1000);
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
