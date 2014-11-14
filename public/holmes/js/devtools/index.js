var $ = require('jquery');
var util = require('util');
var Hogan = require('hogan');

var tScope = Hogan.compile('{{#scope}}'+
  '<tr>'+
    '<td>{{name}}</td>' +
    '<td><small>{{value}}</small></td>' +
  '</tr>'+
'{{/scope}}');
var tStack = Hogan.compile('{{#stack}}'+
  '<tr>'+
    '<td>{{name}}</td>'+
    '<td><small>{{filename}}</small></td>'+
  '</tr>'+
'{{/stack}}');

function renderStack(stack) {
  return tStack.render({stack: stack.slice().reverse()});
}
function renderScope(frame) {
  $.each(frame.scope, function (i, o) {
    o.value = frame.evalInScope(o.name) + '';
  });
  return tScope.render(frame);
}


/**
 * @constructor
 * @param {EventEmitter} emitter
 * @param {array<File>} files
 */
function DevTools(emitter, files) {
  this.container = $('#console');
  this.currentStepNo = 0;
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
  emitter.on('lineNo', this.$onRewind.bind(this));
  $('.resume').on('click', this.$onResume.bind(this));
  $('.step-over').on('click', this.$onStepOver.bind(this));
  $('.step-out').on('click', this.$onStepOut.bind(this));
  $('.step-in').on('click', this.$onStepIn.bind(this));
};

DevTools.prototype.$onRewind = function(lineno, stepno) {
  this.currentStepNo = stepno;
  if(!this.steps || !stepno) {
    return;
  }
  var step = this.steps[stepno];
  $(".var-scope tbody").empty();
  $.each(step.scope, function (stepno, step) {
    $(".var-scope tbody").append("<tr><td>"+step.name+"</td><td>"+step.value+"</td></tr>");
  });
};

DevTools.prototype.$resetDebugger = function() {
  var iframeElement = document.getElementById('browser');
  iframeElement.innerHTML = '';
  var debug = debugjs.createDebugger({
    iframeParentElement: iframeElement
  });
  var context = debug.getContext();
  // TODO: push that down to context-eval.
  context.iframe.style.display = 'block';
  //debug.machine.on('error', this.$logError.bind(this));
  var doc = context.iframe.contentDocument;
  doc.open();
  doc.write(this.$getCode().html);
  doc.close();
  // $.each(this.files, function (f) {
  //   debug.addBreakpoints(f.filename, [2]);
  // });
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
  var i = 0;
  this.steps = [];
  var stack = this.debug.getCallStack();
  while (!this.debug.halted()) {
    var stack = this.debug.getCallStack();
    var frame = stack[stack.length - 1];
    $.each(frame.scope, function (i, o) {
      o.value = frame.evalInScope(o.name) + '';
    });
    var point = {
      y: this.debug.getCurrentLoc().start.line,
      x: i + 1,
      scope: frame.scope
    };
    this.steps.push(point);
    this.debug.stepIn();
    i++;
  }
  this.$printStackFrame(this.currentStepNo);
  console.log(this.steps);
  console.log(this.currentStepNo);
  this.emitter.emit('component-debugger:finishedRunning', this.steps, this.currentStepNo);

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

DevTools.prototype.$printStackFrame = function(stepno) {
  this.$onRewind(null, stepno);
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
  this.$resetDebugger();
  this.debug.load(this.$getCode().js, 'index.js');
  this.debug.run();
};


module.exports = DevTools;
