var $ = require('jquery');
var util = require('util');

/**
 * @constructor
 * @param {EventEmitter} emitter
 * @param {array<File>} files
 */
function DevTools(emitter, files) {
  this.container = $('#console');
  // Only do it on init time so the console can work.
  this.files = files;
  this.$resetDebugger();
  // this.console = new Console();
  //this.find('.console').append(this.console.el);
  //this.console.on('command', this.$onCommand.bind(this));
  this.emitter = emitter;
  emitter.on(
    'component-editor:breakpoint add',
    this.$addBreakpoint.bind(this)
  );
  emitter.on(
    'component-editor:breakpoint remove',
    this.$removeBreakpoint.bind(this)
  );
  emitter.on('component-editor:run', this.loadAndRun.bind(this));
  $('.resume').on('click', this.$onResume.bind(this));
  $('.step-over').on('click', this.$onStepOver.bind(this));
  $('.step-out').on('click', this.$onStepOut.bind(this));
  $('.step-in').on('click', this.$onStepIn.bind(this));
};

DevTools.prototype.$resetDebugger = function() {
  var debug = debugjs.createDebugger({
    iframeParentElement: document.getElementById("lightsource-browser")
  });
  var context = debug.getContext();
  // TODO: push that down to context-eval.
  context.iframe.style.display = 'block';
  //debug.machine.on('error', this.$logError.bind(this));
  var doc = context.iframe.contentDocument;
  // doc.open();
  // doc.write(this.$getCode().html);
  // doc.close();
  $.each(this.files, function (f) {
    debug.addBreakpoints(f.filename, [2]);
  });
  debug.on('breakpoint', this.updateDebugger.bind(this, true));
  this.debug = debug;
  // console.log(context);
  // console.log(doc);
  // console.log(debug);
};

/**
 * Update the debugger UI.
 * @api
 * @param {boolean} paused
 */
DevTools.prototype.updateDebugger = function () {
  var stack = this.debug.getCallStack();
  // this.find('.call-stack').html(renderStack(stack));
  // this.find('.var-scope').html(renderScope(stack[stack.length - 1]));
  var scope = stack[stack.length - 1];
  $.each(scope.scope, function (i, o) {
    o.value = scope.evalInScope(o.name) + '';
    console.log(o.value);
  });
  var loc = this.debug.getCurrentLoc();
  var lineno = loc.start.line;
  if (this.debug.paused()) {
    console.log('paused  ', lineno);
    $('.toolbar .btn').removeAttr('disabled');
    this.emitter.emit('component-debugger:paused', lineno);
  } else {
    console.log('going ', lineno);
    $('.toolbar .btn').attr('disabled', true);
    this.emitter.emit('component-debugger:resumed', lineno);
  }
};

DevTools.prototype.$addBreakpoint = function (lineno) {
  this.debug.addBreakpoints('index.js', [lineno]);
};

DevTools.prototype.$removeBreakpoint = function (lineno) {
  this.debug.removeBreakpoints('index.js', [lineno]);
};

DevTools.prototype.$onStepIn = function () {
  this.debug.stepIn();
  this.updateDebugger();
};

DevTools.prototype.$onStepOut = function () {
  this.debug.stepOut();
  this.updateDebugger();
};

DevTools.prototype.$onStepOver = function () {
  this.debug.stepOver();
  this.updateDebugger();
};

DevTools.prototype.$onResume = function () {
  this.debug.run();
  this.updateDebugger();
};

DevTools.prototype.$getCode = function () {
  var html, js;
  for(var fileObject in this.files) {
    if (this.files[fileObject].filename === 'index.js') {
      js = this.files[fileObject].text;
    } else {
      html = this.files[fileObject].text;
    }
  }
  return {
    html: html,
    js: js
  };
};

/**
 * @api
 * Load and run the code.
 */
DevTools.prototype.loadAndRun = function () {
  // Hardcode our two files for now.
  //this.$resetDebugger();
  this.debug.load(this.$getCode().js, 'index.js');
  this.debug.run();
};


module.exports = DevTools;
