!function(e){if("object"==typeof exports)module.exports=e();else if("function"==typeof define&&define.amd)define(e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.debugjs=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var Debugger = require('./lib/debugger');
var Machine = require('./lib/machine');

/**
 * Sugar to create a debugger without worrying about the machine.
 * @api
 * @param options
 */
function createDebugger(options) {
    options = options || {};
    return new Debugger(new Machine(options.sandbox, options));
}

module.exports = {
  Debugger: Debugger,
  Machine: Machine,
  createDebugger: createDebugger
};


},{"./lib/debugger":2,"./lib/machine":3}],2:[function(require,module,exports){
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;

/**
 * @constructor
 * @param {Machine} machine
 */
function Debugger(machine) {
  this.machine = machine;
  machine.on('debugger', this.$machineDebuggerHandler.bind(this));
  machine.on('event', this.run.bind(this));
  this.$breakpoints = {};
  EventEmitter.call(this);
}

inherits(Debugger, EventEmitter);

/**
 * @api
 * @param {string} filename
 * @return {array}
 */
Debugger.prototype.getBreakpoints = function (filename) {
  return this.$breakpoints[filename];
};

/**
 * @api
 * @param {string} filename
 * @param {array<number>} linenos
 * @return {Machine}
 */
Debugger.prototype.addBreakpoints = function (filename, linenos) {
  if (!this.$breakpoints[filename]) {
    this.$breakpoints[filename] = {};
  }
  linenos.forEach(function (lineno) {
    this.$breakpoints[filename][lineno] = true;
  }, this);
  return this;
};

/**
 * @api
 * @param {string} filename
 * @param {array<number>} linenos
 * @return {Machine}
 */
Debugger.prototype.removeBreakpoints = function (filename, linenos) {
  if (!linenos) {
    this.$breakpoints[filename] = null;
  } else {
    linenos.forEach(function (lineno) {
      var fileBp = this.$breakpoints[filename];
      if (fileBp) {
        fileBp[lineno] = null;
      }
    }, this);
  }
};

Debugger.prototype.$machineDebuggerHandler = function (step) {
  var stack = this.getCallStack();
  var filename = stack[stack.length - 1].filename;
  this.$breakpointHandler({
    filename: filename,
    lineno: step.start.line,
    step: step,
    stack: stack
  });
};

Debugger.prototype.$pauseIfNotHalted = function () {
  if (!this.machine.halted) {
    this.machine.pause();
  }
};

Debugger.prototype.$breakpointHandler = function (data) {
    this.breakpointData = data;
    this.machine.pause();
    this.emit('breakpoint', this.breakpointData);
};

Debugger.prototype.$step = function () {
  this.machine.step();
  var val = this.machine.getState().value;
  if (val && val.type === 'step') {
    var filename = this.machine.getCurrentFilename();
    var fileBp = this.$breakpoints[filename];
    if (fileBp && fileBp[val.start.line]) {
      this.$breakpointHandler({
        filename: filename,
        lineno: val.start.line,
        step: val,
        stack: this.getCallStack()
      });
    }
  }
};


/**
 * @api
 * @param {object} options
 */
Debugger.prototype.getCallStack = function (options) {
  options = options || {};
  if (!options.raw) {
    // Most end users will probably just want the function call stack without
    // all the system stuff.
    return this.machine.getCallStack().filter(function (frame) {
      if (frame.type !== 'stackFrame') {
        return false;
      } else {
        return true;
      }
    });
  } else {
    return this.machine.getCallStack();
  }
};

/**
 * @api
 * @param {object} options
 */
Debugger.prototype.run = function () {
  this.machine.resume();
  var machine = this.machine;
  while (!machine.halted && !machine.paused) {
    this.$step();
  }
  return this;
};

/**
 * @api
 * @return {Machine}
 */
Debugger.prototype.stepOver = function () {
  this.machine.resume();
  var machine = this.machine;
  var len = this.getCallStack({ raw: true }).length;
  var state = machine.getState();
  if (state.value && state.value.type === 'functionCall') {
    // If we are in a thunk (a function that hasn't been called yet) we ignore
    // it and step over.
    len -= 1;
  }
  do {
    this.$step();
  } while ((this.getCallStack({ raw: true }).length > len) &&
            !machine.halted &&
            !machine.paused);
  this.$pauseIfNotHalted();
  return this;
};

/**
 * @api
 * @return {Machine}
 */
Debugger.prototype.stepIn = function () {
  this.machine.resume();
  this.machine.step();
  var state = this.machine.getState();
  if (state.value && state.value.type === 'functionCall') {
    this.machine.step();
  }
  this.$pauseIfNotHalted();
  return this;
};

Debugger.prototype.$stepOutCondition = function (len) {
  var machine = this.machine;
  var state = machine.getState();
  var curLen = this.getCallStack({ raw: true }).length;
  return curLen > len &&
    // This is testing whether we jumped into a new function call without
    // stepping out of our thunk stack frame. Could happen in an expression
    // statement with two function calls.
    !((curLen === len + 1) &&
      state.value && state.value.type === 'functionCall') &&
    !machine.paused && !machine.halted;
};

/**
 * @api
 * @return {Machine}
 */
Debugger.prototype.stepOut = function () {
  this.machine.resume();
  var len = this.getCallStack({ raw: true }).length - 1;
  while (this.$stepOutCondition(len)) {
    this.$step();
  }
  this.$pauseIfNotHalted();
  return this;
};

/**
 * @api
 * @return {Machine}
 */
Debugger.prototype.load = function (code, filename) {
  this.machine.evaluate(code, filename);
  return this;
};

Debugger.prototype.paused = function () {
  return this.machine.paused;
};

Debugger.prototype.halted = function () {
  return this.machine.halted;
};

Debugger.prototype.getCurrentLoc = function () {
  return this.machine.getCurrentLoc();
};

Debugger.prototype.getContext = function () {
  return this.machine.context;
};

Debugger.prototype.getCurrentStackFrame = function () {
  var stack = this.getCallStack();
  return stack[stack.length - 1];
};

module.exports = Debugger;

},{"events":72,"util":77}],3:[function(require,module,exports){
var recast = require('recast');
var transform = require('./transform');
var Context = require('context-eval');
var isGenSupported = require('generator-supported');
var regenerator = require('regenerator');
var fs = require('fs');
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;

/**
 * @constructor
 * @param {function} fn The actual thunk function to invoke.
 * @param {object} thisp The context (this) for which the thunk existed.
 */
function Thunk(fn, thisp, args) {
  this.fn = fn;
  this.thisp = thisp;
  this.args = args;
}

/**
 * @return {*} either a value from a function call from outside our system or
 *              a generator object (from our system).
 */
Thunk.prototype.invoke = function () {
  return this.fn.apply(this.thisp, this.args);
};

/**
 * shortcut for `Thunk` construct to not use `new`
 */
function createThunk(fn, thisp, args) {
  return new Thunk(fn, thisp, args);
}

/**
 * @constructor
 */
function Timers() {
  this.$q = [];
  this.timeElapsed = 0;
  this.$uid = 0;
  this.$nextTick = null;
}

inherits(Timers, EventEmitter);

Timers.prototype.$scheduleNextTick = function () {
  if (this.$q.length) {
    clearTimeout(this.$nextTick);
    this.$nextTick =
      setTimeout(this.$tick.bind(this), this.$q[0].when - this.timeElapsed);
  }
};

/**
 * Main timer loop.
 */
Timers.prototype.$tick = function () {
  if (this.$idleTimeStart) {
    this.timeElapsed += Date.now() - this.$idleTimeStart;
    this.$idleTimeStart = Date.now();
  }
  var timer = this.$q[0];
  if (timer && (timer.when <= this.timeElapsed)) {
    this.$q.shift();
    if (timer.interval) {
      // Need to account for lost time between calls to the first time and
      // subsquent timers.
      var after = timer.after - (this.timeElapsed - timer.when);
      this.$setTimer(timer.genFn, after, timer.args, true, timer.id);
    }
    this.emit('timer', timer);
  }
  this.$scheduleNextTick();
};

/**
 * Sets setInterval and setTimeout timers.
 * @param {Generator Function} genFn
 * @param {number} after
 * @param {array<*>} args
 * @param {boolean} isInterval
 * @param {number} id
 * @return {number} id
 */
Timers.prototype.$setTimer = function (genFn, after, args, isInterval, id) {
  // setInterval have an Id because they repeat themselves.
  if (id == null) {
    id = ++this.$uid;
  }
  var when = this.timeElapsed + after;
  var q = this.$q;
  var i;
  // We maintain a sorted queue ascending by time to execute.
  for (i = 0; i < q.length; i++) {
    if (q[i].when > when) {
      break;
    }
  }
  q.splice(i, 0, {
    genFn: genFn,
    after: after,
    when: when,
    id: id,
    args: args,
    interval: isInterval
  });

  this.$scheduleNextTick();
  return id;
};

/**
 * @api
 * @param {Generator Function} genFn
 * @param {number} after
 * @return {number} id
 */
Timers.prototype.setTimeout = function (genFn, after) {
  var args = Array.prototype.slice.call(arguments, 2);
  return this.$setTimer(genFn, after, args, false);
};

/**
 * @api
 * @param {Generator Function} genFn
 * @param {number} after
 * @return {number} id
 */
Timers.prototype.setInterval = function (genFn, after) {
  var args = Array.prototype.slice.call(arguments, 2);
  return this.$setTimer(genFn, after, args, true);
};

/**
 * @api
 * @param {Generator Function} genFn
 * @param {number} after
 * @return {number} id
 */
Timers.prototype.clearTimeout =
Timers.prototype.clearInterval = function (id) {
  var q = this.$q;
  for (var i = 0; i < q.length; i++) {
    if (q[i].id === id) {
      q.splice(i, 1);
      break;
    }
  }
};

/**
 * Starts a timer for a single step.
 * @api
 */
Timers.prototype.step = function () {
  this.$start = Date.now();
};

/**
 * Stop and increment system time for an execution step.
 * @api
 */
Timers.prototype.stepEnd = function (halted) {
  this.timeElapsed += Date.now() - this.$start;
  if (halted) {
    this.$idleTimeStart = Date.now();
  } else {
    this.$idleTimeStart = null;
  }
};

/**
 * @constructor The runner object that lives in the sandbox to run stuff.
 */
function Runner(timers) {
  this.timers = timers;
}

/**
 * @api
 * @param {Generator} gen The first generator in our callstack.
 */
Runner.prototype.init = function (gen) {
  this.gen = gen;
  this.stack = [];
  this.state = {
    value: null,
    done: false
  };
};


/**
 * Propogate error up the call stack.
 * @param {object} e
 */
Runner.prototype.$propError = function (e) {
  while (this.stack.length) {
    this.gen = this.stack.pop();
    try {
      this.gen.throw(e);
      return;
    } catch (e2) {
      e = e2;
    }
  }
  throw e;
};

Runner.prototype.instantiate = function (genFn) {
  var o = Object.create(genFn.prototype);
  var args = Array.prototype.slice.call(arguments, 1);
  var gen = genFn.apply(o, args);
  var val = gen;
  if (isGen(gen)) {
    while (!(val = gen.next()).done);
    val = val.value;
  }
  if (val !== undefined) {
    return val;
  } else {
    return o;
  }
};

/**
 * @param {*} val
 * @return {boolean}
 */
function isGen(val) {
  return val && val.toString() === '[object Generator]';
}

/**
 * This is the main run "loop". It maintains a callstack `this.stack` and on
 * each step it will call next on the current generator `this.gen` with an
 * optional value `val`. The resulting value from `gen.next` could be:
 *  1. a thunk, which means this is a function call
 *  2. a step info (location etc.)
 *  3. this current generator is done and the following could happen:
 *     a. a resulting generator object, which means a thunk (generator) finished
 *        executing and the result is a function call within our system that
 *        we can pop into. We simply replace the current generator with this
 *        function call
 *     b. we're done with a regular function call and we need to pass the value
 *        as the resulting `yield` expression.
 *
 * @api
 * @param {*} val The value of the yield expression to pass to the generator.
 */
Runner.prototype.step = function (val) {
  this.timers.step();
  try {
    this.state = this.gen.next(val);
  } catch (e) {
    this.$propError(e);
    return;
  } finally {
    this.timers.stepEnd(
      this.state.done &&
      !isGen(this.state.value) &&
      !this.stack.length
    );
  }
  if (this.state.value && this.state.value instanceof Thunk) {
    this.stack.push(this.gen);
    this.gen = this.state.value.invoke();
    this.gen.type = 'thunk';
    this.step();
  } else if (this.state.value && this.state.value.type === 'stackFrame') {
    this.gen.stackFrame = this.state.value;
    this.step();
  } else if (this.state.done) {
    if (isGen(this.state.value)) {
      this.gen = this.state.value;
      this.gen.type = 'functionCall';
      this.state.done = false;
    } else if (this.stack.length) {
      this.gen = this.stack.pop();
      this.step(this.state.value);
    }
  }
};

/**
 * @api
 * @constructor
 * @param {object} sandbox An object with references to be copied into the context.
 * @param {object} options Optional arguments.
 */
function Machine(sandbox, options) {
  sandbox = sandbox || {};
  options = options || {};
  this.$anonFileId = 0;
  this.halted = false;
  this.paused = false;
  this.timers = new Timers();
  this.$runner = new Runner(this.timers);
  this.$evq = [];
  sandbox.__runner = this.$runner;
  sandbox.__thunk = createThunk;
  sandbox.__wrapListener = this.$wrapListener.bind(this);
  sandbox.__instantiate = this.$runner.instantiate.bind(this.$runner);
  sandbox.setTimeout = this.timers.setTimeout.bind(this.timers);
  sandbox.setInterval = this.timers.setInterval.bind(this.timers);
  sandbox.clearTimeout = this.timers.clearTimeout.bind(this.timers);
  sandbox.clearInterval = this.timers.clearInterval.bind(this.timers);
  sandbox.console = sandbox.console || console;
  this.context = new Context(sandbox, options.iframeParentElement);
  this.context.global = this.context.evaluate('this');
  this.$bootstrapRuntime();
  this.timers.on('timer', this.$onTimer.bind(this));
}

inherits(Machine, EventEmitter);

/**
 * @param {string} code
 * @returns {string} transformed code.
 */
Machine.prototype.$transform = function (code, filename) {
  var ast = recast.parse(code);
  filename = filename || ('file' + (++this.$anonFileId));
  var transformed = transform(ast, { filename: filename });
  if (!isGenSupported) {
    transformed = regenerator.transform(transformed);
  }
  return recast.print(transformed).code;
};

/**
 * @param {string} transformedCode
 * @return {Machine} this
 */
Machine.prototype.$evaluate = function(transformedCode) {
  this.context.evaluate(transformedCode);
  this.$setHalted(false);
  this.context.evaluate('__runner.init(__top());');
  return this;
};

/**
 * Bootstraps the environment with the necessary runtime.
 */
Machine.prototype.$bootstrapRuntime = function () {
  var regeneratorRuntime = "/**\n * Copyright (c) 2013, Facebook, Inc.\n * All rights reserved.\n *\n * This source code is licensed under the BSD-style license found in the\n * https://raw.github.com/facebook/regenerator/master/LICENSE file. An\n * additional grant of patent rights can be found in the PATENTS file in\n * the same directory.\n */\n\n(function(\n  // Reliable reference to the global object (i.e. window in browsers).\n  global,\n\n  // Dummy constructor that we use as the .constructor property for\n  // functions that return Generator objects.\n  GeneratorFunction\n) {\n  var hasOwn = Object.prototype.hasOwnProperty;\n\n  if (global.wrapGenerator) {\n    return;\n  }\n\n  function wrapGenerator(innerFn, self) {\n    return new Generator(innerFn, self || null);\n  }\n\n  global.wrapGenerator = wrapGenerator;\n  if (typeof exports !== \"undefined\") {\n    exports.wrapGenerator = wrapGenerator;\n  }\n\n  var GenStateSuspendedStart = \"suspendedStart\";\n  var GenStateSuspendedYield = \"suspendedYield\";\n  var GenStateExecuting = \"executing\";\n  var GenStateCompleted = \"completed\";\n\n  // Returning this object from the innerFn has the same effect as\n  // breaking out of the dispatch switch statement.\n  var ContinueSentinel = {};\n\n  wrapGenerator.mark = function(genFun) {\n    genFun.constructor = GeneratorFunction;\n    return genFun;\n  };\n\n  // Ensure isGeneratorFunction works when Function#name not supported.\n  if (GeneratorFunction.name !== \"GeneratorFunction\") {\n    GeneratorFunction.name = \"GeneratorFunction\";\n  }\n\n  wrapGenerator.isGeneratorFunction = function(genFun) {\n    var ctor = genFun && genFun.constructor;\n    return ctor ? GeneratorFunction.name === ctor.name : false;\n  };\n\n  function Generator(innerFn, self) {\n    var generator = this;\n    var context = new Context();\n    var state = GenStateSuspendedStart;\n\n    function invoke() {\n      state = GenStateExecuting;\n      do {\n        var value = innerFn.call(self, context);\n      } while (value === ContinueSentinel);\n      // If an exception is thrown from innerFn, we leave state ===\n      // GenStateExecuting and loop back for another invocation.\n      state = context.done\n        ? GenStateCompleted\n        : GenStateSuspendedYield;\n      return { value: value, done: context.done };\n    }\n\n    function assertCanInvoke() {\n      if (state === GenStateExecuting) {\n        throw new Error(\"Generator is already running\");\n      }\n\n      if (state === GenStateCompleted) {\n        throw new Error(\"Generator has already finished\");\n      }\n    }\n\n    function handleDelegate(method, arg) {\n      var delegate = context.delegate;\n      if (delegate) {\n        try {\n          var info = delegate.generator[method](arg);\n        } catch (uncaught) {\n          context.delegate = null;\n          return generator.throw(uncaught);\n        }\n\n        if (info) {\n          if (info.done) {\n            context[delegate.resultName] = info.value;\n            context.next = delegate.nextLoc;\n          } else {\n            return info;\n          }\n        }\n\n        context.delegate = null;\n      }\n    }\n\n    generator.next = function(value) {\n      assertCanInvoke();\n\n      var delegateInfo = handleDelegate(\"next\", value);\n      if (delegateInfo) {\n        return delegateInfo;\n      }\n\n      if (state === GenStateSuspendedYield) {\n        context.sent = value;\n      }\n\n      while (true) try {\n        return invoke();\n      } catch (exception) {\n        context.dispatchException(exception);\n      }\n    };\n\n    generator.throw = function(exception) {\n      assertCanInvoke();\n\n      var delegateInfo = handleDelegate(\"throw\", exception);\n      if (delegateInfo) {\n        return delegateInfo;\n      }\n\n      if (state === GenStateSuspendedStart) {\n        state = GenStateCompleted;\n        throw exception;\n      }\n\n      while (true) {\n        context.dispatchException(exception);\n        try {\n          return invoke();\n        } catch (thrown) {\n          exception = thrown;\n        }\n      }\n    };\n  }\n\n  Generator.prototype.toString = function() {\n    return \"[object Generator]\";\n  };\n\n  function Context() {\n    this.reset();\n  }\n\n  Context.prototype = {\n    constructor: Context,\n\n    reset: function() {\n      this.next = 0;\n      this.sent = void 0;\n      this.tryStack = [];\n      this.done = false;\n      this.delegate = null;\n\n      // Pre-initialize at least 20 temporary variables to enable hidden\n      // class optimizations for simple generators.\n      for (var tempIndex = 0, tempName;\n           hasOwn.call(this, tempName = \"t\" + tempIndex) || tempIndex < 20;\n           ++tempIndex) {\n        this[tempName] = null;\n      }\n    },\n\n    stop: function() {\n      this.done = true;\n\n      if (hasOwn.call(this, \"thrown\")) {\n        var thrown = this.thrown;\n        delete this.thrown;\n        throw thrown;\n      }\n\n      return this.rval;\n    },\n\n    keys: function(object) {\n      return Object.keys(object).reverse();\n    },\n\n    pushTry: function(catchLoc, finallyLoc, finallyTempVar) {\n      if (finallyLoc) {\n        this.tryStack.push({\n          finallyLoc: finallyLoc,\n          finallyTempVar: finallyTempVar\n        });\n      }\n\n      if (catchLoc) {\n        this.tryStack.push({\n          catchLoc: catchLoc\n        });\n      }\n    },\n\n    popCatch: function(catchLoc) {\n      var lastIndex = this.tryStack.length - 1;\n      var entry = this.tryStack[lastIndex];\n\n      if (entry && entry.catchLoc === catchLoc) {\n        this.tryStack.length = lastIndex;\n      }\n    },\n\n    popFinally: function(finallyLoc) {\n      var lastIndex = this.tryStack.length - 1;\n      var entry = this.tryStack[lastIndex];\n\n      if (!entry || !hasOwn.call(entry, \"finallyLoc\")) {\n        entry = this.tryStack[--lastIndex];\n      }\n\n      if (entry && entry.finallyLoc === finallyLoc) {\n        this.tryStack.length = lastIndex;\n      }\n    },\n\n    dispatchException: function(exception) {\n      var finallyEntries = [];\n      var dispatched = false;\n\n      if (this.done) {\n        throw exception;\n      }\n\n      // Dispatch the exception to the \"end\" location by default.\n      this.thrown = exception;\n      this.next = \"end\";\n\n      for (var i = this.tryStack.length - 1; i >= 0; --i) {\n        var entry = this.tryStack[i];\n        if (entry.catchLoc) {\n          this.next = entry.catchLoc;\n          dispatched = true;\n          break;\n        } else if (entry.finallyLoc) {\n          finallyEntries.push(entry);\n          dispatched = true;\n        }\n      }\n\n      while ((entry = finallyEntries.pop())) {\n        this[entry.finallyTempVar] = this.next;\n        this.next = entry.finallyLoc;\n      }\n    },\n\n    delegateYield: function(generator, resultName, nextLoc) {\n      var info = generator.next(this.sent);\n\n      if (info.done) {\n        this.delegate = null;\n        this[resultName] = info.value;\n        this.next = nextLoc;\n\n        return ContinueSentinel;\n      }\n\n      this.delegate = {\n        generator: generator,\n        resultName: resultName,\n        nextLoc: nextLoc\n      };\n\n      return info.value;\n    }\n  };\n}).apply(this, Function(\"return [this, function GeneratorFunction(){}]\")());\n".toString();
  this.context.evaluate(regeneratorRuntime);

  var arrayRuntime = "// Shortcut to an often accessed properties, in order to avoid multiple\n// dereference that costs universally.\n// _Please note: Shortcuts are defined after `Function.prototype.bind` as we\n// us it in defining shortcuts.\nwrapGenerator.mark(__top);\n\nfunction __top() {\n    var call, prototypeOfObject, _toString, toObject, boxedString, splitString;\n\n    return wrapGenerator(function __top$($ctx1) {\n        while (1) switch ($ctx1.next) {\n        case 0:\n            $ctx1.next = 2;\n\n            return {\n                \"type\": \"stackFrame\",\n                \"filename\": \"array.js\",\n                \"name\": \"Global Scope\",\n\n                \"scope\": [{\n                    \"name\": \"call\",\n\n                    \"locs\": [{\n                        \"start\": {\n                            \"line\": 5,\n                            \"column\": 4\n                        },\n\n                        \"end\": {\n                            \"line\": 5,\n                            \"column\": 8\n                        }\n                    }]\n                }, {\n                    \"name\": \"prototypeOfObject\",\n\n                    \"locs\": [{\n                        \"start\": {\n                            \"line\": 6,\n                            \"column\": 4\n                        },\n\n                        \"end\": {\n                            \"line\": 6,\n                            \"column\": 21\n                        }\n                    }]\n                }, {\n                    \"name\": \"_toString\",\n\n                    \"locs\": [{\n                        \"start\": {\n                            \"line\": 8,\n                            \"column\": 4\n                        },\n\n                        \"end\": {\n                            \"line\": 8,\n                            \"column\": 13\n                        }\n                    }]\n                }, {\n                    \"name\": \"toObject\",\n\n                    \"locs\": [{\n                        \"start\": {\n                            \"line\": 9,\n                            \"column\": 4\n                        },\n\n                        \"end\": {\n                            \"line\": 9,\n                            \"column\": 12\n                        }\n                    }]\n                }, {\n                    \"name\": \"boxedString\",\n\n                    \"locs\": [{\n                        \"start\": {\n                            \"line\": 17,\n                            \"column\": 4\n                        },\n\n                        \"end\": {\n                            \"line\": 17,\n                            \"column\": 15\n                        }\n                    }]\n                }, {\n                    \"name\": \"splitString\",\n\n                    \"locs\": [{\n                        \"start\": {\n                            \"line\": 18,\n                            \"column\": 4\n                        },\n\n                        \"end\": {\n                            \"line\": 18,\n                            \"column\": 15\n                        }\n                    }]\n                }],\n\n                \"evalInScope\": function(expr) {\n                    return eval(expr);\n                }\n            }\n        case 2:\n            call = Function.prototype.call;\n            prototypeOfObject = Object.prototype;\n            $ctx1.next = 6;\n\n            return __thunk(wrapGenerator.mark(function thunk() {\n                return wrapGenerator(function thunk$($ctx2) {\n                    while (1) switch ($ctx2.next) {\n                    case 0:\n                        $ctx2.rval = call.bind(prototypeOfObject.toString);\n                        delete $ctx2.thrown;\n                        $ctx2.next = 4;\n                        break;\n                    case 4:\n                    case \"end\":\n                        return $ctx2.stop();\n                    }\n                }, this);\n            }), this);\n        case 6:\n            _toString = $ctx1.sent;\n\n            toObject = wrapGenerator.mark(function(o) {\n                return wrapGenerator(function($ctx3) {\n                    while (1) switch ($ctx3.next) {\n                    case 0:\n                        $ctx3.next = 2;\n\n                        return {\n                            \"type\": \"stackFrame\",\n                            \"filename\": \"array.js\",\n                            \"name\": \"anonymous function\",\n\n                            \"scope\": [{\n                                \"name\": \"o\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 9,\n                                        \"column\": 25\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 9,\n                                        \"column\": 26\n                                    }\n                                }]\n                            }],\n\n                            \"evalInScope\": function(expr) {\n                                return eval(expr);\n                            }\n                        }\n                    case 2:\n                        if (!(o == null)) {\n                            $ctx3.next = 4;\n                            break;\n                        }\n\n                        throw new TypeError(\"can't convert \"+o+\" to object\");\n                    case 4:\n                        $ctx3.next = 6;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx4) {\n                                while (1) switch ($ctx4.next) {\n                                case 0:\n                                    $ctx4.rval = Object(o);\n                                    delete $ctx4.thrown;\n                                    $ctx4.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx4.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 6:\n                        $ctx3.rval = $ctx3.sent;\n                        delete $ctx3.thrown;\n                        $ctx3.next = 10;\n                        break;\n                    case 10:\n                    case \"end\":\n                        return $ctx3.stop();\n                    }\n                }, this);\n            });\n\n            $ctx1.next = 10;\n\n            return __thunk(wrapGenerator.mark(function thunk() {\n                return wrapGenerator(function thunk$($ctx5) {\n                    while (1) switch ($ctx5.next) {\n                    case 0:\n                        $ctx5.rval = Object(\"a\");\n                        delete $ctx5.thrown;\n                        $ctx5.next = 4;\n                        break;\n                    case 4:\n                    case \"end\":\n                        return $ctx5.stop();\n                    }\n                }, this);\n            }), this);\n        case 10:\n            boxedString = $ctx1.sent;\n            splitString = boxedString[0] != \"a\" || !(0 in boxedString);\n\n            Array.prototype.forEach = wrapGenerator.mark(function forEach(fun /*, thisp*/) {\n                var object, self, thisp, i, length, $args = arguments;\n\n                return wrapGenerator(function forEach$($ctx6) {\n                    while (1) switch ($ctx6.next) {\n                    case 0:\n                        $ctx6.next = 2;\n\n                        return {\n                            \"type\": \"stackFrame\",\n                            \"filename\": \"array.js\",\n                            \"name\": \"forEach\",\n\n                            \"scope\": [{\n                                \"name\": \"fun\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 19,\n                                        \"column\": 43\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 19,\n                                        \"column\": 46\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"object\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 20,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 20,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"self\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 21,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 21,\n                                        \"column\": 12\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"thisp\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 24,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 24,\n                                        \"column\": 13\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"i\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 25,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 25,\n                                        \"column\": 9\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"length\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 26,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 26,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }],\n\n                            \"evalInScope\": function(expr) {\n                                return eval(expr);\n                            }\n                        }\n                    case 2:\n                        $ctx6.next = 4;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx7) {\n                                while (1) switch ($ctx7.next) {\n                                case 0:\n                                    $ctx7.rval = toObject(this);\n                                    delete $ctx7.thrown;\n                                    $ctx7.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx7.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 4:\n                        object = $ctx6.sent;\n                        $ctx6.t0 = splitString;\n\n                        if (!$ctx6.t0) {\n                            $ctx6.next = 11;\n                            break;\n                        }\n\n                        $ctx6.next = 9;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx8) {\n                                while (1) switch ($ctx8.next) {\n                                case 0:\n                                    $ctx8.rval = _toString(this);\n                                    delete $ctx8.thrown;\n                                    $ctx8.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx8.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 9:\n                        $ctx6.t1 = $ctx6.sent;\n                        $ctx6.t0 = $ctx6.t1 == \"[object String]\";\n                    case 11:\n                        if (!$ctx6.t0) {\n                            $ctx6.next = 17;\n                            break;\n                        }\n\n                        $ctx6.next = 14;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx9) {\n                                while (1) switch ($ctx9.next) {\n                                case 0:\n                                    $ctx9.rval = this.split(\"\");\n                                    delete $ctx9.thrown;\n                                    $ctx9.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx9.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 14:\n                        $ctx6.t2 = $ctx6.sent;\n                        $ctx6.next = 18;\n                        break;\n                    case 17:\n                        $ctx6.t2 = object;\n                    case 18:\n                        self = $ctx6.t2;\n                        thisp = $args[1];\n                        i = -1;\n                        length = self.length >>> 0;\n                        $ctx6.next = 24;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx10) {\n                                while (1) switch ($ctx10.next) {\n                                case 0:\n                                    $ctx10.rval = _toString(fun);\n                                    delete $ctx10.thrown;\n                                    $ctx10.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx10.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 24:\n                        $ctx6.t3 = $ctx6.sent;\n\n                        if (!($ctx6.t3 != \"[object Function]\")) {\n                            $ctx6.next = 27;\n                            break;\n                        }\n\n                        throw new TypeError();\n                    case 27:\n                        if (!(++i < length)) {\n                            $ctx6.next = 33;\n                            break;\n                        }\n\n                        if (!(i in self)) {\n                            $ctx6.next = 31;\n                            break;\n                        }\n\n                        $ctx6.next = 31;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx11) {\n                                while (1) switch ($ctx11.next) {\n                                case 0:\n                                    $ctx11.rval = fun.call(thisp, self[i], i, object);\n                                    delete $ctx11.thrown;\n                                    $ctx11.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx11.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 31:\n                        $ctx6.next = 27;\n                        break;\n                    case 33:\n                    case \"end\":\n                        return $ctx6.stop();\n                    }\n                }, this);\n            });\n\n            Array.prototype.map = wrapGenerator.mark(function map(fun /*, thisp*/) {\n                var object, self, length, result, thisp, i, $args = arguments;\n\n                return wrapGenerator(function map$($ctx12) {\n                    while (1) switch ($ctx12.next) {\n                    case 0:\n                        $ctx12.next = 2;\n\n                        return {\n                            \"type\": \"stackFrame\",\n                            \"filename\": \"array.js\",\n                            \"name\": \"map\",\n\n                            \"scope\": [{\n                                \"name\": \"fun\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 44,\n                                        \"column\": 35\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 44,\n                                        \"column\": 38\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"object\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 45,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 45,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"self\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 46,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 46,\n                                        \"column\": 12\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"length\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 49,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 49,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"result\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 50,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 50,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"thisp\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 51,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 51,\n                                        \"column\": 13\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"i\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 58,\n                                        \"column\": 13\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 58,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }],\n\n                            \"evalInScope\": function(expr) {\n                                return eval(expr);\n                            }\n                        }\n                    case 2:\n                        $ctx12.next = 4;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx13) {\n                                while (1) switch ($ctx13.next) {\n                                case 0:\n                                    $ctx13.rval = toObject(this);\n                                    delete $ctx13.thrown;\n                                    $ctx13.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx13.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 4:\n                        object = $ctx12.sent;\n                        $ctx12.t4 = splitString;\n\n                        if (!$ctx12.t4) {\n                            $ctx12.next = 11;\n                            break;\n                        }\n\n                        $ctx12.next = 9;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx14) {\n                                while (1) switch ($ctx14.next) {\n                                case 0:\n                                    $ctx14.rval = _toString(this);\n                                    delete $ctx14.thrown;\n                                    $ctx14.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx14.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 9:\n                        $ctx12.t5 = $ctx12.sent;\n                        $ctx12.t4 = $ctx12.t5 == \"[object String]\";\n                    case 11:\n                        if (!$ctx12.t4) {\n                            $ctx12.next = 17;\n                            break;\n                        }\n\n                        $ctx12.next = 14;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx15) {\n                                while (1) switch ($ctx15.next) {\n                                case 0:\n                                    $ctx15.rval = this.split(\"\");\n                                    delete $ctx15.thrown;\n                                    $ctx15.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx15.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 14:\n                        $ctx12.t6 = $ctx12.sent;\n                        $ctx12.next = 18;\n                        break;\n                    case 17:\n                        $ctx12.t6 = object;\n                    case 18:\n                        self = $ctx12.t6;\n                        length = self.length >>> 0;\n                        $ctx12.next = 22;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx16) {\n                                while (1) switch ($ctx16.next) {\n                                case 0:\n                                    $ctx16.rval = Array(length);\n                                    delete $ctx16.thrown;\n                                    $ctx16.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx16.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 22:\n                        result = $ctx12.sent;\n                        thisp = $args[1];\n                        $ctx12.next = 26;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx17) {\n                                while (1) switch ($ctx17.next) {\n                                case 0:\n                                    $ctx17.rval = _toString(fun);\n                                    delete $ctx17.thrown;\n                                    $ctx17.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx17.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 26:\n                        $ctx12.t7 = $ctx12.sent;\n\n                        if (!($ctx12.t7 != \"[object Function]\")) {\n                            $ctx12.next = 29;\n                            break;\n                        }\n\n                        throw new TypeError(fun + \" is not a function\");\n                    case 29:\n                        i = 0;\n                    case 30:\n                        if (!(i < length)) {\n                            $ctx12.next = 38;\n                            break;\n                        }\n\n                        if (!(i in self)) {\n                            $ctx12.next = 35;\n                            break;\n                        }\n\n                        $ctx12.next = 34;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx18) {\n                                while (1) switch ($ctx18.next) {\n                                case 0:\n                                    $ctx18.rval = fun.call(thisp, self[i], i, object);\n                                    delete $ctx18.thrown;\n                                    $ctx18.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx18.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 34:\n                        result[i] = $ctx12.sent;\n                    case 35:\n                        i++;\n                        $ctx12.next = 30;\n                        break;\n                    case 38:\n                        $ctx12.rval = result;\n                        delete $ctx12.thrown;\n                        $ctx12.next = 42;\n                        break;\n                    case 42:\n                    case \"end\":\n                        return $ctx12.stop();\n                    }\n                }, this);\n            });\n\n            Array.prototype.filter = wrapGenerator.mark(function filter(fun /*, thisp */) {\n                var object, self, length, result, value, thisp, i, $args = arguments;\n\n                return wrapGenerator(function filter$($ctx19) {\n                    while (1) switch ($ctx19.next) {\n                    case 0:\n                        $ctx19.next = 2;\n\n                        return {\n                            \"type\": \"stackFrame\",\n                            \"filename\": \"array.js\",\n                            \"name\": \"filter\",\n\n                            \"scope\": [{\n                                \"name\": \"fun\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 65,\n                                        \"column\": 41\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 65,\n                                        \"column\": 44\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"object\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 66,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 66,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"self\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 67,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 67,\n                                        \"column\": 12\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"length\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 70,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 70,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"result\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 71,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 71,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"value\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 72,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 72,\n                                        \"column\": 13\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"thisp\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 73,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 73,\n                                        \"column\": 13\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"i\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 80,\n                                        \"column\": 13\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 80,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }],\n\n                            \"evalInScope\": function(expr) {\n                                return eval(expr);\n                            }\n                        }\n                    case 2:\n                        $ctx19.next = 4;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx20) {\n                                while (1) switch ($ctx20.next) {\n                                case 0:\n                                    $ctx20.rval = toObject(this);\n                                    delete $ctx20.thrown;\n                                    $ctx20.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx20.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 4:\n                        object = $ctx19.sent;\n                        $ctx19.t8 = splitString;\n\n                        if (!$ctx19.t8) {\n                            $ctx19.next = 11;\n                            break;\n                        }\n\n                        $ctx19.next = 9;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx21) {\n                                while (1) switch ($ctx21.next) {\n                                case 0:\n                                    $ctx21.rval = _toString(this);\n                                    delete $ctx21.thrown;\n                                    $ctx21.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx21.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 9:\n                        $ctx19.t9 = $ctx19.sent;\n                        $ctx19.t8 = $ctx19.t9 == \"[object String]\";\n                    case 11:\n                        if (!$ctx19.t8) {\n                            $ctx19.next = 17;\n                            break;\n                        }\n\n                        $ctx19.next = 14;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx22) {\n                                while (1) switch ($ctx22.next) {\n                                case 0:\n                                    $ctx22.rval = this.split(\"\");\n                                    delete $ctx22.thrown;\n                                    $ctx22.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx22.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 14:\n                        $ctx19.t10 = $ctx19.sent;\n                        $ctx19.next = 18;\n                        break;\n                    case 17:\n                        $ctx19.t10 = object;\n                    case 18:\n                        self = $ctx19.t10;\n                        length = self.length >>> 0;\n                        result = [];\n                        thisp = $args[1];\n                        $ctx19.next = 24;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx23) {\n                                while (1) switch ($ctx23.next) {\n                                case 0:\n                                    $ctx23.rval = _toString(fun);\n                                    delete $ctx23.thrown;\n                                    $ctx23.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx23.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 24:\n                        $ctx19.t11 = $ctx19.sent;\n\n                        if (!($ctx19.t11 != \"[object Function]\")) {\n                            $ctx19.next = 27;\n                            break;\n                        }\n\n                        throw new TypeError(fun + \" is not a function\");\n                    case 27:\n                        i = 0;\n                    case 28:\n                        if (!(i < length)) {\n                            $ctx19.next = 39;\n                            break;\n                        }\n\n                        if (!(i in self)) {\n                            $ctx19.next = 36;\n                            break;\n                        }\n\n                        value = self[i];\n                        $ctx19.next = 33;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx24) {\n                                while (1) switch ($ctx24.next) {\n                                case 0:\n                                    $ctx24.rval = fun.call(thisp, value, i, object);\n                                    delete $ctx24.thrown;\n                                    $ctx24.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx24.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 33:\n                        if (!$ctx19.sent) {\n                            $ctx19.next = 36;\n                            break;\n                        }\n\n                        $ctx19.next = 36;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx25) {\n                                while (1) switch ($ctx25.next) {\n                                case 0:\n                                    $ctx25.rval = result.push(value);\n                                    delete $ctx25.thrown;\n                                    $ctx25.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx25.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 36:\n                        i++;\n                        $ctx19.next = 28;\n                        break;\n                    case 39:\n                        $ctx19.rval = result;\n                        delete $ctx19.thrown;\n                        $ctx19.next = 43;\n                        break;\n                    case 43:\n                    case \"end\":\n                        return $ctx19.stop();\n                    }\n                }, this);\n            });\n\n            Array.prototype.every = wrapGenerator.mark(function every(fun /*, thisp */) {\n                var object, self, length, thisp, i, $args = arguments;\n\n                return wrapGenerator(function every$($ctx26) {\n                    while (1) switch ($ctx26.next) {\n                    case 0:\n                        $ctx26.next = 2;\n\n                        return {\n                            \"type\": \"stackFrame\",\n                            \"filename\": \"array.js\",\n                            \"name\": \"every\",\n\n                            \"scope\": [{\n                                \"name\": \"fun\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 93,\n                                        \"column\": 39\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 93,\n                                        \"column\": 42\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"object\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 94,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 94,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"self\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 95,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 95,\n                                        \"column\": 12\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"length\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 98,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 98,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"thisp\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 99,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 99,\n                                        \"column\": 13\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"i\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 106,\n                                        \"column\": 13\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 106,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }],\n\n                            \"evalInScope\": function(expr) {\n                                return eval(expr);\n                            }\n                        }\n                    case 2:\n                        $ctx26.next = 4;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx27) {\n                                while (1) switch ($ctx27.next) {\n                                case 0:\n                                    $ctx27.rval = toObject(this);\n                                    delete $ctx27.thrown;\n                                    $ctx27.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx27.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 4:\n                        object = $ctx26.sent;\n                        $ctx26.t12 = splitString;\n\n                        if (!$ctx26.t12) {\n                            $ctx26.next = 11;\n                            break;\n                        }\n\n                        $ctx26.next = 9;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx28) {\n                                while (1) switch ($ctx28.next) {\n                                case 0:\n                                    $ctx28.rval = _toString(this);\n                                    delete $ctx28.thrown;\n                                    $ctx28.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx28.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 9:\n                        $ctx26.t13 = $ctx26.sent;\n                        $ctx26.t12 = $ctx26.t13 == \"[object String]\";\n                    case 11:\n                        if (!$ctx26.t12) {\n                            $ctx26.next = 17;\n                            break;\n                        }\n\n                        $ctx26.next = 14;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx29) {\n                                while (1) switch ($ctx29.next) {\n                                case 0:\n                                    $ctx29.rval = this.split(\"\");\n                                    delete $ctx29.thrown;\n                                    $ctx29.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx29.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 14:\n                        $ctx26.t14 = $ctx26.sent;\n                        $ctx26.next = 18;\n                        break;\n                    case 17:\n                        $ctx26.t14 = object;\n                    case 18:\n                        self = $ctx26.t14;\n                        length = self.length >>> 0;\n                        thisp = $args[1];\n                        $ctx26.next = 23;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx30) {\n                                while (1) switch ($ctx30.next) {\n                                case 0:\n                                    $ctx30.rval = _toString(fun);\n                                    delete $ctx30.thrown;\n                                    $ctx30.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx30.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 23:\n                        $ctx26.t15 = $ctx26.sent;\n\n                        if (!($ctx26.t15 != \"[object Function]\")) {\n                            $ctx26.next = 26;\n                            break;\n                        }\n\n                        throw new TypeError(fun + \" is not a function\");\n                    case 26:\n                        i = 0;\n                    case 27:\n                        if (!(i < length)) {\n                            $ctx26.next = 41;\n                            break;\n                        }\n\n                        $ctx26.t16 = i in self;\n\n                        if (!$ctx26.t16) {\n                            $ctx26.next = 33;\n                            break;\n                        }\n\n                        $ctx26.next = 32;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx31) {\n                                while (1) switch ($ctx31.next) {\n                                case 0:\n                                    $ctx31.rval = fun.call(thisp, self[i], i, object);\n                                    delete $ctx31.thrown;\n                                    $ctx31.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx31.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 32:\n                        $ctx26.t16 = !$ctx26.sent;\n                    case 33:\n                        if (!$ctx26.t16) {\n                            $ctx26.next = 38;\n                            break;\n                        }\n\n                        $ctx26.rval = false;\n                        delete $ctx26.thrown;\n                        $ctx26.next = 45;\n                        break;\n                    case 38:\n                        i++;\n                        $ctx26.next = 27;\n                        break;\n                    case 41:\n                        $ctx26.rval = true;\n                        delete $ctx26.thrown;\n                        $ctx26.next = 45;\n                        break;\n                    case 45:\n                    case \"end\":\n                        return $ctx26.stop();\n                    }\n                }, this);\n            });\n\n            Array.prototype.some = wrapGenerator.mark(function some(fun /*, thisp */) {\n                var object, self, length, thisp, i, $args = arguments;\n\n                return wrapGenerator(function some$($ctx32) {\n                    while (1) switch ($ctx32.next) {\n                    case 0:\n                        $ctx32.next = 2;\n\n                        return {\n                            \"type\": \"stackFrame\",\n                            \"filename\": \"array.js\",\n                            \"name\": \"some\",\n\n                            \"scope\": [{\n                                \"name\": \"fun\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 115,\n                                        \"column\": 37\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 115,\n                                        \"column\": 40\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"object\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 116,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 116,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"self\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 117,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 117,\n                                        \"column\": 12\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"length\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 120,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 120,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"thisp\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 121,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 121,\n                                        \"column\": 13\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"i\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 128,\n                                        \"column\": 13\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 128,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }],\n\n                            \"evalInScope\": function(expr) {\n                                return eval(expr);\n                            }\n                        }\n                    case 2:\n                        $ctx32.next = 4;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx33) {\n                                while (1) switch ($ctx33.next) {\n                                case 0:\n                                    $ctx33.rval = toObject(this);\n                                    delete $ctx33.thrown;\n                                    $ctx33.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx33.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 4:\n                        object = $ctx32.sent;\n                        $ctx32.t17 = splitString;\n\n                        if (!$ctx32.t17) {\n                            $ctx32.next = 11;\n                            break;\n                        }\n\n                        $ctx32.next = 9;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx34) {\n                                while (1) switch ($ctx34.next) {\n                                case 0:\n                                    $ctx34.rval = _toString(this);\n                                    delete $ctx34.thrown;\n                                    $ctx34.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx34.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 9:\n                        $ctx32.t18 = $ctx32.sent;\n                        $ctx32.t17 = $ctx32.t18 == \"[object String]\";\n                    case 11:\n                        if (!$ctx32.t17) {\n                            $ctx32.next = 17;\n                            break;\n                        }\n\n                        $ctx32.next = 14;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx35) {\n                                while (1) switch ($ctx35.next) {\n                                case 0:\n                                    $ctx35.rval = this.split(\"\");\n                                    delete $ctx35.thrown;\n                                    $ctx35.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx35.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 14:\n                        $ctx32.t19 = $ctx32.sent;\n                        $ctx32.next = 18;\n                        break;\n                    case 17:\n                        $ctx32.t19 = object;\n                    case 18:\n                        self = $ctx32.t19;\n                        length = self.length >>> 0;\n                        thisp = $args[1];\n                        $ctx32.next = 23;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx36) {\n                                while (1) switch ($ctx36.next) {\n                                case 0:\n                                    $ctx36.rval = _toString(fun);\n                                    delete $ctx36.thrown;\n                                    $ctx36.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx36.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 23:\n                        $ctx32.t20 = $ctx32.sent;\n\n                        if (!($ctx32.t20 != \"[object Function]\")) {\n                            $ctx32.next = 26;\n                            break;\n                        }\n\n                        throw new TypeError(fun + \" is not a function\");\n                    case 26:\n                        i = 0;\n                    case 27:\n                        if (!(i < length)) {\n                            $ctx32.next = 41;\n                            break;\n                        }\n\n                        $ctx32.t21 = i in self;\n\n                        if (!$ctx32.t21) {\n                            $ctx32.next = 33;\n                            break;\n                        }\n\n                        $ctx32.next = 32;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx37) {\n                                while (1) switch ($ctx37.next) {\n                                case 0:\n                                    $ctx37.rval = fun.call(thisp, self[i], i, object);\n                                    delete $ctx37.thrown;\n                                    $ctx37.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx37.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 32:\n                        $ctx32.t21 = $ctx32.sent;\n                    case 33:\n                        if (!$ctx32.t21) {\n                            $ctx32.next = 38;\n                            break;\n                        }\n\n                        $ctx32.rval = true;\n                        delete $ctx32.thrown;\n                        $ctx32.next = 45;\n                        break;\n                    case 38:\n                        i++;\n                        $ctx32.next = 27;\n                        break;\n                    case 41:\n                        $ctx32.rval = false;\n                        delete $ctx32.thrown;\n                        $ctx32.next = 45;\n                        break;\n                    case 45:\n                    case \"end\":\n                        return $ctx32.stop();\n                    }\n                }, this);\n            });\n\n            Array.prototype.reduce = wrapGenerator.mark(function reduce(fun /*, initial*/) {\n                var object, self, length, i, result, $args = arguments;\n\n                return wrapGenerator(function reduce$($ctx38) {\n                    while (1) switch ($ctx38.next) {\n                    case 0:\n                        $ctx38.next = 2;\n\n                        return {\n                            \"type\": \"stackFrame\",\n                            \"filename\": \"array.js\",\n                            \"name\": \"reduce\",\n\n                            \"scope\": [{\n                                \"name\": \"fun\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 136,\n                                        \"column\": 41\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 136,\n                                        \"column\": 44\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"object\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 137,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 137,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"self\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 138,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 138,\n                                        \"column\": 12\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"length\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 141,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 141,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"i\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 153,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 153,\n                                        \"column\": 9\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"result\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 154,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 154,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }],\n\n                            \"evalInScope\": function(expr) {\n                                return eval(expr);\n                            }\n                        }\n                    case 2:\n                        $ctx38.next = 4;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx39) {\n                                while (1) switch ($ctx39.next) {\n                                case 0:\n                                    $ctx39.rval = toObject(this);\n                                    delete $ctx39.thrown;\n                                    $ctx39.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx39.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 4:\n                        object = $ctx38.sent;\n                        $ctx38.t22 = splitString;\n\n                        if (!$ctx38.t22) {\n                            $ctx38.next = 11;\n                            break;\n                        }\n\n                        $ctx38.next = 9;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx40) {\n                                while (1) switch ($ctx40.next) {\n                                case 0:\n                                    $ctx40.rval = _toString(this);\n                                    delete $ctx40.thrown;\n                                    $ctx40.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx40.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 9:\n                        $ctx38.t23 = $ctx38.sent;\n                        $ctx38.t22 = $ctx38.t23 == \"[object String]\";\n                    case 11:\n                        if (!$ctx38.t22) {\n                            $ctx38.next = 17;\n                            break;\n                        }\n\n                        $ctx38.next = 14;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx41) {\n                                while (1) switch ($ctx41.next) {\n                                case 0:\n                                    $ctx41.rval = this.split(\"\");\n                                    delete $ctx41.thrown;\n                                    $ctx41.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx41.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 14:\n                        $ctx38.t24 = $ctx38.sent;\n                        $ctx38.next = 18;\n                        break;\n                    case 17:\n                        $ctx38.t24 = object;\n                    case 18:\n                        self = $ctx38.t24;\n                        length = self.length >>> 0;\n                        $ctx38.next = 22;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx42) {\n                                while (1) switch ($ctx42.next) {\n                                case 0:\n                                    $ctx42.rval = _toString(fun);\n                                    delete $ctx42.thrown;\n                                    $ctx42.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx42.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 22:\n                        $ctx38.t25 = $ctx38.sent;\n\n                        if (!($ctx38.t25 != \"[object Function]\")) {\n                            $ctx38.next = 25;\n                            break;\n                        }\n\n                        throw new TypeError(fun + \" is not a function\");\n                    case 25:\n                        if (!(!length && $args.length == 1)) {\n                            $ctx38.next = 27;\n                            break;\n                        }\n\n                        throw new TypeError(\"reduce of empty array with no initial value\");\n                    case 27:\n                        i = 0;\n\n                        if (!($args.length >= 2)) {\n                            $ctx38.next = 32;\n                            break;\n                        }\n\n                        result = $args[1];\n                        $ctx38.next = 40;\n                        break;\n                    case 32:\n                        if (!(i in self)) {\n                            $ctx38.next = 37;\n                            break;\n                        }\n\n                        result = self[i++];\n                        delete $ctx38.thrown;\n                        $ctx38.next = 40;\n                        break;\n                    case 37:\n                        if (!(++i >= length)) {\n                            $ctx38.next = 39;\n                            break;\n                        }\n\n                        throw new TypeError(\"reduce of empty array with no initial value\");\n                    case 39:\n                        if (true) {\n                            $ctx38.next = 32;\n                            break;\n                        }\n                    case 40:\n                        if (!(i < length)) {\n                            $ctx38.next = 48;\n                            break;\n                        }\n\n                        if (!(i in self)) {\n                            $ctx38.next = 45;\n                            break;\n                        }\n\n                        $ctx38.next = 44;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx43) {\n                                while (1) switch ($ctx43.next) {\n                                case 0:\n                                    $ctx43.rval = fun.call(void 0, result, self[i], i, object);\n                                    delete $ctx43.thrown;\n                                    $ctx43.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx43.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 44:\n                        result = $ctx38.sent;\n                    case 45:\n                        i++;\n                        $ctx38.next = 40;\n                        break;\n                    case 48:\n                        $ctx38.rval = result;\n                        delete $ctx38.thrown;\n                        $ctx38.next = 52;\n                        break;\n                    case 52:\n                    case \"end\":\n                        return $ctx38.stop();\n                    }\n                }, this);\n            });\n\n            Array.prototype.reduceRight = wrapGenerator.mark(function reduceRight(fun /*, initial*/) {\n                var object, self, length, result, i, $args = arguments;\n\n                return wrapGenerator(function reduceRight$($ctx44) {\n                    while (1) switch ($ctx44.next) {\n                    case 0:\n                        $ctx44.next = 2;\n\n                        return {\n                            \"type\": \"stackFrame\",\n                            \"filename\": \"array.js\",\n                            \"name\": \"reduceRight\",\n\n                            \"scope\": [{\n                                \"name\": \"fun\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 181,\n                                        \"column\": 51\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 181,\n                                        \"column\": 54\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"object\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 182,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 182,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"self\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 183,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 183,\n                                        \"column\": 12\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"length\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 186,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 186,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"result\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 198,\n                                        \"column\": 8\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 198,\n                                        \"column\": 14\n                                    }\n                                }]\n                            }, {\n                                \"name\": \"i\",\n\n                                \"locs\": [{\n                                    \"start\": {\n                                        \"line\": 198,\n                                        \"column\": 16\n                                    },\n\n                                    \"end\": {\n                                        \"line\": 198,\n                                        \"column\": 17\n                                    }\n                                }]\n                            }],\n\n                            \"evalInScope\": function(expr) {\n                                return eval(expr);\n                            }\n                        }\n                    case 2:\n                        $ctx44.next = 4;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx45) {\n                                while (1) switch ($ctx45.next) {\n                                case 0:\n                                    $ctx45.rval = toObject(this);\n                                    delete $ctx45.thrown;\n                                    $ctx45.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx45.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 4:\n                        object = $ctx44.sent;\n                        $ctx44.t26 = splitString;\n\n                        if (!$ctx44.t26) {\n                            $ctx44.next = 11;\n                            break;\n                        }\n\n                        $ctx44.next = 9;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx46) {\n                                while (1) switch ($ctx46.next) {\n                                case 0:\n                                    $ctx46.rval = _toString(this);\n                                    delete $ctx46.thrown;\n                                    $ctx46.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx46.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 9:\n                        $ctx44.t27 = $ctx44.sent;\n                        $ctx44.t26 = $ctx44.t27 == \"[object String]\";\n                    case 11:\n                        if (!$ctx44.t26) {\n                            $ctx44.next = 17;\n                            break;\n                        }\n\n                        $ctx44.next = 14;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx47) {\n                                while (1) switch ($ctx47.next) {\n                                case 0:\n                                    $ctx47.rval = this.split(\"\");\n                                    delete $ctx47.thrown;\n                                    $ctx47.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx47.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 14:\n                        $ctx44.t28 = $ctx44.sent;\n                        $ctx44.next = 18;\n                        break;\n                    case 17:\n                        $ctx44.t28 = object;\n                    case 18:\n                        self = $ctx44.t28;\n                        length = self.length >>> 0;\n                        $ctx44.next = 22;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx48) {\n                                while (1) switch ($ctx48.next) {\n                                case 0:\n                                    $ctx48.rval = _toString(fun);\n                                    delete $ctx48.thrown;\n                                    $ctx48.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx48.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 22:\n                        $ctx44.t29 = $ctx44.sent;\n\n                        if (!($ctx44.t29 != \"[object Function]\")) {\n                            $ctx44.next = 25;\n                            break;\n                        }\n\n                        throw new TypeError(fun + \" is not a function\");\n                    case 25:\n                        if (!(!length && $args.length == 1)) {\n                            $ctx44.next = 27;\n                            break;\n                        }\n\n                        throw new TypeError(\"reduceRight of empty array with no initial value\");\n                    case 27:\n                        i = length - 1;\n\n                        if (!($args.length >= 2)) {\n                            $ctx44.next = 32;\n                            break;\n                        }\n\n                        result = $args[1];\n                        $ctx44.next = 40;\n                        break;\n                    case 32:\n                        if (!(i in self)) {\n                            $ctx44.next = 37;\n                            break;\n                        }\n\n                        result = self[i--];\n                        delete $ctx44.thrown;\n                        $ctx44.next = 40;\n                        break;\n                    case 37:\n                        if (!(--i < 0)) {\n                            $ctx44.next = 39;\n                            break;\n                        }\n\n                        throw new TypeError(\"reduceRight of empty array with no initial value\");\n                    case 39:\n                        if (true) {\n                            $ctx44.next = 32;\n                            break;\n                        }\n                    case 40:\n                        if (!(i < 0)) {\n                            $ctx44.next = 45;\n                            break;\n                        }\n\n                        $ctx44.rval = result;\n                        delete $ctx44.thrown;\n                        $ctx44.next = 54;\n                        break;\n                    case 45:\n                        if (!(i in this)) {\n                            $ctx44.next = 49;\n                            break;\n                        }\n\n                        $ctx44.next = 48;\n\n                        return __thunk(wrapGenerator.mark(function thunk() {\n                            return wrapGenerator(function thunk$($ctx49) {\n                                while (1) switch ($ctx49.next) {\n                                case 0:\n                                    $ctx49.rval = fun.call(void 0, result, self[i], i, object);\n                                    delete $ctx49.thrown;\n                                    $ctx49.next = 4;\n                                    break;\n                                case 4:\n                                case \"end\":\n                                    return $ctx49.stop();\n                                }\n                            }, this);\n                        }), this);\n                    case 48:\n                        result = $ctx44.sent;\n                    case 49:\n                        if (i--) {\n                            $ctx44.next = 45;\n                            break;\n                        }\n                    case 50:\n                        $ctx44.rval = result;\n                        delete $ctx44.thrown;\n                        $ctx44.next = 54;\n                        break;\n                    case 54:\n                    case \"end\":\n                        return $ctx44.stop();\n                    }\n                }, this);\n            });\n        case 19:\n        case \"end\":\n            return $ctx1.stop();\n        }\n    }, this);\n}\n".toString();
  this
    .$evaluate(arrayRuntime)
    .run();

  var domRuntime = "(function () {\n\n  if (typeof Event !== 'undefined') {\n    var _stopProp = Event.prototype.stopPropagation;\n    Event.prototype.stopPropagation = function () {\n      this.__isPropagationStopped = true;\n      _stopProp.apply(this, arguments);\n    };\n  }\n\n  if (typeof EventTarget !== 'undefined') {\n    var _on = EventTarget.prototype.addEventListener;\n    EventTarget.prototype.addEventListener =\n    function (type, listener, useCapture, wantsUntrusted) {\n      return _on.call(\n        this,\n        type,\n        __wrapListener(listener),\n        useCapture,\n        wantsUntrusted\n      );\n    };\n  }\n\n})();\n".toString();
  this
    .$evaluate(domRuntime)
    .run();
};

/**
 * @param {string} type
 * @param {Generator} gen
 */
Machine.prototype.$setHalted = function (isHalted) {
  this.halted = !!isHalted;
  this.dispatchNextEvent();
};

/**
 * @param {string} type
 * @param {Generator} gen
 */
Machine.prototype.$enqueueEvent = function (type, gen, eventObj) {
  this.$evq.push({
    gen: gen,
    type: type,
    eventObj: eventObj
  });
  this.dispatchNextEvent();
};

/**
 * @param {object} timer
 */
Machine.prototype.$onTimer = function (timer) {
  this.$enqueueEvent(
    'timer',
    timer.genFn.apply(this.context.global, timer.args)
  );
};

/**
 * @param {Generator} gen
 */
Machine.prototype.$onEvent = function (gen, eventObj) {
  this.$enqueueEvent('event', gen, eventObj);
};

/**
 * @param {GenereatorFunction} genFn
 */
Machine.prototype.$wrapListener = function (genFn) {
  var dispatch = this.$onEvent.bind(this);
  return function (eventObj) {
    var gen = genFn.apply(this, arguments);
    // `__isPropagationStopped` set in runtime/dom.js
    if (isGen(gen)) {
      dispatch(gen, eventObj);
    } else {
      return gen;
    }
  };
};

/**
 * @api
 * @return {Machine}
 */
Machine.prototype.dispatchNextEvent = function () {
  if (this.halted && this.$evq.length) {
    var ev = this.$evq.shift();
    if (ev.type === 'event' && ev.eventObj &&
        ev.eventObj.__isPropagationStopped) {
      this.dispatchNextEvent();
      return;
    }
    this.$runner.init(ev.gen);
    this.halted = false;
    this.emit('event', ev.type);
  }
  return this;
};

/**
 * @api
 * @return {Machine}
 */
Machine.prototype.pause = function () {
  this.paused = true;
  return this;
};

/**
 * @api
 * @return {Machine}
 */
Machine.prototype.resume = function () {
  this.paused = false;
  return this;
};

/**
 * @api
 * @param {string} code
 * @return {Machine}
 */
Machine.prototype.evaluate = function (code, filename) {
  var transformed = this.$transform(code, filename);
  this.$evaluate(transformed);
  return this;
};

/**
 * @api
 * @return {Machine}
 */
Machine.prototype.step = function () {
  try {
    this.$runner.step();
    this.$setHalted(this.$runner.state.done);
  } catch (e) {
    this.emit('error', e);
    this.$setHalted(true);
    return;
  }
  var state = this.$runner.state;
  // Update latest location on the current generator function.
  // @see this.getCurrentLoc()
  if (state.value && state.value.type === 'step') {
    this.$runner.gen.loc = {
      start: state.value.start,
      end: state.value.end
    };
  }
  if (state.value && state.value.type === 'debugger') {
    // When we hit a debugger statement, emit a debugger event, and if there
    // were no listeners then we recur, i.e. ignore. Otherwise we pause.
    if (this.emit('debugger', state.value)) {
      this.pause();
    } else {
      return this.step();
    }
  }
  return this;
};

/**
 * @api
 * @return {Machine}
 */
Machine.prototype.run = function () {
  while (!this.halted && !this.paused) {
    this.step();
  }
  return this;
};

var _slice = Array.prototype.slice;
/**
 * Helper function to get the stackFrame representation from a generator object.
 * @return {object}
 */
Machine.prototype.$getStackFrame = function (gen) {
  if (gen.stackFrame) {
    // Clone object so we don't have data types from a another context.
    var scope = _slice.call(gen.stackFrame.scope)
    for (var i = 0; i < scope.length; i++) {
      var scopeObj = scope[i]
      scope[i] = {
        name: scopeObj.name,
        locs: _slice.call(scopeObj.locs)
      };
    }
    return {
      type: 'stackFrame',
      filename: gen.stackFrame.filename,
      name: gen.stackFrame.name,
      evalInScope: gen.stackFrame.evalInScope,
      scope: scope
    };
  } else if (gen.type === 'functionCall' || gen.type === 'thunk') {
    return {
      type: gen.type
    };
  } else {
    throw new Error('Unknown call type in stack: ' + gen.type);
  }
};

/**
 * @api
 * @return {array}
 */
Machine.prototype.getCallStack = function () {
  var stack = [this.$getStackFrame(this.$runner.gen)];
  for (var i = this.$runner.stack.length - 1; i >= 0; i--) {
    stack.unshift(this.$getStackFrame(this.$runner.stack[i]));
  }
  return stack;
};

/**
 * @api
 * @return {array}
 */
Machine.prototype.getCurrentStackFrame = function () {
  return this.$getStackFrame(this.$runner.gen);
};

/**
 * @api
 * @return {object}
 */
Machine.prototype.getState = function () {
  return this.$runner.state;
};

/**
 * @api
 * @return {object}
 */
Machine.prototype.getCurrentLoc = function () {
  var loc = this.$runner.gen.loc;
  if (loc) {
    return loc;
  }
  // Thunks don't have location information so when we are in thunks we'll just
  // look up the stack to get the first non-thunk location.
  var stack = this.$runner.stack;
  var i = stack.length - 1;
  while (!loc && i >= 0) {
    loc = stack[i].loc;
    i--;
  }
  return loc;
};

/**
 * A fast way to just get the filename.
 * @api
 * @return {string}
 */
Machine.prototype.getCurrentFilename = function () {
  if (this.$runner.gen.stackFrame) {
    return this.$runner.gen.stackFrame.filename;
  } else {
    var stack = this.$runner.stack;
    for (var i = stack.length - 1; i >= 0; i--) {
      if (stack[i].stackFrame) {
        return stack[i].stackFrame.filename;
      }
    }
  }
  throw new Error('Error getting filename');
};

module.exports = Machine;

},{"./transform":4,"context-eval":19,"events":72,"fs":70,"generator-supported":21,"recast":33,"regenerator":53,"util":77}],4:[function(require,module,exports){
var recast = require('recast');
var b = recast.types.builders;
var types = recast.types.namedTypes;

function createObjectExpression(obj) {
  var props = [];
  for (var prop in obj) {
    var val = typeof obj[prop] === 'object' ? obj[prop] : b.literal(obj[prop]);
    props.push(b.property('init', b.literal(prop), val));
  }
  return b.objectExpression(props);
}

function createStep(loc, isDebugger) {
  var node = b.expressionStatement(
    b.yieldExpression(
      createObjectExpression({
        type: isDebugger ? 'debugger' : 'step',
        start: createObjectExpression(loc.start),
        end: createObjectExpression(loc.end)
      }),
      false
    )
  );
  Object.defineProperty(node, '__stepper', { value: true });
  return node;
}

function createStackFrame(path, filename) {
  var name;
  if (path.scope.isGlobal) {
    name = 'Global Scope';
  } else if (path.get('id').value) {
    name = path.get('id').value.name;
  } else {
    name = 'anonymous function';
  }

  var bindings = path.get('body').scope.getBindings();
  var bindingNodes = [];
  for (var varName in bindings) {
    bindingNodes.push(createObjectExpression({
      name: varName,
      locs: b.arrayExpression(bindings[varName].map(function (p) {
        return createObjectExpression({
          start: createObjectExpression(p.value.loc.start),
          end: createObjectExpression(p.value.loc.end)
        });
      }))
    }));
  }

  var ret = b.expressionStatement(
    b.yieldExpression(
      createObjectExpression({
        type: 'stackFrame',
        filename: filename,
        name: name,
        scope: b.arrayExpression(bindingNodes),
        evalInScope: b.functionExpression(
            null,
            [b.identifier('expr')],
            b.blockStatement([b.returnStatement(
              b.callExpression(b.identifier('eval'), [b.identifier('expr')])
            )]),
            false
          )
      }),
      false
    )
  );

  Object.defineProperty(ret, '__stepper', { value: true });
  return ret;
}

//https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects
var NATIVES = ['Array', 'ArrayBuffer', 'Boolean', 'DataView', 'Date', 'Error',
                'EvalError', 'Float32Array', 'Float64Array', 'Function',
                'Generator', 'InternalError', 'Int16Array', 'Int32Array',
                'Int8Array', 'Iterator', 'JSON', 'Map', 'Math', 'NaN', 'Number',
                'Object', 'ParallelArray', 'Proxy', 'RangeError',
                'ReferenceError', 'Reflect', 'RegExp', 'Set', 'StopIteration',
                'String', 'Symbol', 'SyntaxError', 'TypeError', 'Uint16Array',
                'Uint32Array', 'Uint8Array', 'Uint8ClampedArray', 'URIError',
                'WeakMap', 'WeakSet'];

function transform(ast, options) {
  recast.types.traverse(ast, function (n) {
    if (n.__stepper) {
      return false;
    }

    if (types.CallExpression.check(n)) {
      var thunk = b.callExpression(
        b.identifier('__thunk'), [
          b.functionExpression(
            b.identifier('thunk'),
            [],
            b.blockStatement([b.returnStatement(n)]),
            true
          ),
          b.thisExpression(),
          b.identifier('arguments')
        ]
      );
      this.replace(
        b.yieldExpression(thunk, false)
      );
    }

    if (types.Function.check(n)) {
      this.get('body').replace(
        b.blockStatement(
          [createStackFrame(this, options.filename)].concat(n.body.body)
        )
      );
      n.generator = true;
    }

    if (types.NewExpression.check(n)) {
      if (NATIVES.indexOf(n.callee.name) === -1) {
        var args = [n.callee].concat(n.arguments);
        this.replace(b.callExpression(b.identifier('__instantiate'), args));
      }
    }

    if (options.excludeSteps) {
      return;
    }

    if (types.DebuggerStatement.check(n)) {
      this.replace(createStep(n.loc, true));
      return;
    }

    var parent = this.parent && this.parent.node;

    // If this is a loop make sure to add an additional stepper at the end
    // of the loop so we can step on the condition.
    if (types.ForStatement.check(n) ||
        types.ForInStatement.check(n) ||
        types.WhileStatement.check(n)) {
      this.get('body').replace(b.blockStatement([n.body, createStep(n.loc)]));
    }

    if (types.Statement.check(n) &&
        // Block statements are just groupings of other statements so we ignore
        !types.BlockStatement.check(n) &&
        // Don't insert yield statements inside loop clauses.
        !types.ForStatement.check(parent) &&
        !types.ForInStatement.check(parent)) {
      this.replace(b.blockStatement([createStep(n.loc), n]));
    }
  });

  var body = ast.program.body;
  body.unshift(
    createStackFrame(new recast.types.NodePath(ast.program), options.filename)
  );
  ast.program = b.program([
    b.functionDeclaration(
      b.identifier('__top'), [], b.blockStatement(body), true
    )
  ]);
  return ast;
}

module.exports = transform;

},{"recast":33}],5:[function(require,module,exports){
var types = require("../lib/types");
var Type = types.Type;
var def = Type.def;
var or = Type.or;
var builtin = types.builtInTypes;
var isString = builtin.string;
var isNumber = builtin.number;
var isBoolean = builtin.boolean;
var isRegExp = builtin.RegExp;
var shared = require("../lib/shared");
var defaults = shared.defaults;
var geq = shared.geq;

def("Node")
    .field("type", isString)
    .field("loc", or(
        def("SourceLocation"),
        null
    ), defaults["null"]);

def("SourceLocation")
    .build("start", "end", "source")
    .field("start", def("Position"))
    .field("end", def("Position"))
    .field("source", or(isString, null), defaults["null"]);

def("Position")
    .build("line", "column")
    .field("line", geq(1))
    .field("column", geq(0));

def("Program")
    .bases("Node")
    .build("body")
    .field("body", [def("Statement")]);

def("Function")
    .bases("Node")
    .field("id", or(def("Identifier"), null), defaults["null"])
    .field("params", [def("Pattern")])
    .field("body", or(def("BlockStatement"), def("Expression")))
    .field("generator", isBoolean, defaults["false"])
    .field("expression", isBoolean, defaults["false"])
    .field("defaults", [def("Expression")], defaults.emptyArray)
    .field("rest", or(def("Identifier"), null), defaults["null"]);

def("Statement").bases("Node");

// The empty .build() here means that an EmptyStatement can be constructed
// (i.e. it's not abstract) but that it needs no arguments.
def("EmptyStatement").bases("Statement").build();

def("BlockStatement")
    .bases("Statement")
    .build("body")
    .field("body", [def("Statement")]);

// TODO Figure out how to silently coerce Expressions to
// ExpressionStatements where a Statement was expected.
def("ExpressionStatement")
    .bases("Statement")
    .build("expression")
    .field("expression", def("Expression"));

def("IfStatement")
    .bases("Statement")
    .build("test", "consequent", "alternate")
    .field("test", def("Expression"))
    .field("consequent", def("Statement"))
    .field("alternate", or(def("Statement"), null), defaults["null"]);

def("LabeledStatement")
    .bases("Statement")
    .build("label", "body")
    .field("label", def("Identifier"))
    .field("body", def("Statement"));

def("BreakStatement")
    .bases("Statement")
    .build("label")
    .field("label", or(def("Identifier"), null), defaults["null"]);

def("ContinueStatement")
    .bases("Statement")
    .build("label")
    .field("label", or(def("Identifier"), null), defaults["null"]);

def("WithStatement")
    .bases("Statement")
    .build("object", "body")
    .field("object", def("Expression"))
    .field("body", def("Statement"));

def("SwitchStatement")
    .bases("Statement")
    .build("discriminant", "cases", "lexical")
    .field("discriminant", def("Expression"))
    .field("cases", [def("SwitchCase")])
    .field("lexical", isBoolean, defaults["false"]);

def("ReturnStatement")
    .bases("Statement")
    .build("argument")
    .field("argument", or(def("Expression"), null));

def("ThrowStatement")
    .bases("Statement")
    .build("argument")
    .field("argument", def("Expression"));

def("TryStatement")
    .bases("Statement")
    .build("block", "handler", "finalizer")
    .field("block", def("BlockStatement"))
    .field("handler", or(def("CatchClause"), null), function() {
        return this.handlers && this.handlers[0] || null;
    })
    .field("handlers", [def("CatchClause")], function() {
        return this.handler ? [this.handler] : [];
    }, true) // Indicates this field is hidden from eachField iteration.
    .field("guardedHandlers", [def("CatchClause")], defaults.emptyArray)
    .field("finalizer", or(def("BlockStatement"), null), defaults["null"]);

def("CatchClause")
    .bases("Node")
    .build("param", "guard", "body")
    .field("param", def("Pattern"))
    .field("guard", or(def("Expression"), null), defaults["null"])
    .field("body", def("BlockStatement"));

def("WhileStatement")
    .bases("Statement")
    .build("test", "body")
    .field("test", def("Expression"))
    .field("body", def("Statement"));

def("DoWhileStatement")
    .bases("Statement")
    .build("body", "test")
    .field("body", def("Statement"))
    .field("test", def("Expression"));

def("ForStatement")
    .bases("Statement")
    .build("init", "test", "update", "body")
    .field("init", or(
        def("VariableDeclaration"),
        def("Expression"),
        null))
    .field("test", or(def("Expression"), null))
    .field("update", or(def("Expression"), null))
    .field("body", def("Statement"));

def("ForInStatement")
    .bases("Statement")
    .build("left", "right", "body", "each")
    .field("left", or(
        def("VariableDeclaration"),
        def("Expression")))
    .field("right", def("Expression"))
    .field("body", def("Statement"))
    .field("each", isBoolean);

def("DebuggerStatement").bases("Statement").build();

def("Declaration").bases("Statement");

def("FunctionDeclaration")
    .bases("Function", "Declaration")
    .build("id", "params", "body", "generator", "expression")
    .field("id", def("Identifier"));

def("FunctionExpression")
    .bases("Function", "Expression")
    .build("id", "params", "body", "generator", "expression");

def("VariableDeclaration")
    .bases("Declaration")
    .build("kind", "declarations")
    .field("kind", or("var", "let", "const"))
    .field("declarations", [or(
        def("VariableDeclarator"),
        def("Identifier") // TODO Esprima deviation.
    )]);

def("VariableDeclarator")
    .bases("Node")
    .build("id", "init")
    .field("id", def("Pattern"))
    .field("init", or(def("Expression"), null));

// TODO Are all Expressions really Patterns?
def("Expression").bases("Node", "Pattern");

def("ThisExpression").bases("Expression").build();

def("ArrayExpression")
    .bases("Expression")
    .build("elements")
    .field("elements", [or(def("Expression"), null)]);

def("ObjectExpression")
    .bases("Expression")
    .build("properties")
    .field("properties", [def("Property")]);

// TODO Not in the Mozilla Parser API, but used by Esprima.
def("Property")
    .bases("Node") // Want to be able to visit Property Nodes.
    .build("kind", "key", "value")
    .field("kind", or("init", "get", "set"))
    .field("key", or(def("Literal"), def("Identifier")))
    .field("value", def("Expression"))
    // Esprima extensions not mentioned in the Mozilla Parser API:
    .field("method", isBoolean, defaults["false"])
    .field("shorthand", isBoolean, defaults["false"]);

def("SequenceExpression")
    .bases("Expression")
    .build("expressions")
    .field("expressions", [def("Expression")]);

var UnaryOperator = or(
    "-", "+", "!", "~",
    "typeof", "void", "delete");

def("UnaryExpression")
    .bases("Expression")
    .build("operator", "argument", "prefix")
    .field("operator", UnaryOperator)
    .field("argument", def("Expression"))
    // TODO Esprima doesn't bother with this field, presumably because
    // it's always true for unary operators.
    .field("prefix", isBoolean, defaults["true"]);

var BinaryOperator = or(
    "==", "!=", "===", "!==",
    "<", "<=", ">", ">=",
    "<<", ">>", ">>>",
    "+", "-", "*", "/", "%",
    "&", // TODO Missing from the Parser API.
    "|", "^", "in",
    "instanceof", "..");

def("BinaryExpression")
    .bases("Expression")
    .build("operator", "left", "right")
    .field("operator", BinaryOperator)
    .field("left", def("Expression"))
    .field("right", def("Expression"));

var AssignmentOperator = or(
    "=", "+=", "-=", "*=", "/=", "%=",
    "<<=", ">>=", ">>>=",
    "|=", "^=", "&=");

def("AssignmentExpression")
    .bases("Expression")
    .build("operator", "left", "right")
    .field("operator", AssignmentOperator)
    // TODO Shouldn't this be def("Pattern")?
    .field("left", def("Expression"))
    .field("right", def("Expression"));

var UpdateOperator = or("++", "--");

def("UpdateExpression")
    .bases("Expression")
    .build("operator", "argument", "prefix")
    .field("operator", UpdateOperator)
    .field("argument", def("Expression"))
    .field("prefix", isBoolean);

var LogicalOperator = or("||", "&&");

def("LogicalExpression")
    .bases("Expression")
    .build("operator", "left", "right")
    .field("operator", LogicalOperator)
    .field("left", def("Expression"))
    .field("right", def("Expression"));

def("ConditionalExpression")
    .bases("Expression")
    .build("test", "consequent", "alternate")
    .field("test", def("Expression"))
    .field("consequent", def("Expression"))
    .field("alternate", def("Expression"));

def("NewExpression")
    .bases("Expression")
    .build("callee", "arguments")
    .field("callee", def("Expression"))
    // The Mozilla Parser API gives this type as [or(def("Expression"),
    // null)], but null values don't really make sense at the call site.
    // TODO Report this nonsense.
    .field("arguments", [def("Expression")]);

def("CallExpression")
    .bases("Expression")
    .build("callee", "arguments")
    .field("callee", def("Expression"))
    // See comment for NewExpression above.
    .field("arguments", [def("Expression")]);

def("MemberExpression")
    .bases("Expression")
    .build("object", "property", "computed")
    .field("object", def("Expression"))
    .field("property", or(def("Identifier"), def("Expression")))
    .field("computed", isBoolean);

def("Pattern").bases("Node");

def("ObjectPattern")
    .bases("Pattern")
    .build("properties")
    // TODO File a bug to get PropertyPattern added to the interfaces API.
    .field("properties", [def("PropertyPattern")]);

def("PropertyPattern")
    .bases("Pattern")
    .build("key", "pattern")
    .field("key", or(def("Literal"), def("Identifier")))
    .field("pattern", def("Pattern"));

def("ArrayPattern")
    .bases("Pattern")
    .build("elements")
    .field("elements", [or(def("Pattern"), null)]);

def("SwitchCase")
    .bases("Node")
    .build("test", "consequent")
    .field("test", or(def("Expression"), null))
    .field("consequent", [def("Statement")]);

def("Identifier")
    // But aren't Expressions and Patterns already Nodes? TODO Report this.
    .bases("Node", "Expression", "Pattern")
    .build("name")
    .field("name", isString);

def("Literal")
    // But aren't Expressions already Nodes? TODO Report this.
    .bases("Node", "Expression")
    .build("value")
    .field("value", or(
        isString,
        isBoolean,
        null, // isNull would also work here.
        isNumber,
        isRegExp
    ));

types.finalize();

},{"../lib/shared":12,"../lib/types":14}],6:[function(require,module,exports){
require("./core");
var types = require("../lib/types");
var def = types.Type.def;
var or = types.Type.or;
var builtin = types.builtInTypes;
var isString = builtin.string;
var isBoolean = builtin.boolean;

// Note that none of these types are buildable because the Mozilla Parser
// API doesn't specify any builder functions, and nobody uses E4X anymore.

def("XMLDefaultDeclaration")
    .bases("Declaration")
    .field("namespace", def("Expression"));

def("XMLAnyName").bases("Expression");

def("XMLQualifiedIdentifier")
    .bases("Expression")
    .field("left", or(def("Identifier"), def("XMLAnyName")))
    .field("right", or(def("Identifier"), def("Expression")))
    .field("computed", isBoolean);

def("XMLFunctionQualifiedIdentifier")
    .bases("Expression")
    .field("right", or(def("Identifier"), def("Expression")))
    .field("computed", isBoolean);

def("XMLAttributeSelector")
    .bases("Expression")
    .field("attribute", def("Expression"));

def("XMLFilterExpression")
    .bases("Expression")
    .field("left", def("Expression"))
    .field("right", def("Expression"));

def("XMLElement")
    .bases("XML", "Expression")
    .field("contents", [def("XML")]);

def("XMLList")
    .bases("XML", "Expression")
    .field("contents", [def("XML")]);

def("XML").bases("Node");

def("XMLEscape")
    .bases("XML")
    .field("expression", def("Expression"));

def("XMLText")
    .bases("XML")
    .field("text", isString);

def("XMLStartTag")
    .bases("XML")
    .field("contents", [def("XML")]);

def("XMLEndTag")
    .bases("XML")
    .field("contents", [def("XML")]);

def("XMLPointTag")
    .bases("XML")
    .field("contents", [def("XML")]);

def("XMLName")
    .bases("XML")
    .field("contents", or(isString, [def("XML")]));

def("XMLAttribute")
    .bases("XML")
    .field("value", isString);

def("XMLCdata")
    .bases("XML")
    .field("contents", isString);

def("XMLComment")
    .bases("XML")
    .field("contents", isString);

def("XMLProcessingInstruction")
    .bases("XML")
    .field("target", isString)
    .field("contents", or(isString, null));

types.finalize();

},{"../lib/types":14,"./core":5}],7:[function(require,module,exports){
require("./core");
var types = require("../lib/types");
var def = types.Type.def;
var or = types.Type.or;
var builtin = types.builtInTypes;
var isBoolean = builtin.boolean;
var isString = builtin.string;
var defaults = require("../lib/shared").defaults;

// TODO The Parser API calls this ArrowExpression, but Esprima uses
// ArrowFunctionExpression.
def("ArrowFunctionExpression")
    .bases("Function", "Expression")
    .build("params", "body", "expression")
    // The forced null value here is compatible with the overridden
    // definition of the "id" field in the Function interface.
    .field("id", null, defaults["null"])
    // The current spec forbids arrow generators, so I have taken the
    // liberty of enforcing that. TODO Report this.
    .field("generator", false, defaults["false"]);

def("YieldExpression")
    .bases("Expression")
    .build("argument", "delegate")
    .field("argument", or(def("Expression"), null))
    .field("delegate", isBoolean, false);

def("GeneratorExpression")
    .bases("Expression")
    .build("body", "blocks", "filter")
    .field("body", def("Expression"))
    .field("blocks", [def("ComprehensionBlock")])
    .field("filter", or(def("Expression"), null));

def("ComprehensionExpression")
    .bases("Expression")
    .build("body", "blocks", "filter")
    .field("body", def("Expression"))
    .field("blocks", [def("ComprehensionBlock")])
    .field("filter", or(def("Expression"), null));

def("ComprehensionBlock")
    .bases("Node")
    .build("left", "right", "each")
    .field("left", def("Pattern"))
    .field("right", def("Expression"))
    .field("each", isBoolean);

// This would be the ideal definition for ModuleSpecifier, but alas we
// can't expect ASTs parsed by Esprima to use this custom subtype:
def("ModuleSpecifier")
    .bases("Specifier", "Literal")
//  .build("value") // Make it abstract/non-buildable for now.
    .field("value", isString);

// Instead we must settle for a cheap type alias:
var ModuleSpecifier = def("Literal");

def("ModuleDeclaration")
    .bases("Declaration")
    .build("id", "from", "body")
    .field("id", or(def("Literal"), def("Identifier")))
    .field("source", or(ModuleSpecifier, null))
    .field("body", or(def("BlockStatement"), null));

def("MethodDefinition")
    .bases("Declaration")
    .build("kind", "key", "value")
    .field("kind", or("init", "get", "set", ""))
    .field("key", or(def("Literal"), def("Identifier")))
    .field("value", def("Function"));

def("SpreadElement")
    .bases("Pattern")
    .build("argument")
    .field("argument", def("Pattern"));

var ClassBodyElement = or(
    def("MethodDefinition"),
    def("VariableDeclarator"),
    def("ClassPropertyDefinition")
);

def("ClassPropertyDefinition") // static property
    .bases("Declaration")
    .build("definition")
    // Yes, Virginia, circular definitions are permitted.
    .field("definition", ClassBodyElement);

def("ClassBody")
    .bases("Declaration")
    .build("body")
    .field("body", [ClassBodyElement]);

def("ClassDeclaration")
    .bases("Declaration")
    .build("id", "body", "superClass")
    .field("id", def("Identifier"))
    .field("body", def("ClassBody"))
    .field("superClass", or(def("Expression"), null), defaults["null"]);

def("ClassExpression")
    .bases("Expression")
    .build("id", "body", "superClass")
    .field("id", or(def("Identifier"), null), defaults["null"])
    .field("body", def("ClassBody"))
    .field("superClass", or(def("Expression"), null), defaults["null"]);

// Specifier and NamedSpecifier are non-standard types that I introduced
// for definitional convenience.
def("Specifier").bases("Node");
def("NamedSpecifier")
    .bases("Specifier")
    .field("id", def("Identifier"))
    .field("name", def("Identifier"), defaults["null"]);

def("ExportSpecifier")
    .bases("NamedSpecifier")
    .build("id", "name");

def("ExportBatchSpecifier")
    .bases("Specifier")
    .build();

def("ImportSpecifier")
    .bases("NamedSpecifier")
    .build("id", "name");

def("ExportDeclaration")
    .bases("Declaration")
    .build("default", "declaration", "specifiers", "source")
    .field("default", isBoolean)
    .field("declaration", or(
        def("Declaration"),
        def("AssignmentExpression") // Implies default.
    ))
    .field("specifiers", [or(
        def("ExportSpecifier"),
        def("ExportBatchSpecifier")
    )])
    .field("source", or(ModuleSpecifier, null));

def("ImportDeclaration")
    .bases("Declaration")
    .build("specifiers", "kind", "source")
    .field("specifiers", [def("ImportSpecifier")])
    .field("kind", or("named", "default"))
    .field("source", ModuleSpecifier);

types.finalize();

},{"../lib/shared":12,"../lib/types":14,"./core":5}],8:[function(require,module,exports){
require("./core");
var types = require("../lib/types");
var def = types.Type.def;
var or = types.Type.or;
var builtin = types.builtInTypes;
var isString = builtin.string;
var isBoolean = builtin.boolean;
var defaults = require("../lib/shared").defaults;

def("XJSAttribute")
    .bases("Node")
    .build("name", "value")
    .field("name", def("XJSIdentifier"))
    .field("value", or(
        def("Literal"), // attr="value"
        def("XJSExpressionContainer"), // attr={value}
        null // attr= or just attr
    ), defaults["null"]);

def("XJSIdentifier")
    .bases("Node")
    .build("name", "namespace")
    .field("name", isString)
    .field("namespace", or(isString, null), defaults["null"]);

def("XJSExpressionContainer")
    .bases("Expression")
    .build("expression")
    .field("expression", def("Expression"));

def("XJSElement")
    .bases("Expression")
    .build("openingElement", "closingElement", "children")
    .field("openingElement", def("XJSOpeningElement"))
    .field("closingElement", or(def("XJSClosingElement"), null), defaults["null"])
    .field("children", [or(
        def("XJSElement"),
        def("XJSExpressionContainer"),
        def("XJSText"),
        def("Literal") // TODO Esprima should return XJSText instead.
    )], defaults.emptyArray)
    .field("name", def("XJSIdentifier"), function() {
        // Little-known fact: the `this` object inside a default function
        // is none other than the partially-built object itself, and any
        // fields initialized directly from builder function arguments
        // (like openingElement, closingElement, and children) are
        // guaranteed to be available.
        return this.openingElement.name;
    })
    .field("selfClosing", isBoolean, function() {
        return this.openingElement.selfClosing;
    })
    .field("attributes", [def("XJSAttribute")], function() {
        return this.openingElement.attributes;
    });

def("XJSOpeningElement")
    .bases("Node") // TODO Does this make sense? Can't really be an XJSElement.
    .build("name", "attributes", "selfClosing")
    .field("name", def("XJSIdentifier"))
    .field("attributes", [def("XJSAttribute")], defaults.emptyArray)
    .field("selfClosing", isBoolean, defaults["false"]);

def("XJSClosingElement")
    .bases("Node") // TODO Same concern.
    .build("name")
    .field("name", def("XJSIdentifier"));

def("XJSText")
    .bases("Literal")
    .build("value")
    .field("value", isString);

def("XJSEmptyExpression").bases("Expression").build();

def("TypeAnnotatedIdentifier")
    .bases("Pattern")
    .build("annotation", "identifier")
    .field("annotation", def("TypeAnnotation"))
    .field("identifier", def("Identifier"));

def("TypeAnnotation")
    .bases("Pattern")
    .build("annotatedType", "templateTypes", "paramTypes", "returnType",
           "unionType", "nullable")
    .field("annotatedType", def("Identifier"))
    .field("templateTypes", or([def("TypeAnnotation")], null))
    .field("paramTypes", or([def("TypeAnnotation")], null))
    .field("returnType", or(def("TypeAnnotation"), null))
    .field("unionType", or(def("TypeAnnotation"), null))
    .field("nullable", isBoolean);

types.finalize();

},{"../lib/shared":12,"../lib/types":14,"./core":5}],9:[function(require,module,exports){
require("./core");
var types = require("../lib/types");
var def = types.Type.def;
var or = types.Type.or;
var geq = require("../lib/shared").geq;

def("ForOfStatement")
    .bases("Statement")
    .build("left", "right", "body")
    .field("left", or(
        def("VariableDeclaration"),
        def("Expression")))
    .field("right", def("Expression"))
    .field("body", def("Statement"));

def("LetStatement")
    .bases("Statement")
    .build("head", "body")
    // TODO Deviating from the spec by reusing VariableDeclarator here.
    .field("head", [def("VariableDeclarator")])
    .field("body", def("Statement"));

def("LetExpression")
    .bases("Expression")
    .build("head", "body")
    // TODO Deviating from the spec by reusing VariableDeclarator here.
    .field("head", [def("VariableDeclarator")])
    .field("body", def("Expression"));

def("GraphExpression")
    .bases("Expression")
    .build("index", "expression")
    .field("index", geq(0))
    .field("expression", def("Literal"));

def("GraphIndexExpression")
    .bases("Expression")
    .build("index")
    .field("index", geq(0));

types.finalize();

},{"../lib/shared":12,"../lib/types":14,"./core":5}],10:[function(require,module,exports){
var assert = require("assert");
var types = require("./types");
var n = types.namedTypes;
var isNumber = types.builtInTypes.number;
var isArray = types.builtInTypes.array;
var Path = require("ast-path").Path;
var Scope = require("./scope");

function NodePath(value, parentPath, name) {
    assert.ok(this instanceof NodePath);
    Path.call(this, value, parentPath, name);
}

require("util").inherits(NodePath, Path);
var NPp = NodePath.prototype;

Object.defineProperties(NPp, {
    node: {
        get: function() {
            Object.defineProperty(this, "node", {
                value: this._computeNode()
            });

            return this.node;
        }
    },

    parent: {
        get: function() {
            Object.defineProperty(this, "parent", {
                value: this._computeParent()
            });

            return this.parent;
        }
    },

    scope: {
        get: function() {
            Object.defineProperty(this, "scope", {
                value: this._computeScope()
            });

            return this.scope;
        }
    }
});

// The value of the first ancestor Path whose value is a Node.
NPp._computeNode = function() {
    var value = this.value;
    if (n.Node.check(value)) {
        return value;
    }

    var pp = this.parentPath;
    return pp && pp.node || null;
};

// The first ancestor Path whose value is a Node distinct from this.node.
NPp._computeParent = function() {
    var value = this.value;
    var pp = this.parentPath;

    if (!n.Node.check(value)) {
        while (pp && !n.Node.check(pp.value)) {
            pp = pp.parentPath;
        }

        if (pp) {
            pp = pp.parentPath;
        }
    }

    while (pp && !n.Node.check(pp.value)) {
        pp = pp.parentPath;
    }

    return pp || null;
};

// The closest enclosing scope that governs this node.
NPp._computeScope = function() {
    var value = this.value;
    var pp = this.parentPath;
    var scope = pp && pp.scope;

    if (n.Node.check(value) &&
        Scope.isEstablishedBy(value)) {
        scope = new Scope(this, scope);
    }

    return scope || null;
};

NPp.getValueProperty = function(name) {
    return types.getFieldValue(this.value, name);
};

NPp.needsParens = function() {
    if (!this.parent)
        return false;

    var node = this.node;

    // If this NodePath object is not the direct owner of this.node, then
    // we do not need parentheses here, though the direct owner might need
    // parentheses.
    if (node !== this.value)
        return false;

    var parent = this.parent.node;

    assert.notStrictEqual(node, parent);

    if (!n.Expression.check(node))
        return false;

    if (n.UnaryExpression.check(node))
        return n.MemberExpression.check(parent)
            && this.name === "object"
            && parent.object === node;

    if (isBinary(node)) {
        if (n.CallExpression.check(parent) &&
            this.name === "callee") {
            assert.strictEqual(parent.callee, node);
            return true;
        }

        if (n.UnaryExpression.check(parent))
            return true;

        if (n.MemberExpression.check(parent) &&
            this.name === "object") {
            assert.strictEqual(parent.object, node);
            return true;
        }

        if (isBinary(parent)) {
            var po = parent.operator;
            var pp = PRECEDENCE[po];
            var no = node.operator;
            var np = PRECEDENCE[no];

            if (pp > np) {
                return true;
            }

            if (pp === np && this.name === "right") {
                assert.strictEqual(parent.right, node);
                return true;
            }
        }
    }

    if (n.SequenceExpression.check(node))
        return n.CallExpression.check(parent)
            || n.UnaryExpression.check(parent)
            || isBinary(parent)
            || n.VariableDeclarator.check(parent)
            || n.MemberExpression.check(parent)
            || n.ArrayExpression.check(parent)
            || n.Property.check(parent)
            || n.ConditionalExpression.check(parent);

    if (n.YieldExpression.check(node))
        return isBinary(parent)
            || n.CallExpression.check(parent)
            || n.MemberExpression.check(parent)
            || n.NewExpression.check(parent)
            || n.ConditionalExpression.check(parent)
            || n.UnaryExpression.check(parent)
            || n.YieldExpression.check(parent);

    if (n.NewExpression.check(parent) &&
        this.name === "callee") {
        assert.strictEqual(parent.callee, node);
        return containsCallExpression(node);
    }

    if (n.Literal.check(node) &&
        isNumber.check(node.value) &&
        n.MemberExpression.check(parent) &&
        this.name === "object") {
        assert.strictEqual(parent.object, node);
        return true;
    }

    if (n.AssignmentExpression.check(node) ||
        n.ConditionalExpression.check(node)) {
        if (n.UnaryExpression.check(parent))
            return true;

        if (isBinary(parent))
            return true;

        if (n.CallExpression.check(parent) &&
            this.name === "callee") {
            assert.strictEqual(parent.callee, node);
            return true;
        }

        if (n.ConditionalExpression.check(parent) &&
            this.name === "test") {
            assert.strictEqual(parent.test, node);
            return true;
        }

        if (n.MemberExpression.check(parent) &&
            this.name === "object") {
            assert.strictEqual(parent.object, node);
            return true;
        }
    }

    if (n.FunctionExpression.check(node) &&
        this.firstInStatement())
        return true;

    if (n.ObjectExpression.check(node) &&
        this.firstInStatement())
        return true;

    return false;
};

function isBinary(node) {
    return n.BinaryExpression.check(node)
        || n.LogicalExpression.check(node);
}

var PRECEDENCE = {};
[["||"],
 ["&&"],
 ["|"],
 ["^"],
 ["&"],
 ["==", "===", "!=", "!=="],
 ["<", ">", "<=", ">=", "in", "instanceof"],
 [">>", "<<", ">>>"],
 ["+", "-"],
 ["*", "/", "%"]
].forEach(function(tier, i) {
    tier.forEach(function(op) {
        PRECEDENCE[op] = i;
    });
});

function containsCallExpression(node) {
    if (n.CallExpression.check(node)) {
        return true;
    }

    if (isArray.check(node)) {
        return node.some(containsCallExpression);
    }

    if (n.Node.check(node)) {
        return types.someField(node, function(name, child) {
            return containsCallExpression(child);
        });
    }

    return false;
}

NPp.firstInStatement = function() {
    return firstInStatement(this);
};

function firstInStatement(path) {
    for (var node, parent; path.parent; path = path.parent) {
        node = path.node;
        parent = path.parent.node;

        if (n.BlockStatement.check(parent) &&
            path.parent.name === "body" &&
            path.name === 0) {
            assert.strictEqual(parent.body[0], node);
            return true;
        }

        if (n.ExpressionStatement.check(parent) &&
            path.name === "expression") {
            assert.strictEqual(parent.expression, node);
            return true;
        }

        if (n.SequenceExpression.check(parent) &&
            path.parent.name === "expressions" &&
            path.name === 0) {
            assert.strictEqual(parent.expressions[0], node);
            continue;
        }

        if (n.CallExpression.check(parent) &&
            path.name === "callee") {
            assert.strictEqual(parent.callee, node);
            continue;
        }

        if (n.MemberExpression.check(parent) &&
            path.name === "object") {
            assert.strictEqual(parent.object, node);
            continue;
        }

        if (n.ConditionalExpression.check(parent) &&
            path.name === "test") {
            assert.strictEqual(parent.test, node);
            continue;
        }

        if (isBinary(parent) &&
            path.name === "left") {
            assert.strictEqual(parent.left, node);
            continue;
        }

        if (n.UnaryExpression.check(parent) &&
            !parent.prefix &&
            path.name === "argument") {
            assert.strictEqual(parent.argument, node);
            continue;
        }

        return false;
    }

    return true;
}

module.exports = NodePath;

},{"./scope":11,"./types":14,"assert":71,"ast-path":17,"util":77}],11:[function(require,module,exports){
var assert = require("assert");
var types = require("./types");
var Type = types.Type;
var namedTypes = types.namedTypes;
var Node = namedTypes.Node;
var isArray = types.builtInTypes.array;
var hasOwn = Object.prototype.hasOwnProperty;

function Scope(path, parentScope) {
    assert.ok(this instanceof Scope);
    assert.ok(path instanceof require("./node-path"));
    ScopeType.assert(path.value);

    var depth;

    if (parentScope) {
        assert.ok(parentScope instanceof Scope);
        depth = parentScope.depth + 1;
    } else {
        parentScope = null;
        depth = 0;
    }

    Object.defineProperties(this, {
        path: { value: path },
        node: { value: path.value },
        isGlobal: { value: !parentScope, enumerable: true },
        depth: { value: depth },
        parent: { value: parentScope },
        bindings: { value: {} }
    });
}

var scopeTypes = [
    // Program nodes introduce global scopes.
    namedTypes.Program,

    // Function is the supertype of FunctionExpression,
    // FunctionDeclaration, ArrowExpression, etc.
    namedTypes.Function,

    // In case you didn't know, the caught parameter shadows any variable
    // of the same name in an outer scope.
    namedTypes.CatchClause
];

if (namedTypes.ModuleDeclaration) {
    // Include ModuleDeclaration only if it exists (ES6).
    scopeTypes.push(namedTypes.ModuleDeclaration);
}

var ScopeType = Type.or.apply(Type, scopeTypes);

Scope.isEstablishedBy = function(node) {
    return ScopeType.check(node);
};

var Sp = Scope.prototype;

// Will be overridden after an instance lazily calls scanScope.
Sp.didScan = false;

Sp.declares = function(name) {
    this.scan();
    return hasOwn.call(this.bindings, name);
};

Sp.scan = function(force) {
    if (force || !this.didScan) {
        for (var name in this.bindings) {
            // Empty out this.bindings, just in cases.
            delete this.bindings[name];
        }
        scanScope(this.path, this.bindings);
        this.didScan = true;
    }
};

Sp.getBindings = function () {
    this.scan();
    return this.bindings;
};

function scanScope(path, bindings) {
    var node = path.value;
    ScopeType.assert(node);

    if (namedTypes.CatchClause.check(node)) {
        // A catch clause establishes a new scope but the only variable
        // bound in that scope is the catch parameter. Any other
        // declarations create bindings in the outer scope.
        addPattern(path.get("param"), bindings);

    } else {
        recursiveScanScope(path, bindings);
    }
}

function recursiveScanScope(path, bindings) {
    var node = path.value;

    if (isArray.check(node)) {
        path.each(function(childPath) {
            recursiveScanChild(childPath, bindings);
        });

    } else if (namedTypes.Function.check(node)) {
        path.get("params").each(function(paramPath) {
            addPattern(paramPath, bindings);
        });

        recursiveScanChild(path.get("body"), bindings);

    } else if (namedTypes.VariableDeclarator.check(node)) {
        addPattern(path.get("id"), bindings);
        recursiveScanChild(path.get("init"), bindings);

    } else if (namedTypes.ImportSpecifier &&
               namedTypes.ImportSpecifier.check(node)) {
        addPattern(node.name ? path.get("name") : path.get("id"));

    } else if (Node.check(node)) {
        types.eachField(node, function(name, child) {
            var childPath = path.get(name);
            assert.strictEqual(childPath.value, child);
            recursiveScanChild(childPath, bindings);
        });
    }
}

function recursiveScanChild(path, bindings) {
    var node = path.value;

    if (namedTypes.FunctionDeclaration.check(node)) {
        addPattern(path.get("id"), bindings);

    } else if (namedTypes.ClassDeclaration &&
               namedTypes.ClassDeclaration.check(node)) {
        addPattern(path.get("id"), bindings);

    } else if (Scope.isEstablishedBy(node)) {
        if (namedTypes.CatchClause.check(node)) {
            var catchParamName = node.param.name;
            var hadBinding = hasOwn.call(bindings, catchParamName);

            // Any declarations that occur inside the catch body that do
            // not have the same name as the catch parameter should count
            // as bindings in the outer scope.
            recursiveScanScope(path.get("body"), bindings);

            // If a new binding matching the catch parameter name was
            // created while scanning the catch body, ignore it because it
            // actually refers to the catch parameter and not the outer
            // scope that we're currently scanning.
            if (!hadBinding) {
                delete bindings[catchParamName];
            }
        }

    } else {
        recursiveScanScope(path, bindings);
    }
}

function addPattern(patternPath, bindings) {
    var pattern = patternPath.value;
    namedTypes.Pattern.assert(pattern);

    if (namedTypes.Identifier.check(pattern)) {
        if (hasOwn.call(bindings, pattern.name)) {
            bindings[pattern.name].push(patternPath);
        } else {
            bindings[pattern.name] = [patternPath];
        }

    } else if (namedTypes.SpreadElement &&
               namedTypes.SpreadElement.check(pattern)) {
        addPattern(patternPath.get("argument"), bindings);
    }
}

Sp.lookup = function(name) {
    for (var scope = this; scope; scope = scope.parent)
        if (scope.declares(name))
            break;
    return scope;
};

Sp.getGlobalScope = function() {
    var scope = this;
    while (!scope.isGlobal)
        scope = scope.parent;
    return scope;
};

module.exports = Scope;

},{"./node-path":10,"./types":14,"assert":71}],12:[function(require,module,exports){
var types = require("../lib/types");
var Type = types.Type;
var builtin = types.builtInTypes;
var isNumber = builtin.number;

// An example of constructing a new type with arbitrary constraints from
// an existing type.
exports.geq = function(than) {
    return new Type(function(value) {
        return isNumber.check(value) && value >= than;
    }, isNumber + " >= " + than);
};

// Default value-returning functions that may optionally be passed as a
// third argument to Def.prototype.field.
exports.defaults = {
    // Functions were used because (among other reasons) that's the most
    // elegant way to allow for the emptyArray one always to give a new
    // array instance.
    "null": function() { return null },
    "emptyArray": function() { return [] },
    "false": function() { return false },
    "true": function() { return true },
    "undefined": function() {}
};

var naiveIsPrimitive = Type.or(
    builtin.string,
    builtin.number,
    builtin.boolean,
    builtin.null,
    builtin.undefined
);

exports.isPrimitive = new Type(function(value) {
    if (value === null)
        return true;
    var type = typeof value;
    return !(type === "object" ||
             type === "function");
}, naiveIsPrimitive.toString());

},{"../lib/types":14}],13:[function(require,module,exports){
var assert = require("assert");
var types = require("./types");
var Node = types.namedTypes.Node;
var isObject = types.builtInTypes.object;
var isArray = types.builtInTypes.array;
var NodePath = require("./node-path");
var funToStr = Function.prototype.toString;
var thisPattern = /\bthis\b/;

// Good for traversals that need to modify the syntax tree or to access
// path/scope information via `this` (a NodePath object). Somewhat slower
// than traverseWithNoPathInfo because of the NodePath bookkeeping.
function traverseWithFullPathInfo(node, callback) {
    if (!thisPattern.test(funToStr.call(callback))) {
        // If the callback function contains no references to `this`, then
        // it will have no way of using any of the NodePath information
        // that traverseWithFullPathInfo provides, so we can skip that
        // bookkeeping altogether.
        return traverseWithNoPathInfo(node, callback);
    }

    function traverse(path) {
        assert.ok(path instanceof NodePath);
        var value = path.value;

        if (isArray.check(value)) {
            path.each(traverse);
            return;
        }

        if (Node.check(value)) {
            if (callback.call(path, value, traverse) === false) {
                return;
            }
        } else if (!isObject.check(value)) {
            return;
        }

        types.eachField(value, function(name, child) {
            var childPath = path.get(name);
            if (childPath.value !== child) {
                childPath.replace(child);
            }

            traverse(childPath);
        });
    }

    if (node instanceof NodePath) {
        traverse(node);
        return node.value;
    }

    // Just in case we call this.replace at the root, there needs to be an
    // additional parent Path to update.
    var rootPath = new NodePath({ root: node });
    traverse(rootPath.get("root"));
    return rootPath.value.root;
}

// Good for read-only traversals that do not require any NodePath
// information. Faster than traverseWithFullPathInfo because less
// information is exposed. A context parameter is supported because `this`
// no longer has to be a NodePath object.
function traverseWithNoPathInfo(node, callback, context) {
    context = context || null;

    function traverse(node) {
        if (isArray.check(node)) {
            node.forEach(traverse);
            return;
        }

        if (Node.check(node)) {
            if (callback.call(context, node, traverse) === false) {
                return;
            }
        } else if (!isObject.check(node)) {
            return;
        }

        types.eachField(node, function(name, child) {
            traverse(child);
        });
    }

    traverse(node);

    return node;
}

// Since we export traverseWithFullPathInfo as module.exports, we need to
// attach traverseWithNoPathInfo to it as a property. In other words, you
// should use require("ast-types").traverse.fast(ast, ...) to invoke the
// quick-and-dirty traverseWithNoPathInfo function.
traverseWithFullPathInfo.fast = traverseWithNoPathInfo;

module.exports = traverseWithFullPathInfo;

},{"./node-path":10,"./types":14,"assert":71}],14:[function(require,module,exports){
var assert = require("assert");
var Ap = Array.prototype;
var slice = Ap.slice;
var map = Ap.map;
var each = Ap.forEach;
var Op = Object.prototype;
var objToStr = Op.toString;
var funObjStr = objToStr.call(function(){});
var strObjStr = objToStr.call("");
var hasOwn = Op.hasOwnProperty;

// A type is an object with a .check method that takes a value and returns
// true or false according to whether the value matches the type.

function Type(check, name) {
    var self = this;
    assert.ok(self instanceof Type, self);

    // Unfortunately we can't elegantly reuse isFunction and isString,
    // here, because this code is executed while defining those types.
    assert.strictEqual(objToStr.call(check), funObjStr,
                       check + " is not a function");

    // The `name` parameter can be either a function or a string.
    var nameObjStr = objToStr.call(name);
    assert.ok(nameObjStr === funObjStr ||
              nameObjStr === strObjStr,
              name + " is neither a function nor a string");

    Object.defineProperties(self, {
        name: { value: name },
        check: {
            value: function(value, deep) {
                var result = check.call(self, value, deep);
                if (!result && deep && objToStr.call(deep) === funObjStr)
                    deep(self, value);
                return result;
            }
        }
    });
}

var Tp = Type.prototype;

// Throughout this file we use Object.defineProperty to prevent
// redefinition of exported properties.
Object.defineProperty(exports, "Type", { value: Type });

// Like .check, except that failure triggers an AssertionError.
Tp.assert = function(value, deep) {
    if (!this.check(value, deep)) {
        var str = shallowStringify(value);
        assert.ok(false, str + " does not match type " + this);
        return false;
    }
    return true;
};

function shallowStringify(value) {
    if (isObject.check(value))
        return "{" + Object.keys(value).map(function(key) {
            return key + ": " + value[key];
        }).join(", ") + "}";

    if (isArray.check(value))
        return "[" + value.map(shallowStringify).join(", ") + "]";

    return JSON.stringify(value);
}

Tp.toString = function() {
    var name = this.name;

    if (isString.check(name))
        return name;

    if (isFunction.check(name))
        return name.call(this) + "";

    return name + " type";
};

var builtInTypes = {};
Object.defineProperty(exports, "builtInTypes", {
    enumerable: true,
    value: builtInTypes
});

function defBuiltInType(example, name) {
    var objStr = objToStr.call(example);

    Object.defineProperty(builtInTypes, name, {
        enumerable: true,
        value: new Type(function(value) {
            return objToStr.call(value) === objStr;
        }, name)
    });

    return builtInTypes[name];
}

// These types check the underlying [[Class]] attribute of the given
// value, rather than using the problematic typeof operator. Note however
// that no subtyping is considered; so, for instance, isObject.check
// returns false for [], /./, new Date, and null.
var isString = defBuiltInType("", "string");
var isFunction = defBuiltInType(function(){}, "function");
var isArray = defBuiltInType([], "array");
var isObject = defBuiltInType({}, "object");
var isRegExp = defBuiltInType(/./, "RegExp");
var isDate = defBuiltInType(new Date, "Date");
var isNumber = defBuiltInType(3, "number");
var isBoolean = defBuiltInType(true, "boolean");
var isNull = defBuiltInType(null, "null");
var isUndefined = defBuiltInType(void 0, "undefined");

// There are a number of idiomatic ways of expressing types, so this
// function serves to coerce them all to actual Type objects. Note that
// providing the name argument is not necessary in most cases.
function toType(from, name) {
    // The toType function should of course be idempotent.
    if (from instanceof Type)
        return from;

    // The Def type is used as a helper for constructing compound
    // interface types for AST nodes.
    if (from instanceof Def)
        return from.type;

    // Support [ElemType] syntax.
    if (isArray.check(from))
        return Type.fromArray(from);

    // Support { someField: FieldType, ... } syntax.
    if (isObject.check(from))
        return Type.fromObject(from);

    // If isFunction.check(from), assume that from is a binary predicate
    // function we can use to define the type.
    if (isFunction.check(from))
        return new Type(from, name);

    // As a last resort, toType returns a type that matches any value that
    // is === from. This is primarily useful for literal values like
    // toType(null), but it has the additional advantage of allowing
    // toType to be a total function.
    return new Type(function(value) {
        return value === from;
    }, isUndefined.check(name) ? function() {
        return from + "";
    } : name);
}

// Returns a type that matches the given value iff any of type1, type2,
// etc. match the value.
Type.or = function(/* type1, type2, ... */) {
    var types = [];
    var len = arguments.length;
    for (var i = 0; i < len; ++i)
        types.push(toType(arguments[i]));

    return new Type(function(value, deep) {
        for (var i = 0; i < len; ++i)
            if (types[i].check(value, deep))
                return true;
        return false;
    }, function() {
        return types.join(" | ");
    });
};

Type.fromArray = function(arr) {
    assert.ok(isArray.check(arr));
    assert.strictEqual(
        arr.length, 1,
        "only one element type is permitted for typed arrays");
    return toType(arr[0]).arrayOf();
};

Tp.arrayOf = function() {
    var elemType = this;
    return new Type(function(value, deep) {
        return isArray.check(value) && value.every(function(elem) {
            return elemType.check(elem, deep);
        });
    }, function() {
        return "[" + elemType + "]";
    });
};

Type.fromObject = function(obj) {
    var fields = Object.keys(obj).map(function(name) {
        return new Field(name, obj[name]);
    });

    return new Type(function(value, deep) {
        return isObject.check(value) && fields.every(function(field) {
            return field.type.check(value[field.name], deep);
        });
    }, function() {
        return "{ " + fields.join(", ") + " }";
    });
};

function Field(name, type, defaultFn, hidden) {
    var self = this;

    assert.ok(self instanceof Field);
    isString.assert(name);

    type = toType(type);

    var properties = {
        name: { value: name },
        type: { value: type },
        hidden: { value: !!hidden }
    };

    if (isFunction.check(defaultFn)) {
        properties.defaultFn = { value: defaultFn };
    }

    Object.defineProperties(self, properties);
}

var Fp = Field.prototype;

Fp.toString = function() {
    return JSON.stringify(this.name) + ": " + this.type;
};

Fp.getValue = function(obj) {
    var value = obj[this.name];

    if (!isUndefined.check(value))
        return value;

    if (this.defaultFn)
        value = this.defaultFn.call(obj);

    return value;
};

// Define a type whose name is registered in a namespace (the defCache) so
// that future definitions will return the same type given the same name.
// In particular, this system allows for circular and forward definitions.
// The Def object d returned from Type.def may be used to configure the
// type d.type by calling methods such as d.bases, d.build, and d.field.
Type.def = function(typeName) {
    isString.assert(typeName);
    return hasOwn.call(defCache, typeName)
        ? defCache[typeName]
        : defCache[typeName] = new Def(typeName);
};

// In order to return the same Def instance every time Type.def is called
// with a particular name, those instances need to be stored in a cache.
var defCache = {};

function Def(typeName) {
    var self = this;
    assert.ok(self instanceof Def);

    Object.defineProperties(self, {
        typeName: { value: typeName },
        baseNames: { value: [] },
        ownFields: { value: {} },

        // These two are populated during finalization.
        allSupertypes: { value: {} }, // Includes own typeName.
        allFields: { value: {} }, // Includes inherited fields.

        type: {
            value: new Type(function(value, deep) {
                return self.check(value, deep);
            }, typeName)
        }
    });
}

Def.fromValue = function(value) {
    if (isObject.check(value) &&
        hasOwn.call(value, "type") &&
        hasOwn.call(defCache, value.type))
    {
        var vDef = defCache[value.type];
        assert.strictEqual(vDef.finalized, true);
        return vDef;
    }
};

var Dp = Def.prototype;

Dp.isSupertypeOf = function(that) {
    if (that instanceof Def) {
        assert.strictEqual(this.finalized, true);
        assert.strictEqual(that.finalized, true);
        return hasOwn.call(that.allSupertypes, this.typeName);
    } else {
        assert.ok(false, that + " is not a Def");
    }
};

Dp.checkAllFields = function(value, deep) {
    var allFields = this.allFields;
    assert.strictEqual(this.finalized, true);

    function checkFieldByName(name) {
        var field = allFields[name];
        var type = field.type;
        var child = field.getValue(value);
        return type.check(child, deep);
    }

    return isObject.check(value)
        && Object.keys(allFields).every(checkFieldByName);
};

Dp.check = function(value, deep) {
    assert.strictEqual(
        this.finalized, true,
        "prematurely checking unfinalized type " + this.typeName);

    // A Def type can only match an object value.
    if (!isObject.check(value))
        return false;

    var vDef = Def.fromValue(value);
    if (!vDef) {
        // If we couldn't infer the Def associated with the given value,
        // and we expected it to be a SourceLocation or a Position, it was
        // probably just missing a "type" field (because Esprima does not
        // assign a type property to such nodes). Be optimistic and let
        // this.checkAllFields make the final decision.
        if (this.typeName === "SourceLocation" ||
            this.typeName === "Position") {
            return this.checkAllFields(value, deep);
        }

        // Calling this.checkAllFields for any other type of node is both
        // bad for performance and way too forgiving.
        return false;
    }

    // If checking deeply and vDef === this, then we only need to call
    // checkAllFields once. Calling checkAllFields is too strict when deep
    // is false, because then we only care about this.isSupertypeOf(vDef).
    if (deep && vDef === this)
        return this.checkAllFields(value, deep);

    // In most cases we rely exclusively on isSupertypeOf to make O(1)
    // subtyping determinations. This suffices in most situations outside
    // of unit tests, since interface conformance is checked whenever new
    // instances are created using builder functions.
    if (!this.isSupertypeOf(vDef))
        return false;

    // The exception is when deep is true; then, we recursively check all
    // fields.
    if (!deep)
        return true;

    // Use the more specific Def (vDef) to perform the deep check, but
    // shallow-check fields defined by the less specific Def (this).
    return vDef.checkAllFields(value, deep)
        && this.checkAllFields(value, false);
};

Dp.bases = function() {
    var bases = this.baseNames;

    assert.strictEqual(this.finalized, false);

    each.call(arguments, function(baseName) {
        isString.assert(baseName);

        // This indexOf lookup may be O(n), but the typical number of base
        // names is very small, and indexOf is a native Array method.
        if (bases.indexOf(baseName) < 0)
            bases.push(baseName);
    });

    return this; // For chaining.
};

// False by default until .build(...) is called on an instance.
Object.defineProperty(Dp, "buildable", { value: false });

var builders = {};
Object.defineProperty(exports, "builders", {
    value: builders
});

// This object is used as prototype for any node created by a builder.
var nodePrototype = {};

// Call this function to define a new method to be shared by all AST
// nodes. The replaced method (if any) is returned for easy wrapping.
Object.defineProperty(exports, "defineMethod", {
    value: function(name, func) {
        var old = nodePrototype[name];

        // Pass undefined as func to delete nodePrototype[name].
        if (isUndefined.check(func)) {
            delete nodePrototype[name];

        } else {
            isFunction.assert(func);

            Object.defineProperty(nodePrototype, name, {
                enumerable: true, // For discoverability.
                configurable: true, // For delete proto[name].
                value: func
            });
        }

        return old;
    }
});

// Calling the .build method of a Def simultaneously marks the type as
// buildable (by defining builders[getBuilderName(typeName)]) and
// specifies the order of arguments that should be passed to the builder
// function to create an instance of the type.
Dp.build = function(/* param1, param2, ... */) {
    var self = this;
    var buildParams = slice.call(arguments);
    var typeName = self.typeName;

    assert.strictEqual(self.finalized, false);
    isString.arrayOf().assert(buildParams);

    // Every buildable type will have its "type" field filled in
    // automatically. This includes types that are not subtypes of Node,
    // like SourceLocation, but that seems harmless (TODO?).
    self.field("type", typeName, function() { return typeName });

    // Override Dp.buildable for this Def instance.
    Object.defineProperty(self, "buildable", { value: true });

    Object.defineProperty(builders, getBuilderName(typeName), {
        enumerable: true,

        value: function() {
            var args = arguments;
            var argc = args.length;
            var built = Object.create(nodePrototype);

            assert.ok(
                self.finalized,
                "attempting to instantiate unfinalized type " + typeName);

            function add(param, i) {
                if (hasOwn.call(built, param))
                    return;

                var all = self.allFields;
                assert.ok(hasOwn.call(all, param), param);

                var field = all[param];
                var type = field.type;
                var value;

                if (isNumber.check(i) && i < argc) {
                    value = args[i];
                } else if (field.defaultFn) {
                    // Expose the partially-built object to the default
                    // function as its `this` object.
                    value = field.defaultFn.call(built);
                } else {
                    var message = "no value or default function given for field " +
                        JSON.stringify(param) + " of " + typeName + "(" +
                            buildParams.map(function(name) {
                                return all[name];
                            }).join(", ") + ")";
                    assert.ok(false, message);
                }

                assert.ok(
                    type.check(value),
                    shallowStringify(value) +
                        " does not match field " + field +
                        " of type " + typeName);

                // TODO Could attach getters and setters here to enforce
                // dynamic type safety.
                built[param] = value;
            }

            buildParams.forEach(function(param, i) {
                add(param, i);
            });

            Object.keys(self.allFields).forEach(function(param) {
                add(param); // Use the default value.
            });

            // Make sure that the "type" field was filled automatically.
            assert.strictEqual(built.type, typeName);

            return built;
        }
    });

    return self; // For chaining.
};

function getBuilderName(typeName) {
    return typeName.replace(/^[A-Z]+/, function(upperCasePrefix) {
        var len = upperCasePrefix.length;
        switch (len) {
        case 0: return "";
        // If there's only one initial capital letter, just lower-case it.
        case 1: return upperCasePrefix.toLowerCase();
        default:
            // If there's more than one initial capital letter, lower-case
            // all but the last one, so that XMLDefaultDeclaration (for
            // example) becomes xmlDefaultDeclaration.
            return upperCasePrefix.slice(
                0, len - 1).toLowerCase() +
                upperCasePrefix.charAt(len - 1);
        }
    });
}

// The reason fields are specified using .field(...) instead of an object
// literal syntax is somewhat subtle: the object literal syntax would
// support only one key and one value, but with .field(...) we can pass
// any number of arguments to specify the field.
Dp.field = function(name, type, defaultFn, hidden) {
    assert.strictEqual(this.finalized, false);
    this.ownFields[name] = new Field(name, type, defaultFn, hidden);
    return this; // For chaining.
};

var namedTypes = {};
Object.defineProperty(exports, "namedTypes", {
    value: namedTypes
});

// Get the value of an object property, taking object.type and default
// functions into account.
Object.defineProperty(exports, "getFieldValue", {
    value: function(object, fieldName) {
        var d = Def.fromValue(object);
        if (d) {
            var field = d.allFields[fieldName];
            if (field) {
                return field.getValue(object);
            }
        }

        return object[fieldName];
    }
});

// Iterate over all defined fields of an object, including those missing
// or undefined, passing each field name and effective value (as returned
// by getFieldValue) to the callback. If the object has no corresponding
// Def, the callback will never be called.
Object.defineProperty(exports, "eachField", {
    value: function(object, callback, context) {
        var d = Def.fromValue(object);
        if (d) {
            var all = d.allFields;
            Object.keys(all).forEach(function(name) {
                var field = all[name];
                if (!field.hidden) {
                    callback.call(this, name, field.getValue(object));
                }
            }, context);
        } else {
            assert.strictEqual(
                "type" in object, false,
                "did not recognize object of type " + JSON.stringify(object.type)
            );

            // If we could not infer a Def type for this object, just
            // iterate over its keys in the normal way.
            Object.keys(object).forEach(function(name) {
                callback.call(this, name, object[name]);
            }, context);
        }
    }
});

// Similar to eachField, except that iteration stops as soon as the
// callback returns a truthy value. Like Array.prototype.some, the final
// result is either true or false to indicates whether the callback
// returned true for any element or not.
Object.defineProperty(exports, "someField", {
    value: function(object, callback, context) {
        var d = Def.fromValue(object);
        if (d) {
            var all = d.allFields;
            return Object.keys(all).some(function(name) {
                var field = all[name];
                if (!field.hidden) {
                    var value = field.getValue(object);
                    return callback.call(this, name, value);
                }
            }, context);
        }

        assert.strictEqual(
            "type" in object, false,
            "did not recognize object of type " + JSON.stringify(object.type)
        );

        // If we could not infer a Def type for this object, just iterate
        // over its keys in the normal way.
        return Object.keys(object).some(function(name) {
            return callback.call(this, name, object[name]);
        }, context);
    }
});

// This property will be overridden as true by individual Def instances
// when they are finalized.
Object.defineProperty(Dp, "finalized", { value: false });

Dp.finalize = function() {
    // It's not an error to finalize a type more than once, but only the
    // first call to .finalize does anything.
    if (!this.finalized) {
        var allFields = this.allFields;
        var allSupertypes = this.allSupertypes;

        this.baseNames.forEach(function(name) {
            var def = defCache[name];
            def.finalize();
            extend(allFields, def.allFields);
            extend(allSupertypes, def.allSupertypes);
        });

        // TODO Warn if fields are overridden with incompatible types.
        extend(allFields, this.ownFields);
        allSupertypes[this.typeName] = this;

        // Types are exported only once they have been finalized.
        Object.defineProperty(namedTypes, this.typeName, {
            enumerable: true,
            value: this.type
        });

        Object.defineProperty(this, "finalized", { value: true });
    }
};

function extend(into, from) {
    Object.keys(from).forEach(function(name) {
        into[name] = from[name];
    });

    return into;
};

Object.defineProperty(exports, "finalize", {
    // This function should be called at the end of any complete file of
    // type definitions. It declares that everything defined so far is
    // complete and needs no further modification, and defines all
    // finalized types as properties of exports.namedTypes.
    value: function() {
        Object.keys(defCache).forEach(function(name) {
            defCache[name].finalize();
        });
    }
});

},{"assert":71}],15:[function(require,module,exports){
var types = require("./lib/types");

// This core module of AST types captures ES5 as it is parsed today by
// git://github.com/ariya/esprima.git#master.
require("./def/core");

// Feel free to add to or remove from this list of extension modules to
// configure the precise type hierarchy that you need.
require("./def/es6");
require("./def/mozilla");
require("./def/e4x");
require("./def/fb-harmony");

exports.Type = types.Type;
exports.builtInTypes = types.builtInTypes;
exports.namedTypes = types.namedTypes;
exports.builders = types.builders;
exports.defineMethod = types.defineMethod;
exports.getFieldValue = types.getFieldValue;
exports.eachField = types.eachField;
exports.someField = types.someField;
exports.traverse = require("./lib/traverse");
exports.finalize = types.finalize;
exports.NodePath = require("./lib/node-path");

},{"./def/core":5,"./def/e4x":6,"./def/es6":7,"./def/fb-harmony":8,"./def/mozilla":9,"./lib/node-path":10,"./lib/traverse":13,"./lib/types":14}],16:[function(require,module,exports){
var assert = require("assert");
var getChildCache = require("private").makeAccessor();
var Op = Object.prototype;
var hasOwn = Op.hasOwnProperty;
var toString = Op.toString;
var arrayToString = toString.call([]);
var Ap = Array.prototype;
var slice = Ap.slice;
var map = Ap.map;

function Path(value, parentPath, name) {
  assert.ok(this instanceof Path);

  if (parentPath) {
    assert.ok(parentPath instanceof Path);
  } else {
    parentPath = null;
    name = null;
  }

  Object.defineProperties(this, {
    // The value encapsulated by this Path, generally equal to
    // parentPath.value[name] if we have a parentPath.
    value: { value: value },

    // The immediate parent Path of this Path.
    parentPath: { value: parentPath },

    // The name of the property of parentPath.value through which this
    // Path's value was reached.
    name: {
      value: name,
      configurable: true
    }
  });
}

var Pp = Path.prototype;

function getChildPath(path, name) {
  var cache = getChildCache(path);
  return hasOwn.call(cache, name)
    ? cache[name]
    : cache[name] = new path.constructor(
        path.getValueProperty(name), path, name);
}

// This method is designed to be overridden by subclasses that need to
// handle missing properties, etc.
Pp.getValueProperty = function(name) {
  return this.value[name];
};

Pp.get = function(name) {
  var path = this;
  var names = arguments;
  var count = names.length;

  for (var i = 0; i < count; ++i) {
    path = getChildPath(path, names[i]);
  }

  return path;
};

Pp.each = function(callback, context) {
  var childPaths = [];
  var len = this.value.length;
  var i = 0;

  // Collect all the original child paths before invoking the callback.
  for (var i = 0; i < len; ++i) {
    if (hasOwn.call(this.value, i)) {
      childPaths[i] = this.get(i);
    }
  }

  // Invoke the callback on just the original child paths, regardless of
  // any modifications made to the array by the callback. I chose these
  // semantics over cleverly invoking the callback on new elements because
  // this way is much easier to reason about.
  context = context || this;
  for (i = 0; i < len; ++i) {
    if (hasOwn.call(childPaths, i)) {
      callback.call(context, childPaths[i]);
    }
  }
};

Pp.map = function(callback, context) {
  var result = [];

  this.each(function(childPath) {
    result.push(callback.call(this, childPath));
  }, context);

  return result;
};

Pp.filter = function(callback, context) {
  var result = [];

  this.each(function(childPath) {
    if (callback.call(this, childPath)) {
      result.push(childPath);
    }
  }, context);

  return result;
};

Pp.replace = function(replacement) {
  var count = arguments.length;

  assert.ok(
    this.parentPath instanceof Path,
    "Instead of replacing the root of the tree, create a new tree."
  );

  var name = this.name;
  var parentValue = this.parentPath.value;
  var parentCache = getChildCache(this.parentPath);
  var results = [];

  if (toString.call(parentValue) === arrayToString) {
    delete parentCache.length;
    delete parentCache[name];

    var moved = {};

    for (var i = name + 1; i < parentValue.length; ++i) {
      var child = parentCache[i];
      if (child) {
        var newIndex = i - 1 + count;
        moved[newIndex] = child;
        Object.defineProperty(child, "name", { value: newIndex });
        delete parentCache[i];
      }
    }

    var args = slice.call(arguments);
    args.unshift(name, 1);
    parentValue.splice.apply(parentValue, args);

    for (newIndex in moved) {
      if (hasOwn.call(moved, newIndex)) {
        parentCache[newIndex] = moved[newIndex];
      }
    }

    for (i = name; i < name + count; ++i) {
      results.push(this.parentPath.get(i));
    }

  } else if (count === 1) {
    delete parentCache[name];
    parentValue[name] = replacement;
    results.push(this.parentPath.get(name));

  } else if (count === 0) {
    delete parentCache[name];
    delete parentValue[name];

  } else {
    assert.ok(false, "Could not replace Path.");
  }

  return results;
};

exports.Path = Path;

},{"assert":71,"private":18}],17:[function(require,module,exports){
exports.Path = require("./lib/path").Path;

},{"./lib/path":16}],18:[function(require,module,exports){
"use strict";

var defProp = Object.defineProperty || function(obj, name, desc) {
    // Normal property assignment is the best we can do if
    // Object.defineProperty is not available.
    obj[name] = desc.value;
};

// For functions that will be invoked using .call or .apply, we need to
// define those methods on the function objects themselves, rather than
// inheriting them from Function.prototype, so that a malicious or clumsy
// third party cannot interfere with the functionality of this module by
// redefining Function.prototype.call or .apply.
function makeSafeToCall(fun) {
    defProp(fun, "call", { value: fun.call });
    defProp(fun, "apply", { value: fun.apply });
    return fun;
}

var hasOwn = makeSafeToCall(Object.prototype.hasOwnProperty);
var numToStr = makeSafeToCall(Number.prototype.toString);
var strSlice = makeSafeToCall(String.prototype.slice);

var cloner = function(){};
var create = Object.create || function(prototype, properties) {
    cloner.prototype = prototype || null;
    var obj = new cloner;

    // The properties parameter is unused by this module, but I want this
    // shim to be as complete as possible.
    if (properties)
        for (var name in properties)
            if (hasOwn.call(properties, name))
                defProp(obj, name, properties[name]);

    return obj;
};

var rand = Math.random;
var uniqueKeys = create(null);

function makeUniqueKey() {
    // Collisions are highly unlikely, but this module is in the business
    // of making guarantees rather than safe bets.
    do var uniqueKey = strSlice.call(numToStr.call(rand(), 36), 2);
    while (hasOwn.call(uniqueKeys, uniqueKey));
    return uniqueKeys[uniqueKey] = uniqueKey;
}

// External users might find this function useful, but it is not necessary
// for the typical use of this module.
defProp(exports, "makeUniqueKey", {
    value: makeUniqueKey
});

function makeAccessor() {
    var secrets = [];
    var brand = makeUniqueKey();

    function register(object) {
        var key = secrets.length;
        defProp(object, brand, { value: key });
        secrets[key] = {
            object: object,
            value: create(null)
        };
    }

    return function(object) {
        if (!hasOwn.call(object, brand))
            register(object);

        var secret = secrets[object[brand]];
        if (secret.object === object)
            return secret.value;
    };
}

defProp(exports, "makeAccessor", {
    value: makeAccessor
});

},{}],19:[function(require,module,exports){
if (!(typeof window !== "undefined" && window !== null)) {
  // Will do this dance so the require isn't parsed for browserify etc.
  var moduleName = './lib/context-node';
  module.exports = require(moduleName);
} else {
  module.exports = require('./lib/context-browser');
}

},{"./lib/context-browser":20}],20:[function(require,module,exports){
function Context(sandbox, parentElement) {
  this.iframe = document.createElement('iframe');
  this.iframe.style.display = 'none';
  parentElement = parentElement || document.body;
  parentElement.appendChild(this.iframe);
  var win = this.iframe.contentWindow;
  sandbox = sandbox || {};
  Object.keys(sandbox).forEach(function (key) {
    win[key] = sandbox[key];
  });
}

Context.prototype.evaluate = function (code) {
  return this.iframe.contentWindow.eval(code);
};

Context.prototype.destroy = function () {
  if (this.iframe) {
    this.iframe.parentNode.removeChild(this.iframe);
    this.iframe = null;
  }
};

module.exports = Context;
},{}],21:[function(require,module,exports){
try {
  eval('(function* () {})()');
  module.exports = true;
} catch (e) {
  module.exports = false;
}

},{}],22:[function(require,module,exports){
"use strict";

var defProp = Object.defineProperty || function(obj, name, desc) {
    // Normal property assignment is the best we can do if
    // Object.defineProperty is not available.
    obj[name] = desc.value;
};

// For functions that will be invoked using .call or .apply, we need to
// define those methods on the function objects themselves, rather than
// inheriting them from Function.prototype, so that a malicious or clumsy
// third party cannot interfere with the functionality of this module by
// redefining Function.prototype.call or .apply.
function makeSafeToCall(fun) {
    defProp(fun, "call", { value: fun.call });
    defProp(fun, "apply", { value: fun.apply });
    return fun;
}

var hasOwn = makeSafeToCall(Object.prototype.hasOwnProperty);
var numToStr = makeSafeToCall(Number.prototype.toString);
var strSlice = makeSafeToCall(String.prototype.slice);

var cloner = function(){};
var create = Object.create || function(prototype, properties) {
    cloner.prototype = prototype || null;
    var obj = new cloner;

    // The properties parameter is unused by this module, but I want this
    // shim to be as complete as possible.
    if (properties)
        for (var name in properties)
            if (hasOwn.call(properties, name))
                defProp(obj, name, properties[name]);

    return obj;
};

var rand = Math.random;
var uniqueKeys = create(null);

function makeUniqueKey() {
    // Collisions are highly unlikely, but this module is in the business
    // of making guarantees rather than safe bets.
    do var uniqueKey = strSlice.call(numToStr.call(rand(), 36), 2);
    while (hasOwn.call(uniqueKeys, uniqueKey));
    return uniqueKeys[uniqueKey] = uniqueKey;
}

// External users might find this function useful, but it is not necessary
// for the typical use of this module.
defProp(exports, "makeUniqueKey", {
    value: makeUniqueKey
});

function makeAccessor() {
    var secrets = {};
    var brand = makeUniqueKey();

    function register(object) {
        var key = makeUniqueKey();
        defProp(object, brand, { value: key });
    }

    function accessor(object) {
        if (!hasOwn.call(object, brand))
            register(object);

        var key = object[brand];
        return hasOwn.call(secrets, key)
            ? secrets[key]
            : secrets[key] = create(null);
    }

    accessor.forget = function(object) {
        delete secrets[object[brand]];
    };

    return accessor;
}

defProp(exports, "makeAccessor", {
    value: makeAccessor
});

},{}],23:[function(require,module,exports){
var assert = require("assert");
var linesModule = require("./lines");
var fromString = linesModule.fromString;
var Lines = linesModule.Lines;
var concat = linesModule.concat;
var Visitor = require("./visitor").Visitor;
var comparePos = require("./util").comparePos;

exports.add = function(ast, lines) {
    var comments = ast.comments;
    assert.ok(comments instanceof Array);
    delete ast.comments;

    assert.ok(lines instanceof Lines);

    var pt = new PosTracker,
        len = comments.length,
        comment,
        key,
        loc, locs = pt.locs,
        pair,
        sorted = [];

    pt.visit(ast);

    for (var i = 0; i < len; ++i) {
        comment = comments[i];
        Object.defineProperty(comment.loc, "lines", { value: lines });
        pt.getEntry(comment, "end").comment = comment;
    }

    for (key in locs) {
        loc = locs[key];
        pair = key.split(",");

        sorted.push({
            line: +pair[0],
            column: +pair[1],
            startNode: loc.startNode,
            endNode: loc.endNode,
            comment: loc.comment
        });
    }

    sorted.sort(comparePos);

    var pendingComments = [];
    var previousNode;

    function addComment(node, comment) {
        if (node) {
            var comments = node.comments || (node.comments = []);
            comments.push(comment);
        }
    }

    function dumpTrailing() {
        pendingComments.forEach(function(comment) {
            addComment(previousNode, comment);
            comment.trailing = true;
        });

        pendingComments.length = 0;
    }

    sorted.forEach(function(entry) {
        if (entry.endNode) {
            // If we're ending a node with comments still pending, then we
            // need to attach those comments to the previous node before
            // updating the previous node.
            dumpTrailing();
            previousNode = entry.endNode;
        }

        if (entry.comment) {
            pendingComments.push(entry.comment);
        }

        if (entry.startNode) {
            var node = entry.startNode;
            var nodeStartColumn = node.loc.start.column;
            var didAddLeadingComment = false;
            var gapEndLoc = node.loc.start;

            // Iterate backwards through pendingComments, examining the
            // gaps between them. In order to earn the .possiblyLeading
            // status, a comment must be separated from entry.startNode by
            // an unbroken series of whitespace-only gaps.
            for (var i = pendingComments.length - 1; i >= 0; --i) {
                var comment = pendingComments[i];
                var gap = lines.slice(comment.loc.end, gapEndLoc);
                gapEndLoc = comment.loc.start;

                if (gap.isOnlyWhitespace()) {
                    comment.possiblyLeading = true;
                } else {
                    break;
                }
            }

            pendingComments.forEach(function(comment) {
                if (!comment.possiblyLeading) {
                    // If comment.possiblyLeading was not set to true
                    // above, the comment must be a trailing comment.
                    comment.trailing = true;
                    addComment(previousNode, comment);

                } else if (didAddLeadingComment) {
                    // If we previously added a leading comment to this
                    // node, then any subsequent pending comments must
                    // also be leading comments, even if they are indented
                    // more deeply than the node itself.
                    assert.strictEqual(comment.possiblyLeading, true);
                    comment.trailing = false;
                    addComment(node, comment);

                } else if (comment.type === "Line" &&
                           comment.loc.start.column > nodeStartColumn) {
                    // If the comment is a //-style comment and indented
                    // more deeply than the node itself, and we have not
                    // encountered any other leading comments, treat this
                    // comment as a trailing comment and add it to the
                    // previous node.
                    comment.trailing = true;
                    addComment(previousNode, comment);

                } else {
                    // Here we have the first leading comment for this node.
                    comment.trailing = false;
                    addComment(node, comment);
                    didAddLeadingComment = true;
                }
            });

            pendingComments.length = 0;

            // Note: the previous node is the node that started OR ended
            // most recently.
            previousNode = entry.startNode;
        }
    });

    // Provided we have a previous node to add them to, dump any
    // still-pending comments into the last node we came across.
    dumpTrailing();
};

var PosTracker = Visitor.extend({
    init: function() {
        this.locs = {};
    },

    getEntry: function(node, which) {
        var locs = this.locs,
            key = getKey(node, which);
        return key && (locs[key] || (locs[key] = {}));
    },

    onStart: function(node) {
        var entry = this.getEntry(node, "start");
        if (entry && !entry.startNode)
            entry.startNode = node;
    },

    onEnd: function(node) {
        var entry = this.getEntry(node, "end");
        if (entry)
            entry.endNode = node;
    },

    genericVisit: function(node) {
        this.onStart(node);
        this._super(node);
        this.onEnd(node);
    }
});

function getKey(node, which) {
    var loc = node && node.loc,
        pos = loc && loc[which];
    return pos && (pos.line + "," + pos.column);
}

function printLeadingComment(comment) {
    var orig = comment.original;
    var loc = orig && orig.loc;
    var lines = loc && loc.lines;
    var parts = [];

    if (comment.type === "Block") {
        parts.push("/*", comment.value, "*/");
    } else if (comment.type === "Line") {
        parts.push("//", comment.value);
    } else assert.fail(comment.type);

    if (comment.trailing) {
        // When we print trailing comments as leading comments, we don't
        // want to bring any trailing spaces along.
        parts.push("\n");

    } else if (lines instanceof Lines) {
        var trailingSpace = lines.slice(
            loc.end,
            lines.skipSpaces(loc.end)
        );

        if (trailingSpace.length === 1) {
            // If the trailing space contains no newlines, then we want to
            // preserve it exactly as we found it.
            parts.push(trailingSpace);
        } else {
            // If the trailing space contains newlines, then replace it
            // with just that many newlines, with all other spaces removed.
            parts.push(new Array(trailingSpace.length).join("\n"));
        }

    } else {
        parts.push("\n");
    }

    return concat(parts).stripMargin(loc ? loc.start.column : 0);
}

function printTrailingComment(comment) {
    var orig = comment.original;
    var loc = orig && orig.loc;
    var lines = loc && loc.lines;
    var parts = [];

    if (lines instanceof Lines) {
        var fromPos = lines.skipSpaces(loc.start, true) || lines.firstPos();
        var leadingSpace = lines.slice(fromPos, loc.start);

        if (leadingSpace.length === 1) {
            // If the leading space contains no newlines, then we want to
            // preserve it exactly as we found it.
            parts.push(leadingSpace);
        } else {
            // If the leading space contains newlines, then replace it
            // with just that many newlines, sans all other spaces.
            parts.push(new Array(leadingSpace.length).join("\n"));
        }
    }

    if (comment.type === "Block") {
        parts.push("/*", comment.value, "*/");
    } else if (comment.type === "Line") {
        parts.push("//", comment.value, "\n");
    } else assert.fail(comment.type);

    return concat(parts).stripMargin(
        loc ? loc.start.column : 0,
        true // Skip the first line, in case there were leading spaces.
    );
}

exports.printComments = function(comments, innerLines) {
    if (innerLines) {
        assert.ok(innerLines instanceof Lines);
    } else {
        innerLines = fromString("");
    }

    var count = comments ? comments.length : 0;
    if (count === 0) {
        return innerLines;
    }

    var parts = [];
    var leading = [];
    var trailing = [];

    comments.forEach(function(comment) {
        // For now, only /*comments*/ can be trailing comments.
        if (comment.type === "Block" &&
            comment.trailing) {
            trailing.push(comment);
        } else {
            leading.push(comment);
        }
    });

    leading.forEach(function(comment) {
        parts.push(printLeadingComment(comment));
    });

    parts.push(innerLines);

    trailing.forEach(function(comment) {
        parts.push(printTrailingComment(comment));
    });

    return concat(parts);
};

},{"./lines":24,"./util":31,"./visitor":32,"assert":71}],24:[function(require,module,exports){
var assert = require("assert");
var sourceMap = require("source-map");
var normalizeOptions = require("./options").normalize;
var getSecret = require("private").makeAccessor();
var types = require("./types");
var isString = types.builtInTypes.string;
var comparePos = require("./util").comparePos;
var Mapping = require("./mapping");

// Goals:
// 1. Minimize new string creation.
// 2. Keep (de)identation O(lines) time.
// 3. Permit negative indentations.
// 4. Enforce immutability.
// 5. No newline characters.

function Lines(infos, sourceFileName) {
    var self = this;

    assert.ok(self instanceof Lines);
    assert.ok(infos.length > 0);

    var secret = getSecret(self);
    secret.infos = infos;
    secret.mappings = [];
    secret.cachedSourceMap = null;

    if (sourceFileName) {
        isString.assert(sourceFileName);
    } else {
        sourceFileName = null;
    }

    Object.defineProperties(self, {
        length: { value: infos.length },
        name: { value: sourceFileName }
    });

    if (sourceFileName) {
        secret.mappings.push(new Mapping(this, {
            start: this.firstPos(),
            end: this.lastPos()
        }));
    }
}

// Exposed for instanceof checks. The fromString function should be used
// to create new Lines objects.
exports.Lines = Lines;

var Lp = Lines.prototype,
    leadingSpaceExp = /^\s*/,
    secret;

function copyLineInfo(info) {
    return {
        line: info.line,
        indent: info.indent,
        sliceStart: info.sliceStart,
        sliceEnd: info.sliceEnd
    };
}

var fromStringCache = {};
var hasOwn = fromStringCache.hasOwnProperty;
var maxCacheKeyLen = 10;

function countSpaces(spaces, tabWidth) {
    var count = 0;
    var len = spaces.length;

    for (var i = 0; i < len; ++i) {
        var ch = spaces.charAt(i);

        if (ch === " ") {
            count += 1;

        } else if (ch === "\t") {
            assert.strictEqual(typeof tabWidth, "number");
            assert.ok(tabWidth > 0);

            var next = Math.ceil(count / tabWidth) * tabWidth;
            if (next === count) {
                count += tabWidth;
            } else {
                count = next;
            }

        } else if (ch === "\r") {
            // Ignore carriage return characters.

        } else {
            assert.fail("unexpected whitespace character", ch);
        }
    }

    return count;
}
exports.countSpaces = countSpaces;

function fromString(string, options) {
    if (string instanceof Lines)
        return string;

    string += "";

    var tabWidth = options && options.tabWidth;
    var tabless = string.indexOf("\t") < 0;
    var cacheable = !options && tabless && (string.length <= maxCacheKeyLen);

    assert.ok(tabWidth || tabless, "encountered tabs, but no tab width specified");

    if (cacheable && hasOwn.call(fromStringCache, string))
        return fromStringCache[string];

    var lines = new Lines(string.split("\n").map(function(line) {
        var spaces = leadingSpaceExp.exec(line)[0];
        return {
            line: line,
            indent: countSpaces(spaces, tabWidth),
            sliceStart: spaces.length,
            sliceEnd: line.length
        };
    }), normalizeOptions(options).sourceFileName);

    if (cacheable)
        fromStringCache[string] = lines;

    return lines;
}
exports.fromString = fromString;

function isOnlyWhitespace(string) {
    return !/\S/.test(string);
}

Lp.toString = function(options) {
    return this.sliceString(this.firstPos(), this.lastPos(), options);
};

Lp.getSourceMap = function(sourceMapName, sourceRoot) {
    if (!sourceMapName) {
        // Although we could make up a name or generate an anonymous
        // source map, instead we assume that any consumer who does not
        // provide a name does not actually want a source map.
        return null;
    }

    var targetLines = this;

    function updateJSON(json) {
        json = json || {};

        isString.assert(sourceMapName);
        json.file = sourceMapName;

        if (sourceRoot) {
            isString.assert(sourceRoot);
            json.sourceRoot = sourceRoot;
        }

        return json;
    }

    var secret = getSecret(targetLines);
    if (secret.cachedSourceMap) {
        // Since Lines objects are immutable, we can reuse any source map
        // that was previously generated. Nevertheless, we return a new
        // JSON object here to protect the cached source map from outside
        // modification.
        return updateJSON(secret.cachedSourceMap.toJSON());
    }

    assert.ok(
        secret.mappings.length > 0,
        "No source mappings found. Be sure to pass { sourceFileName: " +
            '"source.js" } to recast.parse to enable source mapping.'
    );

    var smg = new sourceMap.SourceMapGenerator(updateJSON());
    var sourcesToContents = {};

    secret.mappings.forEach(function(mapping) {
        var sourceCursor = mapping.sourceLines.skipSpaces(
            mapping.sourceLoc.start);

        var targetCursor = targetLines.skipSpaces(
            mapping.targetLoc.start);

        while (comparePos(sourceCursor, mapping.sourceLoc.end) < 0 &&
               comparePos(targetCursor, mapping.targetLoc.end) < 0) {

            var sourceChar = mapping.sourceLines.charAt(sourceCursor);
            var targetChar = targetLines.charAt(targetCursor);
            assert.strictEqual(sourceChar, targetChar);

            var sourceName = mapping.sourceLines.name;

            // Add mappings one character at a time for maximum resolution.
            smg.addMapping({
                source: sourceName,
                original: { line: sourceCursor.line,
                            column: sourceCursor.column },
                generated: { line: targetCursor.line,
                             column: targetCursor.column }
            });

            if (!hasOwn.call(sourcesToContents, sourceName)) {
                var sourceContent = mapping.sourceLines.toString();
                smg.setSourceContent(sourceName, sourceContent);
                sourcesToContents[sourceName] = sourceContent;
            }

            targetLines.nextPos(targetCursor, true);
            mapping.sourceLines.nextPos(sourceCursor, true);
        }
    });

    secret.cachedSourceMap = smg;

    return smg.toJSON();
};

Lp.bootstrapCharAt = function(pos) {
    assert.strictEqual(typeof pos, "object");
    assert.strictEqual(typeof pos.line, "number");
    assert.strictEqual(typeof pos.column, "number");

    var line = pos.line,
        column = pos.column,
        strings = this.toString().split("\n"),
        string = strings[line - 1];

    if (typeof string === "undefined")
        return "";

    if (column === string.length &&
        line < strings.length)
        return "\n";

    return string.charAt(column);
};

Lp.charAt = function(pos) {
    assert.strictEqual(typeof pos, "object");
    assert.strictEqual(typeof pos.line, "number");
    assert.strictEqual(typeof pos.column, "number");

    var line = pos.line,
        column = pos.column,
        secret = getSecret(this),
        infos = secret.infos,
        info = infos[line - 1],
        c = column;

    if (typeof info === "undefined" || c < 0)
        return "";

    var indent = this.getIndentAt(line);
    if (c < indent)
        return " ";

    c += info.sliceStart - indent;
    if (c === info.sliceEnd &&
        line < this.length)
        return "\n";

    return info.line.charAt(c);
};

Lp.stripMargin = function(width, skipFirstLine) {
    if (width === 0)
        return this;

    assert.ok(width > 0, "negative margin: " + width);

    if (skipFirstLine && this.length === 1)
        return this;

    var secret = getSecret(this);

    var lines = new Lines(secret.infos.map(function(info, i) {
        if (info.line && (i > 0 || !skipFirstLine)) {
            info = copyLineInfo(info);
            info.indent = Math.max(0, info.indent - width);
        }
        return info;
    }));

    if (secret.mappings.length > 0) {
        var newMappings = getSecret(lines).mappings;
        assert.strictEqual(newMappings.length, 0);
        secret.mappings.forEach(function(mapping) {
            newMappings.push(mapping.indent(width, skipFirstLine, true));
        });
    }

    return lines;
};

Lp.indent = function(by) {
    if (by === 0)
        return this;

    var secret = getSecret(this);

    var lines = new Lines(secret.infos.map(function(info) {
        if (info.line) {
            info = copyLineInfo(info);
            info.indent += by;
        }
        return info
    }));

    if (secret.mappings.length > 0) {
        var newMappings = getSecret(lines).mappings;
        assert.strictEqual(newMappings.length, 0);
        secret.mappings.forEach(function(mapping) {
            newMappings.push(mapping.indent(by));
        });
    }

    return lines;
};

Lp.indentTail = function(by) {
    if (by === 0)
        return this;

    if (this.length < 2)
        return this;

    var secret = getSecret(this);

    var lines = new Lines(secret.infos.map(function(info, i) {
        if (i > 0 && info.line) {
            info = copyLineInfo(info);
            info.indent += by;
        }

        return info;
    }));

    if (secret.mappings.length > 0) {
        var newMappings = getSecret(lines).mappings;
        assert.strictEqual(newMappings.length, 0);
        secret.mappings.forEach(function(mapping) {
            newMappings.push(mapping.indent(by, true));
        });
    }

    return lines;
};

Lp.getIndentAt = function(line) {
    assert.ok(line >= 1, "no line " + line + " (line numbers start from 1)");
    var secret = getSecret(this),
        info = secret.infos[line - 1];
    return Math.max(info.indent, 0);
};

Lp.guessTabWidth = function() {
    var secret = getSecret(this);
    if (hasOwn.call(secret, "cachedTabWidth")) {
        return secret.cachedTabWidth;
    }

    var counts = []; // Sparse array.
    var lastIndent = 0;

    for (var line = 1, last = this.length; line <= last; ++line) {
        var info = secret.infos[line - 1];
        var diff = Math.abs(info.indent - lastIndent);
        counts[diff] = ~~counts[diff] + 1;
        lastIndent = info.indent;
    }

    var maxCount = -1;
    var result = 2;

    for (var tabWidth = 1;
         tabWidth < counts.length;
         tabWidth += 1) {
        if (hasOwn.call(counts, tabWidth) &&
            counts[tabWidth] > maxCount) {
            maxCount = counts[tabWidth];
            result = tabWidth;
        }
    }

    return secret.cachedTabWidth = result;
};

Lp.isOnlyWhitespace = function() {
    return isOnlyWhitespace(this.toString());
};

Lp.isPrecededOnlyByWhitespace = function(pos) {
    return this.slice({
        line: pos.line,
        column: 0
    }, pos).isOnlyWhitespace();
};

Lp.getLineLength = function(line) {
    var secret = getSecret(this),
        info = secret.infos[line - 1];
    return this.getIndentAt(line) + info.sliceEnd - info.sliceStart;
};

Lp.nextPos = function(pos, skipSpaces) {
    var l = Math.max(pos.line, 0),
        c = Math.max(pos.column, 0);

    if (c < this.getLineLength(l)) {
        pos.column += 1;

        return skipSpaces
            ? !!this.skipSpaces(pos, false, true)
            : true;
    }

    if (l < this.length) {
        pos.line += 1;
        pos.column = 0;

        return skipSpaces
            ? !!this.skipSpaces(pos, false, true)
            : true;
    }

    return false;
};

Lp.prevPos = function(pos, skipSpaces) {
    var l = pos.line,
        c = pos.column;

    if (c < 1) {
        l -= 1;

        if (l < 1)
            return false;

        c = this.getLineLength(l);

    } else {
        c = Math.min(c - 1, this.getLineLength(l));
    }

    pos.line = l;
    pos.column = c;

    return skipSpaces
        ? !!this.skipSpaces(pos, true, true)
        : true;
};

Lp.firstPos = function() {
    // Trivial, but provided for completeness.
    return { line: 1, column: 0 };
};

Lp.lastPos = function() {
    return {
        line: this.length,
        column: this.getLineLength(this.length)
    };
};

Lp.skipSpaces = function(pos, backward, modifyInPlace) {
    if (pos) {
        pos = modifyInPlace ? pos : {
            line: pos.line,
            column: pos.column
        };
    } else if (backward) {
        pos = this.lastPos();
    } else {
        pos = this.firstPos();
    }

    if (backward) {
        while (this.prevPos(pos)) {
            if (!isOnlyWhitespace(this.charAt(pos)) &&
                this.nextPos(pos)) {
                return pos;
            }
        }

        return null;

    } else {
        while (isOnlyWhitespace(this.charAt(pos))) {
            if (!this.nextPos(pos)) {
                return null;
            }
        }

        return pos;
    }
};

Lp.trimLeft = function() {
    var pos = this.skipSpaces(this.firstPos(), false, true);
    return pos ? this.slice(pos) : emptyLines;
};

Lp.trimRight = function() {
    var pos = this.skipSpaces(this.lastPos(), true, true);
    return pos ? this.slice(this.firstPos(), pos) : emptyLines;
};

Lp.trim = function() {
    var start = this.skipSpaces(this.firstPos(), false, true);
    if (start === null)
        return emptyLines;

    var end = this.skipSpaces(this.lastPos(), true, true);
    assert.notStrictEqual(end, null);

    return this.slice(start, end);
};

Lp.eachPos = function(callback, startPos, skipSpaces) {
    var pos = this.firstPos();

    if (startPos) {
        pos.line = startPos.line,
        pos.column = startPos.column
    }

    if (skipSpaces && !this.skipSpaces(pos, false, true)) {
        return; // Encountered nothing but spaces.
    }

    do callback.call(this, pos);
    while (this.nextPos(pos, skipSpaces));
};

Lp.bootstrapSlice = function(start, end) {
    var strings = this.toString().split("\n").slice(
            start.line - 1, end.line);

    strings.push(strings.pop().slice(0, end.column));
    strings[0] = strings[0].slice(start.column);

    return fromString(strings.join("\n"));
};

Lp.slice = function(start, end) {
    if (!end) {
        if (!start) {
            // The client seems to want a copy of this Lines object, but
            // Lines objects are immutable, so it's perfectly adequate to
            // return the same object.
            return this;
        }

        // Slice to the end if no end position was provided.
        end = this.lastPos();
    }

    var secret = getSecret(this);
    var sliced = secret.infos.slice(start.line - 1, end.line);

    if (start.line === end.line) {
        sliced[0] = sliceInfo(sliced[0], start.column, end.column);
    } else {
        assert.ok(start.line < end.line);
        sliced[0] = sliceInfo(sliced[0], start.column);
        sliced.push(sliceInfo(sliced.pop(), 0, end.column));
    }

    var lines = new Lines(sliced);

    if (secret.mappings.length > 0) {
        var newMappings = getSecret(lines).mappings;
        assert.strictEqual(newMappings.length, 0);
        secret.mappings.forEach(function(mapping) {
            var sliced = mapping.slice(this, start, end);
            if (sliced) {
                newMappings.push(sliced);
            }
        }, this);
    }

    return lines;
};

function sliceInfo(info, startCol, endCol) {
    var sliceStart = info.sliceStart;
    var sliceEnd = info.sliceEnd;
    var indent = Math.max(info.indent, 0);
    var lineLength = indent + sliceEnd - sliceStart;

    if (typeof endCol === "undefined") {
        endCol = lineLength;
    }

    startCol = Math.max(startCol, 0);
    endCol = Math.min(endCol, lineLength);
    endCol = Math.max(endCol, startCol);

    if (endCol < indent) {
        indent = endCol;
        sliceEnd = sliceStart;
    } else {
        sliceEnd -= lineLength - endCol;
    }

    lineLength = endCol;
    lineLength -= startCol;

    if (startCol < indent) {
        indent -= startCol;
    } else {
        startCol -= indent;
        indent = 0;
        sliceStart += startCol;
    }

    assert.ok(indent >= 0);
    assert.ok(sliceStart <= sliceEnd);
    assert.strictEqual(lineLength, indent + sliceEnd - sliceStart);

    if (info.indent === indent &&
        info.sliceStart === sliceStart &&
        info.sliceEnd === sliceEnd) {
        return info;
    }

    return {
        line: info.line,
        indent: indent,
        sliceStart: sliceStart,
        sliceEnd: sliceEnd
    };
}

Lp.bootstrapSliceString = function(start, end, options) {
    return this.slice(start, end).toString(options);
};

Lp.sliceString = function(start, end, options) {
    if (!end) {
        if (!start) {
            // The client seems to want a copy of this Lines object, but
            // Lines objects are immutable, so it's perfectly adequate to
            // return the same object.
            return this;
        }

        // Slice to the end if no end position was provided.
        end = this.lastPos();
    }

    options = normalizeOptions(options);

    var infos = getSecret(this).infos;
    var parts = [];
    var tabWidth = options.tabWidth;

    for (var line = start.line; line <= end.line; ++line) {
        var info = infos[line - 1];

        if (line === start.line) {
            if (line === end.line) {
                info = sliceInfo(info, start.column, end.column);
            } else {
                info = sliceInfo(info, start.column);
            }
        } else if (line === end.line) {
            info = sliceInfo(info, 0, end.column);
        }

        var indent = Math.max(info.indent, 0);

        var before = info.line.slice(0, info.sliceStart);
        if (options.reuseWhitespace &&
            isOnlyWhitespace(before) &&
            countSpaces(before, options.tabWidth) === indent) {
            // Reuse original spaces if the indentation is correct.
            parts.push(info.line.slice(0, info.sliceEnd));
            continue;
        }

        var tabs = 0;
        var spaces = indent;

        if (options.useTabs) {
            tabs = Math.floor(indent / tabWidth);
            spaces -= tabs * tabWidth;
        }

        var result = "";

        if (tabs > 0) {
            result += new Array(tabs + 1).join("\t");
        }

        if (spaces > 0) {
            result += new Array(spaces + 1).join(" ");
        }

        result += info.line.slice(info.sliceStart, info.sliceEnd);

        parts.push(result);
    }

    return parts.join("\n");
};

Lp.isEmpty = function() {
    return this.length < 2 && this.getLineLength(1) < 1;
};

Lp.join = function(elements) {
    var separator = this;
    var separatorSecret = getSecret(separator);
    var infos = [];
    var mappings = [];
    var prevInfo;

    function appendSecret(secret) {
        if (secret === null)
            return;

        if (prevInfo) {
            var info = secret.infos[0];
            var indent = new Array(info.indent + 1).join(" ");
            var prevLine = infos.length;
            var prevColumn = Math.max(prevInfo.indent, 0) +
                prevInfo.sliceEnd - prevInfo.sliceStart;

            prevInfo.line = prevInfo.line.slice(
                0, prevInfo.sliceEnd) + indent + info.line.slice(
                    info.sliceStart, info.sliceEnd);

            prevInfo.sliceEnd = prevInfo.line.length;

            if (secret.mappings.length > 0) {
                secret.mappings.forEach(function(mapping) {
                    mappings.push(mapping.add(prevLine, prevColumn));
                });
            }

        } else if (secret.mappings.length > 0) {
            mappings.push.apply(mappings, secret.mappings);
        }

        secret.infos.forEach(function(info, i) {
            if (!prevInfo || i > 0) {
                prevInfo = copyLineInfo(info);
                infos.push(prevInfo);
            }
        });
    }

    function appendWithSeparator(secret, i) {
        if (i > 0)
            appendSecret(separatorSecret);
        appendSecret(secret);
    }

    elements.map(function(elem) {
        var lines = fromString(elem);
        if (lines.isEmpty())
            return null;
        return getSecret(lines);
    }).forEach(separator.isEmpty()
               ? appendSecret
               : appendWithSeparator);

    if (infos.length < 1)
        return emptyLines;

    var lines = new Lines(infos);

    if (mappings.length > 0) {
        var newSecret = getSecret(lines);
        assert.strictEqual(newSecret.mappings.length, 0);
        newSecret.mappings = mappings;
    }

    return lines;
};

exports.concat = function(elements) {
    return emptyLines.join(elements);
};

Lp.concat = function(other) {
    var args = arguments,
        list = [this];
    list.push.apply(list, args);
    assert.strictEqual(list.length, args.length + 1);
    return emptyLines.join(list);
};

// The emptyLines object needs to be created all the way down here so that
// Lines.prototype will be fully populated.
var emptyLines = fromString("");

},{"./mapping":25,"./options":26,"./types":30,"./util":31,"assert":71,"private":36,"source-map":37}],25:[function(require,module,exports){
var assert = require("assert");
var types = require("./types");
var isString = types.builtInTypes.string;
var isNumber = types.builtInTypes.number;
var SourceLocation = types.namedTypes.SourceLocation;
var Position = types.namedTypes.Position;
var linesModule = require("./lines");
var comparePos = require("./util").comparePos;

function Mapping(sourceLines, sourceLoc, targetLoc) {
    assert.ok(this instanceof Mapping);
    assert.ok(sourceLines instanceof linesModule.Lines);
    SourceLocation.assert(sourceLoc);

    if (targetLoc) {
        // In certain cases it's possible for targetLoc.{start,end}.column
        // values to be negative, which technically makes them no longer
        // valid SourceLocation nodes, so we need to be more forgiving.
        assert.ok(
            isNumber.check(targetLoc.start.line) &&
            isNumber.check(targetLoc.start.column) &&
            isNumber.check(targetLoc.end.line) &&
            isNumber.check(targetLoc.end.column)
        );
    } else {
        // Assume identity mapping if no targetLoc specified.
        targetLoc = sourceLoc;
    }

    Object.defineProperties(this, {
        sourceLines: { value: sourceLines },
        sourceLoc: { value: sourceLoc },
        targetLoc: { value: targetLoc }
    });
}

var Mp = Mapping.prototype;
module.exports = Mapping;

Mp.slice = function(lines, start, end) {
    assert.ok(lines instanceof linesModule.Lines);
    Position.assert(start);

    if (end) {
        Position.assert(end);
    } else {
        end = lines.lastPos();
    }

    var sourceLines = this.sourceLines;
    var sourceLoc = this.sourceLoc;
    var targetLoc = this.targetLoc;

    function skip(name) {
        var sourceFromPos = sourceLoc[name];
        var targetFromPos = targetLoc[name];
        var targetToPos = start;

        if (name === "end") {
            targetToPos = end;
        } else {
            assert.strictEqual(name, "start");
        }

        return skipChars(
            sourceLines, sourceFromPos,
            lines, targetFromPos, targetToPos
        );
    }

    if (comparePos(start, targetLoc.start) <= 0) {
        if (comparePos(targetLoc.end, end) <= 0) {
            targetLoc = {
                start: subtractPos(targetLoc.start, start.line, start.column),
                end: subtractPos(targetLoc.end, start.line, start.column)
            };

            // The sourceLoc can stay the same because the contents of the
            // targetLoc have not changed.

        } else if (comparePos(end, targetLoc.start) <= 0) {
            return null;

        } else {
            sourceLoc = {
                start: sourceLoc.start,
                end: skip("end")
            };

            targetLoc = {
                start: subtractPos(targetLoc.start, start.line, start.column),
                end: subtractPos(end, start.line, start.column)
            };
        }

    } else {
        if (comparePos(targetLoc.end, start) <= 0) {
            return null;
        }

        if (comparePos(targetLoc.end, end) <= 0) {
            sourceLoc = {
                start: skip("start"),
                end: sourceLoc.end
            };

            targetLoc = {
                // Same as subtractPos(start, start.line, start.column):
                start: { line: 1, column: 0 },
                end: subtractPos(targetLoc.end, start.line, start.column)
            };

        } else {
            sourceLoc = {
                start: skip("start"),
                end: skip("end")
            };

            targetLoc = {
                // Same as subtractPos(start, start.line, start.column):
                start: { line: 1, column: 0 },
                end: subtractPos(end, start.line, start.column)
            };
        }
    }

    return new Mapping(this.sourceLines, sourceLoc, targetLoc);
};

Mp.add = function(line, column) {
    return new Mapping(this.sourceLines, this.sourceLoc, {
        start: addPos(this.targetLoc.start, line, column),
        end: addPos(this.targetLoc.end, line, column)
    });
};

function addPos(toPos, line, column) {
    return {
        line: toPos.line + line - 1,
        column: (toPos.line === 1)
            ? toPos.column + column
            : toPos.column
    };
}

Mp.subtract = function(line, column) {
    return new Mapping(this.sourceLines, this.sourceLoc, {
        start: subtractPos(this.targetLoc.start, line, column),
        end: subtractPos(this.targetLoc.end, line, column)
    });
};

function subtractPos(fromPos, line, column) {
    return {
        line: fromPos.line - line + 1,
        column: (fromPos.line === line)
            ? fromPos.column - column
            : fromPos.column
    };
}

Mp.indent = function(by, skipFirstLine, noNegativeColumns) {
    if (by === 0) {
        return this;
    }

    var targetLoc = this.targetLoc;
    var startLine = targetLoc.start.line;
    var endLine = targetLoc.end.line;

    if (skipFirstLine && startLine === 1 && endLine === 1) {
        return this;
    }

    targetLoc = {
        start: targetLoc.start,
        end: targetLoc.end
    };

    if (!skipFirstLine || startLine > 1) {
        var startColumn = targetLoc.start.column + by;
        targetLoc.start = {
            line: startLine,
            column: noNegativeColumns
                ? Math.max(0, startColumn)
                : startColumn
        };
    }

    if (!skipFirstLine || endLine > 1) {
        var endColumn = targetLoc.end.column + by;
        targetLoc.end = {
            line: endLine,
            column: noNegativeColumns
                ? Math.max(0, endColumn)
                : endColumn
        };
    }

    return new Mapping(this.sourceLines, this.sourceLoc, targetLoc);
};

function skipChars(
    sourceLines, sourceFromPos,
    targetLines, targetFromPos, targetToPos
) {
    assert.ok(sourceLines instanceof linesModule.Lines);
    assert.ok(targetLines instanceof linesModule.Lines);
    Position.assert(sourceFromPos);
    Position.assert(targetFromPos);
    Position.assert(targetToPos);

    var targetComparison = comparePos(targetFromPos, targetToPos);
    if (targetComparison === 0) {
        // Trivial case: no characters to skip.
        return sourceFromPos;
    }

    if (targetComparison < 0) {
        // Skipping forward.

        var sourceCursor = sourceLines.skipSpaces(sourceFromPos);
        var targetCursor = targetLines.skipSpaces(targetFromPos);

        var lineDiff = targetToPos.line - targetCursor.line;
        sourceCursor.line += lineDiff;
        targetCursor.line += lineDiff;

        if (lineDiff > 0) {
            // If jumping to later lines, reset columns to the beginnings
            // of those lines.
            sourceCursor.column = 0;
            targetCursor.column = 0;
        } else {
            assert.strictEqual(lineDiff, 0);
        }

        while (comparePos(targetCursor, targetToPos) < 0 &&
               targetLines.nextPos(targetCursor, true)) {
            assert.ok(sourceLines.nextPos(sourceCursor, true));
            assert.strictEqual(
                sourceLines.charAt(sourceCursor),
                targetLines.charAt(targetCursor)
            );
        }

    } else {
        // Skipping backward.

        var sourceCursor = sourceLines.skipSpaces(sourceFromPos, true);
        var targetCursor = targetLines.skipSpaces(targetFromPos, true);

        var lineDiff = targetToPos.line - targetCursor.line;
        sourceCursor.line += lineDiff;
        targetCursor.line += lineDiff;

        if (lineDiff < 0) {
            // If jumping to earlier lines, reset columns to the ends of
            // those lines.
            sourceCursor.column = sourceLines.getLineLength(sourceCursor.line);
            targetCursor.column = targetLines.getLineLength(targetCursor.line);
        } else {
            assert.strictEqual(lineDiff, 0);
        }

        while (comparePos(targetToPos, targetCursor) < 0 &&
               targetLines.prevPos(targetCursor, true)) {
            assert.ok(sourceLines.prevPos(sourceCursor, true));
            assert.strictEqual(
                sourceLines.charAt(sourceCursor),
                targetLines.charAt(targetCursor)
            );
        }
    }

    return sourceCursor;
}

},{"./lines":24,"./types":30,"./util":31,"assert":71}],26:[function(require,module,exports){
var defaults = {
    tabWidth: 4,
    useTabs: false,
    reuseWhitespace: true,
    wrapColumn: 74, // Aspirational for now.
    sourceFileName: null,
    sourceMapName: null,
    sourceRoot: null,
    inputSourceMap: null,
    esprima: require("esprima"),
    range: false,
    tolerant: true
}, hasOwn = defaults.hasOwnProperty;

// Copy options and fill in default values.
exports.normalize = function(options) {
    options = options || defaults;

    function get(key) {
        return hasOwn.call(options, key)
            ? options[key]
            : defaults[key];
    }

    return {
        tabWidth: +get("tabWidth"),
        useTabs: !!get("useTabs"),
        reuseWhitespace: !!get("reuseWhitespace"),
        wrapColumn: Math.max(get("wrapColumn"), 0),
        sourceFileName: get("sourceFileName"),
        sourceMapName: get("sourceMapName"),
        sourceRoot: get("sourceRoot"),
        inputSourceMap: get("inputSourceMap"),
        esprima: get("esprima"),
        range: get("range"),
        tolerant: get("tolerant")
    };
};

},{"esprima":35}],27:[function(require,module,exports){
var assert = require("assert");
var types = require("./types");
var n = types.namedTypes;
var b = types.builders;
var Patcher = require("./patcher").Patcher;
var Visitor = require("./visitor").Visitor;
var normalizeOptions = require("./options").normalize;

exports.parse = function(source, options) {
    options = normalizeOptions(options);

    var lines = require("./lines").fromString(source, options);

    var pure = options.esprima.parse(lines.toString({
        tabWidth: options.tabWidth,
        reuseWhitespace: false,
        useTabs: false
    }), {
        loc: true,
        range: options.range,
        comment: true,
        tolerant: options.tolerant
    });

    new LocationFixer(lines).visit(pure);

    require("./comments").add(pure, lines);

    // In order to ensure we reprint leading and trailing program
    // comments, wrap the original Program node with a File node.
    pure = b.file(pure);
    pure.loc = {
        lines: lines,
        start: lines.firstPos(),
        end: lines.lastPos()
    };

    // Return a copy of the original AST so that any changes made may be
    // compared to the original.
    return copyAst(pure);
};

var LocationFixer = Visitor.extend({
    init: function(lines) {
        this.lines = lines;
    },

    genericVisit: function(node) {
        this._super(node);

        var loc = node && node.loc,
            start = loc && loc.start,
            end = loc && loc.end;

        if (loc) {
            Object.defineProperty(loc, "lines", {
                value: this.lines
            });
        }

        if (start) {
            start.line = Math.max(start.line, 1);
        }

        if (end) {
            end.line = Math.max(end.line, 1);

            var lines = loc.lines, pos = {
                line: end.line,
                column: end.column
            };

            // Negative columns might indicate an Esprima bug?
            // For now, treat them as reverse indices, a la Python.
            if (pos.column < 0)
                pos.column += lines.getLineLength(pos.line);

            while (lines.prevPos(pos)) {
                if (/\S/.test(lines.charAt(pos))) {
                    assert.ok(lines.nextPos(pos));

                    end.line = pos.line;
                    end.column = pos.column;

                    break;
                }
            }
        }
    }
});

function copyAst(node, parent) {
    if (typeof node === "object" &&
        node !== null)
    {
        if (node instanceof RegExp)
            return node;

        if (node instanceof Array) {
            return node.map(function(child) {
                return copyAst(child, parent);
            });
        }

        var copy = {},
            key,
            val;

        for (key in node) {
            if (node.hasOwnProperty(key)) {
                val = copyAst(node[key], node);
                if (typeof val !== "function")
                    copy[key] = val;
            }
        }

        if (parent && n.Node.check(node)) {
            // Allow upwards traversal of the original AST.
            Object.defineProperty(node, "parentNode", {
                value: parent
            });
        }

        // Provide a link from the copy to the original.
        Object.defineProperty(copy, "original", {
            value: node,
            configurable: false,
            enumerable: false,
            writable: true,
        });

        return copy;
    }

    return node;
}

},{"./comments":23,"./lines":24,"./options":26,"./patcher":28,"./types":30,"./visitor":32,"assert":71}],28:[function(require,module,exports){
var assert = require("assert");
var linesModule = require("./lines");
var typesModule = require("./types");
var getFieldValue = typesModule.getFieldValue;
var Node = typesModule.namedTypes.Node;
var util = require("./util");
var comparePos = util.comparePos;
var NodePath = require("ast-types").NodePath;

function Patcher(lines) {
    assert.ok(this instanceof Patcher);
    assert.ok(lines instanceof linesModule.Lines);

    var self = this,
        replacements = [];

    self.replace = function(loc, lines) {
        if (typeof lines === "string")
            lines = linesModule.fromString(lines);

        replacements.push({
            lines: lines,
            start: loc.start,
            end: loc.end
        });
    };

    self.get = function(loc) {
        // If no location is provided, return the complete Lines object.
        loc = loc || {
            start: { line: 1, column: 0 },
            end: { line: lines.length,
                   column: lines.getLineLength(lines.length) }
        };

        var sliceFrom = loc.start,
            toConcat = [];

        function pushSlice(from, to) {
            assert.ok(comparePos(from, to) <= 0);
            toConcat.push(lines.slice(from, to));
        }

        replacements.sort(function(a, b) {
            return comparePos(a.start, b.start);
        }).forEach(function(rep) {
            if (comparePos(sliceFrom, rep.start) > 0) {
                // Ignore nested replacement ranges.
            } else {
                pushSlice(sliceFrom, rep.start);
                toConcat.push(rep.lines);
                sliceFrom = rep.end;
            }
        });

        pushSlice(sliceFrom, loc.end);

        return linesModule.concat(toConcat);
    };
}
exports.Patcher = Patcher;

exports.getReprinter = function(path) {
    assert.ok(path instanceof NodePath);

    var orig = path.node.original;
    var origLoc = orig && orig.loc;
    var lines = origLoc && origLoc.lines;
    var reprints = [];

    if (!lines || !findReprints(path, reprints))
        return;

    return function(print) {
        var patcher = new Patcher(lines);

        reprints.forEach(function(reprint) {
            var old = reprint.oldNode;
            patcher.replace(
                old.loc,
                print(reprint.newPath).indentTail(
                    getIndent(old)));
        });

        return patcher.get(origLoc).indentTail(-getIndent(orig));
    };
};

// Get the indentation of the first ancestor node on a line with nothing
// before it but whitespace.
function getIndent(orig) {
    var naiveIndent = orig.loc.lines.getIndentAt(
        orig.loc.start.line);

    for (var loc, start, lines;
         orig &&
         (loc = orig.loc) &&
         (start = loc.start) &&
         (lines = loc.lines);
         orig = orig.parentNode)
    {
        if (lines.isPrecededOnlyByWhitespace(start)) {
            // The indent returned by lines.getIndentAt is the column of
            // the first non-space character in the line, but start.column
            // may fall before that character, as when a file begins with
            // whitespace but its start.column nevertheless must be 0.
            assert.ok(start.column <= lines.getIndentAt(start.line));
            return start.column;
        }
    }

    return naiveIndent;
}

function findReprints(path, reprints) {
    var node = path.node;
    assert.ok(node.original);
    assert.deepEqual(reprints, []);

    var canReprint = findChildReprints(path, node.original, reprints);

    if (!canReprint) {
        // Make absolutely sure the calling code does not attempt to reprint
        // any nodes.
        reprints.length = 0;
    }

    return canReprint;
}

function findAnyReprints(path, oldNode, reprints) {
    var newNode = path.value;
    if (newNode === oldNode)
        return true;

    if (newNode instanceof Array)
        return findArrayReprints(path, oldNode, reprints);

    if (typeof newNode === "object")
        return findObjectReprints(path, oldNode, reprints);

    return false;
}

function findArrayReprints(path, oldNode, reprints) {
    var newNode = path.value;
    assert.ok(newNode instanceof Array);
    var len = newNode.length;

    if (!(oldNode instanceof Array &&
          oldNode.length === len))
        return false;

    for (var i = 0; i < len; ++i)
        if (!findAnyReprints(path.get(i), oldNode[i], reprints))
            return false;

    return true;
}

function findObjectReprints(path, oldNode, reprints) {
    var newNode = path.value;
    assert.strictEqual(typeof newNode, "object");
    if (!newNode || !oldNode || typeof oldNode !== "object")
        return false;

    var childReprints = [];
    var canReprintChildren = findChildReprints(path, oldNode, childReprints);

    if (Node.check(newNode)) {
        // TODO Decompose this check: if (!printTheSame(newNode, oldNode))
        if (newNode.type !== oldNode.type)
            return false;

        if (!canReprintChildren) {
            reprints.push({
                newPath: path,
                oldNode: oldNode
            });

            return true;
        }
    }

    reprints.push.apply(reprints, childReprints);
    return canReprintChildren;
}

function hasParens(oldNode) {
    var loc = oldNode.loc;
    var lines = loc && loc.lines;

    if (lines) {
        // This logic can technically be fooled if the node has
        // parentheses but there are comments intervening between the
        // parentheses and the node. In such cases the node will be
        // harmlessly wrapped in an additional layer of parentheses.
        var pos = lines.skipSpaces(loc.start, true);
        if (pos && lines.prevPos(pos) && lines.charAt(pos) === "(") {
            pos = lines.skipSpaces(loc.end);
            if (pos && lines.charAt(pos) === ")")
                return true;
        }
    }

    return false;
}

function findChildReprints(path, oldNode, reprints) {
    var newNode = path.value;
    assert.strictEqual(typeof newNode, "object");
    assert.strictEqual(typeof oldNode, "object");

    // If this node needs parentheses and will not be wrapped with
    // parentheses when reprinted, then return false to skip reprinting
    // and let it be printed generically.
    if (path.needsParens() && !hasParens(oldNode))
        return false;

    for (var k in util.getUnionOfKeys(newNode, oldNode)) {
        if (k === "loc")
            continue;

        var oldChild = getFieldValue(oldNode, k);
        var newChild = getFieldValue(newNode, k);

        // Normally we would use path.get(k), but that might not produce a
        // Path with newChild as its .value (for instance, if a default
        // value was returned), so we must forge this path by hand.
        var newChildPath = new NodePath(newChild, path, k);

        if (!findAnyReprints(newChildPath, oldChild, reprints))
            return false;
    }

    return true;
}

},{"./lines":24,"./types":30,"./util":31,"assert":71,"ast-types":15}],29:[function(require,module,exports){
var assert = require("assert");
var sourceMap = require("source-map");
var printComments = require("./comments").printComments;
var linesModule = require("./lines");
var fromString = linesModule.fromString;
var concat = linesModule.concat;
var normalizeOptions = require("./options").normalize;
var getReprinter = require("./patcher").getReprinter;
var types = require("./types");
var namedTypes = types.namedTypes;
var isString = types.builtInTypes.string;
var isObject = types.builtInTypes.object;
var NodePath = types.NodePath;
var util = require("./util");

function PrintResult(code, sourceMap) {
    assert.ok(this instanceof PrintResult);
    isString.assert(code);

    var properties = {
        code: {
            value: code,
            enumerable: true
        }
    };

    if (sourceMap) {
        isObject.assert(sourceMap);

        properties.map = {
            value: sourceMap,
            enumerable: true
        };
    }

    Object.defineProperties(this, properties);
}

var PRp = PrintResult.prototype;
var warnedAboutToString = false;

PRp.toString = function() {
    if (!warnedAboutToString) {
        console.warn(
            "Deprecation warning: recast.print now returns an object with " +
            "a .code property. You appear to be treating the object as a " +
            "string, which might still work but is strongly discouraged."
        );

        warnedAboutToString = true;
    }

    return this.code;
};

var emptyPrintResult = new PrintResult("");

function Printer(options) {
    assert.ok(this instanceof Printer);

    var explicitTabWidth = options && options.tabWidth;
    options = normalizeOptions(options);

    function printWithComments(path) {
        assert.ok(path instanceof NodePath);
        return printComments(path.node.comments, print(path));
    }

    function print(path, includeComments) {
        if (includeComments)
            return printWithComments(path);

        assert.ok(path instanceof NodePath);

        if (!explicitTabWidth) {
            var oldTabWidth = options.tabWidth;
            var orig = path.node.original;
            var origLoc = orig && orig.loc;
            var origLines = origLoc && origLoc.lines;
            if (origLines) {
                options.tabWidth = origLines.guessTabWidth();
                try {
                    return maybeReprint(path);
                } finally {
                    options.tabWidth = oldTabWidth;
                }
            }
        }

        return maybeReprint(path);
    }

    function maybeReprint(path) {
        var reprinter = getReprinter(path);
        if (reprinter)
            return maybeAddParens(path, reprinter(printRootGenerically));
        return printRootGenerically(path);
    }

    // Print the root node generically, but then resume reprinting its
    // children non-generically.
    function printRootGenerically(path) {
        return genericPrint(path, options, printWithComments);
    }

    // Print the entire AST generically.
    function printGenerically(path) {
        return genericPrint(path, options, printGenerically);
    }

    this.print = function(ast) {
        if (!ast) {
            return emptyPrintResult;
        }

        var path = ast instanceof NodePath ? ast : new NodePath(ast);
        var lines = print(path, true);

        return new PrintResult(
            lines.toString(options),
            util.composeSourceMaps(
                options.inputSourceMap,
                lines.getSourceMap(
                    options.sourceMapName,
                    options.sourceRoot
                )
            )
        );
    };

    this.printGenerically = function(ast) {
        if (!ast) {
            return emptyPrintResult;
        }

        var path = ast instanceof NodePath ? ast : new NodePath(ast);
        var lines = printGenerically(path);

        return new PrintResult(lines.toString(options));
    };
}

exports.Printer = Printer;

function maybeAddParens(path, lines) {
    return path.needsParens() ? concat(["(", lines, ")"]) : lines;
}

function genericPrint(path, options, printPath) {
    assert.ok(path instanceof NodePath);
    return maybeAddParens(path, genericPrintNoParens(path, options, printPath));
}

function genericPrintNoParens(path, options, print) {
    var n = path.value;

    if (!n) {
        return fromString("");
    }

    if (typeof n === "string") {
        return fromString(n, options);
    }

    namedTypes.Node.assert(n);

    switch (n.type) {
    case "File":
        path = path.get("program");
        n = path.node;
        namedTypes.Program.assert(n);

        // intentionally fall through...

    case "Program":
        return maybeAddSemicolon(
            printStatementSequence(path.get("body"), print)
        );

    case "EmptyStatement":
        return fromString("");

    case "ExpressionStatement":
        return concat([print(path.get("expression")), ";"]);

    case "BinaryExpression":
    case "LogicalExpression":
    case "AssignmentExpression":
        return fromString(" ").join([
            print(path.get("left")),
            n.operator,
            print(path.get("right"))
        ]);

    case "MemberExpression":
        var parts = [print(path.get("object"))];

        if (n.computed)
            parts.push("[", print(path.get("property")), "]");
        else
            parts.push(".", print(path.get("property")));

        return concat(parts);

    case "Path":
        return fromString(".").join(n.body);

    case "Identifier":
        return fromString(n.name, options);

    case "SpreadElement":
        return concat(["...", print(path.get("argument"))]);

    case "FunctionDeclaration":
    case "FunctionExpression":
        var parts = ["function"];

        if (n.generator)
            parts.push("*");

        if (n.id)
            parts.push(" ", print(path.get("id")));

        parts.push(
            "(",
            maybeWrapParams(path.get("params"), options, print),
            ") ",
            print(path.get("body")));

        return concat(parts);

    case "ArrowFunctionExpression":
        var parts = [];

        if (n.params.length === 1) {
            parts.push(print(path.get("params", 0)));
        } else {
            parts.push(
                "(",
                maybeWrapParams(path.get("params"), options, print),
                ")"
            );
        }

        parts.push(" => ", print(path.get("body")));

        return concat(parts);

    case "MethodDefinition":
        var parts = [];

        if (!n.kind || n.kind === "init") {
            if (n.value.generator)
                parts.push("*");

        } else {
            assert.ok(
                n.kind === "get" ||
                n.kind === "set");

            parts.push(n.kind, " ");
        }

        parts.push(
            print(path.get("key")),
            "(",
            maybeWrapParams(path.get("value", "params"), options, print),
            ") ",
            print(path.get("value", "body"))
        );

        return concat(parts);

    case "YieldExpression":
        var parts = ["yield"];

        if (n.delegate)
            parts.push("*");

        if (n.argument)
            parts.push(" ", print(path.get("argument")));

        return concat(parts);

    case "ModuleDeclaration":
        var parts = ["module", print(path.get("id"))];

        if (n.source) {
            assert.ok(!n.body);
            parts.push("from", print(path.get("source")));
        } else {
            parts.push(print(path.get("body")));
        }

        return fromString(" ").join(parts);

    case "ImportSpecifier":
    case "ExportSpecifier":
        var parts = [print(path.get("id"))];

        if (n.name)
            parts.push(" as ", print(path.get("name")));

        return concat(parts);

    case "ExportBatchSpecifier":
        return fromString("*");

    case "ExportDeclaration":
        var parts = ["export"];

        if (n["default"]) {
            parts.push(" default");

        } else if (n.specifiers &&
                   n.specifiers.length > 0) {

            if (n.specifiers.length === 1 &&
                n.specifiers[0].type === "ExportBatchSpecifier") {
                parts.push(" *");
            } else {
                parts.push(
                    " { ",
                    fromString(", ").join(path.get("specifiers").map(print)),
                    " }"
                );
            }

            if (n.source)
                parts.push(" from ", print(path.get("source")));

            parts.push(";");

            return concat(parts);
        }

        parts.push(" ", print(path.get("declaration")), ";");

        return concat(parts);

    case "ImportDeclaration":
        var parts = ["import"];

        if (!(n.specifiers &&
              n.specifiers.length > 0)) {
            parts.push(" ", print(path.get("source")));

        } else if (n.kind === "default") {
            parts.push(
                " ",
                print(path.get("specifiers", 0)),
                " from ",
                print(path.get("source"))
            );

        } else if (n.kind === "named") {
            parts.push(
                " { ",
                fromString(", ").join(path.get("specifiers").map(print)),
                " } from ",
                print(path.get("source"))
            );
        }

        parts.push(";");

        return concat(parts);

    case "BlockStatement":
        var naked = printStatementSequence(path.get("body"), print);
        if (naked.isEmpty())
            return fromString("{}");

        return concat([
            "{\n",
            naked.indent(options.tabWidth),
            "\n}"
        ]);

    case "ReturnStatement":
        var parts = ["return"];

        if (n.argument)
            parts.push(" ", print(path.get("argument")));

        return concat(parts);

    case "CallExpression":
        return concat([
            print(path.get("callee")),
            "(",
            fromString(", ").join(path.get("arguments").map(print)),
            ")"
        ]);

    case "ObjectExpression":
    case "ObjectPattern":
        var allowBreak = false,
            len = n.properties.length,
            parts = [len > 0 ? "{\n" : "{"];

        path.get("properties").map(function(childPath) {
            var prop = childPath.value;
            var i = childPath.name;

            // Esprima uses these non-standard AST node types.
            if (!/^Property/.test(prop.type)) {
                if (prop.hasOwnProperty("kind")) {
                    prop.type = "Property";
                } else {
                    prop.type = namedTypes.PropertyPattern
                        ? "PropertyPattern"
                        : "Property";
                }
            }

            var lines = print(childPath).indent(options.tabWidth);

            var multiLine = lines.length > 1;
            if (multiLine && allowBreak) {
                // Similar to the logic for BlockStatement.
                parts.push("\n");
            }

            parts.push(lines);

            if (i < len - 1) {
                // Add an extra line break if the previous object property
                // had a multi-line value.
                parts.push(multiLine ? ",\n\n" : ",\n");
                allowBreak = !multiLine;
            }
        });

        parts.push(len > 0 ? "\n}" : "}");

        return concat(parts);

    case "PropertyPattern":
        return concat([
            print(path.get("key")),
            ": ",
            print(path.get("pattern"))
        ]);

    case "Property": // Non-standard AST node type.
        var key = print(path.get("key")),
            val = print(path.get("value"));

        if (!n.kind || n.kind === "init")
            return fromString(": ").join([key, val]);

        namedTypes.FunctionExpression.assert(n.value);
        assert.ok(n.value.id);
        assert.ok(n.kind === "get" ||
                  n.kind === "set");

        return concat([
            n.kind,
            " ",
            print(path.get("value", "id")),
            "(",
            maybeWrapParams(path.get("value", "params"), options, print),
            ")",
            print(path.get("value", "body"))
        ]);

    case "ArrayExpression":
    case "ArrayPattern":
        var elems = n.elements,
            len = elems.length,
            parts = ["["];

        path.get("elements").each(function(elemPath) {
            var elem = elemPath.value;
            if (!elem) {
                // If the array expression ends with a hole, that hole
                // will be ignored by the interpreter, but if it ends with
                // two (or more) holes, we need to write out two (or more)
                // commas so that the resulting code is interpreted with
                // both (all) of the holes.
                parts.push(",");
            } else {
                var i = elemPath.name;
                if (i > 0)
                    parts.push(" ");
                parts.push(print(elemPath));
                if (i < len - 1)
                    parts.push(",");
            }
        });

        parts.push("]");

        return concat(parts);

    case "SequenceExpression":
        return fromString(", ").join(path.get("expressions").map(print));

    case "ThisExpression":
        return fromString("this");

    case "Literal":
        if (typeof n.value !== "string")
            return fromString(n.value, options);

        // intentionally fall through...

    case "ModuleSpecifier":
        // A ModuleSpecifier is a string-valued Literal.
        return fromString(nodeStr(n), options);

    case "UnaryExpression":
        var parts = [n.operator];
        if (/[a-z]$/.test(n.operator))
            parts.push(" ");
        parts.push(print(path.get("argument")));
        return concat(parts);

    case "UpdateExpression":
        var parts = [
            print(path.get("argument")),
            n.operator
        ];

        if (n.prefix)
            parts.reverse();

        return concat(parts);

    case "ConditionalExpression":
        return concat([
            "(", print(path.get("test")),
            " ? ", print(path.get("consequent")),
            " : ", print(path.get("alternate")), ")"
        ]);

    case "NewExpression":
        var parts = ["new ", print(path.get("callee"))];
        var args = n.arguments;

        if (args) {
            parts.push(
                "(",
                fromString(", ").join(path.get("arguments").map(print)),
                ")"
            );
        }

        return concat(parts);

    case "VariableDeclaration":
        var parts = [n.kind, " "];
        var maxLen = 0;
        var printed = path.get("declarations").map(function(childPath) {
            var lines = print(childPath);
            maxLen = Math.max(lines.length, maxLen);
            return lines;
        });

        if (maxLen === 1) {
            parts.push(fromString(", ").join(printed));
        } else {
            parts.push(
                fromString(",\n").join(printed)
                    .indentTail("var ".length)
            );
        }

        return concat(parts);

    case "VariableDeclarator":
        return n.init ? fromString(" = ").join([
            print(path.get("id")),
            print(path.get("init"))
        ]) : print(path.get("id"));

    case "WithStatement":
        return concat([
            "with (",
            print(path.get("object")),
            ") ",
            print(path.get("body"))
        ]);

    case "IfStatement":
        var con = adjustClause(print(path.get("consequent")), options),
            parts = ["if (", print(path.get("test")), ")", con];

        if (n.alternate)
            parts.push(
                endsWithBrace(con) ? " else" : "\nelse",
                adjustClause(print(path.get("alternate")), options));

        return concat(parts);

    case "ForStatement":
        // TODO Get the for (;;) case right.
        var init = print(path.get("init")),
            sep = init.length > 1 ? ";\n" : "; ",
            forParen = "for (",
            indented = fromString(sep).join([
                init,
                print(path.get("test")),
                print(path.get("update"))
            ]).indentTail(forParen.length),
            head = concat([forParen, indented, ")"]),
            clause = adjustClause(print(path.get("body")), options),
            parts = [head];

        if (head.length > 1) {
            parts.push("\n");
            clause = clause.trimLeft();
        }

        parts.push(clause);

        return concat(parts);

    case "WhileStatement":
        return concat([
            "while (",
            print(path.get("test")),
            ")",
            adjustClause(print(path.get("body")), options)
        ]);

    case "ForInStatement":
        // Note: esprima can't actually parse "for each (".
        return concat([
            n.each ? "for each (" : "for (",
            print(path.get("left")),
            " in ",
            print(path.get("right")),
            ")",
            adjustClause(print(path.get("body")), options)
        ]);

    case "ForOfStatement":
        return concat([
            "for (",
            print(path.get("left")),
            " of ",
            print(path.get("right")),
            ")",
            adjustClause(print(path.get("body")), options)
        ]);

    case "DoWhileStatement":
        var doBody = concat([
            "do",
            adjustClause(print(path.get("body")), options)
        ]), parts = [doBody];

        if (endsWithBrace(doBody))
            parts.push(" while");
        else
            parts.push("\nwhile");

        parts.push(" (", print(path.get("test")), ");");

        return concat(parts);

    case "BreakStatement":
        var parts = ["break"];
        if (n.label)
            parts.push(" ", print(path.get("label")));
        return concat(parts);

    case "ContinueStatement":
        var parts = ["continue"];
        if (n.label)
            parts.push(" ", print(path.get("label")));
        return concat(parts);

    case "LabeledStatement":
        return concat([
            print(path.get("label")),
            ":\n",
            print(path.get("body"))
        ]);

    case "TryStatement":
        var parts = [
            "try ",
            print(path.get("block"))
        ];

        n.handlers.forEach(function(handler) {
            parts.push(" ", print(handler));
        });

        if (n.finalizer)
            parts.push(" finally ", print(path.get("finalizer")));

        return concat(parts);

    case "CatchClause":
        var parts = ["catch (", print(path.get("param"))];

        if (n.guard)
            // Note: esprima does not recognize conditional catch clauses.
            parts.push(" if ", print(path.get("guard")));

        parts.push(") ", print(path.get("body")));

        return concat(parts);

    case "ThrowStatement":
        return concat([
            "throw ",
            print(path.get("argument"))
        ]);

    case "SwitchStatement":
        return concat([
            "switch (",
            print(path.get("discriminant")),
            ") {\n",
            fromString("\n").join(path.get("cases").map(print)),
            "\n}"
        ]);

        // Note: ignoring n.lexical because it has no printing consequences.

    case "SwitchCase":
        var parts = [];

        if (n.test)
            parts.push("case ", print(path.get("test")), ":");
        else
            parts.push("default:");

        if (n.consequent.length > 0) {
            parts.push("\n", printStatementSequence(
                path.get("consequent"),
                print
            ).indent(options.tabWidth));
        }

        return concat(parts);

    case "DebuggerStatement":
        return fromString("debugger");

    // XJS extensions below.

    case "XJSAttribute":
        var parts = [print(path.get("name"))];
        if (n.value)
            parts.push("=", print(path.get("value")));
        return concat(parts);

    case "XJSIdentifier":
        var str = n.name;
        if (typeof n.namespace === "string")
            str = n.namespace + ":" + str;
        return fromString(str, options);

    case "XJSExpressionContainer":
        return concat(["{", print(path.get("expression")), "}"]);

    case "XJSElement":
        var parts = [print(path.get("openingElement"))];

        if (!n.selfClosing) {
            parts.push(
                concat(path.get("children").map(function(childPath) {
                    var child = childPath.value;
                    if (namedTypes.Literal.check(child))
                        child.type = "XJSText";
                    return print(childPath);
                })),
                print(path.get("closingElement"))
            );
        }

        return concat(parts);

    case "XJSOpeningElement":
        var parts = ["<", print(path.get("name"))];

        n.attributes.forEach(function(attr) {
            parts.push(" ", print(attr));
        });

        parts.push(n.selfClosing ? " />" : ">");

        return concat(parts);

    case "XJSClosingElement":
        return concat(["</", print(path.get("name")), ">"]);

    case "XJSText":
        return fromString(n.value, options);

    case "XJSEmptyExpression":
        return fromString("");

    case "TypeAnnotatedIdentifier":
        var parts = [
            print(path.get("annotation")),
            " ",
            print(path.get("identifier"))
        ];

        return concat(parts);

    case "ClassBody":
        return concat([
            "{\n",
            printStatementSequence(path.get("body"), print, true)
                .indent(options.tabWidth),
            "\n}"
        ]);

    case "ClassPropertyDefinition":
        var parts = ["static ", print(path.get("definition"))];
        if (!namedTypes.MethodDefinition.check(n.definition))
            parts.push(";");
        return concat(parts);

    case "ClassDeclaration":
    case "ClassExpression":
        var parts = ["class"];

        if (n.id)
            parts.push(" ", print(path.get("id")));

        if (n.superClass)
            parts.push(" extends ", print(path.get("superClass")));

        parts.push(" ", print(path.get("body")));

        return concat(parts);

    // Unhandled types below. If encountered, nodes of these types should
    // be either left alone or desugared into AST types that are fully
    // supported by the pretty-printer.

    case "ClassHeritage": // TODO
    case "ComprehensionBlock": // TODO
    case "ComprehensionExpression": // TODO
    case "Glob": // TODO
    case "TaggedTemplateExpression": // TODO
    case "TemplateElement": // TODO
    case "TemplateLiteral": // TODO
    case "GeneratorExpression": // TODO
    case "LetStatement": // TODO
    case "LetExpression": // TODO
    case "GraphExpression": // TODO
    case "GraphIndexExpression": // TODO
    case "TypeAnnotation": // TODO
    default:
        debugger;
        throw new Error("unknown type: " + JSON.stringify(n.type));
    }

    return p;
}

function printStatementSequence(path, print, inClassBody) {
    var filtered = path.filter(function(stmtPath) {
        var stmt = stmtPath.value;

        // Just in case the AST has been modified to contain falsy
        // "statements," it's safer simply to skip them.
        if (!stmt)
            return false;

        // Skip printing EmptyStatement nodes to avoid leaving stray
        // semicolons lying around.
        if (stmt.type === "EmptyStatement")
            return false;

        namedTypes.Statement.assert(stmt);

        return true;
    });

    var allowBreak = false,
        len = filtered.length,
        parts = [];

    filtered.map(function(stmtPath) {
        var lines = print(stmtPath);
        var stmt = stmtPath.value;

        if (inClassBody) {
            if (namedTypes.MethodDefinition.check(stmt))
                return lines;

            if (namedTypes.ClassPropertyDefinition.check(stmt) &&
                namedTypes.MethodDefinition.check(stmt.definition))
                return lines;
        }

        // Try to add a semicolon to anything that isn't a method in a
        // class body.
        return maybeAddSemicolon(lines);

    }).forEach(function(lines, i) {
        var multiLine = lines.length > 1;
        if (multiLine && allowBreak) {
            // Insert an additional line break before multi-line
            // statements, if we did not insert an extra line break
            // after the previous statement.
            parts.push("\n");
        }

        if (!inClassBody)
            lines = maybeAddSemicolon(lines);

        parts.push(lines);

        if (i < len - 1) {
            // Add an extra line break if the previous statement
            // spanned multiple lines.
            parts.push(multiLine ? "\n\n" : "\n");

            // Avoid adding another line break if we just added an
            // extra one.
            allowBreak = !multiLine;
        }
    });

    return concat(parts);
}

function maybeWrapParams(path, options, print) {
    var printed = path.map(print);
    var joined = fromString(", ").join(printed);
    if (joined.length > 1 ||
        joined.getLineLength(1) > options.wrapColumn) {
        joined = fromString(",\n").join(printed);
        return concat(["\n", joined.indent(options.tabWidth)]);
    }
    return joined;
}

function adjustClause(clause, options) {
    if (clause.length > 1)
        return concat([" ", clause]);

    return concat([
        "\n",
        maybeAddSemicolon(clause).indent(options.tabWidth)
    ]);
}

function lastNonSpaceCharacter(lines) {
    var pos = lines.lastPos();
    do {
        var ch = lines.charAt(pos);
        if (/\S/.test(ch))
            return ch;
    } while (lines.prevPos(pos));
}

function endsWithBrace(lines) {
    return lastNonSpaceCharacter(lines) === "}";
}

function nodeStrEscape(str) {
    return str.replace(/\\/g, "\\\\")
              .replace(/"/g, "\\\"")
              // The previous line messes up my syntax highlighting
              // unless this comment includes a " character.
              .replace(/\n/g, "\\n")
              .replace(/\r/g, "\\r")
              .replace(/</g, "\\u003C")
              .replace(/>/g, "\\u003E");
}

function nodeStr(n) {
    if (/[\u0000-\u001F\u0080-\uFFFF]/.test(n.value)) {
        // use the convoluted algorithm to avoid broken low/high characters
        var str = "";
        for (var i = 0; i < n.value.length; i++) {
            var c = n.value[i];
            if (c <= "\x1F" || c >= "\x80") {
                var cc = c.charCodeAt(0).toString(16);
                while (cc.length < 4) cc = "0" + cc;
                str += "\\u" + cc;
            } else {
                str += nodeStrEscape(c);
            }
        }
        return '"' + str + '"';
    }

    return '"' + nodeStrEscape(n.value) + '"';
}

function maybeAddSemicolon(lines) {
    var eoc = lastNonSpaceCharacter(lines);
    if (eoc && "\n};".indexOf(eoc) < 0)
        return concat([lines, ";"]);
    return lines;
}

},{"./comments":23,"./lines":24,"./options":26,"./patcher":28,"./types":30,"./util":31,"assert":71,"source-map":37}],30:[function(require,module,exports){
var types = require("ast-types");
var def = types.Type.def;

def("File")
    .bases("Node")
    .build("program")
    .field("program", def("Program"));

types.finalize();

module.exports = types;

},{"ast-types":15}],31:[function(require,module,exports){
var assert = require("assert");
var getFieldValue = require("./types").getFieldValue;
var sourceMap = require("source-map");
var SourceMapConsumer = sourceMap.SourceMapConsumer;
var SourceMapGenerator = sourceMap.SourceMapGenerator;
var hasOwn = Object.prototype.hasOwnProperty;

function getUnionOfKeys(obj) {
    for (var i = 0, key,
             result = {},
             objs = arguments,
             argc = objs.length;
         i < argc;
         i += 1)
    {
        obj = objs[i];
        for (key in obj)
            if (hasOwn.call(obj, key))
                result[key] = true;
    }
    return result;
}
exports.getUnionOfKeys = getUnionOfKeys;

exports.assertEquivalent = function(a, b) {
    if (!deepEquivalent(a, b)) {
        throw new Error(
            JSON.stringify(a) + " not equivalent to " +
            JSON.stringify(b)
        );
    }
};

function deepEquivalent(a, b) {
    if (a === b)
        return true;

    if (a instanceof Array)
        return deepArrEquiv(a, b);

    if (typeof a === "object")
        return deepObjEquiv(a, b);

    return false;
}
exports.deepEquivalent = deepEquivalent;

function deepArrEquiv(a, b) {
    assert.ok(a instanceof Array);
    var len = a.length;

    if (!(b instanceof Array &&
          b.length === len))
        return false;

    for (var i = 0; i < len; ++i) {
        if (i in a !== i in b)
            return false;

        if (!deepEquivalent(a[i], b[i]))
            return false;
    }

    return true;
}

function deepObjEquiv(a, b) {
    assert.strictEqual(typeof a, "object");
    if (!a || !b || typeof b !== "object")
        return false;

    for (var key in getUnionOfKeys(a, b)) {
        if (key === "loc" ||
            key === "range" ||
            key === "comments" ||
            key === "raw")
            continue;

        if (!deepEquivalent(getFieldValue(a, key),
                            getFieldValue(b, key)))
        {
            return false;
        }
    }

    return true;
}

function comparePos(pos1, pos2) {
    return (pos1.line - pos2.line) || (pos1.column - pos2.column);
}
exports.comparePos = comparePos;

exports.composeSourceMaps = function(formerMap, latterMap) {
    if (formerMap) {
        if (!latterMap) {
            return formerMap;
        }
    } else {
        return latterMap || null;
    }

    var smcFormer = new SourceMapConsumer(formerMap);
    var smcLatter = new SourceMapConsumer(latterMap);
    var smg = new SourceMapGenerator({
        file: latterMap.file,
        sourceRoot: latterMap.sourceRoot
    });

    var sourcesToContents = {};

    smcLatter.eachMapping(function(mapping) {
        var origPos = smcFormer.originalPositionFor({
            line: mapping.originalLine,
            column: mapping.originalColumn
        });

        var sourceName = origPos.source;

        smg.addMapping({
            source: sourceName,
            original: {
                line: origPos.line,
                column: origPos.column
            },
            generated: {
                line: mapping.generatedLine,
                column: mapping.generatedColumn
            },
            name: mapping.name
        });

        var sourceContent = smcFormer.sourceContentFor(sourceName);
        if (sourceContent && !hasOwn.call(sourcesToContents, sourceName)) {
            sourcesToContents[sourceName] = sourceContent;
            smg.setSourceContent(sourceName, sourceContent);
        }
    });

    return smg.toJSON();
};

},{"./types":30,"assert":71,"source-map":37}],32:[function(require,module,exports){
var assert = require("assert");
var Class = require("cls");
var Node = require("./types").namedTypes.Node;
var slice = Array.prototype.slice;
var removeRequests = [];

var Visitor = exports.Visitor = Class.extend({
    visit: function(node) {
        var self = this;

        if (!node) {
            // pass

        } else if (node instanceof Array) {
            node = self.visitArray(node);

        } else if (Node.check(node)) {
            var methodName = "visit" + node.type,
                method = self[methodName] || self.genericVisit;
            node = method.call(this, node);

        } else if (typeof node === "object") {
            // Some AST node types contain ad-hoc (non-AST) objects that
            // may contain nested AST nodes.
            self.genericVisit(node);
        }

        return node;
    },

    visitArray: function(arr, noUpdate) {
        for (var elem, result, undef,
                 i = 0, len = arr.length;
             i < len;
             i += 1)
        {
            if (i in arr)
                elem = arr[i];
            else
                continue;

            var requesters = [];
            removeRequests.push(requesters);

            // Make sure we don't accidentally reuse a previous result
            // when this.visit throws an exception.
            result = undef;

            try {
                result = this.visit(elem);

            } finally {
                assert.strictEqual(
                    removeRequests.pop(),
                    requesters);
            }

            if (requesters.length > 0 || result === null) {
                // This hole will be elided by the compaction loop below.
                delete arr[i];
            } else if (result !== undef) {
                arr[i] = result;
            }
        }

        // Compact the array to eliminate holes.
        for (var dst = 0,
                 src = dst,
                 // The length of the array might have changed during the
                 // iteration performed above.
                 len = arr.length;
             src < len;
             src += 1)
            if (src in arr)
                arr[dst++] = arr[src];
        arr.length = dst;

        return arr;
    },

    remove: function() {
        var len = removeRequests.length,
            requesters = removeRequests[len - 1];
        if (requesters)
            requesters.push(this);
    },

    genericVisit: function(node) {
        var field,
            oldValue,
            newValue;

        for (field in node) {
            if (!node.hasOwnProperty(field))
                continue;

            oldValue = node[field];

            if (oldValue instanceof Array) {
                this.visitArray(oldValue);

            } else if (Node.check(oldValue)) {
                newValue = this.visit(oldValue);

                if (typeof newValue === "undefined") {
                    // Keep oldValue.
                } else {
                    node[field] = newValue;
                }

            } else if (typeof oldValue === "object") {
                this.genericVisit(oldValue);
            }
        }

        return node;
    }
});

},{"./types":30,"assert":71,"cls":34}],33:[function(require,module,exports){
var process=require("__browserify_process");var types = require("./lib/types");
var parse = require("./lib/parser").parse;
var Printer = require("./lib/printer").Printer;

function print(node, options) {
    return new Printer(options).print(node);
}

function prettyPrint(node, options) {
    return new Printer(options).printGenerically(node);
}

function run(transformer, options) {
    return runFile(process.argv[2], transformer, options);
}

function runFile(path, transformer, options) {
    require("fs").readFile(path, "utf-8", function(err, code) {
        if (err) {
            console.error(err);
            return;
        }

        runString(code, transformer, options);
    });
}

function defaultWriteback(output) {
    process.stdout.write(output);
}

function runString(code, transformer, options) {
    var writeback = options && options.writeback || defaultWriteback;
    transformer(parse(code, options), function(node) {
        writeback(print(node, options).code);
    });
}

Object.defineProperties(exports, {
    /**
     * Parse a string of code into an augmented syntax tree suitable for
     * arbitrary modification and reprinting.
     */
    parse: {
        enumerable: true,
        value: parse
    },

    /**
     * Reprint a modified syntax tree using as much of the original source
     * code as possible.
     */
    print: {
        enumerable: true,
        value: print
    },

    /**
     * Print without attempting to reuse any original source code.
     */
    prettyPrint: {
        enumerable: true,
        value: prettyPrint
    },

    /**
     * Customized version of require("ast-types").
     */
    types: {
        enumerable: true,
        value: types
    },

    /**
     * Convenient command-line interface (see e.g. example/add-braces).
     */
    run: {
        enumerable: true,
        value: run
    },

    /**
     * Useful utilities for implementing transformer functions.
     */
    Syntax: {
        enumerable: false,
        value: (function() {
            var def = types.Type.def;
            var Syntax = {};

            Object.keys(types.namedTypes).forEach(function(name) {
                if (def(name).buildable)
                    Syntax[name] = name;
            });

            // These two types are buildable but do not technically count
            // as syntax because they are not printable.
            delete Syntax.SourceLocation;
            delete Syntax.Position;

            return Syntax;
        })()
    },

    Visitor: {
        enumerable: false,
        value: require("./lib/visitor").Visitor
    }
});

},{"./lib/parser":27,"./lib/printer":29,"./lib/types":30,"./lib/visitor":32,"__browserify_process":74,"fs":70}],34:[function(require,module,exports){
// Sentinel value passed to base constructors to skip invoking this.init.
var populating = {};

function makeClass(base, newProps) {
    var baseProto = base.prototype;
    var ownProto = Object.create(baseProto);
    var newStatics = newProps.statics;
    var populated;

    function constructor() {
        if (!populated) {
            if (base.extend === extend) {
                // Ensure population of baseProto if base created by makeClass.
                base.call(populating);
            }

            // Wrap override methods to make this._super available.
            populate(ownProto, newProps, baseProto);

            // Help the garbage collector reclaim this object, since we
            // don't need it anymore.
            newProps = null;

            populated = true;
        }

        // When we invoke a constructor just for the sake of making sure
        // its prototype has been populated, the receiver object (this)
        // will be strictly equal to the populating object, which means we
        // want to avoid invoking this.init.
        if (this === populating)
            return;

        // Evaluate this.init only once to avoid looking up .init in the
        // prototype chain twice.
        var init = this.init;
        if (init)
            init.apply(this, arguments);
    }

    // Copy any static properties that have been assigned to the base
    // class over to the subclass.
    populate(constructor, base);

    if (newStatics) {
        // Remove the statics property from newProps so that it does not
        // get copied to the prototype.
        delete newProps.statics;

        // We re-use populate for static properties, so static methods
        // have the same access to this._super that normal methods have.
        populate(constructor, newStatics, base);

        // Help the GC reclaim this object.
        newStatics = null;
    }

    // These property assignments overwrite any properties of the same
    // name that may have been copied from base, above. Note that ownProto
    // has not been populated with any methods or properties, yet, because
    // we postpone that work until the subclass is instantiated for the
    // first time. Also note that we share a single implementation of
    // extend between all classes.
    constructor.prototype = ownProto;
    constructor.extend = extend;
    constructor.base = baseProto;

    // Setting constructor.prototype.constructor = constructor is
    // important so that instanceof works properly in all browsers.
    ownProto.constructor = constructor;

    // Setting .cls as a shorthand for .constructor is purely a
    // convenience to make calling static methods easier.
    ownProto.cls = constructor;

    // If there is a static initializer, call it now. This needs to happen
    // last so that the constructor is ready to be used if, for example,
    // constructor.init needs to create an instance of the new class.
    if (constructor.init)
        constructor.init(constructor);

    return constructor;
}

function populate(target, source, parent) {
    for (var name in source)
        if (source.hasOwnProperty(name))
            target[name] = parent ? maybeWrap(name, source, parent) : source[name];
}

var hasOwnExp = /\bhasOwnProperty\b/;
var superExp = hasOwnExp.test(populate) ? /\b_super\b/ : /.*/;

function maybeWrap(name, child, parent) {
    var cval = child && child[name];
    var pval = parent && parent[name];

    if (typeof cval === "function" &&
        typeof pval === "function" &&
        cval !== pval && // Avoid infinite recursion.
        cval.extend !== extend && // Don't wrap classes.
        superExp.test(cval)) // Only wrap if this._super needed.
    {
        return function() {
            var saved = this._super;
            this._super = parent[name];
            try { return cval.apply(this, arguments) }
            finally { this._super = saved };
        };
    }

    return cval;
}

function extend(newProps) {
    return makeClass(this, newProps || {});
}

module.exports = extend.call(function(){});

},{}],35:[function(require,module,exports){
/*
  Copyright (C) 2012 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2012 Mathias Bynens <mathias@qiwi.be>
  Copyright (C) 2012 Joost-Wim Boekesteijn <joost-wim@boekesteijn.nl>
  Copyright (C) 2012 Kris Kowal <kris.kowal@cixar.com>
  Copyright (C) 2012 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012 Arpad Borsos <arpad.borsos@googlemail.com>
  Copyright (C) 2011 Ariya Hidayat <ariya.hidayat@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/*jslint bitwise:true plusplus:true */
/*global esprima:true, define:true, exports:true, window: true,
throwError: true, createLiteral: true, generateStatement: true,
parseAssignmentExpression: true, parseBlock: true, parseExpression: true,
parseFunctionDeclaration: true, parseFunctionExpression: true,
parseFunctionSourceElements: true, parseVariableIdentifier: true,
parseLeftHandSideExpression: true,
parseStatement: true, parseSourceElement: true */

(function (root, factory) {
    'use strict';

    // Universal Module Definition (UMD) to support AMD, CommonJS/Node.js,
    // Rhino, and plain browser loading.
    if (typeof define === 'function' && define.amd) {
        define(['exports'], factory);
    } else if (typeof exports !== 'undefined') {
        factory(exports);
    } else {
        factory((root.esprima = {}));
    }
}(this, function (exports) {
    'use strict';

    var Token,
        TokenName,
        Syntax,
        PropertyKind,
        Messages,
        Regex,
        source,
        strict,
        index,
        lineNumber,
        lineStart,
        length,
        buffer,
        state,
        extra;

    Token = {
        BooleanLiteral: 1,
        EOF: 2,
        Identifier: 3,
        Keyword: 4,
        NullLiteral: 5,
        NumericLiteral: 6,
        Punctuator: 7,
        StringLiteral: 8
    };

    TokenName = {};
    TokenName[Token.BooleanLiteral] = 'Boolean';
    TokenName[Token.EOF] = '<end>';
    TokenName[Token.Identifier] = 'Identifier';
    TokenName[Token.Keyword] = 'Keyword';
    TokenName[Token.NullLiteral] = 'Null';
    TokenName[Token.NumericLiteral] = 'Numeric';
    TokenName[Token.Punctuator] = 'Punctuator';
    TokenName[Token.StringLiteral] = 'String';

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        ArrayExpression: 'ArrayExpression',
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DoWhileStatement: 'DoWhileStatement',
        DebuggerStatement: 'DebuggerStatement',
        EmptyStatement: 'EmptyStatement',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement'
    };

    PropertyKind = {
        Data: 1,
        Get: 2,
        Set: 4
    };

    // Error messages should be identical to V8.
    Messages = {
        UnexpectedToken:  'Unexpected token %0',
        UnexpectedNumber:  'Unexpected number',
        UnexpectedString:  'Unexpected string',
        UnexpectedIdentifier:  'Unexpected identifier',
        UnexpectedReserved:  'Unexpected reserved word',
        UnexpectedEOS:  'Unexpected end of input',
        NewlineAfterThrow:  'Illegal newline after throw',
        InvalidRegExp: 'Invalid regular expression',
        UnterminatedRegExp:  'Invalid regular expression: missing /',
        InvalidLHSInAssignment:  'Invalid left-hand side in assignment',
        InvalidLHSInForIn:  'Invalid left-hand side in for-in',
        MultipleDefaultsInSwitch: 'More than one default clause in switch statement',
        NoCatchOrFinally:  'Missing catch or finally after try',
        UnknownLabel: 'Undefined label \'%0\'',
        Redeclaration: '%0 \'%1\' has already been declared',
        IllegalContinue: 'Illegal continue statement',
        IllegalBreak: 'Illegal break statement',
        IllegalReturn: 'Illegal return statement',
        StrictModeWith:  'Strict mode code may not include a with statement',
        StrictCatchVariable:  'Catch variable may not be eval or arguments in strict mode',
        StrictVarName:  'Variable name may not be eval or arguments in strict mode',
        StrictParamName:  'Parameter name eval or arguments is not allowed in strict mode',
        StrictParamDupe: 'Strict mode function may not have duplicate parameter names',
        StrictFunctionName:  'Function name may not be eval or arguments in strict mode',
        StrictOctalLiteral:  'Octal literals are not allowed in strict mode.',
        StrictDelete:  'Delete of an unqualified identifier in strict mode.',
        StrictDuplicateProperty:  'Duplicate data property in object literal not allowed in strict mode',
        AccessorDataProperty:  'Object literal may not have data and accessor property with the same name',
        AccessorGetSet:  'Object literal may not have multiple get/set accessors with the same name',
        StrictLHSAssignment:  'Assignment to eval or arguments is not allowed in strict mode',
        StrictLHSPostfix:  'Postfix increment/decrement may not have eval or arguments operand in strict mode',
        StrictLHSPrefix:  'Prefix increment/decrement may not have eval or arguments operand in strict mode',
        StrictReservedWord:  'Use of future reserved word in strict mode'
    };

    // See also tools/generate-unicode-regex.py.
    Regex = {
        NonAsciiIdentifierStart: new RegExp('[\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05d0-\u05ea\u05f0-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u08a0\u08a2-\u08ac\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097f\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c33\u0c35-\u0c39\u0c3d\u0c58\u0c59\u0c60\u0c61\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d60\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f4\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f0\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1877\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191c\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19c1-\u19c7\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4b\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1ce9-\u1cec\u1cee-\u1cf1\u1cf5\u1cf6\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2e2f\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fcc\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua697\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua78e\ua790-\ua793\ua7a0-\ua7aa\ua7f8-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa80-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uabc0-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc]'),
        NonAsciiIdentifierPart: new RegExp('[\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0300-\u0374\u0376\u0377\u037a-\u037d\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u0483-\u0487\u048a-\u0527\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u05d0-\u05ea\u05f0-\u05f2\u0610-\u061a\u0620-\u0669\u066e-\u06d3\u06d5-\u06dc\u06df-\u06e8\u06ea-\u06fc\u06ff\u0710-\u074a\u074d-\u07b1\u07c0-\u07f5\u07fa\u0800-\u082d\u0840-\u085b\u08a0\u08a2-\u08ac\u08e4-\u08fe\u0900-\u0963\u0966-\u096f\u0971-\u0977\u0979-\u097f\u0981-\u0983\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bc-\u09c4\u09c7\u09c8\u09cb-\u09ce\u09d7\u09dc\u09dd\u09df-\u09e3\u09e6-\u09f1\u0a01-\u0a03\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a59-\u0a5c\u0a5e\u0a66-\u0a75\u0a81-\u0a83\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abc-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ad0\u0ae0-\u0ae3\u0ae6-\u0aef\u0b01-\u0b03\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3c-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b56\u0b57\u0b5c\u0b5d\u0b5f-\u0b63\u0b66-\u0b6f\u0b71\u0b82\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd0\u0bd7\u0be6-\u0bef\u0c01-\u0c03\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c33\u0c35-\u0c39\u0c3d-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c58\u0c59\u0c60-\u0c63\u0c66-\u0c6f\u0c82\u0c83\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbc-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0cde\u0ce0-\u0ce3\u0ce6-\u0cef\u0cf1\u0cf2\u0d02\u0d03\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d-\u0d44\u0d46-\u0d48\u0d4a-\u0d4e\u0d57\u0d60-\u0d63\u0d66-\u0d6f\u0d7a-\u0d7f\u0d82\u0d83\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0df2\u0df3\u0e01-\u0e3a\u0e40-\u0e4e\u0e50-\u0e59\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb9\u0ebb-\u0ebd\u0ec0-\u0ec4\u0ec6\u0ec8-\u0ecd\u0ed0-\u0ed9\u0edc-\u0edf\u0f00\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f3e-\u0f47\u0f49-\u0f6c\u0f71-\u0f84\u0f86-\u0f97\u0f99-\u0fbc\u0fc6\u1000-\u1049\u1050-\u109d\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u135d-\u135f\u1380-\u138f\u13a0-\u13f4\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f0\u1700-\u170c\u170e-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176c\u176e-\u1770\u1772\u1773\u1780-\u17d3\u17d7\u17dc\u17dd\u17e0-\u17e9\u180b-\u180d\u1810-\u1819\u1820-\u1877\u1880-\u18aa\u18b0-\u18f5\u1900-\u191c\u1920-\u192b\u1930-\u193b\u1946-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u19d0-\u19d9\u1a00-\u1a1b\u1a20-\u1a5e\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1aa7\u1b00-\u1b4b\u1b50-\u1b59\u1b6b-\u1b73\u1b80-\u1bf3\u1c00-\u1c37\u1c40-\u1c49\u1c4d-\u1c7d\u1cd0-\u1cd2\u1cd4-\u1cf6\u1d00-\u1de6\u1dfc-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u200c\u200d\u203f\u2040\u2054\u2071\u207f\u2090-\u209c\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d7f-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2de0-\u2dff\u2e2f\u3005-\u3007\u3021-\u302f\u3031-\u3035\u3038-\u303c\u3041-\u3096\u3099\u309a\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fcc\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua62b\ua640-\ua66f\ua674-\ua67d\ua67f-\ua697\ua69f-\ua6f1\ua717-\ua71f\ua722-\ua788\ua78b-\ua78e\ua790-\ua793\ua7a0-\ua7aa\ua7f8-\ua827\ua840-\ua873\ua880-\ua8c4\ua8d0-\ua8d9\ua8e0-\ua8f7\ua8fb\ua900-\ua92d\ua930-\ua953\ua960-\ua97c\ua980-\ua9c0\ua9cf-\ua9d9\uaa00-\uaa36\uaa40-\uaa4d\uaa50-\uaa59\uaa60-\uaa76\uaa7a\uaa7b\uaa80-\uaac2\uaadb-\uaadd\uaae0-\uaaef\uaaf2-\uaaf6\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uabc0-\uabea\uabec\uabed\uabf0-\uabf9\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe00-\ufe0f\ufe20-\ufe26\ufe33\ufe34\ufe4d-\ufe4f\ufe70-\ufe74\ufe76-\ufefc\uff10-\uff19\uff21-\uff3a\uff3f\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc]')
    };

    // Ensure the condition is true, otherwise throw an error.
    // This is only to have a better contract semantic, i.e. another safety net
    // to catch a logic error. The condition shall be fulfilled in normal case.
    // Do NOT use this to enforce a certain condition on any user input.

    function assert(condition, message) {
        if (!condition) {
            throw new Error('ASSERT: ' + message);
        }
    }

    function sliceSource(from, to) {
        return source.slice(from, to);
    }

    if (typeof 'esprima'[0] === 'undefined') {
        sliceSource = function sliceArraySource(from, to) {
            return source.slice(from, to).join('');
        };
    }

    function isDecimalDigit(ch) {
        return '0123456789'.indexOf(ch) >= 0;
    }

    function isHexDigit(ch) {
        return '0123456789abcdefABCDEF'.indexOf(ch) >= 0;
    }

    function isOctalDigit(ch) {
        return '01234567'.indexOf(ch) >= 0;
    }


    // 7.2 White Space

    function isWhiteSpace(ch) {
        return (ch === ' ') || (ch === '\u0009') || (ch === '\u000B') ||
            (ch === '\u000C') || (ch === '\u00A0') ||
            (ch.charCodeAt(0) >= 0x1680 &&
             '\u1680\u180E\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\uFEFF'.indexOf(ch) >= 0);
    }

    // 7.3 Line Terminators

    function isLineTerminator(ch) {
        return (ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029');
    }

    // 7.6 Identifier Names and Identifiers

    function isIdentifierStart(ch) {
        return (ch === '$') || (ch === '_') || (ch === '\\') ||
            (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
            ((ch.charCodeAt(0) >= 0x80) && Regex.NonAsciiIdentifierStart.test(ch));
    }

    function isIdentifierPart(ch) {
        return (ch === '$') || (ch === '_') || (ch === '\\') ||
            (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
            ((ch >= '0') && (ch <= '9')) ||
            ((ch.charCodeAt(0) >= 0x80) && Regex.NonAsciiIdentifierPart.test(ch));
    }

    // 7.6.1.2 Future Reserved Words

    function isFutureReservedWord(id) {
        switch (id) {

        // Future reserved words.
        case 'class':
        case 'enum':
        case 'export':
        case 'extends':
        case 'import':
        case 'super':
            return true;
        }

        return false;
    }

    function isStrictModeReservedWord(id) {
        switch (id) {

        // Strict Mode reserved words.
        case 'implements':
        case 'interface':
        case 'package':
        case 'private':
        case 'protected':
        case 'public':
        case 'static':
        case 'yield':
        case 'let':
            return true;
        }

        return false;
    }

    function isRestrictedWord(id) {
        return id === 'eval' || id === 'arguments';
    }

    // 7.6.1.1 Keywords

    function isKeyword(id) {
        var keyword = false;
        switch (id.length) {
        case 2:
            keyword = (id === 'if') || (id === 'in') || (id === 'do');
            break;
        case 3:
            keyword = (id === 'var') || (id === 'for') || (id === 'new') || (id === 'try');
            break;
        case 4:
            keyword = (id === 'this') || (id === 'else') || (id === 'case') || (id === 'void') || (id === 'with');
            break;
        case 5:
            keyword = (id === 'while') || (id === 'break') || (id === 'catch') || (id === 'throw');
            break;
        case 6:
            keyword = (id === 'return') || (id === 'typeof') || (id === 'delete') || (id === 'switch');
            break;
        case 7:
            keyword = (id === 'default') || (id === 'finally');
            break;
        case 8:
            keyword = (id === 'function') || (id === 'continue') || (id === 'debugger');
            break;
        case 10:
            keyword = (id === 'instanceof');
            break;
        }

        if (keyword) {
            return true;
        }

        switch (id) {
        // Future reserved words.
        // 'const' is specialized as Keyword in V8.
        case 'const':
            return true;

        // For compatiblity to SpiderMonkey and ES.next
        case 'yield':
        case 'let':
            return true;
        }

        if (strict && isStrictModeReservedWord(id)) {
            return true;
        }

        return isFutureReservedWord(id);
    }

    // 7.4 Comments

    function skipComment() {
        var ch, blockComment, lineComment;

        blockComment = false;
        lineComment = false;

        while (index < length) {
            ch = source[index];

            if (lineComment) {
                ch = source[index++];
                if (isLineTerminator(ch)) {
                    lineComment = false;
                    if (ch === '\r' && source[index] === '\n') {
                        ++index;
                    }
                    ++lineNumber;
                    lineStart = index;
                }
            } else if (blockComment) {
                if (isLineTerminator(ch)) {
                    if (ch === '\r' && source[index + 1] === '\n') {
                        ++index;
                    }
                    ++lineNumber;
                    ++index;
                    lineStart = index;
                    if (index >= length) {
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }
                } else {
                    ch = source[index++];
                    if (index >= length) {
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }
                    if (ch === '*') {
                        ch = source[index];
                        if (ch === '/') {
                            ++index;
                            blockComment = false;
                        }
                    }
                }
            } else if (ch === '/') {
                ch = source[index + 1];
                if (ch === '/') {
                    index += 2;
                    lineComment = true;
                } else if (ch === '*') {
                    index += 2;
                    blockComment = true;
                    if (index >= length) {
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }
                } else {
                    break;
                }
            } else if (isWhiteSpace(ch)) {
                ++index;
            } else if (isLineTerminator(ch)) {
                ++index;
                if (ch ===  '\r' && source[index] === '\n') {
                    ++index;
                }
                ++lineNumber;
                lineStart = index;
            } else {
                break;
            }
        }
    }

    function scanHexEscape(prefix) {
        var i, len, ch, code = 0;

        len = (prefix === 'u') ? 4 : 2;
        for (i = 0; i < len; ++i) {
            if (index < length && isHexDigit(source[index])) {
                ch = source[index++];
                code = code * 16 + '0123456789abcdef'.indexOf(ch.toLowerCase());
            } else {
                return '';
            }
        }
        return String.fromCharCode(code);
    }

    function scanIdentifier() {
        var ch, start, id, restore;

        ch = source[index];
        if (!isIdentifierStart(ch)) {
            return;
        }

        start = index;
        if (ch === '\\') {
            ++index;
            if (source[index] !== 'u') {
                return;
            }
            ++index;
            restore = index;
            ch = scanHexEscape('u');
            if (ch) {
                if (ch === '\\' || !isIdentifierStart(ch)) {
                    return;
                }
                id = ch;
            } else {
                index = restore;
                id = 'u';
            }
        } else {
            id = source[index++];
        }

        while (index < length) {
            ch = source[index];
            if (!isIdentifierPart(ch)) {
                break;
            }
            if (ch === '\\') {
                ++index;
                if (source[index] !== 'u') {
                    return;
                }
                ++index;
                restore = index;
                ch = scanHexEscape('u');
                if (ch) {
                    if (ch === '\\' || !isIdentifierPart(ch)) {
                        return;
                    }
                    id += ch;
                } else {
                    index = restore;
                    id += 'u';
                }
            } else {
                id += source[index++];
            }
        }

        // There is no keyword or literal with only one character.
        // Thus, it must be an identifier.
        if (id.length === 1) {
            return {
                type: Token.Identifier,
                value: id,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if (isKeyword(id)) {
            return {
                type: Token.Keyword,
                value: id,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        // 7.8.1 Null Literals

        if (id === 'null') {
            return {
                type: Token.NullLiteral,
                value: id,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        // 7.8.2 Boolean Literals

        if (id === 'true' || id === 'false') {
            return {
                type: Token.BooleanLiteral,
                value: id,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        return {
            type: Token.Identifier,
            value: id,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [start, index]
        };
    }

    // 7.7 Punctuators

    function scanPunctuator() {
        var start = index,
            ch1 = source[index],
            ch2,
            ch3,
            ch4;

        // Check for most common single-character punctuators.

        if (ch1 === ';' || ch1 === '{' || ch1 === '}') {
            ++index;
            return {
                type: Token.Punctuator,
                value: ch1,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if (ch1 === ',' || ch1 === '(' || ch1 === ')') {
            ++index;
            return {
                type: Token.Punctuator,
                value: ch1,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        // Dot (.) can also start a floating-point number, hence the need
        // to check the next character.

        ch2 = source[index + 1];
        if (ch1 === '.' && !isDecimalDigit(ch2)) {
            return {
                type: Token.Punctuator,
                value: source[index++],
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        // Peek more characters.

        ch3 = source[index + 2];
        ch4 = source[index + 3];

        // 4-character punctuator: >>>=

        if (ch1 === '>' && ch2 === '>' && ch3 === '>') {
            if (ch4 === '=') {
                index += 4;
                return {
                    type: Token.Punctuator,
                    value: '>>>=',
                    lineNumber: lineNumber,
                    lineStart: lineStart,
                    range: [start, index]
                };
            }
        }

        // 3-character punctuators: === !== >>> <<= >>=

        if (ch1 === '=' && ch2 === '=' && ch3 === '=') {
            index += 3;
            return {
                type: Token.Punctuator,
                value: '===',
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if (ch1 === '!' && ch2 === '=' && ch3 === '=') {
            index += 3;
            return {
                type: Token.Punctuator,
                value: '!==',
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if (ch1 === '>' && ch2 === '>' && ch3 === '>') {
            index += 3;
            return {
                type: Token.Punctuator,
                value: '>>>',
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if (ch1 === '<' && ch2 === '<' && ch3 === '=') {
            index += 3;
            return {
                type: Token.Punctuator,
                value: '<<=',
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if (ch1 === '>' && ch2 === '>' && ch3 === '=') {
            index += 3;
            return {
                type: Token.Punctuator,
                value: '>>=',
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        // 2-character punctuators: <= >= == != ++ -- << >> && ||
        // += -= *= %= &= |= ^= /=

        if (ch2 === '=') {
            if ('<>=!+-*%&|^/'.indexOf(ch1) >= 0) {
                index += 2;
                return {
                    type: Token.Punctuator,
                    value: ch1 + ch2,
                    lineNumber: lineNumber,
                    lineStart: lineStart,
                    range: [start, index]
                };
            }
        }

        if (ch1 === ch2 && ('+-<>&|'.indexOf(ch1) >= 0)) {
            if ('+-<>&|'.indexOf(ch2) >= 0) {
                index += 2;
                return {
                    type: Token.Punctuator,
                    value: ch1 + ch2,
                    lineNumber: lineNumber,
                    lineStart: lineStart,
                    range: [start, index]
                };
            }
        }

        // The remaining 1-character punctuators.

        if ('[]<>+-*%&|^!~?:=/'.indexOf(ch1) >= 0) {
            return {
                type: Token.Punctuator,
                value: source[index++],
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }
    }

    // 7.8.3 Numeric Literals

    function scanNumericLiteral() {
        var number, start, ch;

        ch = source[index];
        assert(isDecimalDigit(ch) || (ch === '.'),
            'Numeric literal must start with a decimal digit or a decimal point');

        start = index;
        number = '';
        if (ch !== '.') {
            number = source[index++];
            ch = source[index];

            // Hex number starts with '0x'.
            // Octal number starts with '0'.
            if (number === '0') {
                if (ch === 'x' || ch === 'X') {
                    number += source[index++];
                    while (index < length) {
                        ch = source[index];
                        if (!isHexDigit(ch)) {
                            break;
                        }
                        number += source[index++];
                    }

                    if (number.length <= 2) {
                        // only 0x
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }

                    if (index < length) {
                        ch = source[index];
                        if (isIdentifierStart(ch)) {
                            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                        }
                    }
                    return {
                        type: Token.NumericLiteral,
                        value: parseInt(number, 16),
                        lineNumber: lineNumber,
                        lineStart: lineStart,
                        range: [start, index]
                    };
                } else if (isOctalDigit(ch)) {
                    number += source[index++];
                    while (index < length) {
                        ch = source[index];
                        if (!isOctalDigit(ch)) {
                            break;
                        }
                        number += source[index++];
                    }

                    if (index < length) {
                        ch = source[index];
                        if (isIdentifierStart(ch) || isDecimalDigit(ch)) {
                            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                        }
                    }
                    return {
                        type: Token.NumericLiteral,
                        value: parseInt(number, 8),
                        octal: true,
                        lineNumber: lineNumber,
                        lineStart: lineStart,
                        range: [start, index]
                    };
                }

                // decimal number starts with '0' such as '09' is illegal.
                if (isDecimalDigit(ch)) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
            }

            while (index < length) {
                ch = source[index];
                if (!isDecimalDigit(ch)) {
                    break;
                }
                number += source[index++];
            }
        }

        if (ch === '.') {
            number += source[index++];
            while (index < length) {
                ch = source[index];
                if (!isDecimalDigit(ch)) {
                    break;
                }
                number += source[index++];
            }
        }

        if (ch === 'e' || ch === 'E') {
            number += source[index++];

            ch = source[index];
            if (ch === '+' || ch === '-') {
                number += source[index++];
            }

            ch = source[index];
            if (isDecimalDigit(ch)) {
                number += source[index++];
                while (index < length) {
                    ch = source[index];
                    if (!isDecimalDigit(ch)) {
                        break;
                    }
                    number += source[index++];
                }
            } else {
                ch = 'character ' + ch;
                if (index >= length) {
                    ch = '<end>';
                }
                throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
            }
        }

        if (index < length) {
            ch = source[index];
            if (isIdentifierStart(ch)) {
                throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
            }
        }

        return {
            type: Token.NumericLiteral,
            value: parseFloat(number),
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [start, index]
        };
    }

    // 7.8.4 String Literals

    function scanStringLiteral() {
        var str = '', quote, start, ch, code, unescaped, restore, octal = false;

        quote = source[index];
        assert((quote === '\'' || quote === '"'),
            'String literal must starts with a quote');

        start = index;
        ++index;

        while (index < length) {
            ch = source[index++];

            if (ch === quote) {
                quote = '';
                break;
            } else if (ch === '\\') {
                ch = source[index++];
                if (!isLineTerminator(ch)) {
                    switch (ch) {
                    case 'n':
                        str += '\n';
                        break;
                    case 'r':
                        str += '\r';
                        break;
                    case 't':
                        str += '\t';
                        break;
                    case 'u':
                    case 'x':
                        restore = index;
                        unescaped = scanHexEscape(ch);
                        if (unescaped) {
                            str += unescaped;
                        } else {
                            index = restore;
                            str += ch;
                        }
                        break;
                    case 'b':
                        str += '\b';
                        break;
                    case 'f':
                        str += '\f';
                        break;
                    case 'v':
                        str += '\x0B';
                        break;

                    default:
                        if (isOctalDigit(ch)) {
                            code = '01234567'.indexOf(ch);

                            // \0 is not octal escape sequence
                            if (code !== 0) {
                                octal = true;
                            }

                            if (index < length && isOctalDigit(source[index])) {
                                octal = true;
                                code = code * 8 + '01234567'.indexOf(source[index++]);

                                // 3 digits are only allowed when string starts
                                // with 0, 1, 2, 3
                                if ('0123'.indexOf(ch) >= 0 &&
                                        index < length &&
                                        isOctalDigit(source[index])) {
                                    code = code * 8 + '01234567'.indexOf(source[index++]);
                                }
                            }
                            str += String.fromCharCode(code);
                        } else {
                            str += ch;
                        }
                        break;
                    }
                } else {
                    ++lineNumber;
                    if (ch ===  '\r' && source[index] === '\n') {
                        ++index;
                    }
                }
            } else if (isLineTerminator(ch)) {
                break;
            } else {
                str += ch;
            }
        }

        if (quote !== '') {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        return {
            type: Token.StringLiteral,
            value: str,
            octal: octal,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [start, index]
        };
    }

    function scanRegExp() {
        var str, ch, start, pattern, flags, value, classMarker = false, restore, terminated = false;

        buffer = null;
        skipComment();

        start = index;
        ch = source[index];
        assert(ch === '/', 'Regular expression literal must start with a slash');
        str = source[index++];

        while (index < length) {
            ch = source[index++];
            str += ch;
            if (ch === '\\') {
                ch = source[index++];
                // ECMA-262 7.8.5
                if (isLineTerminator(ch)) {
                    throwError({}, Messages.UnterminatedRegExp);
                }
                str += ch;
            } else if (classMarker) {
                if (ch === ']') {
                    classMarker = false;
                }
            } else {
                if (ch === '/') {
                    terminated = true;
                    break;
                } else if (ch === '[') {
                    classMarker = true;
                } else if (isLineTerminator(ch)) {
                    throwError({}, Messages.UnterminatedRegExp);
                }
            }
        }

        if (!terminated) {
            throwError({}, Messages.UnterminatedRegExp);
        }

        // Exclude leading and trailing slash.
        pattern = str.substr(1, str.length - 2);

        flags = '';
        while (index < length) {
            ch = source[index];
            if (!isIdentifierPart(ch)) {
                break;
            }

            ++index;
            if (ch === '\\' && index < length) {
                ch = source[index];
                if (ch === 'u') {
                    ++index;
                    restore = index;
                    ch = scanHexEscape('u');
                    if (ch) {
                        flags += ch;
                        str += '\\u';
                        for (; restore < index; ++restore) {
                            str += source[restore];
                        }
                    } else {
                        index = restore;
                        flags += 'u';
                        str += '\\u';
                    }
                } else {
                    str += '\\';
                }
            } else {
                flags += ch;
                str += ch;
            }
        }

        try {
            value = new RegExp(pattern, flags);
        } catch (e) {
            throwError({}, Messages.InvalidRegExp);
        }

        return {
            literal: str,
            value: value,
            range: [start, index]
        };
    }

    function isIdentifierName(token) {
        return token.type === Token.Identifier ||
            token.type === Token.Keyword ||
            token.type === Token.BooleanLiteral ||
            token.type === Token.NullLiteral;
    }

    function advance() {
        var ch, token;

        skipComment();

        if (index >= length) {
            return {
                type: Token.EOF,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [index, index]
            };
        }

        token = scanPunctuator();
        if (typeof token !== 'undefined') {
            return token;
        }

        ch = source[index];

        if (ch === '\'' || ch === '"') {
            return scanStringLiteral();
        }

        if (ch === '.' || isDecimalDigit(ch)) {
            return scanNumericLiteral();
        }

        token = scanIdentifier();
        if (typeof token !== 'undefined') {
            return token;
        }

        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }

    function lex() {
        var token;

        if (buffer) {
            index = buffer.range[1];
            lineNumber = buffer.lineNumber;
            lineStart = buffer.lineStart;
            token = buffer;
            buffer = null;
            return token;
        }

        buffer = null;
        return advance();
    }

    function lookahead() {
        var pos, line, start;

        if (buffer !== null) {
            return buffer;
        }

        pos = index;
        line = lineNumber;
        start = lineStart;
        buffer = advance();
        index = pos;
        lineNumber = line;
        lineStart = start;

        return buffer;
    }

    // Return true if there is a line terminator before the next token.

    function peekLineTerminator() {
        var pos, line, start, found;

        pos = index;
        line = lineNumber;
        start = lineStart;
        skipComment();
        found = lineNumber !== line;
        index = pos;
        lineNumber = line;
        lineStart = start;

        return found;
    }

    // Throw an exception

    function throwError(token, messageFormat) {
        var error,
            args = Array.prototype.slice.call(arguments, 2),
            msg = messageFormat.replace(
                /%(\d)/g,
                function (whole, index) {
                    return args[index] || '';
                }
            );

        if (typeof token.lineNumber === 'number') {
            error = new Error('Line ' + token.lineNumber + ': ' + msg);
            error.index = token.range[0];
            error.lineNumber = token.lineNumber;
            error.column = token.range[0] - lineStart + 1;
        } else {
            error = new Error('Line ' + lineNumber + ': ' + msg);
            error.index = index;
            error.lineNumber = lineNumber;
            error.column = index - lineStart + 1;
        }

        throw error;
    }

    function throwErrorTolerant() {
        try {
            throwError.apply(null, arguments);
        } catch (e) {
            if (extra.errors) {
                extra.errors.push(e);
            } else {
                throw e;
            }
        }
    }


    // Throw an exception because of the token.

    function throwUnexpected(token) {
        if (token.type === Token.EOF) {
            throwError(token, Messages.UnexpectedEOS);
        }

        if (token.type === Token.NumericLiteral) {
            throwError(token, Messages.UnexpectedNumber);
        }

        if (token.type === Token.StringLiteral) {
            throwError(token, Messages.UnexpectedString);
        }

        if (token.type === Token.Identifier) {
            throwError(token, Messages.UnexpectedIdentifier);
        }

        if (token.type === Token.Keyword) {
            if (isFutureReservedWord(token.value)) {
                throwError(token, Messages.UnexpectedReserved);
            } else if (strict && isStrictModeReservedWord(token.value)) {
                throwErrorTolerant(token, Messages.StrictReservedWord);
                return;
            }
            throwError(token, Messages.UnexpectedToken, token.value);
        }

        // BooleanLiteral, NullLiteral, or Punctuator.
        throwError(token, Messages.UnexpectedToken, token.value);
    }

    // Expect the next token to match the specified punctuator.
    // If not, an exception will be thrown.

    function expect(value) {
        var token = lex();
        if (token.type !== Token.Punctuator || token.value !== value) {
            throwUnexpected(token);
        }
    }

    // Expect the next token to match the specified keyword.
    // If not, an exception will be thrown.

    function expectKeyword(keyword) {
        var token = lex();
        if (token.type !== Token.Keyword || token.value !== keyword) {
            throwUnexpected(token);
        }
    }

    // Return true if the next token matches the specified punctuator.

    function match(value) {
        var token = lookahead();
        return token.type === Token.Punctuator && token.value === value;
    }

    // Return true if the next token matches the specified keyword

    function matchKeyword(keyword) {
        var token = lookahead();
        return token.type === Token.Keyword && token.value === keyword;
    }

    // Return true if the next token is an assignment operator

    function matchAssign() {
        var token = lookahead(),
            op = token.value;

        if (token.type !== Token.Punctuator) {
            return false;
        }
        return op === '=' ||
            op === '*=' ||
            op === '/=' ||
            op === '%=' ||
            op === '+=' ||
            op === '-=' ||
            op === '<<=' ||
            op === '>>=' ||
            op === '>>>=' ||
            op === '&=' ||
            op === '^=' ||
            op === '|=';
    }

    function consumeSemicolon() {
        var token, line;

        // Catch the very common case first.
        if (source[index] === ';') {
            lex();
            return;
        }

        line = lineNumber;
        skipComment();
        if (lineNumber !== line) {
            return;
        }

        if (match(';')) {
            lex();
            return;
        }

        token = lookahead();
        if (token.type !== Token.EOF && !match('}')) {
            throwUnexpected(token);
        }
    }

    // Return true if provided expression is LeftHandSideExpression

    function isLeftHandSide(expr) {
        return expr.type === Syntax.Identifier || expr.type === Syntax.MemberExpression;
    }

    // 11.1.4 Array Initialiser

    function parseArrayInitialiser() {
        var elements = [];

        expect('[');

        while (!match(']')) {
            if (match(',')) {
                lex();
                elements.push(null);
            } else {
                elements.push(parseAssignmentExpression());

                if (!match(']')) {
                    expect(',');
                }
            }
        }

        expect(']');

        return {
            type: Syntax.ArrayExpression,
            elements: elements
        };
    }

    // 11.1.5 Object Initialiser

    function parsePropertyFunction(param, first) {
        var previousStrict, body;

        previousStrict = strict;
        body = parseFunctionSourceElements();
        if (first && strict && isRestrictedWord(param[0].name)) {
            throwErrorTolerant(first, Messages.StrictParamName);
        }
        strict = previousStrict;

        return {
            type: Syntax.FunctionExpression,
            id: null,
            params: param,
            defaults: [],
            body: body,
            rest: null,
            generator: false,
            expression: false
        };
    }

    function parseObjectPropertyKey() {
        var token = lex();

        // Note: This function is called only from parseObjectProperty(), where
        // EOF and Punctuator tokens are already filtered out.

        if (token.type === Token.StringLiteral || token.type === Token.NumericLiteral) {
            if (strict && token.octal) {
                throwErrorTolerant(token, Messages.StrictOctalLiteral);
            }
            return createLiteral(token);
        }

        return {
            type: Syntax.Identifier,
            name: token.value
        };
    }

    function parseObjectProperty() {
        var token, key, id, param;

        token = lookahead();

        if (token.type === Token.Identifier) {

            id = parseObjectPropertyKey();

            // Property Assignment: Getter and Setter.

            if (token.value === 'get' && !match(':')) {
                key = parseObjectPropertyKey();
                expect('(');
                expect(')');
                return {
                    type: Syntax.Property,
                    key: key,
                    value: parsePropertyFunction([]),
                    kind: 'get'
                };
            } else if (token.value === 'set' && !match(':')) {
                key = parseObjectPropertyKey();
                expect('(');
                token = lookahead();
                if (token.type !== Token.Identifier) {
                    expect(')');
                    throwErrorTolerant(token, Messages.UnexpectedToken, token.value);
                    return {
                        type: Syntax.Property,
                        key: key,
                        value: parsePropertyFunction([]),
                        kind: 'set'
                    };
                } else {
                    param = [ parseVariableIdentifier() ];
                    expect(')');
                    return {
                        type: Syntax.Property,
                        key: key,
                        value: parsePropertyFunction(param, token),
                        kind: 'set'
                    };
                }
            } else {
                expect(':');
                return {
                    type: Syntax.Property,
                    key: id,
                    value: parseAssignmentExpression(),
                    kind: 'init'
                };
            }
        } else if (token.type === Token.EOF || token.type === Token.Punctuator) {
            throwUnexpected(token);
        } else {
            key = parseObjectPropertyKey();
            expect(':');
            return {
                type: Syntax.Property,
                key: key,
                value: parseAssignmentExpression(),
                kind: 'init'
            };
        }
    }

    function parseObjectInitialiser() {
        var properties = [], property, name, kind, map = {}, toString = String;

        expect('{');

        while (!match('}')) {
            property = parseObjectProperty();

            if (property.key.type === Syntax.Identifier) {
                name = property.key.name;
            } else {
                name = toString(property.key.value);
            }
            kind = (property.kind === 'init') ? PropertyKind.Data : (property.kind === 'get') ? PropertyKind.Get : PropertyKind.Set;
            if (Object.prototype.hasOwnProperty.call(map, name)) {
                if (map[name] === PropertyKind.Data) {
                    if (strict && kind === PropertyKind.Data) {
                        throwErrorTolerant({}, Messages.StrictDuplicateProperty);
                    } else if (kind !== PropertyKind.Data) {
                        throwErrorTolerant({}, Messages.AccessorDataProperty);
                    }
                } else {
                    if (kind === PropertyKind.Data) {
                        throwErrorTolerant({}, Messages.AccessorDataProperty);
                    } else if (map[name] & kind) {
                        throwErrorTolerant({}, Messages.AccessorGetSet);
                    }
                }
                map[name] |= kind;
            } else {
                map[name] = kind;
            }

            properties.push(property);

            if (!match('}')) {
                expect(',');
            }
        }

        expect('}');

        return {
            type: Syntax.ObjectExpression,
            properties: properties
        };
    }

    // 11.1.6 The Grouping Operator

    function parseGroupExpression() {
        var expr;

        expect('(');

        expr = parseExpression();

        expect(')');

        return expr;
    }


    // 11.1 Primary Expressions

    function parsePrimaryExpression() {
        var token = lookahead(),
            type = token.type;

        if (type === Token.Identifier) {
            return {
                type: Syntax.Identifier,
                name: lex().value
            };
        }

        if (type === Token.StringLiteral || type === Token.NumericLiteral) {
            if (strict && token.octal) {
                throwErrorTolerant(token, Messages.StrictOctalLiteral);
            }
            return createLiteral(lex());
        }

        if (type === Token.Keyword) {
            if (matchKeyword('this')) {
                lex();
                return {
                    type: Syntax.ThisExpression
                };
            }

            if (matchKeyword('function')) {
                return parseFunctionExpression();
            }
        }

        if (type === Token.BooleanLiteral) {
            lex();
            token.value = (token.value === 'true');
            return createLiteral(token);
        }

        if (type === Token.NullLiteral) {
            lex();
            token.value = null;
            return createLiteral(token);
        }

        if (match('[')) {
            return parseArrayInitialiser();
        }

        if (match('{')) {
            return parseObjectInitialiser();
        }

        if (match('(')) {
            return parseGroupExpression();
        }

        if (match('/') || match('/=')) {
            return createLiteral(scanRegExp());
        }

        return throwUnexpected(lex());
    }

    // 11.2 Left-Hand-Side Expressions

    function parseArguments() {
        var args = [];

        expect('(');

        if (!match(')')) {
            while (index < length) {
                args.push(parseAssignmentExpression());
                if (match(')')) {
                    break;
                }
                expect(',');
            }
        }

        expect(')');

        return args;
    }

    function parseNonComputedProperty() {
        var token = lex();

        if (!isIdentifierName(token)) {
            throwUnexpected(token);
        }

        return {
            type: Syntax.Identifier,
            name: token.value
        };
    }

    function parseNonComputedMember() {
        expect('.');

        return parseNonComputedProperty();
    }

    function parseComputedMember() {
        var expr;

        expect('[');

        expr = parseExpression();

        expect(']');

        return expr;
    }

    function parseNewExpression() {
        var expr;

        expectKeyword('new');

        expr = {
            type: Syntax.NewExpression,
            callee: parseLeftHandSideExpression(),
            'arguments': []
        };

        if (match('(')) {
            expr['arguments'] = parseArguments();
        }

        return expr;
    }

    function parseLeftHandSideExpressionAllowCall() {
        var expr;

        expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();

        while (match('.') || match('[') || match('(')) {
            if (match('(')) {
                expr = {
                    type: Syntax.CallExpression,
                    callee: expr,
                    'arguments': parseArguments()
                };
            } else if (match('[')) {
                expr = {
                    type: Syntax.MemberExpression,
                    computed: true,
                    object: expr,
                    property: parseComputedMember()
                };
            } else {
                expr = {
                    type: Syntax.MemberExpression,
                    computed: false,
                    object: expr,
                    property: parseNonComputedMember()
                };
            }
        }

        return expr;
    }


    function parseLeftHandSideExpression() {
        var expr;

        expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();

        while (match('.') || match('[')) {
            if (match('[')) {
                expr = {
                    type: Syntax.MemberExpression,
                    computed: true,
                    object: expr,
                    property: parseComputedMember()
                };
            } else {
                expr = {
                    type: Syntax.MemberExpression,
                    computed: false,
                    object: expr,
                    property: parseNonComputedMember()
                };
            }
        }

        return expr;
    }

    // 11.3 Postfix Expressions

    function parsePostfixExpression() {
        var expr = parseLeftHandSideExpressionAllowCall(), token;

        token = lookahead();
        if (token.type !== Token.Punctuator) {
            return expr;
        }

        if ((match('++') || match('--')) && !peekLineTerminator()) {
            // 11.3.1, 11.3.2
            if (strict && expr.type === Syntax.Identifier && isRestrictedWord(expr.name)) {
                throwErrorTolerant({}, Messages.StrictLHSPostfix);
            }
            if (!isLeftHandSide(expr)) {
                throwErrorTolerant({}, Messages.InvalidLHSInAssignment);
            }

            expr = {
                type: Syntax.UpdateExpression,
                operator: lex().value,
                argument: expr,
                prefix: false
            };
        }

        return expr;
    }

    // 11.4 Unary Operators

    function parseUnaryExpression() {
        var token, expr;

        token = lookahead();
        if (token.type !== Token.Punctuator && token.type !== Token.Keyword) {
            return parsePostfixExpression();
        }

        if (match('++') || match('--')) {
            token = lex();
            expr = parseUnaryExpression();
            // 11.4.4, 11.4.5
            if (strict && expr.type === Syntax.Identifier && isRestrictedWord(expr.name)) {
                throwErrorTolerant({}, Messages.StrictLHSPrefix);
            }

            if (!isLeftHandSide(expr)) {
                throwErrorTolerant({}, Messages.InvalidLHSInAssignment);
            }

            expr = {
                type: Syntax.UpdateExpression,
                operator: token.value,
                argument: expr,
                prefix: true
            };
            return expr;
        }

        if (match('+') || match('-') || match('~') || match('!')) {
            expr = {
                type: Syntax.UnaryExpression,
                operator: lex().value,
                argument: parseUnaryExpression(),
                prefix: true
            };
            return expr;
        }

        if (matchKeyword('delete') || matchKeyword('void') || matchKeyword('typeof')) {
            expr = {
                type: Syntax.UnaryExpression,
                operator: lex().value,
                argument: parseUnaryExpression(),
                prefix: true
            };
            if (strict && expr.operator === 'delete' && expr.argument.type === Syntax.Identifier) {
                throwErrorTolerant({}, Messages.StrictDelete);
            }
            return expr;
        }

        return parsePostfixExpression();
    }

    // 11.5 Multiplicative Operators

    function parseMultiplicativeExpression() {
        var expr = parseUnaryExpression();

        while (match('*') || match('/') || match('%')) {
            expr = {
                type: Syntax.BinaryExpression,
                operator: lex().value,
                left: expr,
                right: parseUnaryExpression()
            };
        }

        return expr;
    }

    // 11.6 Additive Operators

    function parseAdditiveExpression() {
        var expr = parseMultiplicativeExpression();

        while (match('+') || match('-')) {
            expr = {
                type: Syntax.BinaryExpression,
                operator: lex().value,
                left: expr,
                right: parseMultiplicativeExpression()
            };
        }

        return expr;
    }

    // 11.7 Bitwise Shift Operators

    function parseShiftExpression() {
        var expr = parseAdditiveExpression();

        while (match('<<') || match('>>') || match('>>>')) {
            expr = {
                type: Syntax.BinaryExpression,
                operator: lex().value,
                left: expr,
                right: parseAdditiveExpression()
            };
        }

        return expr;
    }
    // 11.8 Relational Operators

    function parseRelationalExpression() {
        var expr, previousAllowIn;

        previousAllowIn = state.allowIn;
        state.allowIn = true;

        expr = parseShiftExpression();

        while (match('<') || match('>') || match('<=') || match('>=') || (previousAllowIn && matchKeyword('in')) || matchKeyword('instanceof')) {
            expr = {
                type: Syntax.BinaryExpression,
                operator: lex().value,
                left: expr,
                right: parseShiftExpression()
            };
        }

        state.allowIn = previousAllowIn;
        return expr;
    }

    // 11.9 Equality Operators

    function parseEqualityExpression() {
        var expr = parseRelationalExpression();

        while (match('==') || match('!=') || match('===') || match('!==')) {
            expr = {
                type: Syntax.BinaryExpression,
                operator: lex().value,
                left: expr,
                right: parseRelationalExpression()
            };
        }

        return expr;
    }

    // 11.10 Binary Bitwise Operators

    function parseBitwiseANDExpression() {
        var expr = parseEqualityExpression();

        while (match('&')) {
            lex();
            expr = {
                type: Syntax.BinaryExpression,
                operator: '&',
                left: expr,
                right: parseEqualityExpression()
            };
        }

        return expr;
    }

    function parseBitwiseXORExpression() {
        var expr = parseBitwiseANDExpression();

        while (match('^')) {
            lex();
            expr = {
                type: Syntax.BinaryExpression,
                operator: '^',
                left: expr,
                right: parseBitwiseANDExpression()
            };
        }

        return expr;
    }

    function parseBitwiseORExpression() {
        var expr = parseBitwiseXORExpression();

        while (match('|')) {
            lex();
            expr = {
                type: Syntax.BinaryExpression,
                operator: '|',
                left: expr,
                right: parseBitwiseXORExpression()
            };
        }

        return expr;
    }

    // 11.11 Binary Logical Operators

    function parseLogicalANDExpression() {
        var expr = parseBitwiseORExpression();

        while (match('&&')) {
            lex();
            expr = {
                type: Syntax.LogicalExpression,
                operator: '&&',
                left: expr,
                right: parseBitwiseORExpression()
            };
        }

        return expr;
    }

    function parseLogicalORExpression() {
        var expr = parseLogicalANDExpression();

        while (match('||')) {
            lex();
            expr = {
                type: Syntax.LogicalExpression,
                operator: '||',
                left: expr,
                right: parseLogicalANDExpression()
            };
        }

        return expr;
    }

    // 11.12 Conditional Operator

    function parseConditionalExpression() {
        var expr, previousAllowIn, consequent;

        expr = parseLogicalORExpression();

        if (match('?')) {
            lex();
            previousAllowIn = state.allowIn;
            state.allowIn = true;
            consequent = parseAssignmentExpression();
            state.allowIn = previousAllowIn;
            expect(':');

            expr = {
                type: Syntax.ConditionalExpression,
                test: expr,
                consequent: consequent,
                alternate: parseAssignmentExpression()
            };
        }

        return expr;
    }

    // 11.13 Assignment Operators

    function parseAssignmentExpression() {
        var token, expr;

        token = lookahead();
        expr = parseConditionalExpression();

        if (matchAssign()) {
            // LeftHandSideExpression
            if (!isLeftHandSide(expr)) {
                throwErrorTolerant({}, Messages.InvalidLHSInAssignment);
            }

            // 11.13.1
            if (strict && expr.type === Syntax.Identifier && isRestrictedWord(expr.name)) {
                throwErrorTolerant(token, Messages.StrictLHSAssignment);
            }

            expr = {
                type: Syntax.AssignmentExpression,
                operator: lex().value,
                left: expr,
                right: parseAssignmentExpression()
            };
        }

        return expr;
    }

    // 11.14 Comma Operator

    function parseExpression() {
        var expr = parseAssignmentExpression();

        if (match(',')) {
            expr = {
                type: Syntax.SequenceExpression,
                expressions: [ expr ]
            };

            while (index < length) {
                if (!match(',')) {
                    break;
                }
                lex();
                expr.expressions.push(parseAssignmentExpression());
            }

        }
        return expr;
    }

    // 12.1 Block

    function parseStatementList() {
        var list = [],
            statement;

        while (index < length) {
            if (match('}')) {
                break;
            }
            statement = parseSourceElement();
            if (typeof statement === 'undefined') {
                break;
            }
            list.push(statement);
        }

        return list;
    }

    function parseBlock() {
        var block;

        expect('{');

        block = parseStatementList();

        expect('}');

        return {
            type: Syntax.BlockStatement,
            body: block
        };
    }

    // 12.2 Variable Statement

    function parseVariableIdentifier() {
        var token = lex();

        if (token.type !== Token.Identifier) {
            throwUnexpected(token);
        }

        return {
            type: Syntax.Identifier,
            name: token.value
        };
    }

    function parseVariableDeclaration(kind) {
        var id = parseVariableIdentifier(),
            init = null;

        // 12.2.1
        if (strict && isRestrictedWord(id.name)) {
            throwErrorTolerant({}, Messages.StrictVarName);
        }

        if (kind === 'const') {
            expect('=');
            init = parseAssignmentExpression();
        } else if (match('=')) {
            lex();
            init = parseAssignmentExpression();
        }

        return {
            type: Syntax.VariableDeclarator,
            id: id,
            init: init
        };
    }

    function parseVariableDeclarationList(kind) {
        var list = [];

        do {
            list.push(parseVariableDeclaration(kind));
            if (!match(',')) {
                break;
            }
            lex();
        } while (index < length);

        return list;
    }

    function parseVariableStatement() {
        var declarations;

        expectKeyword('var');

        declarations = parseVariableDeclarationList();

        consumeSemicolon();

        return {
            type: Syntax.VariableDeclaration,
            declarations: declarations,
            kind: 'var'
        };
    }

    // kind may be `const` or `let`
    // Both are experimental and not in the specification yet.
    // see http://wiki.ecmascript.org/doku.php?id=harmony:const
    // and http://wiki.ecmascript.org/doku.php?id=harmony:let
    function parseConstLetDeclaration(kind) {
        var declarations;

        expectKeyword(kind);

        declarations = parseVariableDeclarationList(kind);

        consumeSemicolon();

        return {
            type: Syntax.VariableDeclaration,
            declarations: declarations,
            kind: kind
        };
    }

    // 12.3 Empty Statement

    function parseEmptyStatement() {
        expect(';');

        return {
            type: Syntax.EmptyStatement
        };
    }

    // 12.4 Expression Statement

    function parseExpressionStatement() {
        var expr = parseExpression();

        consumeSemicolon();

        return {
            type: Syntax.ExpressionStatement,
            expression: expr
        };
    }

    // 12.5 If statement

    function parseIfStatement() {
        var test, consequent, alternate;

        expectKeyword('if');

        expect('(');

        test = parseExpression();

        expect(')');

        consequent = parseStatement();

        if (matchKeyword('else')) {
            lex();
            alternate = parseStatement();
        } else {
            alternate = null;
        }

        return {
            type: Syntax.IfStatement,
            test: test,
            consequent: consequent,
            alternate: alternate
        };
    }

    // 12.6 Iteration Statements

    function parseDoWhileStatement() {
        var body, test, oldInIteration;

        expectKeyword('do');

        oldInIteration = state.inIteration;
        state.inIteration = true;

        body = parseStatement();

        state.inIteration = oldInIteration;

        expectKeyword('while');

        expect('(');

        test = parseExpression();

        expect(')');

        if (match(';')) {
            lex();
        }

        return {
            type: Syntax.DoWhileStatement,
            body: body,
            test: test
        };
    }

    function parseWhileStatement() {
        var test, body, oldInIteration;

        expectKeyword('while');

        expect('(');

        test = parseExpression();

        expect(')');

        oldInIteration = state.inIteration;
        state.inIteration = true;

        body = parseStatement();

        state.inIteration = oldInIteration;

        return {
            type: Syntax.WhileStatement,
            test: test,
            body: body
        };
    }

    function parseForVariableDeclaration() {
        var token = lex();

        return {
            type: Syntax.VariableDeclaration,
            declarations: parseVariableDeclarationList(),
            kind: token.value
        };
    }

    function parseForStatement() {
        var init, test, update, left, right, body, oldInIteration;

        init = test = update = null;

        expectKeyword('for');

        expect('(');

        if (match(';')) {
            lex();
        } else {
            if (matchKeyword('var') || matchKeyword('let')) {
                state.allowIn = false;
                init = parseForVariableDeclaration();
                state.allowIn = true;

                if (init.declarations.length === 1 && matchKeyword('in')) {
                    lex();
                    left = init;
                    right = parseExpression();
                    init = null;
                }
            } else {
                state.allowIn = false;
                init = parseExpression();
                state.allowIn = true;

                if (matchKeyword('in')) {
                    // LeftHandSideExpression
                    if (!isLeftHandSide(init)) {
                        throwErrorTolerant({}, Messages.InvalidLHSInForIn);
                    }

                    lex();
                    left = init;
                    right = parseExpression();
                    init = null;
                }
            }

            if (typeof left === 'undefined') {
                expect(';');
            }
        }

        if (typeof left === 'undefined') {

            if (!match(';')) {
                test = parseExpression();
            }
            expect(';');

            if (!match(')')) {
                update = parseExpression();
            }
        }

        expect(')');

        oldInIteration = state.inIteration;
        state.inIteration = true;

        body = parseStatement();

        state.inIteration = oldInIteration;

        if (typeof left === 'undefined') {
            return {
                type: Syntax.ForStatement,
                init: init,
                test: test,
                update: update,
                body: body
            };
        }

        return {
            type: Syntax.ForInStatement,
            left: left,
            right: right,
            body: body,
            each: false
        };
    }

    // 12.7 The continue statement

    function parseContinueStatement() {
        var token, label = null;

        expectKeyword('continue');

        // Optimize the most common form: 'continue;'.
        if (source[index] === ';') {
            lex();

            if (!state.inIteration) {
                throwError({}, Messages.IllegalContinue);
            }

            return {
                type: Syntax.ContinueStatement,
                label: null
            };
        }

        if (peekLineTerminator()) {
            if (!state.inIteration) {
                throwError({}, Messages.IllegalContinue);
            }

            return {
                type: Syntax.ContinueStatement,
                label: null
            };
        }

        token = lookahead();
        if (token.type === Token.Identifier) {
            label = parseVariableIdentifier();

            if (!Object.prototype.hasOwnProperty.call(state.labelSet, label.name)) {
                throwError({}, Messages.UnknownLabel, label.name);
            }
        }

        consumeSemicolon();

        if (label === null && !state.inIteration) {
            throwError({}, Messages.IllegalContinue);
        }

        return {
            type: Syntax.ContinueStatement,
            label: label
        };
    }

    // 12.8 The break statement

    function parseBreakStatement() {
        var token, label = null;

        expectKeyword('break');

        // Optimize the most common form: 'break;'.
        if (source[index] === ';') {
            lex();

            if (!(state.inIteration || state.inSwitch)) {
                throwError({}, Messages.IllegalBreak);
            }

            return {
                type: Syntax.BreakStatement,
                label: null
            };
        }

        if (peekLineTerminator()) {
            if (!(state.inIteration || state.inSwitch)) {
                throwError({}, Messages.IllegalBreak);
            }

            return {
                type: Syntax.BreakStatement,
                label: null
            };
        }

        token = lookahead();
        if (token.type === Token.Identifier) {
            label = parseVariableIdentifier();

            if (!Object.prototype.hasOwnProperty.call(state.labelSet, label.name)) {
                throwError({}, Messages.UnknownLabel, label.name);
            }
        }

        consumeSemicolon();

        if (label === null && !(state.inIteration || state.inSwitch)) {
            throwError({}, Messages.IllegalBreak);
        }

        return {
            type: Syntax.BreakStatement,
            label: label
        };
    }

    // 12.9 The return statement

    function parseReturnStatement() {
        var token, argument = null;

        expectKeyword('return');

        if (!state.inFunctionBody) {
            throwErrorTolerant({}, Messages.IllegalReturn);
        }

        // 'return' followed by a space and an identifier is very common.
        if (source[index] === ' ') {
            if (isIdentifierStart(source[index + 1])) {
                argument = parseExpression();
                consumeSemicolon();
                return {
                    type: Syntax.ReturnStatement,
                    argument: argument
                };
            }
        }

        if (peekLineTerminator()) {
            return {
                type: Syntax.ReturnStatement,
                argument: null
            };
        }

        if (!match(';')) {
            token = lookahead();
            if (!match('}') && token.type !== Token.EOF) {
                argument = parseExpression();
            }
        }

        consumeSemicolon();

        return {
            type: Syntax.ReturnStatement,
            argument: argument
        };
    }

    // 12.10 The with statement

    function parseWithStatement() {
        var object, body;

        if (strict) {
            throwErrorTolerant({}, Messages.StrictModeWith);
        }

        expectKeyword('with');

        expect('(');

        object = parseExpression();

        expect(')');

        body = parseStatement();

        return {
            type: Syntax.WithStatement,
            object: object,
            body: body
        };
    }

    // 12.10 The swith statement

    function parseSwitchCase() {
        var test,
            consequent = [],
            statement;

        if (matchKeyword('default')) {
            lex();
            test = null;
        } else {
            expectKeyword('case');
            test = parseExpression();
        }
        expect(':');

        while (index < length) {
            if (match('}') || matchKeyword('default') || matchKeyword('case')) {
                break;
            }
            statement = parseStatement();
            if (typeof statement === 'undefined') {
                break;
            }
            consequent.push(statement);
        }

        return {
            type: Syntax.SwitchCase,
            test: test,
            consequent: consequent
        };
    }

    function parseSwitchStatement() {
        var discriminant, cases, clause, oldInSwitch, defaultFound;

        expectKeyword('switch');

        expect('(');

        discriminant = parseExpression();

        expect(')');

        expect('{');

        cases = [];

        if (match('}')) {
            lex();
            return {
                type: Syntax.SwitchStatement,
                discriminant: discriminant,
                cases: cases
            };
        }

        oldInSwitch = state.inSwitch;
        state.inSwitch = true;
        defaultFound = false;

        while (index < length) {
            if (match('}')) {
                break;
            }
            clause = parseSwitchCase();
            if (clause.test === null) {
                if (defaultFound) {
                    throwError({}, Messages.MultipleDefaultsInSwitch);
                }
                defaultFound = true;
            }
            cases.push(clause);
        }

        state.inSwitch = oldInSwitch;

        expect('}');

        return {
            type: Syntax.SwitchStatement,
            discriminant: discriminant,
            cases: cases
        };
    }

    // 12.13 The throw statement

    function parseThrowStatement() {
        var argument;

        expectKeyword('throw');

        if (peekLineTerminator()) {
            throwError({}, Messages.NewlineAfterThrow);
        }

        argument = parseExpression();

        consumeSemicolon();

        return {
            type: Syntax.ThrowStatement,
            argument: argument
        };
    }

    // 12.14 The try statement

    function parseCatchClause() {
        var param;

        expectKeyword('catch');

        expect('(');
        if (match(')')) {
            throwUnexpected(lookahead());
        }

        param = parseVariableIdentifier();
        // 12.14.1
        if (strict && isRestrictedWord(param.name)) {
            throwErrorTolerant({}, Messages.StrictCatchVariable);
        }

        expect(')');

        return {
            type: Syntax.CatchClause,
            param: param,
            body: parseBlock()
        };
    }

    function parseTryStatement() {
        var block, handlers = [], finalizer = null;

        expectKeyword('try');

        block = parseBlock();

        if (matchKeyword('catch')) {
            handlers.push(parseCatchClause());
        }

        if (matchKeyword('finally')) {
            lex();
            finalizer = parseBlock();
        }

        if (handlers.length === 0 && !finalizer) {
            throwError({}, Messages.NoCatchOrFinally);
        }

        return {
            type: Syntax.TryStatement,
            block: block,
            guardedHandlers: [],
            handlers: handlers,
            finalizer: finalizer
        };
    }

    // 12.15 The debugger statement

    function parseDebuggerStatement() {
        expectKeyword('debugger');

        consumeSemicolon();

        return {
            type: Syntax.DebuggerStatement
        };
    }

    // 12 Statements

    function parseStatement() {
        var token = lookahead(),
            expr,
            labeledBody;

        if (token.type === Token.EOF) {
            throwUnexpected(token);
        }

        if (token.type === Token.Punctuator) {
            switch (token.value) {
            case ';':
                return parseEmptyStatement();
            case '{':
                return parseBlock();
            case '(':
                return parseExpressionStatement();
            default:
                break;
            }
        }

        if (token.type === Token.Keyword) {
            switch (token.value) {
            case 'break':
                return parseBreakStatement();
            case 'continue':
                return parseContinueStatement();
            case 'debugger':
                return parseDebuggerStatement();
            case 'do':
                return parseDoWhileStatement();
            case 'for':
                return parseForStatement();
            case 'function':
                return parseFunctionDeclaration();
            case 'if':
                return parseIfStatement();
            case 'return':
                return parseReturnStatement();
            case 'switch':
                return parseSwitchStatement();
            case 'throw':
                return parseThrowStatement();
            case 'try':
                return parseTryStatement();
            case 'var':
                return parseVariableStatement();
            case 'while':
                return parseWhileStatement();
            case 'with':
                return parseWithStatement();
            default:
                break;
            }
        }

        expr = parseExpression();

        // 12.12 Labelled Statements
        if ((expr.type === Syntax.Identifier) && match(':')) {
            lex();

            if (Object.prototype.hasOwnProperty.call(state.labelSet, expr.name)) {
                throwError({}, Messages.Redeclaration, 'Label', expr.name);
            }

            state.labelSet[expr.name] = true;
            labeledBody = parseStatement();
            delete state.labelSet[expr.name];

            return {
                type: Syntax.LabeledStatement,
                label: expr,
                body: labeledBody
            };
        }

        consumeSemicolon();

        return {
            type: Syntax.ExpressionStatement,
            expression: expr
        };
    }

    // 13 Function Definition

    function parseFunctionSourceElements() {
        var sourceElement, sourceElements = [], token, directive, firstRestricted,
            oldLabelSet, oldInIteration, oldInSwitch, oldInFunctionBody;

        expect('{');

        while (index < length) {
            token = lookahead();
            if (token.type !== Token.StringLiteral) {
                break;
            }

            sourceElement = parseSourceElement();
            sourceElements.push(sourceElement);
            if (sourceElement.expression.type !== Syntax.Literal) {
                // this is not directive
                break;
            }
            directive = sliceSource(token.range[0] + 1, token.range[1] - 1);
            if (directive === 'use strict') {
                strict = true;
                if (firstRestricted) {
                    throwErrorTolerant(firstRestricted, Messages.StrictOctalLiteral);
                }
            } else {
                if (!firstRestricted && token.octal) {
                    firstRestricted = token;
                }
            }
        }

        oldLabelSet = state.labelSet;
        oldInIteration = state.inIteration;
        oldInSwitch = state.inSwitch;
        oldInFunctionBody = state.inFunctionBody;

        state.labelSet = {};
        state.inIteration = false;
        state.inSwitch = false;
        state.inFunctionBody = true;

        while (index < length) {
            if (match('}')) {
                break;
            }
            sourceElement = parseSourceElement();
            if (typeof sourceElement === 'undefined') {
                break;
            }
            sourceElements.push(sourceElement);
        }

        expect('}');

        state.labelSet = oldLabelSet;
        state.inIteration = oldInIteration;
        state.inSwitch = oldInSwitch;
        state.inFunctionBody = oldInFunctionBody;

        return {
            type: Syntax.BlockStatement,
            body: sourceElements
        };
    }

    function parseFunctionDeclaration() {
        var id, param, params = [], body, token, stricted, firstRestricted, message, previousStrict, paramSet;

        expectKeyword('function');
        token = lookahead();
        id = parseVariableIdentifier();
        if (strict) {
            if (isRestrictedWord(token.value)) {
                throwErrorTolerant(token, Messages.StrictFunctionName);
            }
        } else {
            if (isRestrictedWord(token.value)) {
                firstRestricted = token;
                message = Messages.StrictFunctionName;
            } else if (isStrictModeReservedWord(token.value)) {
                firstRestricted = token;
                message = Messages.StrictReservedWord;
            }
        }

        expect('(');

        if (!match(')')) {
            paramSet = {};
            while (index < length) {
                token = lookahead();
                param = parseVariableIdentifier();
                if (strict) {
                    if (isRestrictedWord(token.value)) {
                        stricted = token;
                        message = Messages.StrictParamName;
                    }
                    if (Object.prototype.hasOwnProperty.call(paramSet, token.value)) {
                        stricted = token;
                        message = Messages.StrictParamDupe;
                    }
                } else if (!firstRestricted) {
                    if (isRestrictedWord(token.value)) {
                        firstRestricted = token;
                        message = Messages.StrictParamName;
                    } else if (isStrictModeReservedWord(token.value)) {
                        firstRestricted = token;
                        message = Messages.StrictReservedWord;
                    } else if (Object.prototype.hasOwnProperty.call(paramSet, token.value)) {
                        firstRestricted = token;
                        message = Messages.StrictParamDupe;
                    }
                }
                params.push(param);
                paramSet[param.name] = true;
                if (match(')')) {
                    break;
                }
                expect(',');
            }
        }

        expect(')');

        previousStrict = strict;
        body = parseFunctionSourceElements();
        if (strict && firstRestricted) {
            throwError(firstRestricted, message);
        }
        if (strict && stricted) {
            throwErrorTolerant(stricted, message);
        }
        strict = previousStrict;

        return {
            type: Syntax.FunctionDeclaration,
            id: id,
            params: params,
            defaults: [],
            body: body,
            rest: null,
            generator: false,
            expression: false
        };
    }

    function parseFunctionExpression() {
        var token, id = null, stricted, firstRestricted, message, param, params = [], body, previousStrict, paramSet;

        expectKeyword('function');

        if (!match('(')) {
            token = lookahead();
            id = parseVariableIdentifier();
            if (strict) {
                if (isRestrictedWord(token.value)) {
                    throwErrorTolerant(token, Messages.StrictFunctionName);
                }
            } else {
                if (isRestrictedWord(token.value)) {
                    firstRestricted = token;
                    message = Messages.StrictFunctionName;
                } else if (isStrictModeReservedWord(token.value)) {
                    firstRestricted = token;
                    message = Messages.StrictReservedWord;
                }
            }
        }

        expect('(');

        if (!match(')')) {
            paramSet = {};
            while (index < length) {
                token = lookahead();
                param = parseVariableIdentifier();
                if (strict) {
                    if (isRestrictedWord(token.value)) {
                        stricted = token;
                        message = Messages.StrictParamName;
                    }
                    if (Object.prototype.hasOwnProperty.call(paramSet, token.value)) {
                        stricted = token;
                        message = Messages.StrictParamDupe;
                    }
                } else if (!firstRestricted) {
                    if (isRestrictedWord(token.value)) {
                        firstRestricted = token;
                        message = Messages.StrictParamName;
                    } else if (isStrictModeReservedWord(token.value)) {
                        firstRestricted = token;
                        message = Messages.StrictReservedWord;
                    } else if (Object.prototype.hasOwnProperty.call(paramSet, token.value)) {
                        firstRestricted = token;
                        message = Messages.StrictParamDupe;
                    }
                }
                params.push(param);
                paramSet[param.name] = true;
                if (match(')')) {
                    break;
                }
                expect(',');
            }
        }

        expect(')');

        previousStrict = strict;
        body = parseFunctionSourceElements();
        if (strict && firstRestricted) {
            throwError(firstRestricted, message);
        }
        if (strict && stricted) {
            throwErrorTolerant(stricted, message);
        }
        strict = previousStrict;

        return {
            type: Syntax.FunctionExpression,
            id: id,
            params: params,
            defaults: [],
            body: body,
            rest: null,
            generator: false,
            expression: false
        };
    }

    // 14 Program

    function parseSourceElement() {
        var token = lookahead();

        if (token.type === Token.Keyword) {
            switch (token.value) {
            case 'const':
            case 'let':
                return parseConstLetDeclaration(token.value);
            case 'function':
                return parseFunctionDeclaration();
            default:
                return parseStatement();
            }
        }

        if (token.type !== Token.EOF) {
            return parseStatement();
        }
    }

    function parseSourceElements() {
        var sourceElement, sourceElements = [], token, directive, firstRestricted;

        while (index < length) {
            token = lookahead();
            if (token.type !== Token.StringLiteral) {
                break;
            }

            sourceElement = parseSourceElement();
            sourceElements.push(sourceElement);
            if (sourceElement.expression.type !== Syntax.Literal) {
                // this is not directive
                break;
            }
            directive = sliceSource(token.range[0] + 1, token.range[1] - 1);
            if (directive === 'use strict') {
                strict = true;
                if (firstRestricted) {
                    throwErrorTolerant(firstRestricted, Messages.StrictOctalLiteral);
                }
            } else {
                if (!firstRestricted && token.octal) {
                    firstRestricted = token;
                }
            }
        }

        while (index < length) {
            sourceElement = parseSourceElement();
            if (typeof sourceElement === 'undefined') {
                break;
            }
            sourceElements.push(sourceElement);
        }
        return sourceElements;
    }

    function parseProgram() {
        var program;
        strict = false;
        program = {
            type: Syntax.Program,
            body: parseSourceElements()
        };
        return program;
    }

    // The following functions are needed only when the option to preserve
    // the comments is active.

    function addComment(type, value, start, end, loc) {
        assert(typeof start === 'number', 'Comment must have valid position');

        // Because the way the actual token is scanned, often the comments
        // (if any) are skipped twice during the lexical analysis.
        // Thus, we need to skip adding a comment if the comment array already
        // handled it.
        if (extra.comments.length > 0) {
            if (extra.comments[extra.comments.length - 1].range[1] > start) {
                return;
            }
        }

        extra.comments.push({
            type: type,
            value: value,
            range: [start, end],
            loc: loc
        });
    }

    function scanComment() {
        var comment, ch, loc, start, blockComment, lineComment;

        comment = '';
        blockComment = false;
        lineComment = false;

        while (index < length) {
            ch = source[index];

            if (lineComment) {
                ch = source[index++];
                if (isLineTerminator(ch)) {
                    loc.end = {
                        line: lineNumber,
                        column: index - lineStart - 1
                    };
                    lineComment = false;
                    addComment('Line', comment, start, index - 1, loc);
                    if (ch === '\r' && source[index] === '\n') {
                        ++index;
                    }
                    ++lineNumber;
                    lineStart = index;
                    comment = '';
                } else if (index >= length) {
                    lineComment = false;
                    comment += ch;
                    loc.end = {
                        line: lineNumber,
                        column: length - lineStart
                    };
                    addComment('Line', comment, start, length, loc);
                } else {
                    comment += ch;
                }
            } else if (blockComment) {
                if (isLineTerminator(ch)) {
                    if (ch === '\r' && source[index + 1] === '\n') {
                        ++index;
                        comment += '\r\n';
                    } else {
                        comment += ch;
                    }
                    ++lineNumber;
                    ++index;
                    lineStart = index;
                    if (index >= length) {
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }
                } else {
                    ch = source[index++];
                    if (index >= length) {
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }
                    comment += ch;
                    if (ch === '*') {
                        ch = source[index];
                        if (ch === '/') {
                            comment = comment.substr(0, comment.length - 1);
                            blockComment = false;
                            ++index;
                            loc.end = {
                                line: lineNumber,
                                column: index - lineStart
                            };
                            addComment('Block', comment, start, index, loc);
                            comment = '';
                        }
                    }
                }
            } else if (ch === '/') {
                ch = source[index + 1];
                if (ch === '/') {
                    loc = {
                        start: {
                            line: lineNumber,
                            column: index - lineStart
                        }
                    };
                    start = index;
                    index += 2;
                    lineComment = true;
                    if (index >= length) {
                        loc.end = {
                            line: lineNumber,
                            column: index - lineStart
                        };
                        lineComment = false;
                        addComment('Line', comment, start, index, loc);
                    }
                } else if (ch === '*') {
                    start = index;
                    index += 2;
                    blockComment = true;
                    loc = {
                        start: {
                            line: lineNumber,
                            column: index - lineStart - 2
                        }
                    };
                    if (index >= length) {
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }
                } else {
                    break;
                }
            } else if (isWhiteSpace(ch)) {
                ++index;
            } else if (isLineTerminator(ch)) {
                ++index;
                if (ch ===  '\r' && source[index] === '\n') {
                    ++index;
                }
                ++lineNumber;
                lineStart = index;
            } else {
                break;
            }
        }
    }

    function filterCommentLocation() {
        var i, entry, comment, comments = [];

        for (i = 0; i < extra.comments.length; ++i) {
            entry = extra.comments[i];
            comment = {
                type: entry.type,
                value: entry.value
            };
            if (extra.range) {
                comment.range = entry.range;
            }
            if (extra.loc) {
                comment.loc = entry.loc;
            }
            comments.push(comment);
        }

        extra.comments = comments;
    }

    function collectToken() {
        var start, loc, token, range, value;

        skipComment();
        start = index;
        loc = {
            start: {
                line: lineNumber,
                column: index - lineStart
            }
        };

        token = extra.advance();
        loc.end = {
            line: lineNumber,
            column: index - lineStart
        };

        if (token.type !== Token.EOF) {
            range = [token.range[0], token.range[1]];
            value = sliceSource(token.range[0], token.range[1]);
            extra.tokens.push({
                type: TokenName[token.type],
                value: value,
                range: range,
                loc: loc
            });
        }

        return token;
    }

    function collectRegex() {
        var pos, loc, regex, token;

        skipComment();

        pos = index;
        loc = {
            start: {
                line: lineNumber,
                column: index - lineStart
            }
        };

        regex = extra.scanRegExp();
        loc.end = {
            line: lineNumber,
            column: index - lineStart
        };

        // Pop the previous token, which is likely '/' or '/='
        if (extra.tokens.length > 0) {
            token = extra.tokens[extra.tokens.length - 1];
            if (token.range[0] === pos && token.type === 'Punctuator') {
                if (token.value === '/' || token.value === '/=') {
                    extra.tokens.pop();
                }
            }
        }

        extra.tokens.push({
            type: 'RegularExpression',
            value: regex.literal,
            range: [pos, index],
            loc: loc
        });

        return regex;
    }

    function filterTokenLocation() {
        var i, entry, token, tokens = [];

        for (i = 0; i < extra.tokens.length; ++i) {
            entry = extra.tokens[i];
            token = {
                type: entry.type,
                value: entry.value
            };
            if (extra.range) {
                token.range = entry.range;
            }
            if (extra.loc) {
                token.loc = entry.loc;
            }
            tokens.push(token);
        }

        extra.tokens = tokens;
    }

    function createLiteral(token) {
        return {
            type: Syntax.Literal,
            value: token.value
        };
    }

    function createRawLiteral(token) {
        return {
            type: Syntax.Literal,
            value: token.value,
            raw: sliceSource(token.range[0], token.range[1])
        };
    }

    function createLocationMarker() {
        var marker = {};

        marker.range = [index, index];
        marker.loc = {
            start: {
                line: lineNumber,
                column: index - lineStart
            },
            end: {
                line: lineNumber,
                column: index - lineStart
            }
        };

        marker.end = function () {
            this.range[1] = index;
            this.loc.end.line = lineNumber;
            this.loc.end.column = index - lineStart;
        };

        marker.applyGroup = function (node) {
            if (extra.range) {
                node.groupRange = [this.range[0], this.range[1]];
            }
            if (extra.loc) {
                node.groupLoc = {
                    start: {
                        line: this.loc.start.line,
                        column: this.loc.start.column
                    },
                    end: {
                        line: this.loc.end.line,
                        column: this.loc.end.column
                    }
                };
            }
        };

        marker.apply = function (node) {
            if (extra.range) {
                node.range = [this.range[0], this.range[1]];
            }
            if (extra.loc) {
                node.loc = {
                    start: {
                        line: this.loc.start.line,
                        column: this.loc.start.column
                    },
                    end: {
                        line: this.loc.end.line,
                        column: this.loc.end.column
                    }
                };
            }
        };

        return marker;
    }

    function trackGroupExpression() {
        var marker, expr;

        skipComment();
        marker = createLocationMarker();
        expect('(');

        expr = parseExpression();

        expect(')');

        marker.end();
        marker.applyGroup(expr);

        return expr;
    }

    function trackLeftHandSideExpression() {
        var marker, expr;

        skipComment();
        marker = createLocationMarker();

        expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();

        while (match('.') || match('[')) {
            if (match('[')) {
                expr = {
                    type: Syntax.MemberExpression,
                    computed: true,
                    object: expr,
                    property: parseComputedMember()
                };
                marker.end();
                marker.apply(expr);
            } else {
                expr = {
                    type: Syntax.MemberExpression,
                    computed: false,
                    object: expr,
                    property: parseNonComputedMember()
                };
                marker.end();
                marker.apply(expr);
            }
        }

        return expr;
    }

    function trackLeftHandSideExpressionAllowCall() {
        var marker, expr;

        skipComment();
        marker = createLocationMarker();

        expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();

        while (match('.') || match('[') || match('(')) {
            if (match('(')) {
                expr = {
                    type: Syntax.CallExpression,
                    callee: expr,
                    'arguments': parseArguments()
                };
                marker.end();
                marker.apply(expr);
            } else if (match('[')) {
                expr = {
                    type: Syntax.MemberExpression,
                    computed: true,
                    object: expr,
                    property: parseComputedMember()
                };
                marker.end();
                marker.apply(expr);
            } else {
                expr = {
                    type: Syntax.MemberExpression,
                    computed: false,
                    object: expr,
                    property: parseNonComputedMember()
                };
                marker.end();
                marker.apply(expr);
            }
        }

        return expr;
    }

    function filterGroup(node) {
        var n, i, entry;

        n = (Object.prototype.toString.apply(node) === '[object Array]') ? [] : {};
        for (i in node) {
            if (node.hasOwnProperty(i) && i !== 'groupRange' && i !== 'groupLoc') {
                entry = node[i];
                if (entry === null || typeof entry !== 'object' || entry instanceof RegExp) {
                    n[i] = entry;
                } else {
                    n[i] = filterGroup(entry);
                }
            }
        }
        return n;
    }

    function wrapTrackingFunction(range, loc) {

        return function (parseFunction) {

            function isBinary(node) {
                return node.type === Syntax.LogicalExpression ||
                    node.type === Syntax.BinaryExpression;
            }

            function visit(node) {
                var start, end;

                if (isBinary(node.left)) {
                    visit(node.left);
                }
                if (isBinary(node.right)) {
                    visit(node.right);
                }

                if (range) {
                    if (node.left.groupRange || node.right.groupRange) {
                        start = node.left.groupRange ? node.left.groupRange[0] : node.left.range[0];
                        end = node.right.groupRange ? node.right.groupRange[1] : node.right.range[1];
                        node.range = [start, end];
                    } else if (typeof node.range === 'undefined') {
                        start = node.left.range[0];
                        end = node.right.range[1];
                        node.range = [start, end];
                    }
                }
                if (loc) {
                    if (node.left.groupLoc || node.right.groupLoc) {
                        start = node.left.groupLoc ? node.left.groupLoc.start : node.left.loc.start;
                        end = node.right.groupLoc ? node.right.groupLoc.end : node.right.loc.end;
                        node.loc = {
                            start: start,
                            end: end
                        };
                    } else if (typeof node.loc === 'undefined') {
                        node.loc = {
                            start: node.left.loc.start,
                            end: node.right.loc.end
                        };
                    }
                }
            }

            return function () {
                var marker, node;

                skipComment();

                marker = createLocationMarker();
                node = parseFunction.apply(null, arguments);
                marker.end();

                if (range && typeof node.range === 'undefined') {
                    marker.apply(node);
                }

                if (loc && typeof node.loc === 'undefined') {
                    marker.apply(node);
                }

                if (isBinary(node)) {
                    visit(node);
                }

                return node;
            };
        };
    }

    function patch() {

        var wrapTracking;

        if (extra.comments) {
            extra.skipComment = skipComment;
            skipComment = scanComment;
        }

        if (extra.raw) {
            extra.createLiteral = createLiteral;
            createLiteral = createRawLiteral;
        }

        if (extra.range || extra.loc) {

            extra.parseGroupExpression = parseGroupExpression;
            extra.parseLeftHandSideExpression = parseLeftHandSideExpression;
            extra.parseLeftHandSideExpressionAllowCall = parseLeftHandSideExpressionAllowCall;
            parseGroupExpression = trackGroupExpression;
            parseLeftHandSideExpression = trackLeftHandSideExpression;
            parseLeftHandSideExpressionAllowCall = trackLeftHandSideExpressionAllowCall;

            wrapTracking = wrapTrackingFunction(extra.range, extra.loc);

            extra.parseAdditiveExpression = parseAdditiveExpression;
            extra.parseAssignmentExpression = parseAssignmentExpression;
            extra.parseBitwiseANDExpression = parseBitwiseANDExpression;
            extra.parseBitwiseORExpression = parseBitwiseORExpression;
            extra.parseBitwiseXORExpression = parseBitwiseXORExpression;
            extra.parseBlock = parseBlock;
            extra.parseFunctionSourceElements = parseFunctionSourceElements;
            extra.parseCatchClause = parseCatchClause;
            extra.parseComputedMember = parseComputedMember;
            extra.parseConditionalExpression = parseConditionalExpression;
            extra.parseConstLetDeclaration = parseConstLetDeclaration;
            extra.parseEqualityExpression = parseEqualityExpression;
            extra.parseExpression = parseExpression;
            extra.parseForVariableDeclaration = parseForVariableDeclaration;
            extra.parseFunctionDeclaration = parseFunctionDeclaration;
            extra.parseFunctionExpression = parseFunctionExpression;
            extra.parseLogicalANDExpression = parseLogicalANDExpression;
            extra.parseLogicalORExpression = parseLogicalORExpression;
            extra.parseMultiplicativeExpression = parseMultiplicativeExpression;
            extra.parseNewExpression = parseNewExpression;
            extra.parseNonComputedProperty = parseNonComputedProperty;
            extra.parseObjectProperty = parseObjectProperty;
            extra.parseObjectPropertyKey = parseObjectPropertyKey;
            extra.parsePostfixExpression = parsePostfixExpression;
            extra.parsePrimaryExpression = parsePrimaryExpression;
            extra.parseProgram = parseProgram;
            extra.parsePropertyFunction = parsePropertyFunction;
            extra.parseRelationalExpression = parseRelationalExpression;
            extra.parseStatement = parseStatement;
            extra.parseShiftExpression = parseShiftExpression;
            extra.parseSwitchCase = parseSwitchCase;
            extra.parseUnaryExpression = parseUnaryExpression;
            extra.parseVariableDeclaration = parseVariableDeclaration;
            extra.parseVariableIdentifier = parseVariableIdentifier;

            parseAdditiveExpression = wrapTracking(extra.parseAdditiveExpression);
            parseAssignmentExpression = wrapTracking(extra.parseAssignmentExpression);
            parseBitwiseANDExpression = wrapTracking(extra.parseBitwiseANDExpression);
            parseBitwiseORExpression = wrapTracking(extra.parseBitwiseORExpression);
            parseBitwiseXORExpression = wrapTracking(extra.parseBitwiseXORExpression);
            parseBlock = wrapTracking(extra.parseBlock);
            parseFunctionSourceElements = wrapTracking(extra.parseFunctionSourceElements);
            parseCatchClause = wrapTracking(extra.parseCatchClause);
            parseComputedMember = wrapTracking(extra.parseComputedMember);
            parseConditionalExpression = wrapTracking(extra.parseConditionalExpression);
            parseConstLetDeclaration = wrapTracking(extra.parseConstLetDeclaration);
            parseEqualityExpression = wrapTracking(extra.parseEqualityExpression);
            parseExpression = wrapTracking(extra.parseExpression);
            parseForVariableDeclaration = wrapTracking(extra.parseForVariableDeclaration);
            parseFunctionDeclaration = wrapTracking(extra.parseFunctionDeclaration);
            parseFunctionExpression = wrapTracking(extra.parseFunctionExpression);
            parseLeftHandSideExpression = wrapTracking(parseLeftHandSideExpression);
            parseLogicalANDExpression = wrapTracking(extra.parseLogicalANDExpression);
            parseLogicalORExpression = wrapTracking(extra.parseLogicalORExpression);
            parseMultiplicativeExpression = wrapTracking(extra.parseMultiplicativeExpression);
            parseNewExpression = wrapTracking(extra.parseNewExpression);
            parseNonComputedProperty = wrapTracking(extra.parseNonComputedProperty);
            parseObjectProperty = wrapTracking(extra.parseObjectProperty);
            parseObjectPropertyKey = wrapTracking(extra.parseObjectPropertyKey);
            parsePostfixExpression = wrapTracking(extra.parsePostfixExpression);
            parsePrimaryExpression = wrapTracking(extra.parsePrimaryExpression);
            parseProgram = wrapTracking(extra.parseProgram);
            parsePropertyFunction = wrapTracking(extra.parsePropertyFunction);
            parseRelationalExpression = wrapTracking(extra.parseRelationalExpression);
            parseStatement = wrapTracking(extra.parseStatement);
            parseShiftExpression = wrapTracking(extra.parseShiftExpression);
            parseSwitchCase = wrapTracking(extra.parseSwitchCase);
            parseUnaryExpression = wrapTracking(extra.parseUnaryExpression);
            parseVariableDeclaration = wrapTracking(extra.parseVariableDeclaration);
            parseVariableIdentifier = wrapTracking(extra.parseVariableIdentifier);
        }

        if (typeof extra.tokens !== 'undefined') {
            extra.advance = advance;
            extra.scanRegExp = scanRegExp;

            advance = collectToken;
            scanRegExp = collectRegex;
        }
    }

    function unpatch() {
        if (typeof extra.skipComment === 'function') {
            skipComment = extra.skipComment;
        }

        if (extra.raw) {
            createLiteral = extra.createLiteral;
        }

        if (extra.range || extra.loc) {
            parseAdditiveExpression = extra.parseAdditiveExpression;
            parseAssignmentExpression = extra.parseAssignmentExpression;
            parseBitwiseANDExpression = extra.parseBitwiseANDExpression;
            parseBitwiseORExpression = extra.parseBitwiseORExpression;
            parseBitwiseXORExpression = extra.parseBitwiseXORExpression;
            parseBlock = extra.parseBlock;
            parseFunctionSourceElements = extra.parseFunctionSourceElements;
            parseCatchClause = extra.parseCatchClause;
            parseComputedMember = extra.parseComputedMember;
            parseConditionalExpression = extra.parseConditionalExpression;
            parseConstLetDeclaration = extra.parseConstLetDeclaration;
            parseEqualityExpression = extra.parseEqualityExpression;
            parseExpression = extra.parseExpression;
            parseForVariableDeclaration = extra.parseForVariableDeclaration;
            parseFunctionDeclaration = extra.parseFunctionDeclaration;
            parseFunctionExpression = extra.parseFunctionExpression;
            parseGroupExpression = extra.parseGroupExpression;
            parseLeftHandSideExpression = extra.parseLeftHandSideExpression;
            parseLeftHandSideExpressionAllowCall = extra.parseLeftHandSideExpressionAllowCall;
            parseLogicalANDExpression = extra.parseLogicalANDExpression;
            parseLogicalORExpression = extra.parseLogicalORExpression;
            parseMultiplicativeExpression = extra.parseMultiplicativeExpression;
            parseNewExpression = extra.parseNewExpression;
            parseNonComputedProperty = extra.parseNonComputedProperty;
            parseObjectProperty = extra.parseObjectProperty;
            parseObjectPropertyKey = extra.parseObjectPropertyKey;
            parsePrimaryExpression = extra.parsePrimaryExpression;
            parsePostfixExpression = extra.parsePostfixExpression;
            parseProgram = extra.parseProgram;
            parsePropertyFunction = extra.parsePropertyFunction;
            parseRelationalExpression = extra.parseRelationalExpression;
            parseStatement = extra.parseStatement;
            parseShiftExpression = extra.parseShiftExpression;
            parseSwitchCase = extra.parseSwitchCase;
            parseUnaryExpression = extra.parseUnaryExpression;
            parseVariableDeclaration = extra.parseVariableDeclaration;
            parseVariableIdentifier = extra.parseVariableIdentifier;
        }

        if (typeof extra.scanRegExp === 'function') {
            advance = extra.advance;
            scanRegExp = extra.scanRegExp;
        }
    }

    function stringToArray(str) {
        var length = str.length,
            result = [],
            i;
        for (i = 0; i < length; ++i) {
            result[i] = str.charAt(i);
        }
        return result;
    }

    function parse(code, options) {
        var program, toString;

        toString = String;
        if (typeof code !== 'string' && !(code instanceof String)) {
            code = toString(code);
        }

        source = code;
        index = 0;
        lineNumber = (source.length > 0) ? 1 : 0;
        lineStart = 0;
        length = source.length;
        buffer = null;
        state = {
            allowIn: true,
            labelSet: {},
            inFunctionBody: false,
            inIteration: false,
            inSwitch: false
        };

        extra = {};
        if (typeof options !== 'undefined') {
            extra.range = (typeof options.range === 'boolean') && options.range;
            extra.loc = (typeof options.loc === 'boolean') && options.loc;
            extra.raw = (typeof options.raw === 'boolean') && options.raw;
            if (typeof options.tokens === 'boolean' && options.tokens) {
                extra.tokens = [];
            }
            if (typeof options.comment === 'boolean' && options.comment) {
                extra.comments = [];
            }
            if (typeof options.tolerant === 'boolean' && options.tolerant) {
                extra.errors = [];
            }
        }

        if (length > 0) {
            if (typeof source[0] === 'undefined') {
                // Try first to convert to a string. This is good as fast path
                // for old IE which understands string indexing for string
                // literals only and not for string object.
                if (code instanceof String) {
                    source = code.valueOf();
                }

                // Force accessing the characters via an array.
                if (typeof source[0] === 'undefined') {
                    source = stringToArray(code);
                }
            }
        }

        patch();
        try {
            program = parseProgram();
            if (typeof extra.comments !== 'undefined') {
                filterCommentLocation();
                program.comments = extra.comments;
            }
            if (typeof extra.tokens !== 'undefined') {
                filterTokenLocation();
                program.tokens = extra.tokens;
            }
            if (typeof extra.errors !== 'undefined') {
                program.errors = extra.errors;
            }
            if (extra.range || extra.loc) {
                program.body = filterGroup(program.body);
            }
        } catch (e) {
            throw e;
        } finally {
            unpatch();
            extra = {};
        }

        return program;
    }

    // Sync with package.json.
    exports.version = '1.0.4';

    exports.parse = parse;

    // Deep copy.
    exports.Syntax = (function () {
        var name, types = {};

        if (typeof Object.create === 'function') {
            types = Object.create(null);
        }

        for (name in Syntax) {
            if (Syntax.hasOwnProperty(name)) {
                types[name] = Syntax[name];
            }
        }

        if (typeof Object.freeze === 'function') {
            Object.freeze(types);
        }

        return types;
    }());

}));
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],36:[function(require,module,exports){
"use strict";

var defProp = Object.defineProperty || function(obj, name, desc) {
    // Normal property assignment is the best we can do if
    // Object.defineProperty is not available.
    obj[name] = desc.value;
};

// For functions that will be invoked using .call or .apply, we need to
// define those methods on the function objects themselves, rather than
// inheriting them from Function.prototype, so that a malicious or clumsy
// third party cannot interfere with the functionality of this module by
// redefining Function.prototype.call or .apply.
function makeSafeToCall(fun) {
    defProp(fun, "call", { value: fun.call });
    defProp(fun, "apply", { value: fun.apply });
    return fun;
}

var hasOwn = makeSafeToCall(Object.prototype.hasOwnProperty);
var numToStr = makeSafeToCall(Number.prototype.toString);
var strSlice = makeSafeToCall(String.prototype.slice);

var cloner = function(){};
var create = Object.create || function(prototype, properties) {
    cloner.prototype = prototype || null;
    var obj = new cloner;

    // The properties parameter is unused by this module, but I want this
    // shim to be as complete as possible.
    if (properties)
        for (var name in properties)
            if (hasOwn.call(properties, name))
                defProp(obj, name, properties[name]);

    return obj;
};

var rand = Math.random;
var uniqueKeys = create(null);

function makeUniqueKey() {
    // Collisions are highly unlikely, but this module is in the business
    // of making guarantees rather than safe bets.
    do var uniqueKey = strSlice.call(numToStr.call(rand(), 36), 2);
    while (hasOwn.call(uniqueKeys, uniqueKey));
    return uniqueKeys[uniqueKey] = uniqueKey;
}

// External users might find this function useful, but it is not necessary
// for the typical use of this module.
defProp(exports, "makeUniqueKey", {
    value: makeUniqueKey
});

function wrap(obj, value) {
    var old = obj[value.name];
    defProp(obj, value.name, { value: value });
    return old;
}

// Object.getOwnPropertyNames is the only way to enumerate non-enumerable
// properties, so if we wrap it to ignore our secret keys, there should be
// no way (except guessing) to access those properties.
var realGetOPNs = wrap(Object, function getOwnPropertyNames(object) {
    for (var names = realGetOPNs(object),
             src = 0,
             dst = 0,
             len = names.length;
         src < len;
         ++src) {
        if (!hasOwn.call(uniqueKeys, names[src])) {
            if (src > dst) {
                names[dst] = names[src];
            }
            ++dst;
        }
    }
    names.length = dst;
    return names;
});

function defaultCreatorFn(object) {
    return create(null);
}

function makeAccessor(secretCreatorFn) {
    var brand = makeUniqueKey();
    var passkey = create(null);

    secretCreatorFn = secretCreatorFn || defaultCreatorFn;

    function register(object) {
        var secret; // Created lazily.
        defProp(object, brand, {
            value: function(key, forget) {
                // Only code that has access to the passkey can retrieve
                // (or forget) the secret object.
                if (key === passkey) {
                    return forget
                        ? secret = null
                        : secret || (secret = secretCreatorFn(object));
                }
            }
        });
    }

    function accessor(object) {
        if (!hasOwn.call(object, brand))
            register(object);
        return object[brand](passkey);
    }

    accessor.forget = function(object) {
        if (hasOwn.call(object, brand))
            object[brand](passkey, true);
    };

    return accessor;
}

defProp(exports, "makeAccessor", {
    value: makeAccessor
});

},{}],37:[function(require,module,exports){
/*
 * Copyright 2009-2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE.txt or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
exports.SourceMapGenerator = require('./source-map/source-map-generator').SourceMapGenerator;
exports.SourceMapConsumer = require('./source-map/source-map-consumer').SourceMapConsumer;
exports.SourceNode = require('./source-map/source-node').SourceNode;

},{"./source-map/source-map-consumer":42,"./source-map/source-map-generator":43,"./source-map/source-node":44}],38:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var util = require('./util');

  /**
   * A data structure which is a combination of an array and a set. Adding a new
   * member is O(1), testing for membership is O(1), and finding the index of an
   * element is O(1). Removing elements from the set is not supported. Only
   * strings are supported for membership.
   */
  function ArraySet() {
    this._array = [];
    this._set = {};
  }

  /**
   * Static method for creating ArraySet instances from an existing array.
   */
  ArraySet.fromArray = function ArraySet_fromArray(aArray, aAllowDuplicates) {
    var set = new ArraySet();
    for (var i = 0, len = aArray.length; i < len; i++) {
      set.add(aArray[i], aAllowDuplicates);
    }
    return set;
  };

  /**
   * Add the given string to this set.
   *
   * @param String aStr
   */
  ArraySet.prototype.add = function ArraySet_add(aStr, aAllowDuplicates) {
    var isDuplicate = this.has(aStr);
    var idx = this._array.length;
    if (!isDuplicate || aAllowDuplicates) {
      this._array.push(aStr);
    }
    if (!isDuplicate) {
      this._set[util.toSetString(aStr)] = idx;
    }
  };

  /**
   * Is the given string a member of this set?
   *
   * @param String aStr
   */
  ArraySet.prototype.has = function ArraySet_has(aStr) {
    return Object.prototype.hasOwnProperty.call(this._set,
                                                util.toSetString(aStr));
  };

  /**
   * What is the index of the given string in the array?
   *
   * @param String aStr
   */
  ArraySet.prototype.indexOf = function ArraySet_indexOf(aStr) {
    if (this.has(aStr)) {
      return this._set[util.toSetString(aStr)];
    }
    throw new Error('"' + aStr + '" is not in the set.');
  };

  /**
   * What is the element at the given index?
   *
   * @param Number aIdx
   */
  ArraySet.prototype.at = function ArraySet_at(aIdx) {
    if (aIdx >= 0 && aIdx < this._array.length) {
      return this._array[aIdx];
    }
    throw new Error('No element indexed by ' + aIdx);
  };

  /**
   * Returns the array representation of this set (which has the proper indices
   * indicated by indexOf). Note that this is a copy of the internal array used
   * for storing the members so that no one can mess with internal state.
   */
  ArraySet.prototype.toArray = function ArraySet_toArray() {
    return this._array.slice();
  };

  exports.ArraySet = ArraySet;

});

},{"./util":45,"amdefine":46}],39:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 *
 * Based on the Base 64 VLQ implementation in Closure Compiler:
 * https://code.google.com/p/closure-compiler/source/browse/trunk/src/com/google/debugging/sourcemap/Base64VLQ.java
 *
 * Copyright 2011 The Closure Compiler Authors. All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *  * Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above
 *    copyright notice, this list of conditions and the following
 *    disclaimer in the documentation and/or other materials provided
 *    with the distribution.
 *  * Neither the name of Google Inc. nor the names of its
 *    contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var base64 = require('./base64');

  // A single base 64 digit can contain 6 bits of data. For the base 64 variable
  // length quantities we use in the source map spec, the first bit is the sign,
  // the next four bits are the actual value, and the 6th bit is the
  // continuation bit. The continuation bit tells us whether there are more
  // digits in this value following this digit.
  //
  //   Continuation
  //   |    Sign
  //   |    |
  //   V    V
  //   101011

  var VLQ_BASE_SHIFT = 5;

  // binary: 100000
  var VLQ_BASE = 1 << VLQ_BASE_SHIFT;

  // binary: 011111
  var VLQ_BASE_MASK = VLQ_BASE - 1;

  // binary: 100000
  var VLQ_CONTINUATION_BIT = VLQ_BASE;

  /**
   * Converts from a two-complement value to a value where the sign bit is
   * is placed in the least significant bit.  For example, as decimals:
   *   1 becomes 2 (10 binary), -1 becomes 3 (11 binary)
   *   2 becomes 4 (100 binary), -2 becomes 5 (101 binary)
   */
  function toVLQSigned(aValue) {
    return aValue < 0
      ? ((-aValue) << 1) + 1
      : (aValue << 1) + 0;
  }

  /**
   * Converts to a two-complement value from a value where the sign bit is
   * is placed in the least significant bit.  For example, as decimals:
   *   2 (10 binary) becomes 1, 3 (11 binary) becomes -1
   *   4 (100 binary) becomes 2, 5 (101 binary) becomes -2
   */
  function fromVLQSigned(aValue) {
    var isNegative = (aValue & 1) === 1;
    var shifted = aValue >> 1;
    return isNegative
      ? -shifted
      : shifted;
  }

  /**
   * Returns the base 64 VLQ encoded value.
   */
  exports.encode = function base64VLQ_encode(aValue) {
    var encoded = "";
    var digit;

    var vlq = toVLQSigned(aValue);

    do {
      digit = vlq & VLQ_BASE_MASK;
      vlq >>>= VLQ_BASE_SHIFT;
      if (vlq > 0) {
        // There are still more digits in this value, so we must make sure the
        // continuation bit is marked.
        digit |= VLQ_CONTINUATION_BIT;
      }
      encoded += base64.encode(digit);
    } while (vlq > 0);

    return encoded;
  };

  /**
   * Decodes the next base 64 VLQ value from the given string and returns the
   * value and the rest of the string.
   */
  exports.decode = function base64VLQ_decode(aStr) {
    var i = 0;
    var strLen = aStr.length;
    var result = 0;
    var shift = 0;
    var continuation, digit;

    do {
      if (i >= strLen) {
        throw new Error("Expected more digits in base 64 VLQ value.");
      }
      digit = base64.decode(aStr.charAt(i++));
      continuation = !!(digit & VLQ_CONTINUATION_BIT);
      digit &= VLQ_BASE_MASK;
      result = result + (digit << shift);
      shift += VLQ_BASE_SHIFT;
    } while (continuation);

    return {
      value: fromVLQSigned(result),
      rest: aStr.slice(i)
    };
  };

});

},{"./base64":40,"amdefine":46}],40:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var charToIntMap = {};
  var intToCharMap = {};

  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    .split('')
    .forEach(function (ch, index) {
      charToIntMap[ch] = index;
      intToCharMap[index] = ch;
    });

  /**
   * Encode an integer in the range of 0 to 63 to a single base 64 digit.
   */
  exports.encode = function base64_encode(aNumber) {
    if (aNumber in intToCharMap) {
      return intToCharMap[aNumber];
    }
    throw new TypeError("Must be between 0 and 63: " + aNumber);
  };

  /**
   * Decode a single base 64 digit to an integer.
   */
  exports.decode = function base64_decode(aChar) {
    if (aChar in charToIntMap) {
      return charToIntMap[aChar];
    }
    throw new TypeError("Not a valid base 64 digit: " + aChar);
  };

});

},{"amdefine":46}],41:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  /**
   * Recursive implementation of binary search.
   *
   * @param aLow Indices here and lower do not contain the needle.
   * @param aHigh Indices here and higher do not contain the needle.
   * @param aNeedle The element being searched for.
   * @param aHaystack The non-empty array being searched.
   * @param aCompare Function which takes two elements and returns -1, 0, or 1.
   */
  function recursiveSearch(aLow, aHigh, aNeedle, aHaystack, aCompare) {
    // This function terminates when one of the following is true:
    //
    //   1. We find the exact element we are looking for.
    //
    //   2. We did not find the exact element, but we can return the next
    //      closest element that is less than that element.
    //
    //   3. We did not find the exact element, and there is no next-closest
    //      element which is less than the one we are searching for, so we
    //      return null.
    var mid = Math.floor((aHigh - aLow) / 2) + aLow;
    var cmp = aCompare(aNeedle, aHaystack[mid], true);
    if (cmp === 0) {
      // Found the element we are looking for.
      return aHaystack[mid];
    }
    else if (cmp > 0) {
      // aHaystack[mid] is greater than our needle.
      if (aHigh - mid > 1) {
        // The element is in the upper half.
        return recursiveSearch(mid, aHigh, aNeedle, aHaystack, aCompare);
      }
      // We did not find an exact match, return the next closest one
      // (termination case 2).
      return aHaystack[mid];
    }
    else {
      // aHaystack[mid] is less than our needle.
      if (mid - aLow > 1) {
        // The element is in the lower half.
        return recursiveSearch(aLow, mid, aNeedle, aHaystack, aCompare);
      }
      // The exact needle element was not found in this haystack. Determine if
      // we are in termination case (2) or (3) and return the appropriate thing.
      return aLow < 0
        ? null
        : aHaystack[aLow];
    }
  }

  /**
   * This is an implementation of binary search which will always try and return
   * the next lowest value checked if there is no exact hit. This is because
   * mappings between original and generated line/col pairs are single points,
   * and there is an implicit region between each of them, so a miss just means
   * that you aren't on the very start of a region.
   *
   * @param aNeedle The element you are looking for.
   * @param aHaystack The array that is being searched.
   * @param aCompare A function which takes the needle and an element in the
   *     array and returns -1, 0, or 1 depending on whether the needle is less
   *     than, equal to, or greater than the element, respectively.
   */
  exports.search = function search(aNeedle, aHaystack, aCompare) {
    return aHaystack.length > 0
      ? recursiveSearch(-1, aHaystack.length, aNeedle, aHaystack, aCompare)
      : null;
  };

});

},{"amdefine":46}],42:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var util = require('./util');
  var binarySearch = require('./binary-search');
  var ArraySet = require('./array-set').ArraySet;
  var base64VLQ = require('./base64-vlq');

  /**
   * A SourceMapConsumer instance represents a parsed source map which we can
   * query for information about the original file positions by giving it a file
   * position in the generated source.
   *
   * The only parameter is the raw source map (either as a JSON string, or
   * already parsed to an object). According to the spec, source maps have the
   * following attributes:
   *
   *   - version: Which version of the source map spec this map is following.
   *   - sources: An array of URLs to the original source files.
   *   - names: An array of identifiers which can be referrenced by individual mappings.
   *   - sourceRoot: Optional. The URL root from which all sources are relative.
   *   - sourcesContent: Optional. An array of contents of the original source files.
   *   - mappings: A string of base64 VLQs which contain the actual mappings.
   *   - file: The generated file this source map is associated with.
   *
   * Here is an example source map, taken from the source map spec[0]:
   *
   *     {
   *       version : 3,
   *       file: "out.js",
   *       sourceRoot : "",
   *       sources: ["foo.js", "bar.js"],
   *       names: ["src", "maps", "are", "fun"],
   *       mappings: "AA,AB;;ABCDE;"
   *     }
   *
   * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit?pli=1#
   */
  function SourceMapConsumer(aSourceMap) {
    var sourceMap = aSourceMap;
    if (typeof aSourceMap === 'string') {
      sourceMap = JSON.parse(aSourceMap.replace(/^\)\]\}'/, ''));
    }

    var version = util.getArg(sourceMap, 'version');
    var sources = util.getArg(sourceMap, 'sources');
    // Sass 3.3 leaves out the 'names' array, so we deviate from the spec (which
    // requires the array) to play nice here.
    var names = util.getArg(sourceMap, 'names', []);
    var sourceRoot = util.getArg(sourceMap, 'sourceRoot', null);
    var sourcesContent = util.getArg(sourceMap, 'sourcesContent', null);
    var mappings = util.getArg(sourceMap, 'mappings');
    var file = util.getArg(sourceMap, 'file', null);

    // Once again, Sass deviates from the spec and supplies the version as a
    // string rather than a number, so we use loose equality checking here.
    if (version != this._version) {
      throw new Error('Unsupported version: ' + version);
    }

    // Pass `true` below to allow duplicate names and sources. While source maps
    // are intended to be compressed and deduplicated, the TypeScript compiler
    // sometimes generates source maps with duplicates in them. See Github issue
    // #72 and bugzil.la/889492.
    this._names = ArraySet.fromArray(names, true);
    this._sources = ArraySet.fromArray(sources, true);

    this.sourceRoot = sourceRoot;
    this.sourcesContent = sourcesContent;
    this._mappings = mappings;
    this.file = file;
  }

  /**
   * Create a SourceMapConsumer from a SourceMapGenerator.
   *
   * @param SourceMapGenerator aSourceMap
   *        The source map that will be consumed.
   * @returns SourceMapConsumer
   */
  SourceMapConsumer.fromSourceMap =
    function SourceMapConsumer_fromSourceMap(aSourceMap) {
      var smc = Object.create(SourceMapConsumer.prototype);

      smc._names = ArraySet.fromArray(aSourceMap._names.toArray(), true);
      smc._sources = ArraySet.fromArray(aSourceMap._sources.toArray(), true);
      smc.sourceRoot = aSourceMap._sourceRoot;
      smc.sourcesContent = aSourceMap._generateSourcesContent(smc._sources.toArray(),
                                                              smc.sourceRoot);
      smc.file = aSourceMap._file;

      smc.__generatedMappings = aSourceMap._mappings.slice()
        .sort(util.compareByGeneratedPositions);
      smc.__originalMappings = aSourceMap._mappings.slice()
        .sort(util.compareByOriginalPositions);

      return smc;
    };

  /**
   * The version of the source mapping spec that we are consuming.
   */
  SourceMapConsumer.prototype._version = 3;

  /**
   * The list of original sources.
   */
  Object.defineProperty(SourceMapConsumer.prototype, 'sources', {
    get: function () {
      return this._sources.toArray().map(function (s) {
        return this.sourceRoot ? util.join(this.sourceRoot, s) : s;
      }, this);
    }
  });

  // `__generatedMappings` and `__originalMappings` are arrays that hold the
  // parsed mapping coordinates from the source map's "mappings" attribute. They
  // are lazily instantiated, accessed via the `_generatedMappings` and
  // `_originalMappings` getters respectively, and we only parse the mappings
  // and create these arrays once queried for a source location. We jump through
  // these hoops because there can be many thousands of mappings, and parsing
  // them is expensive, so we only want to do it if we must.
  //
  // Each object in the arrays is of the form:
  //
  //     {
  //       generatedLine: The line number in the generated code,
  //       generatedColumn: The column number in the generated code,
  //       source: The path to the original source file that generated this
  //               chunk of code,
  //       originalLine: The line number in the original source that
  //                     corresponds to this chunk of generated code,
  //       originalColumn: The column number in the original source that
  //                       corresponds to this chunk of generated code,
  //       name: The name of the original symbol which generated this chunk of
  //             code.
  //     }
  //
  // All properties except for `generatedLine` and `generatedColumn` can be
  // `null`.
  //
  // `_generatedMappings` is ordered by the generated positions.
  //
  // `_originalMappings` is ordered by the original positions.

  SourceMapConsumer.prototype.__generatedMappings = null;
  Object.defineProperty(SourceMapConsumer.prototype, '_generatedMappings', {
    get: function () {
      if (!this.__generatedMappings) {
        this.__generatedMappings = [];
        this.__originalMappings = [];
        this._parseMappings(this._mappings, this.sourceRoot);
      }

      return this.__generatedMappings;
    }
  });

  SourceMapConsumer.prototype.__originalMappings = null;
  Object.defineProperty(SourceMapConsumer.prototype, '_originalMappings', {
    get: function () {
      if (!this.__originalMappings) {
        this.__generatedMappings = [];
        this.__originalMappings = [];
        this._parseMappings(this._mappings, this.sourceRoot);
      }

      return this.__originalMappings;
    }
  });

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (the ordered arrays in the `this.__generatedMappings` and
   * `this.__originalMappings` properties).
   */
  SourceMapConsumer.prototype._parseMappings =
    function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
      var generatedLine = 1;
      var previousGeneratedColumn = 0;
      var previousOriginalLine = 0;
      var previousOriginalColumn = 0;
      var previousSource = 0;
      var previousName = 0;
      var mappingSeparator = /^[,;]/;
      var str = aStr;
      var mapping;
      var temp;

      while (str.length > 0) {
        if (str.charAt(0) === ';') {
          generatedLine++;
          str = str.slice(1);
          previousGeneratedColumn = 0;
        }
        else if (str.charAt(0) === ',') {
          str = str.slice(1);
        }
        else {
          mapping = {};
          mapping.generatedLine = generatedLine;

          // Generated column.
          temp = base64VLQ.decode(str);
          mapping.generatedColumn = previousGeneratedColumn + temp.value;
          previousGeneratedColumn = mapping.generatedColumn;
          str = temp.rest;

          if (str.length > 0 && !mappingSeparator.test(str.charAt(0))) {
            // Original source.
            temp = base64VLQ.decode(str);
            mapping.source = this._sources.at(previousSource + temp.value);
            previousSource += temp.value;
            str = temp.rest;
            if (str.length === 0 || mappingSeparator.test(str.charAt(0))) {
              throw new Error('Found a source, but no line and column');
            }

            // Original line.
            temp = base64VLQ.decode(str);
            mapping.originalLine = previousOriginalLine + temp.value;
            previousOriginalLine = mapping.originalLine;
            // Lines are stored 0-based
            mapping.originalLine += 1;
            str = temp.rest;
            if (str.length === 0 || mappingSeparator.test(str.charAt(0))) {
              throw new Error('Found a source and line, but no column');
            }

            // Original column.
            temp = base64VLQ.decode(str);
            mapping.originalColumn = previousOriginalColumn + temp.value;
            previousOriginalColumn = mapping.originalColumn;
            str = temp.rest;

            if (str.length > 0 && !mappingSeparator.test(str.charAt(0))) {
              // Original name.
              temp = base64VLQ.decode(str);
              mapping.name = this._names.at(previousName + temp.value);
              previousName += temp.value;
              str = temp.rest;
            }
          }

          this.__generatedMappings.push(mapping);
          if (typeof mapping.originalLine === 'number') {
            this.__originalMappings.push(mapping);
          }
        }
      }

      this.__generatedMappings.sort(util.compareByGeneratedPositions);
      this.__originalMappings.sort(util.compareByOriginalPositions);
    };

  /**
   * Find the mapping that best matches the hypothetical "needle" mapping that
   * we are searching for in the given "haystack" of mappings.
   */
  SourceMapConsumer.prototype._findMapping =
    function SourceMapConsumer_findMapping(aNeedle, aMappings, aLineName,
                                           aColumnName, aComparator) {
      // To return the position we are searching for, we must first find the
      // mapping for the given position and then return the opposite position it
      // points to. Because the mappings are sorted, we can use binary search to
      // find the best mapping.

      if (aNeedle[aLineName] <= 0) {
        throw new TypeError('Line must be greater than or equal to 1, got '
                            + aNeedle[aLineName]);
      }
      if (aNeedle[aColumnName] < 0) {
        throw new TypeError('Column must be greater than or equal to 0, got '
                            + aNeedle[aColumnName]);
      }

      return binarySearch.search(aNeedle, aMappings, aComparator);
    };

  /**
   * Returns the original source, line, and column information for the generated
   * source's line and column positions provided. The only argument is an object
   * with the following properties:
   *
   *   - line: The line number in the generated source.
   *   - column: The column number in the generated source.
   *
   * and an object is returned with the following properties:
   *
   *   - source: The original source file, or null.
   *   - line: The line number in the original source, or null.
   *   - column: The column number in the original source, or null.
   *   - name: The original identifier, or null.
   */
  SourceMapConsumer.prototype.originalPositionFor =
    function SourceMapConsumer_originalPositionFor(aArgs) {
      var needle = {
        generatedLine: util.getArg(aArgs, 'line'),
        generatedColumn: util.getArg(aArgs, 'column')
      };

      var mapping = this._findMapping(needle,
                                      this._generatedMappings,
                                      "generatedLine",
                                      "generatedColumn",
                                      util.compareByGeneratedPositions);

      if (mapping) {
        var source = util.getArg(mapping, 'source', null);
        if (source && this.sourceRoot) {
          source = util.join(this.sourceRoot, source);
        }
        return {
          source: source,
          line: util.getArg(mapping, 'originalLine', null),
          column: util.getArg(mapping, 'originalColumn', null),
          name: util.getArg(mapping, 'name', null)
        };
      }

      return {
        source: null,
        line: null,
        column: null,
        name: null
      };
    };

  /**
   * Returns the original source content. The only argument is the url of the
   * original source file. Returns null if no original source content is
   * availible.
   */
  SourceMapConsumer.prototype.sourceContentFor =
    function SourceMapConsumer_sourceContentFor(aSource) {
      if (!this.sourcesContent) {
        return null;
      }

      if (this.sourceRoot) {
        aSource = util.relative(this.sourceRoot, aSource);
      }

      if (this._sources.has(aSource)) {
        return this.sourcesContent[this._sources.indexOf(aSource)];
      }

      var url;
      if (this.sourceRoot
          && (url = util.urlParse(this.sourceRoot))) {
        // XXX: file:// URIs and absolute paths lead to unexpected behavior for
        // many users. We can help them out when they expect file:// URIs to
        // behave like it would if they were running a local HTTP server. See
        // https://bugzilla.mozilla.org/show_bug.cgi?id=885597.
        var fileUriAbsPath = aSource.replace(/^file:\/\//, "");
        if (url.scheme == "file"
            && this._sources.has(fileUriAbsPath)) {
          return this.sourcesContent[this._sources.indexOf(fileUriAbsPath)]
        }

        if ((!url.path || url.path == "/")
            && this._sources.has("/" + aSource)) {
          return this.sourcesContent[this._sources.indexOf("/" + aSource)];
        }
      }

      throw new Error('"' + aSource + '" is not in the SourceMap.');
    };

  /**
   * Returns the generated line and column information for the original source,
   * line, and column positions provided. The only argument is an object with
   * the following properties:
   *
   *   - source: The filename of the original source.
   *   - line: The line number in the original source.
   *   - column: The column number in the original source.
   *
   * and an object is returned with the following properties:
   *
   *   - line: The line number in the generated source, or null.
   *   - column: The column number in the generated source, or null.
   */
  SourceMapConsumer.prototype.generatedPositionFor =
    function SourceMapConsumer_generatedPositionFor(aArgs) {
      var needle = {
        source: util.getArg(aArgs, 'source'),
        originalLine: util.getArg(aArgs, 'line'),
        originalColumn: util.getArg(aArgs, 'column')
      };

      if (this.sourceRoot) {
        needle.source = util.relative(this.sourceRoot, needle.source);
      }

      var mapping = this._findMapping(needle,
                                      this._originalMappings,
                                      "originalLine",
                                      "originalColumn",
                                      util.compareByOriginalPositions);

      if (mapping) {
        return {
          line: util.getArg(mapping, 'generatedLine', null),
          column: util.getArg(mapping, 'generatedColumn', null)
        };
      }

      return {
        line: null,
        column: null
      };
    };

  SourceMapConsumer.GENERATED_ORDER = 1;
  SourceMapConsumer.ORIGINAL_ORDER = 2;

  /**
   * Iterate over each mapping between an original source/line/column and a
   * generated line/column in this source map.
   *
   * @param Function aCallback
   *        The function that is called with each mapping.
   * @param Object aContext
   *        Optional. If specified, this object will be the value of `this` every
   *        time that `aCallback` is called.
   * @param aOrder
   *        Either `SourceMapConsumer.GENERATED_ORDER` or
   *        `SourceMapConsumer.ORIGINAL_ORDER`. Specifies whether you want to
   *        iterate over the mappings sorted by the generated file's line/column
   *        order or the original's source/line/column order, respectively. Defaults to
   *        `SourceMapConsumer.GENERATED_ORDER`.
   */
  SourceMapConsumer.prototype.eachMapping =
    function SourceMapConsumer_eachMapping(aCallback, aContext, aOrder) {
      var context = aContext || null;
      var order = aOrder || SourceMapConsumer.GENERATED_ORDER;

      var mappings;
      switch (order) {
      case SourceMapConsumer.GENERATED_ORDER:
        mappings = this._generatedMappings;
        break;
      case SourceMapConsumer.ORIGINAL_ORDER:
        mappings = this._originalMappings;
        break;
      default:
        throw new Error("Unknown order of iteration.");
      }

      var sourceRoot = this.sourceRoot;
      mappings.map(function (mapping) {
        var source = mapping.source;
        if (source && sourceRoot) {
          source = util.join(sourceRoot, source);
        }
        return {
          source: source,
          generatedLine: mapping.generatedLine,
          generatedColumn: mapping.generatedColumn,
          originalLine: mapping.originalLine,
          originalColumn: mapping.originalColumn,
          name: mapping.name
        };
      }).forEach(aCallback, context);
    };

  exports.SourceMapConsumer = SourceMapConsumer;

});

},{"./array-set":38,"./base64-vlq":39,"./binary-search":41,"./util":45,"amdefine":46}],43:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var base64VLQ = require('./base64-vlq');
  var util = require('./util');
  var ArraySet = require('./array-set').ArraySet;

  /**
   * An instance of the SourceMapGenerator represents a source map which is
   * being built incrementally. To create a new one, you must pass an object
   * with the following properties:
   *
   *   - file: The filename of the generated source.
   *   - sourceRoot: An optional root for all URLs in this source map.
   */
  function SourceMapGenerator(aArgs) {
    this._file = util.getArg(aArgs, 'file');
    this._sourceRoot = util.getArg(aArgs, 'sourceRoot', null);
    this._sources = new ArraySet();
    this._names = new ArraySet();
    this._mappings = [];
    this._sourcesContents = null;
  }

  SourceMapGenerator.prototype._version = 3;

  /**
   * Creates a new SourceMapGenerator based on a SourceMapConsumer
   *
   * @param aSourceMapConsumer The SourceMap.
   */
  SourceMapGenerator.fromSourceMap =
    function SourceMapGenerator_fromSourceMap(aSourceMapConsumer) {
      var sourceRoot = aSourceMapConsumer.sourceRoot;
      var generator = new SourceMapGenerator({
        file: aSourceMapConsumer.file,
        sourceRoot: sourceRoot
      });
      aSourceMapConsumer.eachMapping(function (mapping) {
        var newMapping = {
          generated: {
            line: mapping.generatedLine,
            column: mapping.generatedColumn
          }
        };

        if (mapping.source) {
          newMapping.source = mapping.source;
          if (sourceRoot) {
            newMapping.source = util.relative(sourceRoot, newMapping.source);
          }

          newMapping.original = {
            line: mapping.originalLine,
            column: mapping.originalColumn
          };

          if (mapping.name) {
            newMapping.name = mapping.name;
          }
        }

        generator.addMapping(newMapping);
      });
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content) {
          generator.setSourceContent(sourceFile, content);
        }
      });
      return generator;
    };

  /**
   * Add a single mapping from original source line and column to the generated
   * source's line and column for this source map being created. The mapping
   * object should have the following properties:
   *
   *   - generated: An object with the generated line and column positions.
   *   - original: An object with the original line and column positions.
   *   - source: The original source file (relative to the sourceRoot).
   *   - name: An optional original token name for this mapping.
   */
  SourceMapGenerator.prototype.addMapping =
    function SourceMapGenerator_addMapping(aArgs) {
      var generated = util.getArg(aArgs, 'generated');
      var original = util.getArg(aArgs, 'original', null);
      var source = util.getArg(aArgs, 'source', null);
      var name = util.getArg(aArgs, 'name', null);

      this._validateMapping(generated, original, source, name);

      if (source && !this._sources.has(source)) {
        this._sources.add(source);
      }

      if (name && !this._names.has(name)) {
        this._names.add(name);
      }

      this._mappings.push({
        generatedLine: generated.line,
        generatedColumn: generated.column,
        originalLine: original != null && original.line,
        originalColumn: original != null && original.column,
        source: source,
        name: name
      });
    };

  /**
   * Set the source content for a source file.
   */
  SourceMapGenerator.prototype.setSourceContent =
    function SourceMapGenerator_setSourceContent(aSourceFile, aSourceContent) {
      var source = aSourceFile;
      if (this._sourceRoot) {
        source = util.relative(this._sourceRoot, source);
      }

      if (aSourceContent !== null) {
        // Add the source content to the _sourcesContents map.
        // Create a new _sourcesContents map if the property is null.
        if (!this._sourcesContents) {
          this._sourcesContents = {};
        }
        this._sourcesContents[util.toSetString(source)] = aSourceContent;
      } else {
        // Remove the source file from the _sourcesContents map.
        // If the _sourcesContents map is empty, set the property to null.
        delete this._sourcesContents[util.toSetString(source)];
        if (Object.keys(this._sourcesContents).length === 0) {
          this._sourcesContents = null;
        }
      }
    };

  /**
   * Applies the mappings of a sub-source-map for a specific source file to the
   * source map being generated. Each mapping to the supplied source file is
   * rewritten using the supplied source map. Note: The resolution for the
   * resulting mappings is the minimium of this map and the supplied map.
   *
   * @param aSourceMapConsumer The source map to be applied.
   * @param aSourceFile Optional. The filename of the source file.
   *        If omitted, SourceMapConsumer's file property will be used.
   */
  SourceMapGenerator.prototype.applySourceMap =
    function SourceMapGenerator_applySourceMap(aSourceMapConsumer, aSourceFile) {
      // If aSourceFile is omitted, we will use the file property of the SourceMap
      if (!aSourceFile) {
        aSourceFile = aSourceMapConsumer.file;
      }
      var sourceRoot = this._sourceRoot;
      // Make "aSourceFile" relative if an absolute Url is passed.
      if (sourceRoot) {
        aSourceFile = util.relative(sourceRoot, aSourceFile);
      }
      // Applying the SourceMap can add and remove items from the sources and
      // the names array.
      var newSources = new ArraySet();
      var newNames = new ArraySet();

      // Find mappings for the "aSourceFile"
      this._mappings.forEach(function (mapping) {
        if (mapping.source === aSourceFile && mapping.originalLine) {
          // Check if it can be mapped by the source map, then update the mapping.
          var original = aSourceMapConsumer.originalPositionFor({
            line: mapping.originalLine,
            column: mapping.originalColumn
          });
          if (original.source !== null) {
            // Copy mapping
            if (sourceRoot) {
              mapping.source = util.relative(sourceRoot, original.source);
            } else {
              mapping.source = original.source;
            }
            mapping.originalLine = original.line;
            mapping.originalColumn = original.column;
            if (original.name !== null && mapping.name !== null) {
              // Only use the identifier name if it's an identifier
              // in both SourceMaps
              mapping.name = original.name;
            }
          }
        }

        var source = mapping.source;
        if (source && !newSources.has(source)) {
          newSources.add(source);
        }

        var name = mapping.name;
        if (name && !newNames.has(name)) {
          newNames.add(name);
        }

      }, this);
      this._sources = newSources;
      this._names = newNames;

      // Copy sourcesContents of applied map.
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content) {
          if (sourceRoot) {
            sourceFile = util.relative(sourceRoot, sourceFile);
          }
          this.setSourceContent(sourceFile, content);
        }
      }, this);
    };

  /**
   * A mapping can have one of the three levels of data:
   *
   *   1. Just the generated position.
   *   2. The Generated position, original position, and original source.
   *   3. Generated and original position, original source, as well as a name
   *      token.
   *
   * To maintain consistency, we validate that any new mapping being added falls
   * in to one of these categories.
   */
  SourceMapGenerator.prototype._validateMapping =
    function SourceMapGenerator_validateMapping(aGenerated, aOriginal, aSource,
                                                aName) {
      if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
          && aGenerated.line > 0 && aGenerated.column >= 0
          && !aOriginal && !aSource && !aName) {
        // Case 1.
        return;
      }
      else if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
               && aOriginal && 'line' in aOriginal && 'column' in aOriginal
               && aGenerated.line > 0 && aGenerated.column >= 0
               && aOriginal.line > 0 && aOriginal.column >= 0
               && aSource) {
        // Cases 2 and 3.
        return;
      }
      else {
        throw new Error('Invalid mapping: ' + JSON.stringify({
          generated: aGenerated,
          source: aSource,
          original: aOriginal,
          name: aName
        }));
      }
    };

  /**
   * Serialize the accumulated mappings in to the stream of base 64 VLQs
   * specified by the source map format.
   */
  SourceMapGenerator.prototype._serializeMappings =
    function SourceMapGenerator_serializeMappings() {
      var previousGeneratedColumn = 0;
      var previousGeneratedLine = 1;
      var previousOriginalColumn = 0;
      var previousOriginalLine = 0;
      var previousName = 0;
      var previousSource = 0;
      var result = '';
      var mapping;

      // The mappings must be guaranteed to be in sorted order before we start
      // serializing them or else the generated line numbers (which are defined
      // via the ';' separators) will be all messed up. Note: it might be more
      // performant to maintain the sorting as we insert them, rather than as we
      // serialize them, but the big O is the same either way.
      this._mappings.sort(util.compareByGeneratedPositions);

      for (var i = 0, len = this._mappings.length; i < len; i++) {
        mapping = this._mappings[i];

        if (mapping.generatedLine !== previousGeneratedLine) {
          previousGeneratedColumn = 0;
          while (mapping.generatedLine !== previousGeneratedLine) {
            result += ';';
            previousGeneratedLine++;
          }
        }
        else {
          if (i > 0) {
            if (!util.compareByGeneratedPositions(mapping, this._mappings[i - 1])) {
              continue;
            }
            result += ',';
          }
        }

        result += base64VLQ.encode(mapping.generatedColumn
                                   - previousGeneratedColumn);
        previousGeneratedColumn = mapping.generatedColumn;

        if (mapping.source) {
          result += base64VLQ.encode(this._sources.indexOf(mapping.source)
                                     - previousSource);
          previousSource = this._sources.indexOf(mapping.source);

          // lines are stored 0-based in SourceMap spec version 3
          result += base64VLQ.encode(mapping.originalLine - 1
                                     - previousOriginalLine);
          previousOriginalLine = mapping.originalLine - 1;

          result += base64VLQ.encode(mapping.originalColumn
                                     - previousOriginalColumn);
          previousOriginalColumn = mapping.originalColumn;

          if (mapping.name) {
            result += base64VLQ.encode(this._names.indexOf(mapping.name)
                                       - previousName);
            previousName = this._names.indexOf(mapping.name);
          }
        }
      }

      return result;
    };

  SourceMapGenerator.prototype._generateSourcesContent =
    function SourceMapGenerator_generateSourcesContent(aSources, aSourceRoot) {
      return aSources.map(function (source) {
        if (!this._sourcesContents) {
          return null;
        }
        if (aSourceRoot) {
          source = util.relative(aSourceRoot, source);
        }
        var key = util.toSetString(source);
        return Object.prototype.hasOwnProperty.call(this._sourcesContents,
                                                    key)
          ? this._sourcesContents[key]
          : null;
      }, this);
    };

  /**
   * Externalize the source map.
   */
  SourceMapGenerator.prototype.toJSON =
    function SourceMapGenerator_toJSON() {
      var map = {
        version: this._version,
        file: this._file,
        sources: this._sources.toArray(),
        names: this._names.toArray(),
        mappings: this._serializeMappings()
      };
      if (this._sourceRoot) {
        map.sourceRoot = this._sourceRoot;
      }
      if (this._sourcesContents) {
        map.sourcesContent = this._generateSourcesContent(map.sources, map.sourceRoot);
      }

      return map;
    };

  /**
   * Render the source map being generated to a string.
   */
  SourceMapGenerator.prototype.toString =
    function SourceMapGenerator_toString() {
      return JSON.stringify(this);
    };

  exports.SourceMapGenerator = SourceMapGenerator;

});

},{"./array-set":38,"./base64-vlq":39,"./util":45,"amdefine":46}],44:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var SourceMapGenerator = require('./source-map-generator').SourceMapGenerator;
  var util = require('./util');

  /**
   * SourceNodes provide a way to abstract over interpolating/concatenating
   * snippets of generated JavaScript source code while maintaining the line and
   * column information associated with the original source code.
   *
   * @param aLine The original line number.
   * @param aColumn The original column number.
   * @param aSource The original source's filename.
   * @param aChunks Optional. An array of strings which are snippets of
   *        generated JS, or other SourceNodes.
   * @param aName The original identifier.
   */
  function SourceNode(aLine, aColumn, aSource, aChunks, aName) {
    this.children = [];
    this.sourceContents = {};
    this.line = aLine === undefined ? null : aLine;
    this.column = aColumn === undefined ? null : aColumn;
    this.source = aSource === undefined ? null : aSource;
    this.name = aName === undefined ? null : aName;
    if (aChunks != null) this.add(aChunks);
  }

  /**
   * Creates a SourceNode from generated code and a SourceMapConsumer.
   *
   * @param aGeneratedCode The generated code
   * @param aSourceMapConsumer The SourceMap for the generated code
   */
  SourceNode.fromStringWithSourceMap =
    function SourceNode_fromStringWithSourceMap(aGeneratedCode, aSourceMapConsumer) {
      // The SourceNode we want to fill with the generated code
      // and the SourceMap
      var node = new SourceNode();

      // The generated code
      // Processed fragments are removed from this array.
      var remainingLines = aGeneratedCode.split('\n');

      // We need to remember the position of "remainingLines"
      var lastGeneratedLine = 1, lastGeneratedColumn = 0;

      // The generate SourceNodes we need a code range.
      // To extract it current and last mapping is used.
      // Here we store the last mapping.
      var lastMapping = null;

      aSourceMapConsumer.eachMapping(function (mapping) {
        if (lastMapping === null) {
          // We add the generated code until the first mapping
          // to the SourceNode without any mapping.
          // Each line is added as separate string.
          while (lastGeneratedLine < mapping.generatedLine) {
            node.add(remainingLines.shift() + "\n");
            lastGeneratedLine++;
          }
          if (lastGeneratedColumn < mapping.generatedColumn) {
            var nextLine = remainingLines[0];
            node.add(nextLine.substr(0, mapping.generatedColumn));
            remainingLines[0] = nextLine.substr(mapping.generatedColumn);
            lastGeneratedColumn = mapping.generatedColumn;
          }
        } else {
          // We add the code from "lastMapping" to "mapping":
          // First check if there is a new line in between.
          if (lastGeneratedLine < mapping.generatedLine) {
            var code = "";
            // Associate full lines with "lastMapping"
            do {
              code += remainingLines.shift() + "\n";
              lastGeneratedLine++;
              lastGeneratedColumn = 0;
            } while (lastGeneratedLine < mapping.generatedLine);
            // When we reached the correct line, we add code until we
            // reach the correct column too.
            if (lastGeneratedColumn < mapping.generatedColumn) {
              var nextLine = remainingLines[0];
              code += nextLine.substr(0, mapping.generatedColumn);
              remainingLines[0] = nextLine.substr(mapping.generatedColumn);
              lastGeneratedColumn = mapping.generatedColumn;
            }
            // Create the SourceNode.
            addMappingWithCode(lastMapping, code);
          } else {
            // There is no new line in between.
            // Associate the code between "lastGeneratedColumn" and
            // "mapping.generatedColumn" with "lastMapping"
            var nextLine = remainingLines[0];
            var code = nextLine.substr(0, mapping.generatedColumn -
                                          lastGeneratedColumn);
            remainingLines[0] = nextLine.substr(mapping.generatedColumn -
                                                lastGeneratedColumn);
            lastGeneratedColumn = mapping.generatedColumn;
            addMappingWithCode(lastMapping, code);
          }
        }
        lastMapping = mapping;
      }, this);
      // We have processed all mappings.
      // Associate the remaining code in the current line with "lastMapping"
      // and add the remaining lines without any mapping
      addMappingWithCode(lastMapping, remainingLines.join("\n"));

      // Copy sourcesContent into SourceNode
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content) {
          node.setSourceContent(sourceFile, content);
        }
      });

      return node;

      function addMappingWithCode(mapping, code) {
        if (mapping === null || mapping.source === undefined) {
          node.add(code);
        } else {
          node.add(new SourceNode(mapping.originalLine,
                                  mapping.originalColumn,
                                  mapping.source,
                                  code,
                                  mapping.name));
        }
      }
    };

  /**
   * Add a chunk of generated JS to this source node.
   *
   * @param aChunk A string snippet of generated JS code, another instance of
   *        SourceNode, or an array where each member is one of those things.
   */
  SourceNode.prototype.add = function SourceNode_add(aChunk) {
    if (Array.isArray(aChunk)) {
      aChunk.forEach(function (chunk) {
        this.add(chunk);
      }, this);
    }
    else if (aChunk instanceof SourceNode || typeof aChunk === "string") {
      if (aChunk) {
        this.children.push(aChunk);
      }
    }
    else {
      throw new TypeError(
        "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
      );
    }
    return this;
  };

  /**
   * Add a chunk of generated JS to the beginning of this source node.
   *
   * @param aChunk A string snippet of generated JS code, another instance of
   *        SourceNode, or an array where each member is one of those things.
   */
  SourceNode.prototype.prepend = function SourceNode_prepend(aChunk) {
    if (Array.isArray(aChunk)) {
      for (var i = aChunk.length-1; i >= 0; i--) {
        this.prepend(aChunk[i]);
      }
    }
    else if (aChunk instanceof SourceNode || typeof aChunk === "string") {
      this.children.unshift(aChunk);
    }
    else {
      throw new TypeError(
        "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
      );
    }
    return this;
  };

  /**
   * Walk over the tree of JS snippets in this node and its children. The
   * walking function is called once for each snippet of JS and is passed that
   * snippet and the its original associated source's line/column location.
   *
   * @param aFn The traversal function.
   */
  SourceNode.prototype.walk = function SourceNode_walk(aFn) {
    var chunk;
    for (var i = 0, len = this.children.length; i < len; i++) {
      chunk = this.children[i];
      if (chunk instanceof SourceNode) {
        chunk.walk(aFn);
      }
      else {
        if (chunk !== '') {
          aFn(chunk, { source: this.source,
                       line: this.line,
                       column: this.column,
                       name: this.name });
        }
      }
    }
  };

  /**
   * Like `String.prototype.join` except for SourceNodes. Inserts `aStr` between
   * each of `this.children`.
   *
   * @param aSep The separator.
   */
  SourceNode.prototype.join = function SourceNode_join(aSep) {
    var newChildren;
    var i;
    var len = this.children.length;
    if (len > 0) {
      newChildren = [];
      for (i = 0; i < len-1; i++) {
        newChildren.push(this.children[i]);
        newChildren.push(aSep);
      }
      newChildren.push(this.children[i]);
      this.children = newChildren;
    }
    return this;
  };

  /**
   * Call String.prototype.replace on the very right-most source snippet. Useful
   * for trimming whitespace from the end of a source node, etc.
   *
   * @param aPattern The pattern to replace.
   * @param aReplacement The thing to replace the pattern with.
   */
  SourceNode.prototype.replaceRight = function SourceNode_replaceRight(aPattern, aReplacement) {
    var lastChild = this.children[this.children.length - 1];
    if (lastChild instanceof SourceNode) {
      lastChild.replaceRight(aPattern, aReplacement);
    }
    else if (typeof lastChild === 'string') {
      this.children[this.children.length - 1] = lastChild.replace(aPattern, aReplacement);
    }
    else {
      this.children.push(''.replace(aPattern, aReplacement));
    }
    return this;
  };

  /**
   * Set the source content for a source file. This will be added to the SourceMapGenerator
   * in the sourcesContent field.
   *
   * @param aSourceFile The filename of the source file
   * @param aSourceContent The content of the source file
   */
  SourceNode.prototype.setSourceContent =
    function SourceNode_setSourceContent(aSourceFile, aSourceContent) {
      this.sourceContents[util.toSetString(aSourceFile)] = aSourceContent;
    };

  /**
   * Walk over the tree of SourceNodes. The walking function is called for each
   * source file content and is passed the filename and source content.
   *
   * @param aFn The traversal function.
   */
  SourceNode.prototype.walkSourceContents =
    function SourceNode_walkSourceContents(aFn) {
      for (var i = 0, len = this.children.length; i < len; i++) {
        if (this.children[i] instanceof SourceNode) {
          this.children[i].walkSourceContents(aFn);
        }
      }

      var sources = Object.keys(this.sourceContents);
      for (var i = 0, len = sources.length; i < len; i++) {
        aFn(util.fromSetString(sources[i]), this.sourceContents[sources[i]]);
      }
    };

  /**
   * Return the string representation of this source node. Walks over the tree
   * and concatenates all the various snippets together to one string.
   */
  SourceNode.prototype.toString = function SourceNode_toString() {
    var str = "";
    this.walk(function (chunk) {
      str += chunk;
    });
    return str;
  };

  /**
   * Returns the string representation of this source node along with a source
   * map.
   */
  SourceNode.prototype.toStringWithSourceMap = function SourceNode_toStringWithSourceMap(aArgs) {
    var generated = {
      code: "",
      line: 1,
      column: 0
    };
    var map = new SourceMapGenerator(aArgs);
    var sourceMappingActive = false;
    var lastOriginalSource = null;
    var lastOriginalLine = null;
    var lastOriginalColumn = null;
    var lastOriginalName = null;
    this.walk(function (chunk, original) {
      generated.code += chunk;
      if (original.source !== null
          && original.line !== null
          && original.column !== null) {
        if(lastOriginalSource !== original.source
           || lastOriginalLine !== original.line
           || lastOriginalColumn !== original.column
           || lastOriginalName !== original.name) {
          map.addMapping({
            source: original.source,
            original: {
              line: original.line,
              column: original.column
            },
            generated: {
              line: generated.line,
              column: generated.column
            },
            name: original.name
          });
        }
        lastOriginalSource = original.source;
        lastOriginalLine = original.line;
        lastOriginalColumn = original.column;
        lastOriginalName = original.name;
        sourceMappingActive = true;
      } else if (sourceMappingActive) {
        map.addMapping({
          generated: {
            line: generated.line,
            column: generated.column
          }
        });
        lastOriginalSource = null;
        sourceMappingActive = false;
      }
      chunk.split('').forEach(function (ch) {
        if (ch === '\n') {
          generated.line++;
          generated.column = 0;
        } else {
          generated.column++;
        }
      });
    });
    this.walkSourceContents(function (sourceFile, sourceContent) {
      map.setSourceContent(sourceFile, sourceContent);
    });

    return { code: generated.code, map: map };
  };

  exports.SourceNode = SourceNode;

});

},{"./source-map-generator":43,"./util":45,"amdefine":46}],45:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  /**
   * This is a helper function for getting values from parameter/options
   * objects.
   *
   * @param args The object we are extracting values from
   * @param name The name of the property we are getting.
   * @param defaultValue An optional value to return if the property is missing
   * from the object. If this is not specified and the property is missing, an
   * error will be thrown.
   */
  function getArg(aArgs, aName, aDefaultValue) {
    if (aName in aArgs) {
      return aArgs[aName];
    } else if (arguments.length === 3) {
      return aDefaultValue;
    } else {
      throw new Error('"' + aName + '" is a required argument.');
    }
  }
  exports.getArg = getArg;

  var urlRegexp = /([\w+\-.]+):\/\/((\w+:\w+)@)?([\w.]+)?(:(\d+))?(\S+)?/;
  var dataUrlRegexp = /^data:.+\,.+/;

  function urlParse(aUrl) {
    var match = aUrl.match(urlRegexp);
    if (!match) {
      return null;
    }
    return {
      scheme: match[1],
      auth: match[3],
      host: match[4],
      port: match[6],
      path: match[7]
    };
  }
  exports.urlParse = urlParse;

  function urlGenerate(aParsedUrl) {
    var url = aParsedUrl.scheme + "://";
    if (aParsedUrl.auth) {
      url += aParsedUrl.auth + "@"
    }
    if (aParsedUrl.host) {
      url += aParsedUrl.host;
    }
    if (aParsedUrl.port) {
      url += ":" + aParsedUrl.port
    }
    if (aParsedUrl.path) {
      url += aParsedUrl.path;
    }
    return url;
  }
  exports.urlGenerate = urlGenerate;

  function join(aRoot, aPath) {
    var url;

    if (aPath.match(urlRegexp) || aPath.match(dataUrlRegexp)) {
      return aPath;
    }

    if (aPath.charAt(0) === '/' && (url = urlParse(aRoot))) {
      url.path = aPath;
      return urlGenerate(url);
    }

    return aRoot.replace(/\/$/, '') + '/' + aPath;
  }
  exports.join = join;

  /**
   * Because behavior goes wacky when you set `__proto__` on objects, we
   * have to prefix all the strings in our set with an arbitrary character.
   *
   * See https://github.com/mozilla/source-map/pull/31 and
   * https://github.com/mozilla/source-map/issues/30
   *
   * @param String aStr
   */
  function toSetString(aStr) {
    return '$' + aStr;
  }
  exports.toSetString = toSetString;

  function fromSetString(aStr) {
    return aStr.substr(1);
  }
  exports.fromSetString = fromSetString;

  function relative(aRoot, aPath) {
    aRoot = aRoot.replace(/\/$/, '');

    var url = urlParse(aRoot);
    if (aPath.charAt(0) == "/" && url && url.path == "/") {
      return aPath.slice(1);
    }

    return aPath.indexOf(aRoot + '/') === 0
      ? aPath.substr(aRoot.length + 1)
      : aPath;
  }
  exports.relative = relative;

  function strcmp(aStr1, aStr2) {
    var s1 = aStr1 || "";
    var s2 = aStr2 || "";
    return (s1 > s2) - (s1 < s2);
  }

  /**
   * Comparator between two mappings where the original positions are compared.
   *
   * Optionally pass in `true` as `onlyCompareGenerated` to consider two
   * mappings with the same original source/line/column, but different generated
   * line and column the same. Useful when searching for a mapping with a
   * stubbed out mapping.
   */
  function compareByOriginalPositions(mappingA, mappingB, onlyCompareOriginal) {
    var cmp;

    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp || onlyCompareOriginal) {
      return cmp;
    }

    cmp = strcmp(mappingA.name, mappingB.name);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp) {
      return cmp;
    }

    return mappingA.generatedColumn - mappingB.generatedColumn;
  };
  exports.compareByOriginalPositions = compareByOriginalPositions;

  /**
   * Comparator between two mappings where the generated positions are
   * compared.
   *
   * Optionally pass in `true` as `onlyCompareGenerated` to consider two
   * mappings with the same generated line and column, but different
   * source/name/original line and column the same. Useful when searching for a
   * mapping with a stubbed out mapping.
   */
  function compareByGeneratedPositions(mappingA, mappingB, onlyCompareGenerated) {
    var cmp;

    cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp || onlyCompareGenerated) {
      return cmp;
    }

    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp) {
      return cmp;
    }

    return strcmp(mappingA.name, mappingB.name);
  };
  exports.compareByGeneratedPositions = compareByGeneratedPositions;

});

},{"amdefine":46}],46:[function(require,module,exports){
var process=require("__browserify_process"),__filename="/node_modules/recast/node_modules/source-map/node_modules/amdefine/amdefine.js";/** vim: et:ts=4:sw=4:sts=4
 * @license amdefine 0.1.0 Copyright (c) 2011, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/amdefine for details
 */

/*jslint node: true */
/*global module, process */
'use strict';

/**
 * Creates a define for node.
 * @param {Object} module the "module" object that is defined by Node for the
 * current module.
 * @param {Function} [requireFn]. Node's require function for the current module.
 * It only needs to be passed in Node versions before 0.5, when module.require
 * did not exist.
 * @returns {Function} a define function that is usable for the current node
 * module.
 */
function amdefine(module, requireFn) {
    'use strict';
    var defineCache = {},
        loaderCache = {},
        alreadyCalled = false,
        path = require('path'),
        makeRequire, stringRequire;

    /**
     * Trims the . and .. from an array of path segments.
     * It will keep a leading path segment if a .. will become
     * the first path segment, to help with module name lookups,
     * which act like paths, but can be remapped. But the end result,
     * all paths that use this function should look normalized.
     * NOTE: this method MODIFIES the input array.
     * @param {Array} ary the array of path segments.
     */
    function trimDots(ary) {
        var i, part;
        for (i = 0; ary[i]; i+= 1) {
            part = ary[i];
            if (part === '.') {
                ary.splice(i, 1);
                i -= 1;
            } else if (part === '..') {
                if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                    //End of the line. Keep at least one non-dot
                    //path segment at the front so it can be mapped
                    //correctly to disk. Otherwise, there is likely
                    //no path mapping for a path starting with '..'.
                    //This can still fail, but catches the most reasonable
                    //uses of ..
                    break;
                } else if (i > 0) {
                    ary.splice(i - 1, 2);
                    i -= 2;
                }
            }
        }
    }

    function normalize(name, baseName) {
        var baseParts;

        //Adjust any relative paths.
        if (name && name.charAt(0) === '.') {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                baseParts = baseName.split('/');
                baseParts = baseParts.slice(0, baseParts.length - 1);
                baseParts = baseParts.concat(name.split('/'));
                trimDots(baseParts);
                name = baseParts.join('/');
            }
        }

        return name;
    }

    /**
     * Create the normalize() function passed to a loader plugin's
     * normalize method.
     */
    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(id) {
        function load(value) {
            loaderCache[id] = value;
        }

        load.fromText = function (id, text) {
            //This one is difficult because the text can/probably uses
            //define, and any relative paths and requires should be relative
            //to that id was it would be found on disk. But this would require
            //bootstrapping a module/require fairly deeply from node core.
            //Not sure how best to go about that yet.
            throw new Error('amdefine does not implement load.fromText');
        };

        return load;
    }

    makeRequire = function (systemRequire, exports, module, relId) {
        function amdRequire(deps, callback) {
            if (typeof deps === 'string') {
                //Synchronous, single module require('')
                return stringRequire(systemRequire, exports, module, deps, relId);
            } else {
                //Array of dependencies with a callback.

                //Convert the dependencies to modules.
                deps = deps.map(function (depName) {
                    return stringRequire(systemRequire, exports, module, depName, relId);
                });

                //Wait for next tick to call back the require call.
                process.nextTick(function () {
                    callback.apply(null, deps);
                });
            }
        }

        amdRequire.toUrl = function (filePath) {
            if (filePath.indexOf('.') === 0) {
                return normalize(filePath, path.dirname(module.filename));
            } else {
                return filePath;
            }
        };

        return amdRequire;
    };

    //Favor explicit value, passed in if the module wants to support Node 0.4.
    requireFn = requireFn || function req() {
        return module.require.apply(module, arguments);
    };

    function runFactory(id, deps, factory) {
        var r, e, m, result;

        if (id) {
            e = loaderCache[id] = {};
            m = {
                id: id,
                uri: __filename,
                exports: e
            };
            r = makeRequire(requireFn, e, m, id);
        } else {
            //Only support one define call per file
            if (alreadyCalled) {
                throw new Error('amdefine with no module ID cannot be called more than once per file.');
            }
            alreadyCalled = true;

            //Use the real variables from node
            //Use module.exports for exports, since
            //the exports in here is amdefine exports.
            e = module.exports;
            m = module;
            r = makeRequire(requireFn, e, m, module.id);
        }

        //If there are dependencies, they are strings, so need
        //to convert them to dependency values.
        if (deps) {
            deps = deps.map(function (depName) {
                return r(depName);
            });
        }

        //Call the factory with the right dependencies.
        if (typeof factory === 'function') {
            result = factory.apply(m.exports, deps);
        } else {
            result = factory;
        }

        if (result !== undefined) {
            m.exports = result;
            if (id) {
                loaderCache[id] = m.exports;
            }
        }
    }

    stringRequire = function (systemRequire, exports, module, id, relId) {
        //Split the ID by a ! so that
        var index = id.indexOf('!'),
            originalId = id,
            prefix, plugin;

        if (index === -1) {
            id = normalize(id, relId);

            //Straight module lookup. If it is one of the special dependencies,
            //deal with it, otherwise, delegate to node.
            if (id === 'require') {
                return makeRequire(systemRequire, exports, module, relId);
            } else if (id === 'exports') {
                return exports;
            } else if (id === 'module') {
                return module;
            } else if (loaderCache.hasOwnProperty(id)) {
                return loaderCache[id];
            } else if (defineCache[id]) {
                runFactory.apply(null, defineCache[id]);
                return loaderCache[id];
            } else {
                if(systemRequire) {
                    return systemRequire(originalId);
                } else {
                    throw new Error('No module with ID: ' + id);
                }
            }
        } else {
            //There is a plugin in play.
            prefix = id.substring(0, index);
            id = id.substring(index + 1, id.length);

            plugin = stringRequire(systemRequire, exports, module, prefix, relId);

            if (plugin.normalize) {
                id = plugin.normalize(id, makeNormalize(relId));
            } else {
                //Normalize the ID normally.
                id = normalize(id, relId);
            }

            if (loaderCache[id]) {
                return loaderCache[id];
            } else {
                plugin.load(id, makeRequire(systemRequire, exports, module, relId), makeLoad(id), {});

                return loaderCache[id];
            }
        }
    };

    //Create a define function specific to the module asking for amdefine.
    function define(id, deps, factory) {
        if (Array.isArray(id)) {
            factory = deps;
            deps = id;
            id = undefined;
        } else if (typeof id !== 'string') {
            factory = id;
            id = deps = undefined;
        }

        if (deps && !Array.isArray(deps)) {
            factory = deps;
            deps = undefined;
        }

        if (!deps) {
            deps = ['require', 'exports', 'module'];
        }

        //Set up properties for this module. If an ID, then use
        //internal cache. If no ID, then use the external variables
        //for this node module.
        if (id) {
            //Put the module in deep freeze until there is a
            //require call for it.
            defineCache[id] = [id, deps, factory];
        } else {
            runFactory(id, deps, factory);
        }
    }

    //define.require, which has access to all the values in the
    //cache. Useful for AMD modules that all have IDs in the file,
    //but need to finally export a value to node based on one of those
    //IDs.
    define.require = function (id) {
        if (loaderCache[id]) {
            return loaderCache[id];
        }

        if (defineCache[id]) {
            runFactory.apply(null, defineCache[id]);
            return loaderCache[id];
        }
    };

    define.amd = {};

    return define;
}

module.exports = amdefine;

},{"__browserify_process":74,"path":75}],47:[function(require,module,exports){
/**
 * Copyright (c) 2013, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * https://raw.github.com/facebook/regenerator/master/LICENSE file. An
 * additional grant of patent rights can be found in the PATENTS file in
 * the same directory.
 */

var assert = require("assert");
var types = require("ast-types");
var isArray = types.builtInTypes.array;
var b = types.builders;
var n = types.namedTypes;
var leap = require("./leap");
var meta = require("./meta");
var hasOwn = Object.prototype.hasOwnProperty;

function Emitter(contextId) {
  assert.ok(this instanceof Emitter);
  n.Identifier.assert(contextId);

  Object.defineProperties(this, {
    // In order to make sure the context object does not collide with
    // anything in the local scope, we might have to rename it, so we
    // refer to it symbolically instead of just assuming that it will be
    // called "context".
    contextId: { value: contextId },

    // An append-only list of Statements that grows each time this.emit is
    // called.
    listing: { value: [] },

    // A sparse array whose keys correspond to locations in this.listing
    // that have been marked as branch/jump targets.
    marked: { value: [true] },

    // The last location will be marked when this.getDispatchLoop is
    // called.
    finalLoc: { value: loc() }
  });

  // The .leapManager property needs to be defined by a separate
  // defineProperties call so that .finalLoc will be visible to the
  // leap.LeapManager constructor.
  Object.defineProperties(this, {
    // Each time we evaluate the body of a loop, we tell this.leapManager
    // to enter a nested loop context that determines the meaning of break
    // and continue statements therein.
    leapManager: { value: new leap.LeapManager(this) }
  });
}

var Ep = Emitter.prototype;
exports.Emitter = Emitter;

// Offsets into this.listing that could be used as targets for branches or
// jumps are represented as numeric Literal nodes. This representation has
// the amazingly convenient benefit of allowing the exact value of the
// location to be determined at any time, even after generating code that
// refers to the location.
function loc() {
  return b.literal(-1);
}

// Sets the exact value of the given location to the offset of the next
// Statement emitted.
Ep.mark = function(loc) {
  n.Literal.assert(loc);
  var index = this.listing.length;
  loc.value = index;
  this.marked[index] = true;
  return loc;
};

Ep.emit = function(node) {
  if (n.Expression.check(node))
    node = b.expressionStatement(node);
  n.Statement.assert(node);
  this.listing.push(node);
};

// Shorthand for emitting assignment statements. This will come in handy
// for assignments to temporary variables.
Ep.emitAssign = function(lhs, rhs) {
  this.emit(this.assign(lhs, rhs));
  return lhs;
};

// Shorthand for an assignment statement.
Ep.assign = function(lhs, rhs) {
  return b.expressionStatement(
    b.assignmentExpression("=", lhs, rhs));
};

// Convenience function for generating expressions like context.next,
// context.sent, and context.rval.
Ep.contextProperty = function(name) {
  return b.memberExpression(
    this.contextId,
    b.identifier(name),
    false
  );
};

var volatileContextPropertyNames = {
  next: true,
  sent: true,
  rval: true,
  thrown: true
};

// A "volatile" context property is a MemberExpression like context.sent
// that should probably be stored in a temporary variable when there's a
// possibility the property will get overwritten.
Ep.isVolatileContextProperty = function(expr) {
  if (n.MemberExpression.check(expr)) {
    if (expr.computed) {
      // If it's a computed property such as context[couldBeAnything],
      // assume the worst in terms of volatility.
      return true;
    }

    if (n.Identifier.check(expr.object) &&
        n.Identifier.check(expr.property) &&
        expr.object.name === this.contextId.name &&
        hasOwn.call(volatileContextPropertyNames,
                    expr.property.name)) {
      return true;
    }
  }

  return false;
};

// Shorthand for setting context.rval and jumping to `context.stop()`.
Ep.stop = function(rval) {
  if (rval) {
    this.setReturnValue(rval);
  }

  this.jump(this.finalLoc);
};

Ep.setReturnValue = function(valuePath) {
  n.Expression.assert(valuePath.value);

  this.emitAssign(
    this.contextProperty("rval"),
    this.explodeExpression(valuePath)
  );
};

Ep.clearPendingException = function(assignee) {
  var cp = this.contextProperty("thrown");

  if (assignee) {
    this.emitAssign(assignee, cp);
  }

  this.emit(b.unaryExpression("delete", cp));
};

// Emits code for an unconditional jump to the given location, even if the
// exact value of the location is not yet known.
Ep.jump = function(toLoc) {
  this.emitAssign(this.contextProperty("next"), toLoc);
  this.emit(b.breakStatement());
};

// Conditional jump.
Ep.jumpIf = function(test, toLoc) {
  n.Expression.assert(test);
  n.Literal.assert(toLoc);

  this.emit(b.ifStatement(
    test,
    b.blockStatement([
      this.assign(this.contextProperty("next"), toLoc),
      b.breakStatement()
    ])
  ));
};

// Conditional jump, with the condition negated.
Ep.jumpIfNot = function(test, toLoc) {
  n.Expression.assert(test);
  n.Literal.assert(toLoc);

  this.emit(b.ifStatement(
    b.unaryExpression("!", test),
    b.blockStatement([
      this.assign(this.contextProperty("next"), toLoc),
      b.breakStatement()
    ])
  ));
};

// Returns a unique MemberExpression that can be used to store and
// retrieve temporary values. Since the object of the member expression is
// the context object, which is presumed to coexist peacefully with all
// other local variables, and since we just increment `nextTempId`
// monotonically, uniqueness is assured.
var nextTempId = 0;
Ep.makeTempVar = function() {
  return this.contextProperty("t" + nextTempId++);
};

Ep.getContextFunction = function(id) {
  return b.functionExpression(
    id || null/*Anonymous*/,
    [this.contextId],
    b.blockStatement([this.getDispatchLoop()]),
    false, // Not a generator anymore!
    false // Nor an expression.
  );
};

// Turns this.listing into a loop of the form
//
//   while (1) switch (context.next) {
//   case 0:
//   ...
//   case n:
//     return context.stop();
//   }
//
// Each marked location in this.listing will correspond to one generated
// case statement.
Ep.getDispatchLoop = function() {
  var self = this;
  var cases = [];
  var current;

  // If we encounter a break, continue, or return statement in a switch
  // case, we can skip the rest of the statements until the next case.
  var alreadyEnded = false;

  self.listing.forEach(function(stmt, i) {
    if (self.marked.hasOwnProperty(i)) {
      cases.push(b.switchCase(
        b.literal(i),
        current = []));
      alreadyEnded = false;
    }

    if (!alreadyEnded) {
      current.push(stmt);
      if (isSwitchCaseEnder(stmt))
        alreadyEnded = true;
    }
  });

  // Now that we know how many statements there will be in this.listing,
  // we can finally resolve this.finalLoc.value.
  this.finalLoc.value = this.listing.length;

  cases.push(
    b.switchCase(this.finalLoc, [
      // Intentionally fall through to the "end" case...
    ]),

    // So that the runtime can jump to the final location without having
    // to know its offset, we provide the "end" case as a synonym.
    b.switchCase(b.literal("end"), [
      // This will check/clear both context.thrown and context.rval.
      b.returnStatement(
        b.callExpression(this.contextProperty("stop"), [])
      )
    ])
  );

  return b.whileStatement(
    b.literal(1),
    b.switchStatement(this.contextProperty("next"), cases)
  );
};

// See comment above re: alreadyEnded.
function isSwitchCaseEnder(stmt) {
  return n.BreakStatement.check(stmt)
      || n.ContinueStatement.check(stmt)
      || n.ReturnStatement.check(stmt)
      || n.ThrowStatement.check(stmt);
}

// All side effects must be realized in order.

// If any subexpression harbors a leap, all subexpressions must be
// neutered of side effects.

// No destructive modification of AST nodes.

Ep.explode = function(path, ignoreResult) {
  assert.ok(path instanceof types.NodePath);

  var node = path.value;
  var self = this;

  n.Node.assert(node);

  if (n.Statement.check(node))
    return self.explodeStatement(path);

  if (n.Expression.check(node))
    return self.explodeExpression(path, ignoreResult);

  if (n.Declaration.check(node))
    throw getDeclError(node);

  switch (node.type) {
  case "Program":
    return path.get("body").map(
      self.explodeStatement,
      self
    );

  case "VariableDeclarator":
    throw getDeclError(node);

  // These node types should be handled by their parent nodes
  // (ObjectExpression, SwitchStatement, and TryStatement, respectively).
  case "Property":
  case "SwitchCase":
  case "CatchClause":
    throw new Error(
      node.type + " nodes should be handled by their parents");

  default:
    throw new Error(
      "unknown Node of type " +
        JSON.stringify(node.type));
  }
};

function getDeclError(node) {
  return new Error(
    "all declarations should have been transformed into " +
    "assignments before the Exploder began its work: " +
    JSON.stringify(node));
}

Ep.explodeStatement = function(path, labelId) {
  assert.ok(path instanceof types.NodePath);

  var stmt = path.value;
  var self = this;

  n.Statement.assert(stmt);

  if (labelId) {
    n.Identifier.assert(labelId);
  } else {
    labelId = null;
  }

  // Explode BlockStatement nodes even if they do not contain a yield,
  // because we don't want or need the curly braces.
  if (n.BlockStatement.check(stmt)) {
    return path.get("body").each(
      self.explodeStatement,
      self
    );
  }

  if (!meta.containsLeap(stmt)) {
    // Technically we should be able to avoid emitting the statement
    // altogether if !meta.hasSideEffects(stmt), but that leads to
    // confusing generated code (for instance, `while (true) {}` just
    // disappears) and is probably a more appropriate job for a dedicated
    // dead code elimination pass.
    self.emit(stmt);
    return;
  }

  switch (stmt.type) {
  case "ExpressionStatement":
    self.explodeExpression(path.get("expression"), true);
    break;

  case "LabeledStatement":
    self.explodeStatement(path.get("body"), stmt.label);
    break;

  case "WhileStatement":
    var before = loc();
    var after = loc();

    self.mark(before);
    self.jumpIfNot(self.explodeExpression(path.get("test")), after);
    self.leapManager.withEntry(
      new leap.LoopEntry(after, before, labelId),
      function() { self.explodeStatement(path.get("body")); }
    );
    self.jump(before);
    self.mark(after);

    break;

  case "DoWhileStatement":
    var first = loc();
    var test = loc();
    var after = loc();

    self.mark(first);
    self.leapManager.withEntry(
      new leap.LoopEntry(after, test, labelId),
      function() { self.explode(path.get("body")); }
    );
    self.mark(test);
    self.jumpIf(self.explodeExpression(path.get("test")), first);
    self.mark(after);

    break;

  case "ForStatement":
    var head = loc();
    var update = loc();
    var after = loc();

    if (stmt.init) {
      // We pass true here to indicate that if stmt.init is an expression
      // then we do not care about its result.
      self.explode(path.get("init"), true);
    }

    self.mark(head);

    if (stmt.test) {
      self.jumpIfNot(self.explodeExpression(path.get("test")), after);
    } else {
      // No test means continue unconditionally.
    }

    self.leapManager.withEntry(
      new leap.LoopEntry(after, update, labelId),
      function() { self.explodeStatement(path.get("body")); }
    );

    self.mark(update);

    if (stmt.update) {
      // We pass true here to indicate that if stmt.update is an
      // expression then we do not care about its result.
      self.explode(path.get("update"), true);
    }

    self.jump(head);

    self.mark(after);

    break;

  case "ForInStatement":
    n.Identifier.assert(stmt.left);

    var head = loc();
    var after = loc();

    var keysPath = new types.NodePath(b.callExpression(
      self.contextProperty("keys"),
      [stmt.right]
    ), path, "right");

    var keys = self.emitAssign(
      self.makeTempVar(),
      self.explodeExpression(keysPath)
    );

    self.mark(head);

    self.jumpIfNot(
      b.memberExpression(
        keys,
        b.identifier("length"),
        false
      ),
      after
    );

    self.emitAssign(
      stmt.left,
      b.callExpression(
        b.memberExpression(
          keys,
          b.identifier("pop"),
          false
        ),
        []
      )
    );

    self.leapManager.withEntry(
      new leap.LoopEntry(after, head, labelId),
      function() { self.explodeStatement(path.get("body")); }
    );

    self.jump(head);

    self.mark(after);

    break;

  case "BreakStatement":
    self.leapManager.emitBreak(stmt.label);
    break;

  case "ContinueStatement":
    self.leapManager.emitContinue(stmt.label);
    break;

  case "SwitchStatement":
    // Always save the discriminant into a temporary variable in case the
    // test expressions overwrite values like context.sent.
    var disc = self.emitAssign(
      self.makeTempVar(),
      self.explodeExpression(path.get("discriminant"))
    );

    var after = loc();
    var defaultLoc = loc();
    var condition = defaultLoc;
    var caseLocs = [];

    // If there are no cases, .cases might be undefined.
    var cases = stmt.cases || [];

    for (var i = cases.length - 1; i >= 0; --i) {
      var c = cases[i];
      n.SwitchCase.assert(c);

      if (c.test) {
        condition = b.conditionalExpression(
          b.binaryExpression("===", disc, c.test),
          caseLocs[i] = loc(),
          condition
        );
      } else {
        caseLocs[i] = defaultLoc;
      }
    }

    self.jump(self.explodeExpression(
      new types.NodePath(condition, path, "discriminant")
    ));

    self.leapManager.withEntry(
      new leap.SwitchEntry(after),
      function() {
        path.get("cases").each(function(casePath) {
          var c = casePath.value;
          var i = casePath.name;

          self.mark(caseLocs[i]);

          casePath.get("consequent").each(
            self.explodeStatement,
            self
          );
        });
      }
    );

    self.mark(after);
    if (defaultLoc.value === -1) {
      self.mark(defaultLoc);
      assert.strictEqual(after.value, defaultLoc.value);
    }

    break;

  case "IfStatement":
    var elseLoc = stmt.alternate && loc();
    var after = loc();

    self.jumpIfNot(
      self.explodeExpression(path.get("test")),
      elseLoc || after
    );

    self.explodeStatement(path.get("consequent"));

    if (elseLoc) {
      self.jump(after);
      self.mark(elseLoc);
      self.explodeStatement(path.get("alternate"));
    }

    self.mark(after);

    break;

  case "ReturnStatement":
    self.leapManager.emitReturn(path.get("argument"));
    break;

  case "WithStatement":
    throw new Error(
      node.type + " not supported in generator functions.");

  case "TryStatement":
    var after = loc();

    var handler = stmt.handler;
    if (!handler && stmt.handlers) {
      handler = stmt.handlers[0] || null;
    }

    var catchLoc = handler && loc();
    var catchEntry = catchLoc && new leap.CatchEntry(
      catchLoc,
      handler.param
    );

    var finallyLoc = stmt.finalizer && loc();
    var finallyEntry = finallyLoc && new leap.FinallyEntry(
      finallyLoc,
      self.makeTempVar()
    );

    if (finallyEntry) {
      // Finally blocks examine their .nextLocTempVar property to figure
      // out where to jump next, so we must set that property to the
      // fall-through location, by default.
      self.emitAssign(finallyEntry.nextLocTempVar, after);
    }

    var tryEntry = new leap.TryEntry(catchEntry, finallyEntry);

    // Push information about this try statement so that the runtime can
    // figure out what to do if it gets an uncaught exception.
    self.pushTry(tryEntry);

    self.leapManager.withEntry(tryEntry, function() {
      self.explodeStatement(path.get("block"));

      if (catchLoc) {
        // If execution leaves the try block normally, the associated
        // catch block no longer applies.
        self.popCatch(catchEntry);

        if (finallyLoc) {
          // If we have both a catch block and a finally block, then
          // because we emit the catch block first, we need to jump over
          // it to the finally block.
          self.jump(finallyLoc);

        } else {
          // If there is no finally block, then we need to jump over the
          // catch block to the fall-through location.
          self.jump(after);
        }

        self.mark(catchLoc);

        // On entering a catch block, we must not have exited the
        // associated try block normally, so we won't have called
        // context.popCatch yet.  Call it here instead.
        self.popCatch(catchEntry);

        var bodyPath = path.get("handler", "body");
        var safeParam = self.makeTempVar();
        self.clearPendingException(safeParam);

        var catchScope = bodyPath.scope;
        var catchParamName = handler.param.name;
        n.CatchClause.assert(catchScope.node);
        assert.strictEqual(catchScope.lookup(catchParamName), catchScope);

        types.traverse(bodyPath, function(node) {
          if (n.Identifier.check(node) &&
              node.name === catchParamName &&
              this.scope.lookup(catchParamName) === catchScope) {
            this.replace(safeParam);
            return false;
          }
        });

        self.leapManager.withEntry(catchEntry, function() {
          self.explodeStatement(bodyPath);
        });
      }

      if (finallyLoc) {
        self.mark(finallyLoc);

        self.popFinally(finallyEntry);

        self.leapManager.withEntry(finallyEntry, function() {
          self.explodeStatement(path.get("finalizer"));
        });

        self.jump(finallyEntry.nextLocTempVar);
      }
    });

    self.mark(after);

    break;

  case "ThrowStatement":
    self.emit(b.throwStatement(
      self.explodeExpression(path.get("argument"))
    ));

    break;

  default:
    throw new Error(
      "unknown Statement of type " +
        JSON.stringify(stmt.type));
  }
};

// Emit a runtime call to context.pushTry(catchLoc, finallyLoc) so that
// the runtime wrapper can dispatch uncaught exceptions appropriately.
Ep.pushTry = function(tryEntry) {
  assert.ok(tryEntry instanceof leap.TryEntry);

  var nil = b.literal(null);
  var catchEntry = tryEntry.catchEntry;
  var finallyEntry = tryEntry.finallyEntry;
  var method = this.contextProperty("pushTry");
  var args = [
    catchEntry && catchEntry.firstLoc || nil,
    finallyEntry && finallyEntry.firstLoc || nil,
    finallyEntry && b.literal(
      finallyEntry.nextLocTempVar.property.name
    ) || nil
  ];

  this.emit(b.callExpression(method, args));
};

// Emit a runtime call to context.popCatch(catchLoc) so that the runtime
// wrapper knows when a catch block reported to pushTry no longer applies.
Ep.popCatch = function(catchEntry) {
  var catchLoc;

  if (catchEntry) {
    assert.ok(catchEntry instanceof leap.CatchEntry);
    catchLoc = catchEntry.firstLoc;
  } else {
    assert.strictEqual(catchEntry, null);
    catchLoc = b.literal(null);
  }

  // TODO Think about not emitting anything when catchEntry === null.  For
  // now, emitting context.popCatch(null) is good for sanity checking.

  this.emit(b.callExpression(
    this.contextProperty("popCatch"),
    [catchLoc]
  ));
};

// Emit a runtime call to context.popFinally(finallyLoc) so that the
// runtime wrapper knows when a finally block reported to pushTry no
// longer applies.
Ep.popFinally = function(finallyEntry) {
  var finallyLoc;

  if (finallyEntry) {
    assert.ok(finallyEntry instanceof leap.FinallyEntry);
    finallyLoc = finallyEntry.firstLoc;
  } else {
    assert.strictEqual(finallyEntry, null);
    finallyLoc = b.literal(null);
  }

  // TODO Think about not emitting anything when finallyEntry === null.
  // For now, emitting context.popFinally(null) is good for sanity
  // checking.

  this.emit(b.callExpression(
    this.contextProperty("popFinally"),
    [finallyLoc]
  ));
};

Ep.explodeExpression = function(path, ignoreResult) {
  assert.ok(path instanceof types.NodePath);

  var expr = path.value;
  if (expr) {
    n.Expression.assert(expr);
  } else {
    return expr;
  }

  var self = this;
  var result; // Used optionally by several cases below.

  function finish(expr) {
    n.Expression.assert(expr);
    if (ignoreResult) {
      self.emit(expr);
    } else {
      return expr;
    }
  }

  // If the expression does not contain a leap, then we either emit the
  // expression as a standalone statement or return it whole.
  if (!meta.containsLeap(expr)) {
    return finish(expr);
  }

  // If any child contains a leap (such as a yield or labeled continue or
  // break statement), then any sibling subexpressions will almost
  // certainly have to be exploded in order to maintain the order of their
  // side effects relative to the leaping child(ren).
  var hasLeapingChildren = meta.containsLeap.onlyChildren(expr);

  // In order to save the rest of explodeExpression from a combinatorial
  // trainwreck of special cases, explodeViaTempVar is responsible for
  // deciding when a subexpression needs to be "exploded," which is my
  // very technical term for emitting the subexpression as an assignment
  // to a temporary variable and the substituting the temporary variable
  // for the original subexpression. Think of exploded view diagrams, not
  // Michael Bay movies. The point of exploding subexpressions is to
  // control the precise order in which the generated code realizes the
  // side effects of those subexpressions.
  function explodeViaTempVar(tempVar, childPath, ignoreChildResult) {
    assert.ok(childPath instanceof types.NodePath);

    assert.ok(
      !ignoreChildResult || !tempVar,
      "Ignoring the result of a child expression but forcing it to " +
        "be assigned to a temporary variable?"
    );

    var result = self.explodeExpression(childPath, ignoreChildResult);

    if (ignoreChildResult) {
      // Side effects already emitted above.

    } else if (tempVar || (hasLeapingChildren &&
                           (self.isVolatileContextProperty(result) ||
                            meta.hasSideEffects(result)))) {
      // If tempVar was provided, then the result will always be assigned
      // to it, even if the result does not otherwise need to be assigned
      // to a temporary variable.  When no tempVar is provided, we have
      // the flexibility to decide whether a temporary variable is really
      // necessary.  In general, temporary assignment is required only
      // when some other child contains a leap and the child in question
      // is a context property like $ctx.sent that might get overwritten
      // or an expression with side effects that need to occur in proper
      // sequence relative to the leap.
      result = self.emitAssign(
        tempVar || self.makeTempVar(),
        result
      );
    }
    return result;
  }

  // If ignoreResult is true, then we must take full responsibility for
  // emitting the expression with all its side effects, and we should not
  // return a result.

  switch (expr.type) {
  case "MemberExpression":
    return finish(b.memberExpression(
      self.explodeExpression(path.get("object")),
      expr.computed
        ? explodeViaTempVar(null, path.get("property"))
        : expr.property,
      expr.computed
    ));

  case "CallExpression":
    var oldCalleePath = path.get("callee");
    var newCallee = self.explodeExpression(oldCalleePath);

    // If the callee was not previously a MemberExpression, then the
    // CallExpression was "unqualified," meaning its `this` object should
    // be the global object. If the exploded expression has become a
    // MemberExpression, then we need to force it to be unqualified by
    // using the (0, object.property)(...) trick; otherwise, it will
    // receive the object of the MemberExpression as its `this` object.
    if (!n.MemberExpression.check(oldCalleePath.node) &&
        n.MemberExpression.check(newCallee)) {
      newCallee = b.sequenceExpression([
        b.literal(0),
        newCallee
      ]);
    }

    return finish(b.callExpression(
      newCallee,
      path.get("arguments").map(function(argPath) {
        return explodeViaTempVar(null, argPath);
      })
    ));

  case "NewExpression":
    return finish(b.newExpression(
      explodeViaTempVar(null, path.get("callee")),
      path.get("arguments").map(function(argPath) {
        return explodeViaTempVar(null, argPath);
      })
    ));

  case "ObjectExpression":
    return finish(b.objectExpression(
      path.get("properties").map(function(propPath) {
        return b.property(
          propPath.value.kind,
          propPath.value.key,
          explodeViaTempVar(null, propPath.get("value"))
        );
      })
    ));

  case "ArrayExpression":
    return finish(b.arrayExpression(
      path.get("elements").map(function(elemPath) {
        return explodeViaTempVar(null, elemPath);
      })
    ));

  case "SequenceExpression":
    var lastIndex = expr.expressions.length - 1;

    path.get("expressions").each(function(exprPath) {
      if (exprPath.name === lastIndex) {
        result = self.explodeExpression(exprPath, ignoreResult);
      } else {
        self.explodeExpression(exprPath, true);
      }
    });

    return result;

  case "LogicalExpression":
    var after = loc();

    if (!ignoreResult) {
      result = self.makeTempVar();
    }

    var left = explodeViaTempVar(result, path.get("left"));

    if (expr.operator === "&&") {
      self.jumpIfNot(left, after);
    } else if (expr.operator = "||") {
      self.jumpIf(left, after);
    }

    explodeViaTempVar(result, path.get("right"), ignoreResult);

    self.mark(after);

    return result;

  case "ConditionalExpression":
    var elseLoc = loc();
    var after = loc();
    var test = self.explodeExpression(path.get("test"));

    self.jumpIfNot(test, elseLoc);

    if (!ignoreResult) {
      result = self.makeTempVar();
    }

    explodeViaTempVar(result, path.get("consequent"), ignoreResult);
    self.jump(after);

    self.mark(elseLoc);
    explodeViaTempVar(result, path.get("alternate"), ignoreResult);

    self.mark(after);

    return result;

  case "UnaryExpression":
    return finish(b.unaryExpression(
      expr.operator,
      // Can't (and don't need to) break up the syntax of the argument.
      // Think about delete a[b].
      self.explodeExpression(path.get("argument")),
      !!expr.prefix
    ));

  case "BinaryExpression":
    return finish(b.binaryExpression(
      expr.operator,
      explodeViaTempVar(null, path.get("left")),
      explodeViaTempVar(null, path.get("right"))
    ));

  case "AssignmentExpression":
    return finish(b.assignmentExpression(
      expr.operator,
      self.explodeExpression(path.get("left")),
      self.explodeExpression(path.get("right"))
    ));

  case "UpdateExpression":
    return finish(b.updateExpression(
      expr.operator,
      self.explodeExpression(path.get("argument")),
      expr.prefix
    ));

  case "YieldExpression":
    var after = loc();
    var arg = expr.argument && self.explodeExpression(path.get("argument"));

    if (arg && expr.delegate) {
      var result = self.makeTempVar();

      self.emit(b.returnStatement(b.callExpression(
        self.contextProperty("delegateYield"), [
          arg,
          b.literal(result.property.name),
          after
        ]
      )));

      self.mark(after);

      return result;
    }

    self.emitAssign(self.contextProperty("next"), after);
    self.emit(b.returnStatement(arg || null));
    self.mark(after);

    return self.contextProperty("sent");

  default:
    throw new Error(
      "unknown Expression of type " +
        JSON.stringify(expr.type));
  }
};

},{"./leap":49,"./meta":50,"assert":71,"ast-types":15}],48:[function(require,module,exports){
/**
 * Copyright (c) 2013, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * https://raw.github.com/facebook/regenerator/master/LICENSE file. An
 * additional grant of patent rights can be found in the PATENTS file in
 * the same directory.
 */

var assert = require("assert");
var types = require("ast-types");
var n = types.namedTypes;
var b = types.builders;
var hasOwn = Object.prototype.hasOwnProperty;

// The hoist function takes a FunctionExpression or FunctionDeclaration
// and replaces any Declaration nodes in its body with assignments, then
// returns a VariableDeclaration containing just the names of the removed
// declarations.
exports.hoist = function(funPath) {
  assert.ok(funPath instanceof types.NodePath);
  n.Function.assert(funPath.value);

  var vars = {};

  function varDeclToExpr(vdec, includeIdentifiers) {
    n.VariableDeclaration.assert(vdec);
    var exprs = [];

    vdec.declarations.forEach(function(dec) {
      vars[dec.id.name] = dec.id;

      if (dec.init) {
        exprs.push(b.assignmentExpression(
          "=", dec.id, dec.init
        ));
      } else if (includeIdentifiers) {
        exprs.push(dec.id);
      }
    });

    if (exprs.length === 0)
      return null;

    if (exprs.length === 1)
      return exprs[0];

    return b.sequenceExpression(exprs);
  }

  types.traverse(funPath.get("body"), function(node) {
    if (n.VariableDeclaration.check(node)) {
      var expr = varDeclToExpr(node, false);
      if (expr === null) {
        this.replace();
      } else {
        // We don't need to traverse this expression any further because
        // there can't be any new declarations inside an expression.
        this.replace(b.expressionStatement(expr));
      }

      // Since the original node has been either removed or replaced,
      // avoid traversing it any further.
      return false;

    } else if (n.ForStatement.check(node)) {
      if (n.VariableDeclaration.check(node.init)) {
        var expr = varDeclToExpr(node.init, false);
        this.get("init").replace(expr);
      }

    } else if (n.ForInStatement.check(node)) {
      if (n.VariableDeclaration.check(node.left)) {
        var expr = varDeclToExpr(node.left, true);
        this.get("left").replace(expr);
      }

    } else if (n.FunctionDeclaration.check(node)) {
      vars[node.id.name] = node.id;

      var parentNode = this.parent.node;
      var assignment = b.expressionStatement(
        b.assignmentExpression(
          "=",
          node.id,
          b.functionExpression(
            node.id,
            node.params,
            node.body,
            node.generator,
            node.expression
          )
        )
      );

      if (n.BlockStatement.check(this.parent.node)) {
        // Note that the function declaration we want to remove might be
        // the same node that firstStmtPath refers to, in case the
        // function declaration was already the first statement in the
        // enclosing block statement.
        var firstStmtPath = this.parent.get("body", 0);

        // Insert the assignment form before the first statement in the
        // enclosing block.
        firstStmtPath.replace(assignment, firstStmtPath.value);

        // Remove the function declaration now that we've inserted the
        // equivalent assignment form at the beginning of the block.
        this.replace();

      } else {
        // If the parent node is not a block statement, then we can just
        // replace the declaration with the equivalent assignment form
        // without worrying about hoisting it.
        this.replace(assignment);
      }

      // Don't hoist variables out of inner functions.
      return false;

    } else if (n.FunctionExpression.check(node)) {
      // Don't descend into nested function expressions.
      return false;
    }
  });

  var paramNames = {};
  funPath.get("params").each(function(paramPath) {
    var param = paramPath.value;
    if (n.Identifier.check(param)) {
      paramNames[param.name] = param;
    } else {
      // Variables declared by destructuring parameter patterns will be
      // harmlessly re-declared.
    }
  });

  var declarations = [];

  Object.keys(vars).forEach(function(name) {
    if (!hasOwn.call(paramNames, name)) {
      declarations.push(b.variableDeclarator(vars[name], null));
    }
  });

  if (declarations.length === 0) {
    return null; // Be sure to handle this case!
  }

  return b.variableDeclaration("var", declarations);
};

},{"assert":71,"ast-types":15}],49:[function(require,module,exports){
/**
 * Copyright (c) 2013, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * https://raw.github.com/facebook/regenerator/master/LICENSE file. An
 * additional grant of patent rights can be found in the PATENTS file in
 * the same directory.
 */

var assert = require("assert");
var types = require("ast-types");
var n = types.namedTypes;
var b = types.builders;
var inherits = require("util").inherits;

function Entry() {
  assert.ok(this instanceof Entry);
}

function FunctionEntry(returnLoc) {
  Entry.call(this);

  n.Literal.assert(returnLoc);

  Object.defineProperties(this, {
    returnLoc: { value: returnLoc }
  });
}

inherits(FunctionEntry, Entry);
exports.FunctionEntry = FunctionEntry;

function LoopEntry(breakLoc, continueLoc, label) {
  Entry.call(this);

  n.Literal.assert(breakLoc);
  n.Literal.assert(continueLoc);

  if (label) {
    n.Identifier.assert(label);
  } else {
    label = null;
  }

  Object.defineProperties(this, {
    breakLoc: { value: breakLoc },
    continueLoc: { value: continueLoc },
    label: { value: label }
  });
}

inherits(LoopEntry, Entry);
exports.LoopEntry = LoopEntry;

function SwitchEntry(breakLoc) {
  Entry.call(this);

  n.Literal.assert(breakLoc);

  Object.defineProperties(this, {
    breakLoc: { value: breakLoc }
  });
}

inherits(SwitchEntry, Entry);
exports.SwitchEntry = SwitchEntry;

function TryEntry(catchEntry, finallyEntry) {
  Entry.call(this);

  if (catchEntry) {
    assert.ok(catchEntry instanceof CatchEntry);
  } else {
    catchEntry = null;
  }

  if (finallyEntry) {
    assert.ok(finallyEntry instanceof FinallyEntry);
  } else {
    finallyEntry = null;
  }

  Object.defineProperties(this, {
    catchEntry: { value: catchEntry },
    finallyEntry: { value: finallyEntry }
  });
}

inherits(TryEntry, Entry);
exports.TryEntry = TryEntry;

function CatchEntry(firstLoc, paramId) {
  Entry.call(this);

  n.Literal.assert(firstLoc);
  n.Identifier.assert(paramId);

  Object.defineProperties(this, {
    firstLoc: { value: firstLoc },
    paramId: { value: paramId }
  });
}

inherits(CatchEntry, Entry);
exports.CatchEntry = CatchEntry;

function FinallyEntry(firstLoc, nextLocTempVar) {
  Entry.call(this);

  n.Literal.assert(firstLoc);
  n.MemberExpression.assert(nextLocTempVar);

  Object.defineProperties(this, {
    firstLoc: { value: firstLoc },
    nextLocTempVar: { value: nextLocTempVar }
  });
}

inherits(FinallyEntry, Entry);
exports.FinallyEntry = FinallyEntry;

function LeapManager(emitter) {
  assert.ok(this instanceof LeapManager);

  var Emitter = require("./emit").Emitter;
  assert.ok(emitter instanceof Emitter);

  Object.defineProperties(this, {
    emitter: { value: emitter },
    entryStack: {
      value: [new FunctionEntry(emitter.finalLoc)]
    }
  });
}

var LMp = LeapManager.prototype;
exports.LeapManager = LeapManager;

LMp.withEntry = function(entry, callback) {
  assert.ok(entry instanceof Entry);
  this.entryStack.push(entry);
  try {
    callback.call(this.emitter);
  } finally {
    var popped = this.entryStack.pop();
    assert.strictEqual(popped, entry);
  }
};

LMp._leapToEntry = function(predicate, defaultLoc) {
  var entry, loc;
  var finallyEntries = [];
  var skipNextTryEntry = null;

  for (var i = this.entryStack.length - 1; i >= 0; --i) {
    entry = this.entryStack[i];

    if (entry instanceof CatchEntry ||
        entry instanceof FinallyEntry) {

      // If we are inside of a catch or finally block, then we must
      // have exited the try block already, so we shouldn't consider
      // the next TryStatement as a handler for this throw.
      skipNextTryEntry = entry;

    } else if (entry instanceof TryEntry) {
      if (skipNextTryEntry) {
        // If an exception was thrown from inside a catch block and this
        // try statement has a finally block, make sure we execute that
        // finally block.
        if (skipNextTryEntry instanceof CatchEntry &&
            entry.finallyEntry) {
          finallyEntries.push(entry.finallyEntry);
        }

        skipNextTryEntry = null;

      } else if ((loc = predicate.call(this, entry))) {
        break;

      } else if (entry.finallyEntry) {
        finallyEntries.push(entry.finallyEntry);
      }

    } else if ((loc = predicate.call(this, entry))) {
      break;
    }
  }

  if (loc) {
    // fall through
  } else if (defaultLoc) {
    loc = defaultLoc;
  } else {
    return null;
  }

  n.Literal.assert(loc);

  while ((finallyEntry = finallyEntries.pop())) {
    this.emitter.emitAssign(finallyEntry.nextLocTempVar, loc);
    loc = finallyEntry.firstLoc;
  }

  return loc;
};

function getLeapLocation(entry, property, label) {
  var loc = entry[property];
  if (loc) {
    if (label) {
      if (entry.label &&
          entry.label.name === label.name) {
        return loc;
      }
    } else {
      return loc;
    }
  }
  return null;
}

LMp.emitBreak = function(label) {
  var loc = this._leapToEntry(function(entry) {
    return getLeapLocation(entry, "breakLoc", label);
  });

  if (loc === null) {
    throw new Error("illegal break statement");
  }

  this.emitter.clearPendingException();
  this.emitter.jump(loc);
};

LMp.emitContinue = function(label) {
  var loc = this._leapToEntry(function(entry) {
    return getLeapLocation(entry, "continueLoc", label);
  });

  if (loc === null) {
    throw new Error("illegal continue statement");
  }

  this.emitter.clearPendingException();
  this.emitter.jump(loc);
};

LMp.emitReturn = function(argPath) {
  assert.ok(argPath instanceof types.NodePath);

  var loc = this._leapToEntry(function(entry) {
    return getLeapLocation(entry, "returnLoc");
  });

  if (loc === null) {
    throw new Error("illegal return statement");
  }

  if (argPath.value) {
    this.emitter.setReturnValue(argPath);
  }

  this.emitter.clearPendingException();
  this.emitter.jump(loc);
};

},{"./emit":47,"assert":71,"ast-types":15,"util":77}],50:[function(require,module,exports){
/**
 * Copyright (c) 2013, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * https://raw.github.com/facebook/regenerator/master/LICENSE file. An
 * additional grant of patent rights can be found in the PATENTS file in
 * the same directory.
 */

var assert = require("assert");
var m = require("private").makeAccessor();
var types = require("ast-types");
var isArray = types.builtInTypes.array;
var n = types.namedTypes;
var hasOwn = Object.prototype.hasOwnProperty;

function makePredicate(propertyName, knownTypes) {
  function onlyChildren(node) {
    n.Node.assert(node);

    // Assume no side effects until we find out otherwise.
    var result = false;

    function check(child) {
      if (result) {
        // Do nothing.
      } else if (isArray.check(child)) {
        child.some(check);
      } else if (n.Node.check(child)) {
        assert.strictEqual(result, false);
        result = predicate(child);
      }
      return result;
    }

    types.eachField(node, function(name, child) {
      check(child);
    });

    return result;
  }

  function predicate(node) {
    n.Node.assert(node);

    var meta = m(node);
    if (hasOwn.call(meta, propertyName))
      return meta[propertyName];

    // Certain types are "opaque," which means they have no side
    // effects or leaps and we don't care about their subexpressions.
    if (hasOwn.call(opaqueTypes, node.type))
      return meta[propertyName] = false;

    if (hasOwn.call(knownTypes, node.type))
      return meta[propertyName] = true;

    return meta[propertyName] = onlyChildren(node);
  }

  predicate.onlyChildren = onlyChildren;

  return predicate;
}

var opaqueTypes = {
  FunctionExpression: true
};

// These types potentially have side effects regardless of what side
// effects their subexpressions have.
var sideEffectTypes = {
  CallExpression: true, // Anything could happen!
  ForInStatement: true, // Modifies the key variable.
  UnaryExpression: true, // Think delete.
  BinaryExpression: true, // Might invoke .toString() or .valueOf().
  AssignmentExpression: true, // Side-effecting by definition.
  UpdateExpression: true, // Updates are essentially assignments.
  NewExpression: true // Similar to CallExpression.
};

// These types are the direct cause of all leaps in control flow.
var leapTypes = {
  YieldExpression: true,
  BreakStatement: true,
  ContinueStatement: true,
  ReturnStatement: true,
  ThrowStatement: true
};

// All leap types are also side effect types.
for (var type in leapTypes) {
  if (hasOwn.call(leapTypes, type)) {
    sideEffectTypes[type] = leapTypes[type];
  }
}

exports.hasSideEffects = makePredicate("hasSideEffects", sideEffectTypes);
exports.containsLeap = makePredicate("containsLeap", leapTypes);

},{"assert":71,"ast-types":15,"private":22}],51:[function(require,module,exports){
/**
 * Copyright (c) 2013, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * https://raw.github.com/facebook/regenerator/master/LICENSE file. An
 * additional grant of patent rights can be found in the PATENTS file in
 * the same directory.
 */

var hasOwn = Object.prototype.hasOwnProperty;

exports.guessTabWidth = function(source) {
  var counts = []; // Sparse array.
  var lastIndent = 0;

  source.split("\n").forEach(function(line) {
    var indent = /^\s*/.exec(line)[0].length;
    var diff = Math.abs(indent - lastIndent);
    counts[diff] = ~~counts[diff] + 1;
    lastIndent = indent;
  });

  var maxCount = -1;
  var result = 2;

  for (var tabWidth = 1;
       tabWidth < counts.length;
       tabWidth += 1) {
    if (tabWidth in counts &&
        counts[tabWidth] > maxCount) {
      maxCount = counts[tabWidth];
      result = tabWidth;
    }
  }

  return result;
};

exports.defaults = function(obj) {
  var len = arguments.length;
  var extension;

  for (var i = 1; i < len; ++i) {
    if ((extension = arguments[i])) {
      for (var key in extension) {
        if (hasOwn.call(extension, key) && !hasOwn.call(obj, key)) {
          obj[key] = extension[key];
        }
      }
    }
  }

  return obj;
};

},{}],52:[function(require,module,exports){
/**
 * Copyright (c) 2013, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * https://raw.github.com/facebook/regenerator/master/LICENSE file. An
 * additional grant of patent rights can be found in the PATENTS file in
 * the same directory.
 */

var assert = require("assert");
var types = require("ast-types");
var n = types.namedTypes;
var b = types.builders;
var hoist = require("./hoist").hoist;
var Emitter = require("./emit").Emitter;

exports.transform = function(ast) {
  return types.traverse(ast, visitNode);
};
var ctxid = 0;

function visitNode(node) {
  if (!n.Function.check(node) || !node.generator) {
    // Note that because we are not returning false here the traversal
    // will continue into the subtree rooted at this node, as desired.
    return;
  }

  node.generator = false;

  if (node.expression) {
    // Transform expression lambdas into normal functions.
    node.expression = false;
    node.body = b.blockStatement([
      b.returnStatement(node.body)
    ]);
  }

  // TODO Ensure these identifiers are named uniquely.
  var contextId = b.identifier("$ctx" + (++ctxid));
  var functionId = node.id ? b.identifier(node.id.name + "$") : null/*Anonymous*/;
  var argsId = b.identifier("$args");
  var wrapGeneratorId = b.identifier("wrapGenerator");
  var shouldAliasArguments = renameArguments(this, argsId);
  var vars = hoist(this);

  if (shouldAliasArguments) {
    vars = vars || b.variableDeclaration("var", []);
    vars.declarations.push(b.variableDeclarator(
      argsId, b.identifier("arguments")
    ));
  }

  var emitter = new Emitter(contextId);
  emitter.explode(this.get("body"));

  var outerBody = [];

  if (vars && vars.declarations.length > 0) {
    outerBody.push(vars);
  }

  outerBody.push(b.returnStatement(
    b.callExpression(wrapGeneratorId, [
      emitter.getContextFunction(functionId),
      b.thisExpression()
    ])
  ));

  node.body = b.blockStatement(outerBody);

  var markMethod = b.memberExpression(
    wrapGeneratorId,
    b.identifier("mark"),
    false
  );

  if (n.FunctionDeclaration.check(node)) {
    var path = this.parent;

    while (path && !(n.BlockStatement.check(path.value) ||
                     n.Program.check(path.value))) {
      path = path.parent;
    }

    if (path) {
      var firstStmtPath = path.get("body", 0);
      firstStmtPath.replace(
        b.expressionStatement(b.callExpression(markMethod, [node.id])),
        firstStmtPath.value
      );
    }

  } else {
    n.FunctionExpression.assert(node);
    this.replace(b.callExpression(markMethod, [node]));
  }
}

function renameArguments(funcPath, argsId) {
  assert.ok(funcPath instanceof types.NodePath);
  var func = funcPath.value;
  var didReplaceArguments = false;
  var hasImplicitArguments = false;

  types.traverse(funcPath, function(node) {
    if (node === func) {
      hasImplicitArguments = !this.scope.lookup("arguments");
    } else if (n.Function.check(node)) {
      return false;
    }

    if (n.Identifier.check(node) && node.name === "arguments") {
      var isMemberProperty =
        n.MemberExpression.check(this.parent.node) &&
        this.name === "property" &&
        !this.parent.node.computed;

      if (!isMemberProperty) {
        this.replace(argsId);
        didReplaceArguments = true;
        return false;
      }
    }
  });

  // If the traversal replaced any arguments identifiers, and those
  // identifiers were free variables, then we need to alias the outer
  // function's arguments object to the variable named by argsId.
  return didReplaceArguments && hasImplicitArguments;
}

},{"./emit":47,"./hoist":48,"assert":71,"ast-types":15}],53:[function(require,module,exports){
var __dirname="/node_modules/regenerator";/**
 * Copyright (c) 2013, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * https://raw.github.com/facebook/regenerator/master/LICENSE file. An
 * additional grant of patent rights can be found in the PATENTS file in
 * the same directory.
 */

var assert = require("assert");
var path = require("path");
var fs = require("fs");
var transform = require("./lib/visit").transform;
var utils = require("./lib/util");
var recast = require("recast");
var esprimaHarmony = require("esprima");
var genFunExp = /\bfunction\s*\*/;
var blockBindingExp = /\b(let|const)\s+/;

assert.ok(
  /harmony/.test(esprimaHarmony.version),
  "Bad esprima version: " + esprimaHarmony.version
);

function regenerator(source, options) {
  options = utils.defaults(options || {}, {
    includeRuntime: false,
    supportBlockBinding: true
  });

  var runtime = options.includeRuntime ? fs.readFileSync(
    regenerator.runtime.dev, "utf-8"
  ) + "\n" : "";

  if (!genFunExp.test(source)) {
    return runtime + source; // Shortcut: no generators to transform.
  }

  var runtimeBody = recast.parse(runtime, {
    sourceFileName: regenerator.runtime.dev
  }).program.body;

  var supportBlockBinding = !!options.supportBlockBinding;
  if (supportBlockBinding) {
    if (!blockBindingExp.test(source)) {
      supportBlockBinding = false;
    }
  }

  var recastOptions = {
    tabWidth: utils.guessTabWidth(source),
    // Use the harmony branch of Esprima that installs with regenerator
    // instead of the master branch that recast provides.
    esprima: esprimaHarmony,
    range: supportBlockBinding
  };

  var ast = recast.parse(source, recastOptions);

  // Transpile let/const into var declarations.
  if (supportBlockBinding) {
    var defsResult = require("defs")(ast.program, {
      ast: true,
      disallowUnknownReferences: false,
      disallowDuplicated: false,
      disallowVars: false,
      loopClosures: "iife"
    });

    if (defsResult.errors) {
      throw new Error(defsResult.errors.join("\n"))
    }
  }

  var path = new recast.types.NodePath(ast);

  transform(path.get("program"));

  // Include the runtime by modifying the AST rather than by concatenating
  // strings. This technique will allow for more accurate source mapping.
  if (options.includeRuntime) {
    var body = ast.program.body;
    body.unshift.apply(body, runtimeBody);
  }

  return recast.print(path, recastOptions).code;
}

// To modify an AST directly, call require("regenerator").transform(ast).
regenerator.transform = transform;

regenerator.runtime = {
  dev: path.join(__dirname, "runtime", "dev.js"),
  min: path.join(__dirname, "runtime", "min.js")
};

// To transform a string of ES6 code, call require("regenerator")(source);
module.exports = regenerator;

},{"./lib/util":51,"./lib/visit":52,"assert":71,"defs":54,"esprima":69,"fs":70,"path":75,"recast":33}],54:[function(require,module,exports){
"use strict";

var assert = require("assert");
var is = require("simple-is");
var fmt = require("simple-fmt");
var stringmap = require("stringmap");
var stringset = require("stringset");
var alter = require("alter");
var traverse = require("ast-traverse");
var breakable = require("breakable");
var Scope = require("./scope");
var error = require("./error");
var options = require("./options");
var Stats = require("./stats");
var jshint_vars = require("./jshint_globals/vars.js");


function getline(node) {
    return node.loc.start.line;
}

function isConstLet(kind) {
    return is.someof(kind, ["const", "let"]);
}

function isVarConstLet(kind) {
    return is.someof(kind, ["var", "const", "let"]);
}

function isNonFunctionBlock(node) {
    return node.type === "BlockStatement" && is.noneof(node.$parent.type, ["FunctionDeclaration", "FunctionExpression"]);
}

function isForWithConstLet(node) {
    return node.type === "ForStatement" && node.init && node.init.type === "VariableDeclaration" && isConstLet(node.init.kind);
}

function isForInWithConstLet(node) {
    return node.type === "ForInStatement" && node.left.type === "VariableDeclaration" && isConstLet(node.left.kind);
}

function isFunction(node) {
    return is.someof(node.type, ["FunctionDeclaration", "FunctionExpression"]);
}

function isLoop(node) {
    return is.someof(node.type, ["ForStatement", "ForInStatement", "WhileStatement", "DoWhileStatement"]);
}

function isReference(node) {
    var parent = node.$parent;
    return node.$refToScope ||
        node.type === "Identifier" &&
        !(parent.type === "VariableDeclarator" && parent.id === node) && // var|let|const $
        !(parent.type === "MemberExpression" && parent.computed === false && parent.property === node) && // obj.$
        !(parent.type === "Property" && parent.key === node) && // {$: ...}
        !(parent.type === "LabeledStatement" && parent.label === node) && // $: ...
        !(parent.type === "CatchClause" && parent.param === node) && // catch($)
        !(isFunction(parent) && parent.id === node) && // function $(..
        !(isFunction(parent) && is.someof(node, parent.params)) && // function f($)..
        true;
}

function isLvalue(node) {
    return isReference(node) &&
        ((node.$parent.type === "AssignmentExpression" && node.$parent.left === node) ||
            (node.$parent.type === "UpdateExpression" && node.$parent.argument === node));
}

function createScopes(node, parent) {
    assert(!node.$scope);

    node.$parent = parent;
    node.$scope = node.$parent ? node.$parent.$scope : null; // may be overridden

    if (node.type === "Program") {
        // Top-level program is a scope
        // There's no block-scope under it
        node.$scope = new Scope({
            kind: "hoist",
            node: node,
            parent: null,
        });

    } else if (isFunction(node)) {
        // Function is a scope, with params in it
        // There's no block-scope under it

        node.$scope = new Scope({
            kind: "hoist",
            node: node,
            parent: node.$parent.$scope,
        });

        // function has a name
        if (node.id) {
            assert(node.id.type === "Identifier");

            if (node.type === "FunctionDeclaration") {
                // Function name goes in parent scope for declared functions
                node.$parent.$scope.add(node.id.name, "fun", node.id, null);
            } else if (node.type === "FunctionExpression") {
                // Function name goes in function's scope for named function expressions
                node.$scope.add(node.id.name, "fun", node.id, null);
            } else {
                assert(false);
            }
        }

        node.params.forEach(function(param) {
            node.$scope.add(param.name, "param", param, null);
        });

    } else if (node.type === "VariableDeclaration") {
        // Variable declarations names goes in current scope
        assert(isVarConstLet(node.kind));
        node.declarations.forEach(function(declarator) {
            assert(declarator.type === "VariableDeclarator");
            var name = declarator.id.name;
            if (options.disallowVars && node.kind === "var") {
                error(getline(declarator), "var {0} is not allowed (use let or const)", name);
            }
            node.$scope.add(name, node.kind, declarator.id, declarator.range[1]);
        });

    } else if (isForWithConstLet(node) || isForInWithConstLet(node)) {
        // For(In) loop with const|let declaration is a scope, with declaration in it
        // There may be a block-scope under it
        node.$scope = new Scope({
            kind: "block",
            node: node,
            parent: node.$parent.$scope,
        });

    } else if (isNonFunctionBlock(node)) {
        // A block node is a scope unless parent is a function
        node.$scope = new Scope({
            kind: "block",
            node: node,
            parent: node.$parent.$scope,
        });

    } else if (node.type === "CatchClause") {
        var identifier = node.param;

        node.$scope = new Scope({
            kind: "catch-block",
            node: node,
            parent: node.$parent.$scope,
        });
        node.$scope.add(identifier.name, "caught", identifier, null);

        // All hoist-scope keeps track of which variables that are propagated through,
        // i.e. an reference inside the scope points to a declaration outside the scope.
        // This is used to mark "taint" the name since adding a new variable in the scope,
        // with a propagated name, would change the meaning of the existing references.
        //
        // catch(e) is special because even though e is a variable in its own scope,
        // we want to make sure that catch(e){let e} is never transformed to
        // catch(e){var e} (but rather var e$0). For that reason we taint the use of e
        // in the closest hoist-scope, i.e. where var e$0 belongs.
        node.$scope.closestHoistScope().markPropagates(identifier.name);
    }
}

function createTopScope(programScope, environments, globals) {
    function inject(obj) {
        for (var name in obj) {
            var writeable = obj[name];
            var kind = (writeable ? "var" : "const");
            if (topScope.hasOwn(name)) {
                topScope.remove(name);
            }
            topScope.add(name, kind, {loc: {start: {line: -1}}}, -1);
        }
    }

    var topScope = new Scope({
        kind: "hoist",
        node: {},
        parent: null,
    });

    var complementary = {
        undefined: false,
        Infinity: false,
        console: false,
    };

    inject(complementary);
    inject(jshint_vars.reservedVars);
    inject(jshint_vars.ecmaIdentifiers);
    if (environments) {
        environments.forEach(function(env) {
            if (!jshint_vars[env]) {
                error(-1, 'environment "{0}" not found', env);
            } else {
                inject(jshint_vars[env]);
            }
        });
    }
    if (globals) {
        inject(globals);
    }

    // link it in
    programScope.parent = topScope;
    topScope.children.push(programScope);

    return topScope;
}

function setupReferences(ast, allIdentifiers, opts) {
    var analyze = (is.own(opts, "analyze") ? opts.analyze : true);

    function visit(node) {
        if (!isReference(node)) {
            return;
        }
        allIdentifiers.add(node.name);

        var scope = node.$scope.lookup(node.name);
        if (analyze && !scope && options.disallowUnknownReferences) {
            error(getline(node), "reference to unknown global variable {0}", node.name);
        }
        // check const and let for referenced-before-declaration
        if (analyze && scope && is.someof(scope.getKind(node.name), ["const", "let"])) {
            var allowedFromPos = scope.getFromPos(node.name);
            var referencedAtPos = node.range[0];
            assert(is.finitenumber(allowedFromPos));
            assert(is.finitenumber(referencedAtPos));
            if (referencedAtPos < allowedFromPos) {
                if (!node.$scope.hasFunctionScopeBetween(scope)) {
                    error(getline(node), "{0} is referenced before its declaration", node.name);
                }
            }
        }
        node.$refToScope = scope;
    }

    traverse(ast, {pre: visit});
}

// TODO for loops init and body props are parallel to each other but init scope is outer that of body
// TODO is this a problem?

function varify(ast, stats, allIdentifiers, changes) {
    function unique(name) {
        assert(allIdentifiers.has(name));
        for (var cnt = 0; ; cnt++) {
            var genName = name + "$" + String(cnt);
            if (!allIdentifiers.has(genName)) {
                return genName;
            }
        }
    }

    function renameDeclarations(node) {
        if (node.type === "VariableDeclaration" && isConstLet(node.kind)) {
            var hoistScope = node.$scope.closestHoistScope();
            var origScope = node.$scope;

            // text change const|let => var
            changes.push({
                start: node.range[0],
                end: node.range[0] + node.kind.length,
                str: "var",
            });

            node.declarations.forEach(function(declarator) {
                assert(declarator.type === "VariableDeclarator");
                var name = declarator.id.name;

                stats.declarator(node.kind);

                // rename if
                // 1) name already exists in hoistScope, or
                // 2) name is already propagated (passed) through hoistScope or manually tainted
                var rename = (origScope !== hoistScope &&
                    (hoistScope.hasOwn(name) || hoistScope.doesPropagate(name)));

                var newName = (rename ? unique(name) : name);

                origScope.remove(name);
                hoistScope.add(newName, "var", declarator.id, declarator.range[1]);

                origScope.moves = origScope.moves || stringmap();
                origScope.moves.set(name, {
                    name: newName,
                    scope: hoistScope,
                });

                allIdentifiers.add(newName);

                if (newName !== name) {
                    stats.rename(name, newName, getline(declarator));

                    declarator.id.originalName = name;
                    declarator.id.name = newName;

                    // textchange var x => var x$1
                    changes.push({
                        start: declarator.id.range[0],
                        end: declarator.id.range[1],
                        str: newName,
                    });
                }
            });

            // ast change const|let => var
            node.kind = "var";
        }
    }

    function renameReferences(node) {
        if (!node.$refToScope) {
            return;
        }
        var move = node.$refToScope.moves && node.$refToScope.moves.get(node.name);
        if (!move) {
            return;
        }
        node.$refToScope = move.scope;

        if (node.name !== move.name) {
            node.originalName = node.name;
            node.name = move.name;

            if (node.alterop) {
                // node has no range because it is the result of another alter operation
                var existingOp = null;
                for (var i = 0; i < changes.length; i++) {
                    var op = changes[i];
                    if (op.node === node) {
                        existingOp = op;
                        break;
                    }
                }
                assert(existingOp);

                // modify op
                existingOp.str = move.name;
            } else {
                changes.push({
                    start: node.range[0],
                    end: node.range[1],
                    str: move.name,
                });
            }
        }
    }

    traverse(ast, {pre: renameDeclarations});
    traverse(ast, {pre: renameReferences});
    ast.$scope.traverse({pre: function(scope) {
        delete scope.moves;
    }});
}


function detectLoopClosures(ast) {
    traverse(ast, {pre: visit});

    function detectIifyBodyBlockers(body, node) {
        return breakable(function(brk) {
            traverse(body, {pre: function(n) {
                // if we hit an inner function of the loop body, don't traverse further
                if (isFunction(n)) {
                    return false;
                }

                var err = true; // reset to false in else-statement below
                var msg = "loop-variable {0} is captured by a loop-closure that can't be transformed due to use of {1} at line {2}";
                if (n.type === "BreakStatement") {
                    error(getline(node), msg, node.name, "break", getline(n));
                } else if (n.type === "ContinueStatement") {
                    error(getline(node), msg, node.name, "continue", getline(n));
                } else if (n.type === "ReturnStatement") {
                    error(getline(node), msg, node.name, "return", getline(n));
                } else if (n.type === "YieldExpression") {
                    error(getline(node), msg, node.name, "yield", getline(n));
                } else if (n.type === "Identifier" && n.name === "arguments") {
                    error(getline(node), msg, node.name, "arguments", getline(n));
                } else if (n.type === "VariableDeclaration" && n.kind === "var") {
                    error(getline(node), msg, node.name, "var", getline(n));
                } else {
                    err = false;
                }
                if (err) {
                    brk(true); // break traversal
                }
            }});
            return false;
        });
    }

    function visit(node) {
        // forbidden pattern:
        // <any>* <loop> <non-fn>* <constlet-def> <any>* <fn> <any>* <constlet-ref>
        var loopNode = null;
        if (isReference(node) && node.$refToScope && isConstLet(node.$refToScope.getKind(node.name))) {
            // traverse nodes up towards root from constlet-def
            // if we hit a function (before a loop) - ok!
            // if we hit a loop - maybe-ouch
            // if we reach root - ok!
            for (var n = node.$refToScope.node; ; ) {
                if (isFunction(n)) {
                    // we're ok (function-local)
                    return;
                } else if (isLoop(n)) {
                    loopNode = n;
                    // maybe not ok (between loop and function)
                    break;
                }
                n = n.$parent;
                if (!n) {
                    // ok (reached root)
                    return;
                }
            }

            assert(isLoop(loopNode));

            // traverse scopes from reference-scope up towards definition-scope
            // if we hit a function, ouch!
            var defScope = node.$refToScope;
            var generateIIFE = (options.loopClosures === "iife");

            for (var s = node.$scope; s; s = s.parent) {
                if (s === defScope) {
                    // we're ok
                    return;
                } else if (isFunction(s.node)) {
                    // not ok (there's a function between the reference and definition)
                    // may be transformable via IIFE

                    if (!generateIIFE) {
                        var msg = "loop-variable {0} is captured by a loop-closure. Tried \"loopClosures\": \"iife\" in defs-config.json?";
                        return error(getline(node), msg, node.name);
                    }

                    // here be dragons
                    // for (let x = ..; .. ; ..) { (function(){x})() } is forbidden because of current
                    // spec and VM status
                    if (loopNode.type === "ForStatement" && defScope.node === loopNode) {
                        var declarationNode = defScope.getNode(node.name);
                        return error(getline(declarationNode), "Not yet specced ES6 feature. {0} is declared in for-loop header and then captured in loop closure", declarationNode.name);
                    }

                    // speak now or forever hold your peace
                    if (detectIifyBodyBlockers(loopNode.body, node)) {
                        // error already generated
                        return;
                    }

                    // mark loop for IIFE-insertion
                    loopNode.$iify = true;
                }
            }
        }
    }
}

function transformLoopClosures(root, ops, options) {
    function insertOp(pos, str, node) {
        var op = {
            start: pos,
            end: pos,
            str: str,
        }
        if (node) {
            op.node = node;
        }
        ops.push(op);
    }

    traverse(root, {pre: function(node) {
        if (!node.$iify) {
            return;
        }

        var hasBlock = (node.body.type === "BlockStatement");

        var insertHead = (hasBlock ?
            node.body.range[0] + 1 : // just after body {
            node.body.range[0]); // just before existing expression
        var insertFoot = (hasBlock ?
            node.body.range[1] - 1 : // just before body }
            node.body.range[1]);  // just after existing expression

        var forInName = (node.type === "ForInStatement" && node.left.declarations[0].id.name);;
        var iifeHead = fmt("(function({0}){", forInName ? forInName : "");
        var iifeTail = fmt("}).call(this{0});", forInName ? ", " + forInName : "");

        // modify AST
        var iifeFragment = options.parse(iifeHead + iifeTail);
        var iifeExpressionStatement = iifeFragment.body[0];
        var iifeBlockStatement = iifeExpressionStatement.expression.callee.object.body;

        if (hasBlock) {
            var forBlockStatement = node.body;
            var tmp = forBlockStatement.body;
            forBlockStatement.body = [iifeExpressionStatement];
            iifeBlockStatement.body = tmp;
        } else {
            var tmp$0 = node.body;
            node.body = iifeExpressionStatement;
            iifeBlockStatement.body[0] = tmp$0;
        }

        // create ops
        insertOp(insertHead, iifeHead);

        if (forInName) {
            insertOp(insertFoot, "}).call(this, ");

            var args = iifeExpressionStatement.expression.arguments;
            var iifeArgumentIdentifier = args[1];
            iifeArgumentIdentifier.alterop = true;
            insertOp(insertFoot, forInName, iifeArgumentIdentifier);

            insertOp(insertFoot, ");");
        } else {
            insertOp(insertFoot, iifeTail);
        }
    }});
}

function detectConstAssignment(ast) {
    traverse(ast, {pre: function(node) {
        if (isLvalue(node)) {
            var scope = node.$scope.lookup(node.name);
            if (scope && scope.getKind(node.name) === "const") {
                error(getline(node), "can't assign to const variable {0}", node.name);
            }
        }
    }});
}

function detectConstantLets(ast) {
    traverse(ast, {pre: function(node) {
        if (isLvalue(node)) {
            var scope = node.$scope.lookup(node.name);
            if (scope) {
                scope.markWrite(node.name);
            }
        }
    }});

    ast.$scope.detectUnmodifiedLets();
}

function setupScopeAndReferences(root, opts) {
    // setup scopes
    traverse(root, {pre: createScopes});
    var topScope = createTopScope(root.$scope, options.environments, options.globals);

    // allIdentifiers contains all declared and referenced vars
    // collect all declaration names (including those in topScope)
    var allIdentifiers = stringset();
    topScope.traverse({pre: function(scope) {
        allIdentifiers.addMany(scope.decls.keys());
    }});

    // setup node.$refToScope, check for errors.
    // also collects all referenced names to allIdentifiers
    setupReferences(root, allIdentifiers, opts);
    return allIdentifiers;
}

function cleanupTree(root) {
    traverse(root, {pre: function(node) {
        for (var prop in node) {
            if (prop[0] === "$") {
                delete node[prop];
            }
        }
    }});
}

function run(src, config) {
    // alter the options singleton with user configuration
    for (var key in config) {
        options[key] = config[key];
    }

    var parsed;

    if (is.object(src)) {
        if (!options.ast) {
            return {
                errors: [
                    "Can't produce string output when input is an AST. " +
                    "Did you forget to set options.ast = true?"
                ],
            };
        }

        // Received an AST object as src, so no need to parse it.
        parsed = src;

    } else if (is.string(src)) {
        try {
            parsed = options.parse(src, {
                loc: true,
                range: true,
            });
        } catch (e) {
            return {
                errors: [
                    fmt("line {0} column {1}: Error during input file parsing\n{2}\n{3}",
                        e.lineNumber,
                        e.column,
                        src.split("\n")[e.lineNumber - 1],
                        fmt.repeat(" ", e.column - 1) + "^")
                ],
            };
        }

    } else {
        return {
            errors: ["Input was neither an AST object nor a string."],
        };
    }

    var ast = parsed;

    // TODO detect unused variables (never read)
    error.reset();

    var allIdentifiers = setupScopeAndReferences(ast, {});

    // static analysis passes
    detectLoopClosures(ast);
    detectConstAssignment(ast);
    //detectConstantLets(ast);

    var changes = [];
    transformLoopClosures(ast, changes, options);

    //ast.$scope.print(); process.exit(-1);

    if (error.errors.length >= 1) {
        return {
            errors: error.errors,
        };
    }

    if (changes.length > 0) {
        cleanupTree(ast);
        allIdentifiers = setupScopeAndReferences(ast, {analyze: false});
    }
    assert(error.errors.length === 0);

    // change constlet declarations to var, renamed if needed
    // varify modifies the scopes and AST accordingly and
    // returns a list of change fragments (to use with alter)
    var stats = new Stats();
    varify(ast, stats, allIdentifiers, changes);

    if (options.ast) {
        // return the modified AST instead of src code
        // get rid of all added $ properties first, such as $parent and $scope
        cleanupTree(ast);
        return {
            stats: stats,
            ast: ast,
        };
    } else {
        // apply changes produced by varify and return the transformed src
        var transformedSrc = alter(src, changes);
        return {
            stats: stats,
            src: transformedSrc,
        };
    }
}

module.exports = run;

},{"./error":55,"./jshint_globals/vars.js":56,"./options":57,"./scope":58,"./stats":59,"alter":60,"assert":71,"ast-traverse":62,"breakable":63,"simple-fmt":65,"simple-is":66,"stringmap":67,"stringset":68}],55:[function(require,module,exports){
"use strict";

var fmt = require("simple-fmt");
var assert = require("assert");

function error(line, var_args) {
    assert(arguments.length >= 2);

    var msg = (arguments.length === 2 ?
        String(var_args) : fmt.apply(fmt, Array.prototype.slice.call(arguments, 1)));

    error.errors.push(line === -1 ? msg : fmt("line {0}: {1}", line, msg));
}

error.reset = function() {
    error.errors = [];
};

error.reset();

module.exports = error;

},{"assert":71,"simple-fmt":65}],56:[function(require,module,exports){
// jshint -W001

"use strict";

// Identifiers provided by the ECMAScript standard.

exports.reservedVars = {
    arguments : false,
    NaN       : false
};

exports.ecmaIdentifiers = {
    Array              : false,
    Boolean            : false,
    Date               : false,
    decodeURI          : false,
    decodeURIComponent : false,
    encodeURI          : false,
    encodeURIComponent : false,
    Error              : false,
    "eval"             : false,
    EvalError          : false,
    Function           : false,
    hasOwnProperty     : false,
    isFinite           : false,
    isNaN              : false,
    JSON               : false,
    Math               : false,
    Map                : false,
    Number             : false,
    Object             : false,
    parseInt           : false,
    parseFloat         : false,
    RangeError         : false,
    ReferenceError     : false,
    RegExp             : false,
    Set                : false,
    String             : false,
    SyntaxError        : false,
    TypeError          : false,
    URIError           : false,
    WeakMap            : false
};

// Global variables commonly provided by a web browser environment.

exports.browser = {
    ArrayBuffer          : false,
    ArrayBufferView      : false,
    Audio                : false,
    Blob                 : false,
    addEventListener     : false,
    applicationCache     : false,
    atob                 : false,
    blur                 : false,
    btoa                 : false,
    clearInterval        : false,
    clearTimeout         : false,
    close                : false,
    closed               : false,
    DataView             : false,
    DOMParser            : false,
    defaultStatus        : false,
    document             : false,
    Element              : false,
    event                : false,
    FileReader           : false,
    Float32Array         : false,
    Float64Array         : false,
    FormData             : false,
    focus                : false,
    frames               : false,
    getComputedStyle     : false,
    HTMLElement          : false,
    HTMLAnchorElement    : false,
    HTMLBaseElement      : false,
    HTMLBlockquoteElement: false,
    HTMLBodyElement      : false,
    HTMLBRElement        : false,
    HTMLButtonElement    : false,
    HTMLCanvasElement    : false,
    HTMLDirectoryElement : false,
    HTMLDivElement       : false,
    HTMLDListElement     : false,
    HTMLFieldSetElement  : false,
    HTMLFontElement      : false,
    HTMLFormElement      : false,
    HTMLFrameElement     : false,
    HTMLFrameSetElement  : false,
    HTMLHeadElement      : false,
    HTMLHeadingElement   : false,
    HTMLHRElement        : false,
    HTMLHtmlElement      : false,
    HTMLIFrameElement    : false,
    HTMLImageElement     : false,
    HTMLInputElement     : false,
    HTMLIsIndexElement   : false,
    HTMLLabelElement     : false,
    HTMLLayerElement     : false,
    HTMLLegendElement    : false,
    HTMLLIElement        : false,
    HTMLLinkElement      : false,
    HTMLMapElement       : false,
    HTMLMenuElement      : false,
    HTMLMetaElement      : false,
    HTMLModElement       : false,
    HTMLObjectElement    : false,
    HTMLOListElement     : false,
    HTMLOptGroupElement  : false,
    HTMLOptionElement    : false,
    HTMLParagraphElement : false,
    HTMLParamElement     : false,
    HTMLPreElement       : false,
    HTMLQuoteElement     : false,
    HTMLScriptElement    : false,
    HTMLSelectElement    : false,
    HTMLStyleElement     : false,
    HTMLTableCaptionElement: false,
    HTMLTableCellElement : false,
    HTMLTableColElement  : false,
    HTMLTableElement     : false,
    HTMLTableRowElement  : false,
    HTMLTableSectionElement: false,
    HTMLTextAreaElement  : false,
    HTMLTitleElement     : false,
    HTMLUListElement     : false,
    HTMLVideoElement     : false,
    history              : false,
    Int16Array           : false,
    Int32Array           : false,
    Int8Array            : false,
    Image                : false,
    length               : false,
    localStorage         : false,
    location             : false,
    MessageChannel       : false,
    MessageEvent         : false,
    MessagePort          : false,
    moveBy               : false,
    moveTo               : false,
    MutationObserver     : false,
    name                 : false,
    Node                 : false,
    NodeFilter           : false,
    navigator            : false,
    onbeforeunload       : true,
    onblur               : true,
    onerror              : true,
    onfocus              : true,
    onload               : true,
    onresize             : true,
    onunload             : true,
    open                 : false,
    openDatabase         : false,
    opener               : false,
    Option               : false,
    parent               : false,
    print                : false,
    removeEventListener  : false,
    resizeBy             : false,
    resizeTo             : false,
    screen               : false,
    scroll               : false,
    scrollBy             : false,
    scrollTo             : false,
    sessionStorage       : false,
    setInterval          : false,
    setTimeout           : false,
    SharedWorker         : false,
    status               : false,
    top                  : false,
    Uint16Array          : false,
    Uint32Array          : false,
    Uint8Array           : false,
    Uint8ClampedArray    : false,
    WebSocket            : false,
    window               : false,
    Worker               : false,
    XMLHttpRequest       : false,
    XMLSerializer        : false,
    XPathEvaluator       : false,
    XPathException       : false,
    XPathExpression      : false,
    XPathNamespace       : false,
    XPathNSResolver      : false,
    XPathResult          : false
};

exports.devel = {
    alert  : false,
    confirm: false,
    console: false,
    Debug  : false,
    opera  : false,
    prompt : false
};

exports.worker = {
    importScripts: true,
    postMessage  : true,
    self         : true
};

// Widely adopted global names that are not part of ECMAScript standard
exports.nonstandard = {
    escape  : false,
    unescape: false
};

// Globals provided by popular JavaScript environments.

exports.couch = {
    "require" : false,
    respond   : false,
    getRow    : false,
    emit      : false,
    send      : false,
    start     : false,
    sum       : false,
    log       : false,
    exports   : false,
    module    : false,
    provides  : false
};

exports.node = {
    __filename   : false,
    __dirname    : false,
    Buffer       : false,
    DataView     : false,
    console      : false,
    exports      : true,  // In Node it is ok to exports = module.exports = foo();
    GLOBAL       : false,
    global       : false,
    module       : false,
    process      : false,
    require      : false,
    setTimeout   : false,
    clearTimeout : false,
    setInterval  : false,
    clearInterval: false
};

exports.phantom = {
    phantom      : true,
    require      : true,
    WebPage      : true
};

exports.rhino = {
    defineClass  : false,
    deserialize  : false,
    gc           : false,
    help         : false,
    importPackage: false,
    "java"       : false,
    load         : false,
    loadClass    : false,
    print        : false,
    quit         : false,
    readFile     : false,
    readUrl      : false,
    runCommand   : false,
    seal         : false,
    serialize    : false,
    spawn        : false,
    sync         : false,
    toint32      : false,
    version      : false
};

exports.wsh = {
    ActiveXObject            : true,
    Enumerator               : true,
    GetObject                : true,
    ScriptEngine             : true,
    ScriptEngineBuildVersion : true,
    ScriptEngineMajorVersion : true,
    ScriptEngineMinorVersion : true,
    VBArray                  : true,
    WSH                      : true,
    WScript                  : true,
    XDomainRequest           : true
};

// Globals provided by popular JavaScript libraries.

exports.dojo = {
    dojo     : false,
    dijit    : false,
    dojox    : false,
    define   : false,
    "require": false
};

exports.jquery = {
    "$"    : false,
    jQuery : false
};

exports.mootools = {
    "$"           : false,
    "$$"          : false,
    Asset         : false,
    Browser       : false,
    Chain         : false,
    Class         : false,
    Color         : false,
    Cookie        : false,
    Core          : false,
    Document      : false,
    DomReady      : false,
    DOMEvent      : false,
    DOMReady      : false,
    Drag          : false,
    Element       : false,
    Elements      : false,
    Event         : false,
    Events        : false,
    Fx            : false,
    Group         : false,
    Hash          : false,
    HtmlTable     : false,
    Iframe        : false,
    IframeShim    : false,
    InputValidator: false,
    instanceOf    : false,
    Keyboard      : false,
    Locale        : false,
    Mask          : false,
    MooTools      : false,
    Native        : false,
    Options       : false,
    OverText      : false,
    Request       : false,
    Scroller      : false,
    Slick         : false,
    Slider        : false,
    Sortables     : false,
    Spinner       : false,
    Swiff         : false,
    Tips          : false,
    Type          : false,
    typeOf        : false,
    URI           : false,
    Window        : false
};

exports.prototypejs = {
    "$"               : false,
    "$$"              : false,
    "$A"              : false,
    "$F"              : false,
    "$H"              : false,
    "$R"              : false,
    "$break"          : false,
    "$continue"       : false,
    "$w"              : false,
    Abstract          : false,
    Ajax              : false,
    Class             : false,
    Enumerable        : false,
    Element           : false,
    Event             : false,
    Field             : false,
    Form              : false,
    Hash              : false,
    Insertion         : false,
    ObjectRange       : false,
    PeriodicalExecuter: false,
    Position          : false,
    Prototype         : false,
    Selector          : false,
    Template          : false,
    Toggle            : false,
    Try               : false,
    Autocompleter     : false,
    Builder           : false,
    Control           : false,
    Draggable         : false,
    Draggables        : false,
    Droppables        : false,
    Effect            : false,
    Sortable          : false,
    SortableObserver  : false,
    Sound             : false,
    Scriptaculous     : false
};

exports.yui = {
    YUI       : false,
    Y         : false,
    YUI_config: false
};


},{}],57:[function(require,module,exports){
// default configuration

module.exports = {
    disallowVars: false,
    disallowDuplicated: true,
    disallowUnknownReferences: true,
    parse: require("esprima").parse,
};

},{"esprima":64}],58:[function(require,module,exports){
"use strict";

var assert = require("assert");
var stringmap = require("stringmap");
var stringset = require("stringset");
var is = require("simple-is");
var fmt = require("simple-fmt");
var error = require("./error");
var options = require("./options");

function Scope(args) {
    assert(is.someof(args.kind, ["hoist", "block", "catch-block"]));
    assert(is.object(args.node));
    assert(args.parent === null || is.object(args.parent));

    // kind === "hoist": function scopes, program scope, injected globals
    // kind === "block": ES6 block scopes
    // kind === "catch-block": catch block scopes
    this.kind = args.kind;

    // the AST node the block corresponds to
    this.node = args.node;

    // parent scope
    this.parent = args.parent;

    // children scopes for easier traversal (populated internally)
    this.children = [];

    // scope declarations. decls[variable_name] = {
    //     kind: "fun" for functions,
    //           "param" for function parameters,
    //           "caught" for catch parameter
    //           "var",
    //           "const",
    //           "let"
    //     node: the AST node the declaration corresponds to
    //     from: source code index from which it is visible at earliest
    //           (only stored for "const", "let" [and "var"] nodes)
    // }
    this.decls = stringmap();

    // names of all declarations within this scope that was ever written
    // TODO move to decls.w?
    // TODO create corresponding read?
    this.written = stringset();

    // names of all variables declared outside this hoist scope but
    // referenced in this scope (immediately or in child).
    // only stored on hoist scopes for efficiency
    // (because we currently generate lots of empty block scopes)
    this.propagates = (this.kind === "hoist" ? stringset() : null);

    // scopes register themselves with their parents for easier traversal
    if (this.parent) {
        this.parent.children.push(this);
    }
}

Scope.prototype.print = function(indent) {
    indent = indent || 0;
    var scope = this;
    var names = this.decls.keys().map(function(name) {
        return fmt("{0} [{1}]", name, scope.decls.get(name).kind);
    }).join(", ");
    var propagates = this.propagates ? this.propagates.items().join(", ") : "";
    console.log(fmt("{0}{1}: {2}. propagates: {3}", fmt.repeat(" ", indent), this.node.type, names, propagates));
    this.children.forEach(function(c) {
        c.print(indent + 2);
    });
};

Scope.prototype.add = function(name, kind, node, referableFromPos) {
    assert(is.someof(kind, ["fun", "param", "var", "caught", "const", "let"]));

    function isConstLet(kind) {
        return is.someof(kind, ["const", "let"]);
    }

    var scope = this;

    // search nearest hoist-scope for fun, param and var's
    // const, let and caught variables go directly in the scope (which may be hoist, block or catch-block)
    if (is.someof(kind, ["fun", "param", "var"])) {
        while (scope.kind !== "hoist") {
            if (scope.decls.has(name) && isConstLet(scope.decls.get(name).kind)) { // could be caught
                return error(node.loc.start.line, "{0} is already declared", name);
            }
            scope = scope.parent;
        }
    }
    // name exists in scope and either new or existing kind is const|let => error
    if (scope.decls.has(name) && (options.disallowDuplicated || isConstLet(scope.decls.get(name).kind) || isConstLet(kind))) {
        return error(node.loc.start.line, "{0} is already declared", name);
    }

    var declaration = {
        kind: kind,
        node: node,
    };
    if (referableFromPos) {
        assert(is.someof(kind, ["var", "const", "let"]));
        declaration.from = referableFromPos;
    }
    scope.decls.set(name, declaration);
};

Scope.prototype.getKind = function(name) {
    assert(is.string(name));
    var decl = this.decls.get(name);
    return decl ? decl.kind : null;
};

Scope.prototype.getNode = function(name) {
    assert(is.string(name));
    var decl = this.decls.get(name);
    return decl ? decl.node : null;
};

Scope.prototype.getFromPos = function(name) {
    assert(is.string(name));
    var decl = this.decls.get(name);
    return decl ? decl.from : null;
};

Scope.prototype.hasOwn = function(name) {
    return this.decls.has(name);
};

Scope.prototype.remove = function(name) {
    return this.decls.remove(name);
};

Scope.prototype.doesPropagate = function(name) {
    return this.propagates.has(name);
};

Scope.prototype.markPropagates = function(name) {
    this.propagates.add(name);
};

Scope.prototype.closestHoistScope = function() {
    var scope = this;
    while (scope.kind !== "hoist") {
        scope = scope.parent;
    }
    return scope;
};

Scope.prototype.hasFunctionScopeBetween = function(outer) {
    function isFunction(node) {
        return is.someof(node.type, ["FunctionDeclaration", "FunctionExpression"]);
    }

    for (var scope = this; scope; scope = scope.parent) {
        if (scope === outer) {
            return false;
        }
        if (isFunction(scope.node)) {
            return true;
        }
    }

    throw new Error("wasn't inner scope of outer");
};

Scope.prototype.lookup = function(name) {
    for (var scope = this; scope; scope = scope.parent) {
        if (scope.decls.has(name)) {
            return scope;
        } else if (scope.kind === "hoist") {
            scope.propagates.add(name);
        }
    }
    return null;
};

Scope.prototype.markWrite = function(name) {
    assert(is.string(name));
    this.written.add(name);
};

// detects let variables that are never modified (ignores top-level)
Scope.prototype.detectUnmodifiedLets = function() {
    var outmost = this;

    function detect(scope) {
        if (scope !== outmost) {
            scope.decls.keys().forEach(function(name) {
                if (scope.getKind(name) === "let" && !scope.written.has(name)) {
                    return error(scope.getNode(name).loc.start.line, "{0} is declared as let but never modified so could be const", name);
                }
            });
        }

        scope.children.forEach(function(childScope) {
            detect(childScope);;
        });
    }
    detect(this);
};

Scope.prototype.traverse = function(options) {
    options = options || {};
    var pre = options.pre;
    var post = options.post;

    function visit(scope) {
        if (pre) {
            pre(scope);
        }
        scope.children.forEach(function(childScope) {
            visit(childScope);
        });
        if (post) {
            post(scope);
        }
    }

    visit(this);
};

module.exports = Scope;

},{"./error":55,"./options":57,"assert":71,"simple-fmt":65,"simple-is":66,"stringmap":67,"stringset":68}],59:[function(require,module,exports){
var fmt = require("simple-fmt");
var is = require("simple-is");
var assert = require("assert");

function Stats() {
    this.lets = 0;
    this.consts = 0;
    this.renames = [];
}

Stats.prototype.declarator = function(kind) {
    assert(is.someof(kind, ["const", "let"]));
    if (kind === "const") {
        this.consts++;
    } else {
        this.lets++;
    }
};

Stats.prototype.rename = function(oldName, newName, line) {
    this.renames.push({
        oldName: oldName,
        newName: newName,
        line: line,
    });
};

Stats.prototype.toString = function() {
//    console.log("defs.js stats for file {0}:", filename)

    var renames = this.renames.map(function(r) {
        return r;
    }).sort(function(a, b) {
            return a.line - b.line;
        }); // sort a copy of renames

    var renameStr = renames.map(function(rename) {
        return fmt("\nline {0}: {1} => {2}", rename.line, rename.oldName, rename.newName);
    }).join("");

    var sum = this.consts + this.lets;
    var constlets = (sum === 0 ?
        "can't calculate const coverage (0 consts, 0 lets)" :
        fmt("{0}% const coverage ({1} consts, {2} lets)",
            Math.floor(100 * this.consts / sum), this.consts, this.lets));

    return constlets + renameStr + "\n";
};

module.exports = Stats;

},{"assert":71,"simple-fmt":65,"simple-is":66}],60:[function(require,module,exports){
// alter.js
// MIT licensed, see LICENSE file
// Copyright (c) 2013 Olov Lassus <olov.lassus@gmail.com>

var assert = require("assert");
var stableSort = require("stable");

// fragments is a list of {start: index, end: index, str: string to replace with}
function alter(str, fragments) {
    "use strict";

    var isArray = Array.isArray || function(v) {
        return Object.prototype.toString.call(v) === "[object Array]";
    };;

    assert(typeof str === "string");
    assert(isArray(fragments));

    // stableSort isn't in-place so no need to copy array first
    var sortedFragments = stableSort(fragments, function(a, b) {
        return a.start - b.start;
    });

    var outs = [];

    var pos = 0;
    for (var i = 0; i < sortedFragments.length; i++) {
        var frag = sortedFragments[i];

        assert(pos <= frag.start);
        assert(frag.start <= frag.end);
        outs.push(str.slice(pos, frag.start));
        outs.push(frag.str);
        pos = frag.end;
    }
    if (pos < str.length) {
        outs.push(str.slice(pos));
    }

    return outs.join("");
}

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = alter;
}

},{"assert":71,"stable":61}],61:[function(require,module,exports){
//! stable.js 0.1.4, https://github.com/Two-Screen/stable
//! © 2012 Stéphan Kochen, Angry Bytes. MIT licensed.

(function() {

// A stable array sort, because `Array#sort()` is not guaranteed stable.
// This is an implementation of merge sort, without recursion.

var stable = function(arr, comp) {
    return exec(arr.slice(), comp);
};

stable.inplace = function(arr, comp) {
    var result = exec(arr, comp);

    // This simply copies back if the result isn't in the original array,
    // which happens on an odd number of passes.
    if (result !== arr) {
        pass(result, null, arr.length, arr);
    }

    return arr;
};

// Execute the sort using the input array and a second buffer as work space.
// Returns one of those two, containing the final result.
function exec(arr, comp) {
    if (typeof(comp) !== 'function') {
        comp = function(a, b) {
            return String(a).localeCompare(b);
        };
    }

    // Short-circuit when there's nothing to sort.
    var len = arr.length;
    if (len <= 1) {
        return arr;
    }

    // Rather than dividing input, simply iterate chunks of 1, 2, 4, 8, etc.
    // Chunks are the size of the left or right hand in merge sort.
    // Stop when the left-hand covers all of the array.
    var buffer = new Array(len);
    for (var chk = 1; chk < len; chk *= 2) {
        pass(arr, comp, chk, buffer);

        var tmp = arr;
        arr = buffer;
        buffer = tmp;
    }

    return arr;
}

// Run a single pass with the given chunk size.
var pass = function(arr, comp, chk, result) {
    var len = arr.length;
    var i = 0;
    // Step size / double chunk size.
    var dbl = chk * 2;
    // Bounds of the left and right chunks.
    var l, r, e;
    // Iterators over the left and right chunk.
    var li, ri;

    // Iterate over pairs of chunks.
    for (l = 0; l < len; l += dbl) {
        r = l + chk;
        e = r + chk;
        if (r > len) r = len;
        if (e > len) e = len;

        // Iterate both chunks in parallel.
        li = l;
        ri = r;
        while (true) {
            // Compare the chunks.
            if (li < r && ri < e) {
                // This works for a regular `sort()` compatible comparator,
                // but also for a simple comparator like: `a > b`
                if (comp(arr[li], arr[ri]) <= 0) {
                    result[i++] = arr[li++];
                }
                else {
                    result[i++] = arr[ri++];
                }
            }
            // Nothing to compare, just flush what's left.
            else if (li < r) {
                result[i++] = arr[li++];
            }
            else if (ri < e) {
                result[i++] = arr[ri++];
            }
            // Both iterators are at the chunk ends.
            else {
                break;
            }
        }
    }
};

// Export using CommonJS or to the window.
if (typeof(module) !== 'undefined') {
    module.exports = stable;
}
else {
    window.stable = stable;
}

})();

},{}],62:[function(require,module,exports){
function traverse(root, options) {
    "use strict";

    options = options || {};
    var pre = options.pre;
    var post = options.post;
    var skipProperty = options.skipProperty;

    function visit(node, parent, prop, idx) {
        if (!node || typeof node.type !== "string") {
            return;
        }

        var res = undefined;
        if (pre) {
            res = pre(node, parent, prop, idx);
        }

        if (res !== false) {
            for (var prop in node) {
                if (skipProperty ? skipProperty(prop, node) : prop[0] === "$") {
                    continue;
                }

                var child = node[prop];

                if (Array.isArray(child)) {
                    for (var i = 0; i < child.length; i++) {
                        visit(child[i], node, prop, i);
                    }
                } else {
                    visit(child, node, prop);
                }
            }
        }

        if (post) {
            post(node, parent, prop, idx);
        }
    }

    visit(root, null);
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = traverse;
}

},{}],63:[function(require,module,exports){
// breakable.js
// MIT licensed, see LICENSE file
// Copyright (c) 2013 Olov Lassus <olov.lassus@gmail.com>

var breakable = (function() {
    "use strict";

    function Val(val) {
        this.val = val;
    }

    function brk(val) {
        throw new Val(val);
    }

    function breakable(fn) {
        try {
            return fn(brk);
        } catch (e) {
            if (e instanceof Val) {
                return e.val;
            }
            throw e;
        }
    }

    breakable.fn = function breakablefn(fn) {
        return breakable.bind(null, fn);
    };

    return breakable;
})();

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = breakable;
}

},{}],64:[function(require,module,exports){
module.exports=require(35)
},{}],65:[function(require,module,exports){
// simple-fmt.js
// MIT licensed, see LICENSE file
// Copyright (c) 2013 Olov Lassus <olov.lassus@gmail.com>

var fmt = (function() {
    "use strict";

    function fmt(str, var_args) {
        var args = Array.prototype.slice.call(arguments, 1);
        return str.replace(/\{(\d+)\}/g, function(s, match) {
            return (match in args ? args[match] : s);
        });
    }

    function obj(str, obj) {
        return str.replace(/\{([_$a-zA-Z0-9][_$a-zA-Z0-9]*)\}/g, function(s, match) {
            return (match in obj ? obj[match] : s);
        });
    }

    function repeat(str, n) {
        return (new Array(n + 1)).join(str);
    }

    fmt.fmt = fmt;
    fmt.obj = obj;
    fmt.repeat = repeat;
    return fmt;
})();

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = fmt;
}

},{}],66:[function(require,module,exports){
// simple-is.js
// MIT licensed, see LICENSE file
// Copyright (c) 2013 Olov Lassus <olov.lassus@gmail.com>

var is = (function() {
    "use strict";

    var hasOwnProperty = Object.prototype.hasOwnProperty;
    var toString = Object.prototype.toString;
    var _undefined = void 0;

    return {
        nan: function(v) {
            return v !== v;
        },
        boolean: function(v) {
            return typeof v === "boolean";
        },
        number: function(v) {
            return typeof v === "number";
        },
        string: function(v) {
            return typeof v === "string";
        },
        fn: function(v) {
            return typeof v === "function";
        },
        object: function(v) {
            return v !== null && typeof v === "object";
        },
        primitive: function(v) {
            var t = typeof v;
            return v === null || v === _undefined ||
                t === "boolean" || t === "number" || t === "string";
        },
        array: Array.isArray || function(v) {
            return toString.call(v) === "[object Array]";
        },
        finitenumber: function(v) {
            return typeof v === "number" && isFinite(v);
        },
        someof: function(v, values) {
            return values.indexOf(v) >= 0;
        },
        noneof: function(v, values) {
            return values.indexOf(v) === -1;
        },
        own: function(obj, prop) {
            return hasOwnProperty.call(obj, prop);
        },
    };
})();

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = is;
}

},{}],67:[function(require,module,exports){
// stringmap.js
// MIT licensed, see LICENSE file
// Copyright (c) 2013 Olov Lassus <olov.lassus@gmail.com>

var StringMap = (function() {
    "use strict";

    // to save us a few characters
    var hasOwnProperty = Object.prototype.hasOwnProperty;

    var create = (function() {
        function hasOwnEnumerableProps(obj) {
            for (var prop in obj) {
                if (hasOwnProperty.call(obj, prop)) {
                    return true;
                }
            }
            return false;
        }
        // FF <= 3.6:
        // o = {}; o.hasOwnProperty("__proto__" or "__count__" or "__parent__") => true
        // o = {"__proto__": null}; Object.prototype.hasOwnProperty.call(o, "__proto__" or "__count__" or "__parent__") => false
        function hasOwnPollutedProps(obj) {
            return hasOwnProperty.call(obj, "__count__") || hasOwnProperty.call(obj, "__parent__");
        }

        var useObjectCreate = false;
        if (typeof Object.create === "function") {
            if (!hasOwnEnumerableProps(Object.create(null))) {
                useObjectCreate = true;
            }
        }
        if (useObjectCreate === false) {
            if (hasOwnEnumerableProps({})) {
                throw new Error("StringMap environment error 0, please file a bug at https://github.com/olov/stringmap/issues");
            }
        }
        // no throw yet means we can create objects without own enumerable props (safe-guard against VMs and shims)

        var o = (useObjectCreate ? Object.create(null) : {});
        var useProtoClear = false;
        if (hasOwnPollutedProps(o)) {
            o.__proto__ = null;
            if (hasOwnEnumerableProps(o) || hasOwnPollutedProps(o)) {
                throw new Error("StringMap environment error 1, please file a bug at https://github.com/olov/stringmap/issues");
            }
            useProtoClear = true;
        }
        // no throw yet means we can create objects without own polluted props (safe-guard against VMs and shims)

        return function() {
            var o = (useObjectCreate ? Object.create(null) : {});
            if (useProtoClear) {
                o.__proto__ = null;
            }
            return o;
        };
    })();

    // stringmap ctor
    function stringmap(optional_object) {
        // use with or without new
        if (!(this instanceof stringmap)) {
            return new stringmap(optional_object);
        }
        this.obj = create();
        this.hasProto = false; // false (no __proto__ key) or true (has __proto__ key)
        this.proto = undefined; // value for __proto__ key when hasProto is true, undefined otherwise

        if (optional_object) {
            this.setMany(optional_object);
        }
    };

    // primitive methods that deals with data representation
    stringmap.prototype.has = function(key) {
        // The type-check of key in has, get, set and delete is important because otherwise an object
        // {toString: function() { return "__proto__"; }} can avoid the key === "__proto__" test.
        // The alternative to type-checking would be to force string conversion, i.e. key = String(key);
        if (typeof key !== "string") {
            throw new Error("StringMap expected string key");
        }
        return (key === "__proto__" ?
            this.hasProto :
            hasOwnProperty.call(this.obj, key));
    };

    stringmap.prototype.get = function(key) {
        if (typeof key !== "string") {
            throw new Error("StringMap expected string key");
        }
        return (key === "__proto__" ?
            this.proto :
            (hasOwnProperty.call(this.obj, key) ? this.obj[key] : undefined));
    };

    stringmap.prototype.set = function(key, value) {
        if (typeof key !== "string") {
            throw new Error("StringMap expected string key");
        }
        if (key === "__proto__") {
            this.hasProto = true;
            this.proto = value;
        } else {
            this.obj[key] = value;
        }
    };

    stringmap.prototype.remove = function(key) {
        if (typeof key !== "string") {
            throw new Error("StringMap expected string key");
        }
        var didExist = this.has(key);
        if (key === "__proto__") {
            this.hasProto = false;
            this.proto = undefined;
        } else {
            delete this.obj[key];
        }
        return didExist;
    };

    // alias remove to delete but beware:
    // sm.delete("key"); // OK in ES5 and later
    // sm['delete']("key"); // OK in all ES versions
    // sm.remove("key"); // OK in all ES versions
    stringmap.prototype['delete'] = stringmap.prototype.remove;

    stringmap.prototype.isEmpty = function() {
        for (var key in this.obj) {
            if (hasOwnProperty.call(this.obj, key)) {
                return false;
            }
        }
        return !this.hasProto;
    };

    stringmap.prototype.size = function() {
        var len = 0;
        for (var key in this.obj) {
            if (hasOwnProperty.call(this.obj, key)) {
                ++len;
            }
        }
        return (this.hasProto ? len + 1 : len);
    };

    stringmap.prototype.keys = function() {
        var keys = [];
        for (var key in this.obj) {
            if (hasOwnProperty.call(this.obj, key)) {
                keys.push(key);
            }
        }
        if (this.hasProto) {
            keys.push("__proto__");
        }
        return keys;
    };

    stringmap.prototype.values = function() {
        var values = [];
        for (var key in this.obj) {
            if (hasOwnProperty.call(this.obj, key)) {
                values.push(this.obj[key]);
            }
        }
        if (this.hasProto) {
            values.push(this.proto);
        }
        return values;
    };

    stringmap.prototype.items = function() {
        var items = [];
        for (var key in this.obj) {
            if (hasOwnProperty.call(this.obj, key)) {
                items.push([key, this.obj[key]]);
            }
        }
        if (this.hasProto) {
            items.push(["__proto__", this.proto]);
        }
        return items;
    };


    // methods that rely on the above primitives
    stringmap.prototype.setMany = function(object) {
        if (object === null || (typeof object !== "object" && typeof object !== "function")) {
            throw new Error("StringMap expected Object");
        }
        for (var key in object) {
            if (hasOwnProperty.call(object, key)) {
                this.set(key, object[key]);
            }
        }
        return this;
    };

    stringmap.prototype.merge = function(other) {
        var keys = other.keys();
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            this.set(key, other.get(key));
        }
        return this;
    };

    stringmap.prototype.map = function(fn) {
        var keys = this.keys();
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            keys[i] = fn(this.get(key), key); // re-use keys array for results
        }
        return keys;
    };

    stringmap.prototype.forEach = function(fn) {
        var keys = this.keys();
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            fn(this.get(key), key);
        }
    };

    stringmap.prototype.clone = function() {
        var other = stringmap();
        return other.merge(this);
    };

    stringmap.prototype.toString = function() {
        var self = this;
        return "{" + this.keys().map(function(key) {
            return JSON.stringify(key) + ":" + JSON.stringify(self.get(key));
        }).join(",") + "}";
    };

    return stringmap;
})();

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = StringMap;
}

},{}],68:[function(require,module,exports){
// stringset.js
// MIT licensed, see LICENSE file
// Copyright (c) 2013 Olov Lassus <olov.lassus@gmail.com>

var StringSet = (function() {
    "use strict";

    // to save us a few characters
    var hasOwnProperty = Object.prototype.hasOwnProperty;

    var create = (function() {
        function hasOwnEnumerableProps(obj) {
            for (var prop in obj) {
                if (hasOwnProperty.call(obj, prop)) {
                    return true;
                }
            }
            return false;
        }

        // FF <= 3.6:
        // o = {}; o.hasOwnProperty("__proto__" or "__count__" or "__parent__") => true
        // o = {"__proto__": null}; Object.prototype.hasOwnProperty.call(o, "__proto__" or "__count__" or "__parent__") => false
        function hasOwnPollutedProps(obj) {
            return hasOwnProperty.call(obj, "__count__") || hasOwnProperty.call(obj, "__parent__");
        }

        var useObjectCreate = false;
        if (typeof Object.create === "function") {
            if (!hasOwnEnumerableProps(Object.create(null))) {
                useObjectCreate = true;
            }
        }
        if (useObjectCreate === false) {
            if (hasOwnEnumerableProps({})) {
                throw new Error("StringSet environment error 0, please file a bug at https://github.com/olov/stringset/issues");
            }
        }
        // no throw yet means we can create objects without own enumerable props (safe-guard against VMs and shims)

        var o = (useObjectCreate ? Object.create(null) : {});
        var useProtoClear = false;
        if (hasOwnPollutedProps(o)) {
            o.__proto__ = null;
            if (hasOwnEnumerableProps(o) || hasOwnPollutedProps(o)) {
                throw new Error("StringSet environment error 1, please file a bug at https://github.com/olov/stringset/issues");
            }
            useProtoClear = true;
        }
        // no throw yet means we can create objects without own polluted props (safe-guard against VMs and shims)

        return function() {
            var o = (useObjectCreate ? Object.create(null) : {});
            if (useProtoClear) {
                o.__proto__ = null;
            }
            return o;
        };
    })();

    // stringset ctor
    function stringset(optional_array) {
        // use with or without new
        if (!(this instanceof stringset)) {
            return new stringset(optional_array);
        }
        this.obj = create();
        this.hasProto = false; // false (no __proto__ item) or true (has __proto__ item)

        if (optional_array) {
            this.addMany(optional_array);
        }
    };

    // primitive methods that deals with data representation
    stringset.prototype.has = function(item) {
        // The type-check of item in has, get, set and delete is important because otherwise an object
        // {toString: function() { return "__proto__"; }} can avoid the item === "__proto__" test.
        // The alternative to type-checking would be to force string conversion, i.e. item = String(item);
        if (typeof item !== "string") {
            throw new Error("StringSet expected string item");
        }
        return (item === "__proto__" ?
            this.hasProto :
            hasOwnProperty.call(this.obj, item));
    };

    stringset.prototype.add = function(item) {
        if (typeof item !== "string") {
            throw new Error("StringSet expected string item");
        }
        if (item === "__proto__") {
            this.hasProto = true;
        } else {
            this.obj[item] = true;
        }
    };

    stringset.prototype.remove = function(item) {
        if (typeof item !== "string") {
            throw new Error("StringSet expected string item");
        }
        var didExist = this.has(item);
        if (item === "__proto__") {
            this.hasProto = false;
        } else {
            delete this.obj[item];
        }
        return didExist;
    };

    // alias remove to delete but beware:
    // ss.delete("key"); // OK in ES5 and later
    // ss['delete']("key"); // OK in all ES versions
    // ss.remove("key"); // OK in all ES versions
    stringset.prototype['delete'] = stringset.prototype.remove;

    stringset.prototype.isEmpty = function() {
        for (var item in this.obj) {
            if (hasOwnProperty.call(this.obj, item)) {
                return false;
            }
        }
        return !this.hasProto;
    };

    stringset.prototype.size = function() {
        var len = 0;
        for (var item in this.obj) {
            if (hasOwnProperty.call(this.obj, item)) {
                ++len;
            }
        }
        return (this.hasProto ? len + 1 : len);
    };

    stringset.prototype.items = function() {
        var items = [];
        for (var item in this.obj) {
            if (hasOwnProperty.call(this.obj, item)) {
                items.push(item);
            }
        }
        if (this.hasProto) {
            items.push("__proto__");
        }
        return items;
    };


    // methods that rely on the above primitives
    stringset.prototype.addMany = function(items) {
        if (!Array.isArray(items)) {
            throw new Error("StringSet expected array");
        }
        for (var i = 0; i < items.length; i++) {
            this.add(items[i]);
        }
        return this;
    };

    stringset.prototype.merge = function(other) {
        this.addMany(other.items());
        return this;
    };

    stringset.prototype.clone = function() {
        var other = stringset();
        return other.merge(this);
    };

    stringset.prototype.toString = function() {
        return "{" + this.items().map(JSON.stringify).join(",") + "}";
    };

    return stringset;
})();

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = StringSet;
}

},{}],69:[function(require,module,exports){
/*
  Copyright (C) 2013 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2013 Thaddee Tyl <thaddee.tyl@gmail.com>
  Copyright (C) 2012 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2012 Mathias Bynens <mathias@qiwi.be>
  Copyright (C) 2012 Joost-Wim Boekesteijn <joost-wim@boekesteijn.nl>
  Copyright (C) 2012 Kris Kowal <kris.kowal@cixar.com>
  Copyright (C) 2012 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012 Arpad Borsos <arpad.borsos@googlemail.com>
  Copyright (C) 2011 Ariya Hidayat <ariya.hidayat@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/*jslint bitwise:true plusplus:true */
/*global esprima:true, define:true, exports:true, window: true,
throwError: true, generateStatement: true, peek: true,
parseAssignmentExpression: true, parseBlock: true,
parseClassExpression: true, parseClassDeclaration: true, parseExpression: true,
parseForStatement: true,
parseFunctionDeclaration: true, parseFunctionExpression: true,
parseFunctionSourceElements: true, parseVariableIdentifier: true,
parseImportSpecifier: true,
parseLeftHandSideExpression: true, parseParams: true, validateParam: true,
parseSpreadOrAssignmentExpression: true,
parseStatement: true, parseSourceElement: true, parseModuleBlock: true, parseConciseBody: true,
parseYieldExpression: true
*/

(function (root, factory) {
    'use strict';

    // Universal Module Definition (UMD) to support AMD, CommonJS/Node.js,
    // Rhino, and plain browser loading.
    if (typeof define === 'function' && define.amd) {
        define(['exports'], factory);
    } else if (typeof exports !== 'undefined') {
        factory(exports);
    } else {
        factory((root.esprima = {}));
    }
}(this, function (exports) {
    'use strict';

    var Token,
        TokenName,
        FnExprTokens,
        Syntax,
        PropertyKind,
        Messages,
        Regex,
        SyntaxTreeDelegate,
        ClassPropertyType,
        source,
        strict,
        index,
        lineNumber,
        lineStart,
        length,
        delegate,
        lookahead,
        state,
        extra;

    Token = {
        BooleanLiteral: 1,
        EOF: 2,
        Identifier: 3,
        Keyword: 4,
        NullLiteral: 5,
        NumericLiteral: 6,
        Punctuator: 7,
        StringLiteral: 8,
        RegularExpression: 9,
        Template: 10
    };

    TokenName = {};
    TokenName[Token.BooleanLiteral] = 'Boolean';
    TokenName[Token.EOF] = '<end>';
    TokenName[Token.Identifier] = 'Identifier';
    TokenName[Token.Keyword] = 'Keyword';
    TokenName[Token.NullLiteral] = 'Null';
    TokenName[Token.NumericLiteral] = 'Numeric';
    TokenName[Token.Punctuator] = 'Punctuator';
    TokenName[Token.StringLiteral] = 'String';
    TokenName[Token.RegularExpression] = 'RegularExpression';

    // A function following one of those tokens is an expression.
    FnExprTokens = ['(', '{', '[', 'in', 'typeof', 'instanceof', 'new',
                    'return', 'case', 'delete', 'throw', 'void',
                    // assignment operators
                    '=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '>>>=',
                    '&=', '|=', '^=', ',',
                    // binary/unary operators
                    '+', '-', '*', '/', '%', '++', '--', '<<', '>>', '>>>', '&',
                    '|', '^', '!', '~', '&&', '||', '?', ':', '===', '==', '>=',
                    '<=', '<', '>', '!=', '!=='];

    Syntax = {
        ArrayExpression: 'ArrayExpression',
        ArrayPattern: 'ArrayPattern',
        ArrowFunctionExpression: 'ArrowFunctionExpression',
        AssignmentExpression: 'AssignmentExpression',
        BinaryExpression: 'BinaryExpression',
        BlockStatement: 'BlockStatement',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ClassBody: 'ClassBody',
        ClassDeclaration: 'ClassDeclaration',
        ClassExpression: 'ClassExpression',
        ClassHeritage: 'ClassHeritage',
        ComprehensionBlock: 'ComprehensionBlock',
        ComprehensionExpression: 'ComprehensionExpression',
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DebuggerStatement: 'DebuggerStatement',
        DoWhileStatement: 'DoWhileStatement',
        EmptyStatement: 'EmptyStatement',
        ExportDeclaration: 'ExportDeclaration',
        ExportBatchSpecifier: 'ExportBatchSpecifier',
        ExportSpecifier: 'ExportSpecifier',
        ExpressionStatement: 'ExpressionStatement',
        ForInStatement: 'ForInStatement',
        ForOfStatement: 'ForOfStatement',
        ForStatement: 'ForStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        ImportDeclaration: 'ImportDeclaration',
        ImportSpecifier: 'ImportSpecifier',
        LabeledStatement: 'LabeledStatement',
        Literal: 'Literal',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        MethodDefinition: 'MethodDefinition',
        ModuleDeclaration: 'ModuleDeclaration',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        ObjectPattern: 'ObjectPattern',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SpreadElement: 'SpreadElement',
        SwitchCase: 'SwitchCase',
        SwitchStatement: 'SwitchStatement',
        TaggedTemplateExpression: 'TaggedTemplateExpression',
        TemplateElement: 'TemplateElement',
        TemplateLiteral: 'TemplateLiteral',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement',
        YieldExpression: 'YieldExpression'
    };

    PropertyKind = {
        Data: 1,
        Get: 2,
        Set: 4
    };

    ClassPropertyType = {
        'static': 'static',
        prototype: 'prototype'
    };

    // Error messages should be identical to V8.
    Messages = {
        UnexpectedToken:  'Unexpected token %0',
        UnexpectedNumber:  'Unexpected number',
        UnexpectedString:  'Unexpected string',
        UnexpectedIdentifier:  'Unexpected identifier',
        UnexpectedReserved:  'Unexpected reserved word',
        UnexpectedTemplate:  'Unexpected quasi %0',
        UnexpectedEOS:  'Unexpected end of input',
        NewlineAfterThrow:  'Illegal newline after throw',
        InvalidRegExp: 'Invalid regular expression',
        UnterminatedRegExp:  'Invalid regular expression: missing /',
        InvalidLHSInAssignment:  'Invalid left-hand side in assignment',
        InvalidLHSInFormalsList:  'Invalid left-hand side in formals list',
        InvalidLHSInForIn:  'Invalid left-hand side in for-in',
        MultipleDefaultsInSwitch: 'More than one default clause in switch statement',
        NoCatchOrFinally:  'Missing catch or finally after try',
        UnknownLabel: 'Undefined label \'%0\'',
        Redeclaration: '%0 \'%1\' has already been declared',
        IllegalContinue: 'Illegal continue statement',
        IllegalBreak: 'Illegal break statement',
        IllegalDuplicateClassProperty: 'Illegal duplicate property in class definition',
        IllegalReturn: 'Illegal return statement',
        IllegalYield: 'Illegal yield expression',
        IllegalSpread: 'Illegal spread element',
        StrictModeWith:  'Strict mode code may not include a with statement',
        StrictCatchVariable:  'Catch variable may not be eval or arguments in strict mode',
        StrictVarName:  'Variable name may not be eval or arguments in strict mode',
        StrictParamName:  'Parameter name eval or arguments is not allowed in strict mode',
        StrictParamDupe: 'Strict mode function may not have duplicate parameter names',
        ParameterAfterRestParameter: 'Rest parameter must be final parameter of an argument list',
        DefaultRestParameter: 'Rest parameter can not have a default value',
        ElementAfterSpreadElement: 'Spread must be the final element of an element list',
        ObjectPatternAsRestParameter: 'Invalid rest parameter',
        ObjectPatternAsSpread: 'Invalid spread argument',
        StrictFunctionName:  'Function name may not be eval or arguments in strict mode',
        StrictOctalLiteral:  'Octal literals are not allowed in strict mode.',
        StrictDelete:  'Delete of an unqualified identifier in strict mode.',
        StrictDuplicateProperty:  'Duplicate data property in object literal not allowed in strict mode',
        AccessorDataProperty:  'Object literal may not have data and accessor property with the same name',
        AccessorGetSet:  'Object literal may not have multiple get/set accessors with the same name',
        StrictLHSAssignment:  'Assignment to eval or arguments is not allowed in strict mode',
        StrictLHSPostfix:  'Postfix increment/decrement may not have eval or arguments operand in strict mode',
        StrictLHSPrefix:  'Prefix increment/decrement may not have eval or arguments operand in strict mode',
        StrictReservedWord:  'Use of future reserved word in strict mode',
        NewlineAfterModule:  'Illegal newline after module',
        NoFromAfterImport: 'Missing from after import',
        InvalidModuleSpecifier: 'Invalid module specifier',
        NestedModule: 'Module declaration can not be nested',
        NoYieldInGenerator: 'Missing yield in generator',
        NoUnintializedConst: 'Const must be initialized',
        ComprehensionRequiresBlock: 'Comprehension must have at least one block',
        ComprehensionError:  'Comprehension Error',
        EachNotAllowed:  'Each is not supported'
    };

    // See also tools/generate-unicode-regex.py.
    Regex = {
        NonAsciiIdentifierStart: new RegExp('[\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05d0-\u05ea\u05f0-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u08a0\u08a2-\u08ac\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097f\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c33\u0c35-\u0c39\u0c3d\u0c58\u0c59\u0c60\u0c61\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d60\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f4\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f0\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1877\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191c\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19c1-\u19c7\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4b\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1ce9-\u1cec\u1cee-\u1cf1\u1cf5\u1cf6\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2e2f\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fcc\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua697\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua78e\ua790-\ua793\ua7a0-\ua7aa\ua7f8-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa80-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uabc0-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc]'),
        NonAsciiIdentifierPart: new RegExp('[\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0300-\u0374\u0376\u0377\u037a-\u037d\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u0483-\u0487\u048a-\u0527\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u05d0-\u05ea\u05f0-\u05f2\u0610-\u061a\u0620-\u0669\u066e-\u06d3\u06d5-\u06dc\u06df-\u06e8\u06ea-\u06fc\u06ff\u0710-\u074a\u074d-\u07b1\u07c0-\u07f5\u07fa\u0800-\u082d\u0840-\u085b\u08a0\u08a2-\u08ac\u08e4-\u08fe\u0900-\u0963\u0966-\u096f\u0971-\u0977\u0979-\u097f\u0981-\u0983\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bc-\u09c4\u09c7\u09c8\u09cb-\u09ce\u09d7\u09dc\u09dd\u09df-\u09e3\u09e6-\u09f1\u0a01-\u0a03\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a59-\u0a5c\u0a5e\u0a66-\u0a75\u0a81-\u0a83\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abc-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ad0\u0ae0-\u0ae3\u0ae6-\u0aef\u0b01-\u0b03\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3c-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b56\u0b57\u0b5c\u0b5d\u0b5f-\u0b63\u0b66-\u0b6f\u0b71\u0b82\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd0\u0bd7\u0be6-\u0bef\u0c01-\u0c03\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c33\u0c35-\u0c39\u0c3d-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c58\u0c59\u0c60-\u0c63\u0c66-\u0c6f\u0c82\u0c83\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbc-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0cde\u0ce0-\u0ce3\u0ce6-\u0cef\u0cf1\u0cf2\u0d02\u0d03\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d-\u0d44\u0d46-\u0d48\u0d4a-\u0d4e\u0d57\u0d60-\u0d63\u0d66-\u0d6f\u0d7a-\u0d7f\u0d82\u0d83\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0df2\u0df3\u0e01-\u0e3a\u0e40-\u0e4e\u0e50-\u0e59\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb9\u0ebb-\u0ebd\u0ec0-\u0ec4\u0ec6\u0ec8-\u0ecd\u0ed0-\u0ed9\u0edc-\u0edf\u0f00\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f3e-\u0f47\u0f49-\u0f6c\u0f71-\u0f84\u0f86-\u0f97\u0f99-\u0fbc\u0fc6\u1000-\u1049\u1050-\u109d\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u135d-\u135f\u1380-\u138f\u13a0-\u13f4\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f0\u1700-\u170c\u170e-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176c\u176e-\u1770\u1772\u1773\u1780-\u17d3\u17d7\u17dc\u17dd\u17e0-\u17e9\u180b-\u180d\u1810-\u1819\u1820-\u1877\u1880-\u18aa\u18b0-\u18f5\u1900-\u191c\u1920-\u192b\u1930-\u193b\u1946-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u19d0-\u19d9\u1a00-\u1a1b\u1a20-\u1a5e\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1aa7\u1b00-\u1b4b\u1b50-\u1b59\u1b6b-\u1b73\u1b80-\u1bf3\u1c00-\u1c37\u1c40-\u1c49\u1c4d-\u1c7d\u1cd0-\u1cd2\u1cd4-\u1cf6\u1d00-\u1de6\u1dfc-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u200c\u200d\u203f\u2040\u2054\u2071\u207f\u2090-\u209c\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d7f-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2de0-\u2dff\u2e2f\u3005-\u3007\u3021-\u302f\u3031-\u3035\u3038-\u303c\u3041-\u3096\u3099\u309a\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fcc\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua62b\ua640-\ua66f\ua674-\ua67d\ua67f-\ua697\ua69f-\ua6f1\ua717-\ua71f\ua722-\ua788\ua78b-\ua78e\ua790-\ua793\ua7a0-\ua7aa\ua7f8-\ua827\ua840-\ua873\ua880-\ua8c4\ua8d0-\ua8d9\ua8e0-\ua8f7\ua8fb\ua900-\ua92d\ua930-\ua953\ua960-\ua97c\ua980-\ua9c0\ua9cf-\ua9d9\uaa00-\uaa36\uaa40-\uaa4d\uaa50-\uaa59\uaa60-\uaa76\uaa7a\uaa7b\uaa80-\uaac2\uaadb-\uaadd\uaae0-\uaaef\uaaf2-\uaaf6\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uabc0-\uabea\uabec\uabed\uabf0-\uabf9\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe00-\ufe0f\ufe20-\ufe26\ufe33\ufe34\ufe4d-\ufe4f\ufe70-\ufe74\ufe76-\ufefc\uff10-\uff19\uff21-\uff3a\uff3f\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc]')
    };

    // Ensure the condition is true, otherwise throw an error.
    // This is only to have a better contract semantic, i.e. another safety net
    // to catch a logic error. The condition shall be fulfilled in normal case.
    // Do NOT use this to enforce a certain condition on any user input.

    function assert(condition, message) {
        if (!condition) {
            throw new Error('ASSERT: ' + message);
        }
    }

    function isDecimalDigit(ch) {
        return (ch >= 48 && ch <= 57);   // 0..9
    }

    function isHexDigit(ch) {
        return '0123456789abcdefABCDEF'.indexOf(ch) >= 0;
    }

    function isOctalDigit(ch) {
        return '01234567'.indexOf(ch) >= 0;
    }


    // 7.2 White Space

    function isWhiteSpace(ch) {
        return (ch === 32) ||  // space
            (ch === 9) ||      // tab
            (ch === 0xB) ||
            (ch === 0xC) ||
            (ch === 0xA0) ||
            (ch >= 0x1680 && '\u1680\u180E\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\uFEFF'.indexOf(String.fromCharCode(ch)) > 0);
    }

    // 7.3 Line Terminators

    function isLineTerminator(ch) {
        return (ch === 10) || (ch === 13) || (ch === 0x2028) || (ch === 0x2029);
    }

    // 7.6 Identifier Names and Identifiers

    function isIdentifierStart(ch) {
        return (ch === 36) || (ch === 95) ||  // $ (dollar) and _ (underscore)
            (ch >= 65 && ch <= 90) ||         // A..Z
            (ch >= 97 && ch <= 122) ||        // a..z
            (ch === 92) ||                    // \ (backslash)
            ((ch >= 0x80) && Regex.NonAsciiIdentifierStart.test(String.fromCharCode(ch)));
    }

    function isIdentifierPart(ch) {
        return (ch === 36) || (ch === 95) ||  // $ (dollar) and _ (underscore)
            (ch >= 65 && ch <= 90) ||         // A..Z
            (ch >= 97 && ch <= 122) ||        // a..z
            (ch >= 48 && ch <= 57) ||         // 0..9
            (ch === 92) ||                    // \ (backslash)
            ((ch >= 0x80) && Regex.NonAsciiIdentifierPart.test(String.fromCharCode(ch)));
    }

    // 7.6.1.2 Future Reserved Words

    function isFutureReservedWord(id) {
        switch (id) {
        case 'class':
        case 'enum':
        case 'export':
        case 'extends':
        case 'import':
        case 'super':
            return true;
        default:
            return false;
        }
    }

    function isStrictModeReservedWord(id) {
        switch (id) {
        case 'implements':
        case 'interface':
        case 'package':
        case 'private':
        case 'protected':
        case 'public':
        case 'static':
        case 'yield':
        case 'let':
            return true;
        default:
            return false;
        }
    }

    function isRestrictedWord(id) {
        return id === 'eval' || id === 'arguments';
    }

    // 7.6.1.1 Keywords

    function isKeyword(id) {
        if (strict && isStrictModeReservedWord(id)) {
            return true;
        }

        // 'const' is specialized as Keyword in V8.
        // 'yield' and 'let' are for compatiblity with SpiderMonkey and ES.next.
        // Some others are from future reserved words.

        switch (id.length) {
        case 2:
            return (id === 'if') || (id === 'in') || (id === 'do');
        case 3:
            return (id === 'var') || (id === 'for') || (id === 'new') ||
                (id === 'try') || (id === 'let');
        case 4:
            return (id === 'this') || (id === 'else') || (id === 'case') ||
                (id === 'void') || (id === 'with') || (id === 'enum');
        case 5:
            return (id === 'while') || (id === 'break') || (id === 'catch') ||
                (id === 'throw') || (id === 'const') || (id === 'yield') ||
                (id === 'class') || (id === 'super');
        case 6:
            return (id === 'return') || (id === 'typeof') || (id === 'delete') ||
                (id === 'switch') || (id === 'export') || (id === 'import');
        case 7:
            return (id === 'default') || (id === 'finally') || (id === 'extends');
        case 8:
            return (id === 'function') || (id === 'continue') || (id === 'debugger');
        case 10:
            return (id === 'instanceof');
        default:
            return false;
        }
    }

    // 7.4 Comments

    function skipComment() {
        var ch, blockComment, lineComment;

        blockComment = false;
        lineComment = false;

        while (index < length) {
            ch = source.charCodeAt(index);

            if (lineComment) {
                ++index;
                if (isLineTerminator(ch)) {
                    lineComment = false;
                    if (ch === 13 && source.charCodeAt(index) === 10) {
                        ++index;
                    }
                    ++lineNumber;
                    lineStart = index;
                }
            } else if (blockComment) {
                if (isLineTerminator(ch)) {
                    if (ch === 13 && source.charCodeAt(index + 1) === 10) {
                        ++index;
                    }
                    ++lineNumber;
                    ++index;
                    lineStart = index;
                    if (index >= length) {
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }
                } else {
                    ch = source.charCodeAt(index++);
                    if (index >= length) {
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }
                    // Block comment ends with '*/' (char #42, char #47).
                    if (ch === 42) {
                        ch = source.charCodeAt(index);
                        if (ch === 47) {
                            ++index;
                            blockComment = false;
                        }
                    }
                }
            } else if (ch === 47) {
                ch = source.charCodeAt(index + 1);
                // Line comment starts with '//' (char #47, char #47).
                if (ch === 47) {
                    index += 2;
                    lineComment = true;
                } else if (ch === 42) {
                    // Block comment starts with '/*' (char #47, char #42).
                    index += 2;
                    blockComment = true;
                    if (index >= length) {
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }
                } else {
                    break;
                }
            } else if (isWhiteSpace(ch)) {
                ++index;
            } else if (isLineTerminator(ch)) {
                ++index;
                if (ch === 13 && source.charCodeAt(index) === 10) {
                    ++index;
                }
                ++lineNumber;
                lineStart = index;
            } else {
                break;
            }
        }
    }

    function scanHexEscape(prefix) {
        var i, len, ch, code = 0;

        len = (prefix === 'u') ? 4 : 2;
        for (i = 0; i < len; ++i) {
            if (index < length && isHexDigit(source[index])) {
                ch = source[index++];
                code = code * 16 + '0123456789abcdef'.indexOf(ch.toLowerCase());
            } else {
                return '';
            }
        }
        return String.fromCharCode(code);
    }

    function scanUnicodeCodePointEscape() {
        var ch, code, cu1, cu2;

        ch = source[index];
        code = 0;

        // At least, one hex digit is required.
        if (ch === '}') {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        while (index < length) {
            ch = source[index++];
            if (!isHexDigit(ch)) {
                break;
            }
            code = code * 16 + '0123456789abcdef'.indexOf(ch.toLowerCase());
        }

        if (code > 0x10FFFF || ch !== '}') {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        // UTF-16 Encoding
        if (code <= 0xFFFF) {
            return String.fromCharCode(code);
        }
        cu1 = ((code - 0x10000) >> 10) + 0xD800;
        cu2 = ((code - 0x10000) & 1023) + 0xDC00;
        return String.fromCharCode(cu1, cu2);
    }

    function getEscapedIdentifier() {
        var ch, id;

        ch = source.charCodeAt(index++);
        id = String.fromCharCode(ch);

        // '\u' (char #92, char #117) denotes an escaped character.
        if (ch === 92) {
            if (source.charCodeAt(index) !== 117) {
                throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
            }
            ++index;
            ch = scanHexEscape('u');
            if (!ch || ch === '\\' || !isIdentifierStart(ch.charCodeAt(0))) {
                throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
            }
            id = ch;
        }

        while (index < length) {
            ch = source.charCodeAt(index);
            if (!isIdentifierPart(ch)) {
                break;
            }
            ++index;
            id += String.fromCharCode(ch);

            // '\u' (char #92, char #117) denotes an escaped character.
            if (ch === 92) {
                id = id.substr(0, id.length - 1);
                if (source.charCodeAt(index) !== 117) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
                ++index;
                ch = scanHexEscape('u');
                if (!ch || ch === '\\' || !isIdentifierPart(ch.charCodeAt(0))) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
                id += ch;
            }
        }

        return id;
    }

    function getIdentifier() {
        var start, ch;

        start = index++;
        while (index < length) {
            ch = source.charCodeAt(index);
            if (ch === 92) {
                // Blackslash (char #92) marks Unicode escape sequence.
                index = start;
                return getEscapedIdentifier();
            }
            if (isIdentifierPart(ch)) {
                ++index;
            } else {
                break;
            }
        }

        return source.slice(start, index);
    }

    function scanIdentifier() {
        var start, id, type;

        start = index;

        // Backslash (char #92) starts an escaped character.
        id = (source.charCodeAt(index) === 92) ? getEscapedIdentifier() : getIdentifier();

        // There is no keyword or literal with only one character.
        // Thus, it must be an identifier.
        if (id.length === 1) {
            type = Token.Identifier;
        } else if (isKeyword(id)) {
            type = Token.Keyword;
        } else if (id === 'null') {
            type = Token.NullLiteral;
        } else if (id === 'true' || id === 'false') {
            type = Token.BooleanLiteral;
        } else {
            type = Token.Identifier;
        }

        return {
            type: type,
            value: id,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [start, index]
        };
    }


    // 7.7 Punctuators

    function scanPunctuator() {
        var start = index,
            code = source.charCodeAt(index),
            code2,
            ch1 = source[index],
            ch2,
            ch3,
            ch4;

        switch (code) {
        // Check for most common single-character punctuators.
        case 40:   // ( open bracket
        case 41:   // ) close bracket
        case 59:   // ; semicolon
        case 44:   // , comma
        case 123:  // { open curly brace
        case 125:  // } close curly brace
        case 91:   // [
        case 93:   // ]
        case 58:   // :
        case 63:   // ?
        case 126:  // ~
            ++index;
            if (extra.tokenize) {
                if (code === 40) {
                    extra.openParenToken = extra.tokens.length;
                } else if (code === 123) {
                    extra.openCurlyToken = extra.tokens.length;
                }
            }
            return {
                type: Token.Punctuator,
                value: String.fromCharCode(code),
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };

        default:
            code2 = source.charCodeAt(index + 1);

            // '=' (char #61) marks an assignment or comparison operator.
            if (code2 === 61) {
                switch (code) {
                case 37:  // %
                case 38:  // &
                case 42:  // *:
                case 43:  // +
                case 45:  // -
                case 47:  // /
                case 60:  // <
                case 62:  // >
                case 94:  // ^
                case 124: // |
                    index += 2;
                    return {
                        type: Token.Punctuator,
                        value: String.fromCharCode(code) + String.fromCharCode(code2),
                        lineNumber: lineNumber,
                        lineStart: lineStart,
                        range: [start, index]
                    };

                case 33: // !
                case 61: // =
                    index += 2;

                    // !== and ===
                    if (source.charCodeAt(index) === 61) {
                        ++index;
                    }
                    return {
                        type: Token.Punctuator,
                        value: source.slice(start, index),
                        lineNumber: lineNumber,
                        lineStart: lineStart,
                        range: [start, index]
                    };
                default:
                    break;
                }
            }
            break;
        }

        // Peek more characters.

        ch2 = source[index + 1];
        ch3 = source[index + 2];
        ch4 = source[index + 3];

        // 4-character punctuator: >>>=

        if (ch1 === '>' && ch2 === '>' && ch3 === '>') {
            if (ch4 === '=') {
                index += 4;
                return {
                    type: Token.Punctuator,
                    value: '>>>=',
                    lineNumber: lineNumber,
                    lineStart: lineStart,
                    range: [start, index]
                };
            }
        }

        // 3-character punctuators: === !== >>> <<= >>=

        if (ch1 === '>' && ch2 === '>' && ch3 === '>') {
            index += 3;
            return {
                type: Token.Punctuator,
                value: '>>>',
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if (ch1 === '<' && ch2 === '<' && ch3 === '=') {
            index += 3;
            return {
                type: Token.Punctuator,
                value: '<<=',
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if (ch1 === '>' && ch2 === '>' && ch3 === '=') {
            index += 3;
            return {
                type: Token.Punctuator,
                value: '>>=',
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if (ch1 === '.' && ch2 === '.' && ch3 === '.') {
            index += 3;
            return {
                type: Token.Punctuator,
                value: '...',
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        // Other 2-character punctuators: ++ -- << >> && ||

        if (ch1 === ch2 && ('+-<>&|'.indexOf(ch1) >= 0)) {
            index += 2;
            return {
                type: Token.Punctuator,
                value: ch1 + ch2,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if (ch1 === '=' && ch2 === '>') {
            index += 2;
            return {
                type: Token.Punctuator,
                value: '=>',
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if ('<>=!+-*%&|^/'.indexOf(ch1) >= 0) {
            ++index;
            return {
                type: Token.Punctuator,
                value: ch1,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if (ch1 === '.') {
            ++index;
            return {
                type: Token.Punctuator,
                value: ch1,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }

    // 7.8.3 Numeric Literals

    function scanHexLiteral(start) {
        var number = '';

        while (index < length) {
            if (!isHexDigit(source[index])) {
                break;
            }
            number += source[index++];
        }

        if (number.length === 0) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        if (isIdentifierStart(source.charCodeAt(index))) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        return {
            type: Token.NumericLiteral,
            value: parseInt('0x' + number, 16),
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [start, index]
        };
    }

    function scanOctalLiteral(prefix, start) {
        var number, octal;

        if (isOctalDigit(prefix)) {
            octal = true;
            number = '0' + source[index++];
        } else {
            octal = false;
            ++index;
            number = '';
        }

        while (index < length) {
            if (!isOctalDigit(source[index])) {
                break;
            }
            number += source[index++];
        }

        if (!octal && number.length === 0) {
            // only 0o or 0O
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        if (isIdentifierStart(source.charCodeAt(index)) || isDecimalDigit(source.charCodeAt(index))) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        return {
            type: Token.NumericLiteral,
            value: parseInt(number, 8),
            octal: octal,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [start, index]
        };
    }

    function scanNumericLiteral() {
        var number, start, ch, octal;

        ch = source[index];
        assert(isDecimalDigit(ch.charCodeAt(0)) || (ch === '.'),
            'Numeric literal must start with a decimal digit or a decimal point');

        start = index;
        number = '';
        if (ch !== '.') {
            number = source[index++];
            ch = source[index];

            // Hex number starts with '0x'.
            // Octal number starts with '0'.
            // Octal number in ES6 starts with '0o'.
            // Binary number in ES6 starts with '0b'.
            if (number === '0') {
                if (ch === 'x' || ch === 'X') {
                    ++index;
                    return scanHexLiteral(start);
                }
                if (ch === 'b' || ch === 'B') {
                    ++index;
                    number = '';

                    while (index < length) {
                        ch = source[index];
                        if (ch !== '0' && ch !== '1') {
                            break;
                        }
                        number += source[index++];
                    }

                    if (number.length === 0) {
                        // only 0b or 0B
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }

                    if (index < length) {
                        ch = source.charCodeAt(index);
                        if (isIdentifierStart(ch) || isDecimalDigit(ch)) {
                            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                        }
                    }
                    return {
                        type: Token.NumericLiteral,
                        value: parseInt(number, 2),
                        lineNumber: lineNumber,
                        lineStart: lineStart,
                        range: [start, index]
                    };
                }
                if (ch === 'o' || ch === 'O' || isOctalDigit(ch)) {
                    return scanOctalLiteral(ch, start);
                }
                // decimal number starts with '0' such as '09' is illegal.
                if (ch && isDecimalDigit(ch.charCodeAt(0))) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
            }

            while (isDecimalDigit(source.charCodeAt(index))) {
                number += source[index++];
            }
            ch = source[index];
        }

        if (ch === '.') {
            number += source[index++];
            while (isDecimalDigit(source.charCodeAt(index))) {
                number += source[index++];
            }
            ch = source[index];
        }

        if (ch === 'e' || ch === 'E') {
            number += source[index++];

            ch = source[index];
            if (ch === '+' || ch === '-') {
                number += source[index++];
            }
            if (isDecimalDigit(source.charCodeAt(index))) {
                while (isDecimalDigit(source.charCodeAt(index))) {
                    number += source[index++];
                }
            } else {
                throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
            }
        }

        if (isIdentifierStart(source.charCodeAt(index))) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        return {
            type: Token.NumericLiteral,
            value: parseFloat(number),
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [start, index]
        };
    }

    // 7.8.4 String Literals

    function scanStringLiteral() {
        var str = '', quote, start, ch, code, unescaped, restore, octal = false;

        quote = source[index];
        assert((quote === '\'' || quote === '"'),
            'String literal must starts with a quote');

        start = index;
        ++index;

        while (index < length) {
            ch = source[index++];

            if (ch === quote) {
                quote = '';
                break;
            } else if (ch === '\\') {
                ch = source[index++];
                if (!ch || !isLineTerminator(ch.charCodeAt(0))) {
                    switch (ch) {
                    case 'n':
                        str += '\n';
                        break;
                    case 'r':
                        str += '\r';
                        break;
                    case 't':
                        str += '\t';
                        break;
                    case 'u':
                    case 'x':
                        if (source[index] === '{') {
                            ++index;
                            str += scanUnicodeCodePointEscape();
                        } else {
                            restore = index;
                            unescaped = scanHexEscape(ch);
                            if (unescaped) {
                                str += unescaped;
                            } else {
                                index = restore;
                                str += ch;
                            }
                        }
                        break;
                    case 'b':
                        str += '\b';
                        break;
                    case 'f':
                        str += '\f';
                        break;
                    case 'v':
                        str += '\x0B';
                        break;

                    default:
                        if (isOctalDigit(ch)) {
                            code = '01234567'.indexOf(ch);

                            // \0 is not octal escape sequence
                            if (code !== 0) {
                                octal = true;
                            }

                            if (index < length && isOctalDigit(source[index])) {
                                octal = true;
                                code = code * 8 + '01234567'.indexOf(source[index++]);

                                // 3 digits are only allowed when string starts
                                // with 0, 1, 2, 3
                                if ('0123'.indexOf(ch) >= 0 &&
                                        index < length &&
                                        isOctalDigit(source[index])) {
                                    code = code * 8 + '01234567'.indexOf(source[index++]);
                                }
                            }
                            str += String.fromCharCode(code);
                        } else {
                            str += ch;
                        }
                        break;
                    }
                } else {
                    ++lineNumber;
                    if (ch ===  '\r' && source[index] === '\n') {
                        ++index;
                    }
                }
            } else if (isLineTerminator(ch.charCodeAt(0))) {
                break;
            } else {
                str += ch;
            }
        }

        if (quote !== '') {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        return {
            type: Token.StringLiteral,
            value: str,
            octal: octal,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [start, index]
        };
    }

    function scanTemplate() {
        var cooked = '', ch, start, terminated, tail, restore, unescaped, code, octal;

        terminated = false;
        tail = false;
        start = index;

        ++index;

        while (index < length) {
            ch = source[index++];
            if (ch === '`') {
                tail = true;
                terminated = true;
                break;
            } else if (ch === '$') {
                if (source[index] === '{') {
                    ++index;
                    terminated = true;
                    break;
                }
                cooked += ch;
            } else if (ch === '\\') {
                ch = source[index++];
                if (!isLineTerminator(ch.charCodeAt(0))) {
                    switch (ch) {
                    case 'n':
                        cooked += '\n';
                        break;
                    case 'r':
                        cooked += '\r';
                        break;
                    case 't':
                        cooked += '\t';
                        break;
                    case 'u':
                    case 'x':
                        if (source[index] === '{') {
                            ++index;
                            cooked += scanUnicodeCodePointEscape();
                        } else {
                            restore = index;
                            unescaped = scanHexEscape(ch);
                            if (unescaped) {
                                cooked += unescaped;
                            } else {
                                index = restore;
                                cooked += ch;
                            }
                        }
                        break;
                    case 'b':
                        cooked += '\b';
                        break;
                    case 'f':
                        cooked += '\f';
                        break;
                    case 'v':
                        cooked += '\v';
                        break;

                    default:
                        if (isOctalDigit(ch)) {
                            code = '01234567'.indexOf(ch);

                            // \0 is not octal escape sequence
                            if (code !== 0) {
                                octal = true;
                            }

                            if (index < length && isOctalDigit(source[index])) {
                                octal = true;
                                code = code * 8 + '01234567'.indexOf(source[index++]);

                                // 3 digits are only allowed when string starts
                                // with 0, 1, 2, 3
                                if ('0123'.indexOf(ch) >= 0 &&
                                        index < length &&
                                        isOctalDigit(source[index])) {
                                    code = code * 8 + '01234567'.indexOf(source[index++]);
                                }
                            }
                            cooked += String.fromCharCode(code);
                        } else {
                            cooked += ch;
                        }
                        break;
                    }
                } else {
                    ++lineNumber;
                    if (ch ===  '\r' && source[index] === '\n') {
                        ++index;
                    }
                }
            } else if (isLineTerminator(ch.charCodeAt(0))) {
                ++lineNumber;
                if (ch ===  '\r' && source[index] === '\n') {
                    ++index;
                }
                cooked += '\n';
            } else {
                cooked += ch;
            }
        }

        if (!terminated) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        return {
            type: Token.Template,
            value: {
                cooked: cooked,
                raw: source.slice(start + 1, index - ((tail) ? 1 : 2))
            },
            tail: tail,
            octal: octal,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [start, index]
        };
    }

    function scanTemplateElement(option) {
        var startsWith, template;

        lookahead = null;
        skipComment();

        startsWith = (option.head) ? '`' : '}';

        if (source[index] !== startsWith) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        template = scanTemplate();

        peek();

        return template;
    }

    function scanRegExp() {
        var str, ch, start, pattern, flags, value, classMarker = false, restore, terminated = false;

        lookahead = null;
        skipComment();

        start = index;
        ch = source[index];
        assert(ch === '/', 'Regular expression literal must start with a slash');
        str = source[index++];

        while (index < length) {
            ch = source[index++];
            str += ch;
            if (classMarker) {
                if (ch === ']') {
                    classMarker = false;
                }
            } else {
                if (ch === '\\') {
                    ch = source[index++];
                    // ECMA-262 7.8.5
                    if (isLineTerminator(ch.charCodeAt(0))) {
                        throwError({}, Messages.UnterminatedRegExp);
                    }
                    str += ch;
                } else if (ch === '/') {
                    terminated = true;
                    break;
                } else if (ch === '[') {
                    classMarker = true;
                } else if (isLineTerminator(ch.charCodeAt(0))) {
                    throwError({}, Messages.UnterminatedRegExp);
                }
            }
        }

        if (!terminated) {
            throwError({}, Messages.UnterminatedRegExp);
        }

        // Exclude leading and trailing slash.
        pattern = str.substr(1, str.length - 2);

        flags = '';
        while (index < length) {
            ch = source[index];
            if (!isIdentifierPart(ch.charCodeAt(0))) {
                break;
            }

            ++index;
            if (ch === '\\' && index < length) {
                ch = source[index];
                if (ch === 'u') {
                    ++index;
                    restore = index;
                    ch = scanHexEscape('u');
                    if (ch) {
                        flags += ch;
                        for (str += '\\u'; restore < index; ++restore) {
                            str += source[restore];
                        }
                    } else {
                        index = restore;
                        flags += 'u';
                        str += '\\u';
                    }
                } else {
                    str += '\\';
                }
            } else {
                flags += ch;
                str += ch;
            }
        }

        try {
            value = new RegExp(pattern, flags);
        } catch (e) {
            throwError({}, Messages.InvalidRegExp);
        }

        peek();


        if (extra.tokenize) {
            return {
                type: Token.RegularExpression,
                value: value,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }
        return {
            literal: str,
            value: value,
            range: [start, index]
        };
    }

    function isIdentifierName(token) {
        return token.type === Token.Identifier ||
            token.type === Token.Keyword ||
            token.type === Token.BooleanLiteral ||
            token.type === Token.NullLiteral;
    }

    function advanceSlash() {
        var prevToken,
            checkToken;
        // Using the following algorithm:
        // https://github.com/mozilla/sweet.js/wiki/design
        prevToken = extra.tokens[extra.tokens.length - 1];
        if (!prevToken) {
            // Nothing before that: it cannot be a division.
            return scanRegExp();
        }
        if (prevToken.type === 'Punctuator') {
            if (prevToken.value === ')') {
                checkToken = extra.tokens[extra.openParenToken - 1];
                if (checkToken &&
                        checkToken.type === 'Keyword' &&
                        (checkToken.value === 'if' ||
                         checkToken.value === 'while' ||
                         checkToken.value === 'for' ||
                         checkToken.value === 'with')) {
                    return scanRegExp();
                }
                return scanPunctuator();
            }
            if (prevToken.value === '}') {
                // Dividing a function by anything makes little sense,
                // but we have to check for that.
                if (extra.tokens[extra.openCurlyToken - 3] &&
                        extra.tokens[extra.openCurlyToken - 3].type === 'Keyword') {
                    // Anonymous function.
                    checkToken = extra.tokens[extra.openCurlyToken - 4];
                    if (!checkToken) {
                        return scanPunctuator();
                    }
                } else if (extra.tokens[extra.openCurlyToken - 4] &&
                        extra.tokens[extra.openCurlyToken - 4].type === 'Keyword') {
                    // Named function.
                    checkToken = extra.tokens[extra.openCurlyToken - 5];
                    if (!checkToken) {
                        return scanRegExp();
                    }
                } else {
                    return scanPunctuator();
                }
                // checkToken determines whether the function is
                // a declaration or an expression.
                if (FnExprTokens.indexOf(checkToken.value) >= 0) {
                    // It is an expression.
                    return scanPunctuator();
                }
                // It is a declaration.
                return scanRegExp();
            }
            return scanRegExp();
        }
        if (prevToken.type === 'Keyword') {
            return scanRegExp();
        }
        return scanPunctuator();
    }

    function advance() {
        var ch;

        skipComment();

        if (index >= length) {
            return {
                type: Token.EOF,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [index, index]
            };
        }

        ch = source.charCodeAt(index);

        // Very common: ( and ) and ;
        if (ch === 40 || ch === 41 || ch === 58) {
            return scanPunctuator();
        }

        // String literal starts with single quote (#39) or double quote (#34).
        if (ch === 39 || ch === 34) {
            return scanStringLiteral();
        }

        if (ch === 96) {
            return scanTemplate();
        }
        if (isIdentifierStart(ch)) {
            return scanIdentifier();
        }

        // Dot (.) char #46 can also start a floating-point number, hence the need
        // to check the next character.
        if (ch === 46) {
            if (isDecimalDigit(source.charCodeAt(index + 1))) {
                return scanNumericLiteral();
            }
            return scanPunctuator();
        }

        if (isDecimalDigit(ch)) {
            return scanNumericLiteral();
        }

        // Slash (/) char #47 can also start a regex.
        if (extra.tokenize && ch === 47) {
            return advanceSlash();
        }

        return scanPunctuator();
    }

    function lex() {
        var token;

        token = lookahead;
        index = token.range[1];
        lineNumber = token.lineNumber;
        lineStart = token.lineStart;

        lookahead = advance();

        index = token.range[1];
        lineNumber = token.lineNumber;
        lineStart = token.lineStart;

        return token;
    }

    function peek() {
        var pos, line, start;

        pos = index;
        line = lineNumber;
        start = lineStart;
        lookahead = advance();
        index = pos;
        lineNumber = line;
        lineStart = start;
    }

    function lookahead2() {
        var adv, pos, line, start, result;

        // If we are collecting the tokens, don't grab the next one yet.
        adv = (typeof extra.advance === 'function') ? extra.advance : advance;

        pos = index;
        line = lineNumber;
        start = lineStart;

        // Scan for the next immediate token.
        if (lookahead === null) {
            lookahead = adv();
        }
        index = lookahead.range[1];
        lineNumber = lookahead.lineNumber;
        lineStart = lookahead.lineStart;

        // Grab the token right after.
        result = adv();
        index = pos;
        lineNumber = line;
        lineStart = start;

        return result;
    }

    SyntaxTreeDelegate = {

        name: 'SyntaxTree',

        postProcess: function (node) {
            return node;
        },

        createArrayExpression: function (elements) {
            return {
                type: Syntax.ArrayExpression,
                elements: elements
            };
        },

        createAssignmentExpression: function (operator, left, right) {
            return {
                type: Syntax.AssignmentExpression,
                operator: operator,
                left: left,
                right: right
            };
        },

        createBinaryExpression: function (operator, left, right) {
            var type = (operator === '||' || operator === '&&') ? Syntax.LogicalExpression :
                        Syntax.BinaryExpression;
            return {
                type: type,
                operator: operator,
                left: left,
                right: right
            };
        },

        createBlockStatement: function (body) {
            return {
                type: Syntax.BlockStatement,
                body: body
            };
        },

        createBreakStatement: function (label) {
            return {
                type: Syntax.BreakStatement,
                label: label
            };
        },

        createCallExpression: function (callee, args) {
            return {
                type: Syntax.CallExpression,
                callee: callee,
                'arguments': args
            };
        },

        createCatchClause: function (param, body) {
            return {
                type: Syntax.CatchClause,
                param: param,
                body: body
            };
        },

        createConditionalExpression: function (test, consequent, alternate) {
            return {
                type: Syntax.ConditionalExpression,
                test: test,
                consequent: consequent,
                alternate: alternate
            };
        },

        createContinueStatement: function (label) {
            return {
                type: Syntax.ContinueStatement,
                label: label
            };
        },

        createDebuggerStatement: function () {
            return {
                type: Syntax.DebuggerStatement
            };
        },

        createDoWhileStatement: function (body, test) {
            return {
                type: Syntax.DoWhileStatement,
                body: body,
                test: test
            };
        },

        createEmptyStatement: function () {
            return {
                type: Syntax.EmptyStatement
            };
        },

        createExpressionStatement: function (expression) {
            return {
                type: Syntax.ExpressionStatement,
                expression: expression
            };
        },

        createForStatement: function (init, test, update, body) {
            return {
                type: Syntax.ForStatement,
                init: init,
                test: test,
                update: update,
                body: body
            };
        },

        createForInStatement: function (left, right, body) {
            return {
                type: Syntax.ForInStatement,
                left: left,
                right: right,
                body: body,
                each: false
            };
        },

        createForOfStatement: function (left, right, body) {
            return {
                type: Syntax.ForOfStatement,
                left: left,
                right: right,
                body: body
            };
        },

        createFunctionDeclaration: function (id, params, defaults, body, rest, generator, expression) {
            return {
                type: Syntax.FunctionDeclaration,
                id: id,
                params: params,
                defaults: defaults,
                body: body,
                rest: rest,
                generator: generator,
                expression: expression
            };
        },

        createFunctionExpression: function (id, params, defaults, body, rest, generator, expression) {
            return {
                type: Syntax.FunctionExpression,
                id: id,
                params: params,
                defaults: defaults,
                body: body,
                rest: rest,
                generator: generator,
                expression: expression
            };
        },

        createIdentifier: function (name) {
            return {
                type: Syntax.Identifier,
                name: name
            };
        },

        createIfStatement: function (test, consequent, alternate) {
            return {
                type: Syntax.IfStatement,
                test: test,
                consequent: consequent,
                alternate: alternate
            };
        },

        createLabeledStatement: function (label, body) {
            return {
                type: Syntax.LabeledStatement,
                label: label,
                body: body
            };
        },

        createLiteral: function (token) {
            return {
                type: Syntax.Literal,
                value: token.value,
                raw: source.slice(token.range[0], token.range[1])
            };
        },

        createMemberExpression: function (accessor, object, property) {
            return {
                type: Syntax.MemberExpression,
                computed: accessor === '[',
                object: object,
                property: property
            };
        },

        createNewExpression: function (callee, args) {
            return {
                type: Syntax.NewExpression,
                callee: callee,
                'arguments': args
            };
        },

        createObjectExpression: function (properties) {
            return {
                type: Syntax.ObjectExpression,
                properties: properties
            };
        },

        createPostfixExpression: function (operator, argument) {
            return {
                type: Syntax.UpdateExpression,
                operator: operator,
                argument: argument,
                prefix: false
            };
        },

        createProgram: function (body) {
            return {
                type: Syntax.Program,
                body: body
            };
        },

        createProperty: function (kind, key, value, method, shorthand) {
            return {
                type: Syntax.Property,
                key: key,
                value: value,
                kind: kind,
                method: method,
                shorthand: shorthand
            };
        },

        createReturnStatement: function (argument) {
            return {
                type: Syntax.ReturnStatement,
                argument: argument
            };
        },

        createSequenceExpression: function (expressions) {
            return {
                type: Syntax.SequenceExpression,
                expressions: expressions
            };
        },

        createSwitchCase: function (test, consequent) {
            return {
                type: Syntax.SwitchCase,
                test: test,
                consequent: consequent
            };
        },

        createSwitchStatement: function (discriminant, cases) {
            return {
                type: Syntax.SwitchStatement,
                discriminant: discriminant,
                cases: cases
            };
        },

        createThisExpression: function () {
            return {
                type: Syntax.ThisExpression
            };
        },

        createThrowStatement: function (argument) {
            return {
                type: Syntax.ThrowStatement,
                argument: argument
            };
        },

        createTryStatement: function (block, guardedHandlers, handlers, finalizer) {
            return {
                type: Syntax.TryStatement,
                block: block,
                guardedHandlers: guardedHandlers,
                handlers: handlers,
                finalizer: finalizer
            };
        },

        createUnaryExpression: function (operator, argument) {
            if (operator === '++' || operator === '--') {
                return {
                    type: Syntax.UpdateExpression,
                    operator: operator,
                    argument: argument,
                    prefix: true
                };
            }
            return {
                type: Syntax.UnaryExpression,
                operator: operator,
                argument: argument
            };
        },

        createVariableDeclaration: function (declarations, kind) {
            return {
                type: Syntax.VariableDeclaration,
                declarations: declarations,
                kind: kind
            };
        },

        createVariableDeclarator: function (id, init) {
            return {
                type: Syntax.VariableDeclarator,
                id: id,
                init: init
            };
        },

        createWhileStatement: function (test, body) {
            return {
                type: Syntax.WhileStatement,
                test: test,
                body: body
            };
        },

        createWithStatement: function (object, body) {
            return {
                type: Syntax.WithStatement,
                object: object,
                body: body
            };
        },

        createTemplateElement: function (value, tail) {
            return {
                type: Syntax.TemplateElement,
                value: value,
                tail: tail
            };
        },

        createTemplateLiteral: function (quasis, expressions) {
            return {
                type: Syntax.TemplateLiteral,
                quasis: quasis,
                expressions: expressions
            };
        },

        createSpreadElement: function (argument) {
            return {
                type: Syntax.SpreadElement,
                argument: argument
            };
        },

        createTaggedTemplateExpression: function (tag, quasi) {
            return {
                type: Syntax.TaggedTemplateExpression,
                tag: tag,
                quasi: quasi
            };
        },

        createArrowFunctionExpression: function (params, defaults, body, rest, expression) {
            return {
                type: Syntax.ArrowFunctionExpression,
                id: null,
                params: params,
                defaults: defaults,
                body: body,
                rest: rest,
                generator: false,
                expression: expression
            };
        },

        createMethodDefinition: function (propertyType, kind, key, value) {
            return {
                type: Syntax.MethodDefinition,
                key: key,
                value: value,
                kind: kind,
                'static': propertyType === ClassPropertyType.static
            };
        },

        createClassBody: function (body) {
            return {
                type: Syntax.ClassBody,
                body: body
            };
        },

        createClassExpression: function (id, superClass, body) {
            return {
                type: Syntax.ClassExpression,
                id: id,
                superClass: superClass,
                body: body
            };
        },

        createClassDeclaration: function (id, superClass, body) {
            return {
                type: Syntax.ClassDeclaration,
                id: id,
                superClass: superClass,
                body: body
            };
        },

        createExportSpecifier: function (id, name) {
            return {
                type: Syntax.ExportSpecifier,
                id: id,
                name: name
            };
        },

        createExportBatchSpecifier: function () {
            return {
                type: Syntax.ExportBatchSpecifier
            };
        },

        createExportDeclaration: function (declaration, specifiers, source) {
            return {
                type: Syntax.ExportDeclaration,
                declaration: declaration,
                specifiers: specifiers,
                source: source
            };
        },

        createImportSpecifier: function (id, name) {
            return {
                type: Syntax.ImportSpecifier,
                id: id,
                name: name
            };
        },

        createImportDeclaration: function (specifiers, kind, source) {
            return {
                type: Syntax.ImportDeclaration,
                specifiers: specifiers,
                kind: kind,
                source: source
            };
        },

        createYieldExpression: function (argument, delegate) {
            return {
                type: Syntax.YieldExpression,
                argument: argument,
                delegate: delegate
            };
        },

        createModuleDeclaration: function (id, source, body) {
            return {
                type: Syntax.ModuleDeclaration,
                id: id,
                source: source,
                body: body
            };
        }


    };

    // Return true if there is a line terminator before the next token.

    function peekLineTerminator() {
        var pos, line, start, found;

        pos = index;
        line = lineNumber;
        start = lineStart;
        skipComment();
        found = lineNumber !== line;
        index = pos;
        lineNumber = line;
        lineStart = start;

        return found;
    }

    // Throw an exception

    function throwError(token, messageFormat) {
        var error,
            args = Array.prototype.slice.call(arguments, 2),
            msg = messageFormat.replace(
                /%(\d)/g,
                function (whole, index) {
                    assert(index < args.length, 'Message reference must be in range');
                    return args[index];
                }
            );

        if (typeof token.lineNumber === 'number') {
            error = new Error('Line ' + token.lineNumber + ': ' + msg);
            error.index = token.range[0];
            error.lineNumber = token.lineNumber;
            error.column = token.range[0] - lineStart + 1;
        } else {
            error = new Error('Line ' + lineNumber + ': ' + msg);
            error.index = index;
            error.lineNumber = lineNumber;
            error.column = index - lineStart + 1;
        }

        error.description = msg;
        throw error;
    }

    function throwErrorTolerant() {
        try {
            throwError.apply(null, arguments);
        } catch (e) {
            if (extra.errors) {
                extra.errors.push(e);
            } else {
                throw e;
            }
        }
    }


    // Throw an exception because of the token.

    function throwUnexpected(token) {
        if (token.type === Token.EOF) {
            throwError(token, Messages.UnexpectedEOS);
        }

        if (token.type === Token.NumericLiteral) {
            throwError(token, Messages.UnexpectedNumber);
        }

        if (token.type === Token.StringLiteral) {
            throwError(token, Messages.UnexpectedString);
        }

        if (token.type === Token.Identifier) {
            throwError(token, Messages.UnexpectedIdentifier);
        }

        if (token.type === Token.Keyword) {
            if (isFutureReservedWord(token.value)) {
                throwError(token, Messages.UnexpectedReserved);
            } else if (strict && isStrictModeReservedWord(token.value)) {
                throwErrorTolerant(token, Messages.StrictReservedWord);
                return;
            }
            throwError(token, Messages.UnexpectedToken, token.value);
        }

        if (token.type === Token.Template) {
            throwError(token, Messages.UnexpectedTemplate, token.value.raw);
        }

        // BooleanLiteral, NullLiteral, or Punctuator.
        throwError(token, Messages.UnexpectedToken, token.value);
    }

    // Expect the next token to match the specified punctuator.
    // If not, an exception will be thrown.

    function expect(value) {
        var token = lex();
        if (token.type !== Token.Punctuator || token.value !== value) {
            throwUnexpected(token);
        }
    }

    // Expect the next token to match the specified keyword.
    // If not, an exception will be thrown.

    function expectKeyword(keyword) {
        var token = lex();
        if (token.type !== Token.Keyword || token.value !== keyword) {
            throwUnexpected(token);
        }
    }

    // Return true if the next token matches the specified punctuator.

    function match(value) {
        return lookahead.type === Token.Punctuator && lookahead.value === value;
    }

    // Return true if the next token matches the specified keyword

    function matchKeyword(keyword) {
        return lookahead.type === Token.Keyword && lookahead.value === keyword;
    }


    // Return true if the next token matches the specified contextual keyword

    function matchContextualKeyword(keyword) {
        return lookahead.type === Token.Identifier && lookahead.value === keyword;
    }

    // Return true if the next token is an assignment operator

    function matchAssign() {
        var op;

        if (lookahead.type !== Token.Punctuator) {
            return false;
        }
        op = lookahead.value;
        return op === '=' ||
            op === '*=' ||
            op === '/=' ||
            op === '%=' ||
            op === '+=' ||
            op === '-=' ||
            op === '<<=' ||
            op === '>>=' ||
            op === '>>>=' ||
            op === '&=' ||
            op === '^=' ||
            op === '|=';
    }

    function consumeSemicolon() {
        var line;

        // Catch the very common case first: immediately a semicolon (char #59).
        if (source.charCodeAt(index) === 59) {
            lex();
            return;
        }

        line = lineNumber;
        skipComment();
        if (lineNumber !== line) {
            return;
        }

        if (match(';')) {
            lex();
            return;
        }

        if (lookahead.type !== Token.EOF && !match('}')) {
            throwUnexpected(lookahead);
        }
    }

    // Return true if provided expression is LeftHandSideExpression

    function isLeftHandSide(expr) {
        return expr.type === Syntax.Identifier || expr.type === Syntax.MemberExpression;
    }

    function isAssignableLeftHandSide(expr) {
        return isLeftHandSide(expr) || expr.type === Syntax.ObjectPattern || expr.type === Syntax.ArrayPattern;
    }

    // 11.1.4 Array Initialiser

    function parseArrayInitialiser() {
        var elements = [], blocks = [], filter = null, tmp, possiblecomprehension = true, body;

        expect('[');
        while (!match(']')) {
            if (lookahead.value === 'for' &&
                    lookahead.type === Token.Keyword) {
                if (!possiblecomprehension) {
                    throwError({}, Messages.ComprehensionError);
                }
                matchKeyword('for');
                tmp = parseForStatement({ignoreBody: true});
                tmp.of = tmp.type === Syntax.ForOfStatement;
                tmp.type = Syntax.ComprehensionBlock;
                if (tmp.left.kind) { // can't be let or const
                    throwError({}, Messages.ComprehensionError);
                }
                blocks.push(tmp);
            } else if (lookahead.value === 'if' &&
                           lookahead.type === Token.Keyword) {
                if (!possiblecomprehension) {
                    throwError({}, Messages.ComprehensionError);
                }
                expectKeyword('if');
                expect('(');
                filter = parseExpression();
                expect(')');
            } else if (lookahead.value === ',' &&
                           lookahead.type === Token.Punctuator) {
                possiblecomprehension = false; // no longer allowed.
                lex();
                elements.push(null);
            } else {
                tmp = parseSpreadOrAssignmentExpression();
                elements.push(tmp);
                if (tmp && tmp.type === Syntax.SpreadElement) {
                    if (!match(']')) {
                        throwError({}, Messages.ElementAfterSpreadElement);
                    }
                } else if (!(match(']') || matchKeyword('for') || matchKeyword('if'))) {
                    expect(','); // this lexes.
                    possiblecomprehension = false;
                }
            }
        }

        expect(']');

        if (filter && !blocks.length) {
            throwError({}, Messages.ComprehensionRequiresBlock);
        }

        if (blocks.length) {
            if (elements.length !== 1) {
                throwError({}, Messages.ComprehensionError);
            }
            return {
                type:  Syntax.ComprehensionExpression,
                filter: filter,
                blocks: blocks,
                body: elements[0]
            };
        }
        return delegate.createArrayExpression(elements);
    }

    // 11.1.5 Object Initialiser

    function parsePropertyFunction(options) {
        var previousStrict, previousYieldAllowed, params, defaults, body;

        previousStrict = strict;
        previousYieldAllowed = state.yieldAllowed;
        state.yieldAllowed = options.generator;
        params = options.params || [];
        defaults = options.defaults || [];

        body = parseConciseBody();
        if (options.name && strict && isRestrictedWord(params[0].name)) {
            throwErrorTolerant(options.name, Messages.StrictParamName);
        }
        if (state.yieldAllowed && !state.yieldFound) {
            throwErrorTolerant({}, Messages.NoYieldInGenerator);
        }
        strict = previousStrict;
        state.yieldAllowed = previousYieldAllowed;

        return delegate.createFunctionExpression(null, params, defaults, body, options.rest || null, options.generator, body.type !== Syntax.BlockStatement);
    }


    function parsePropertyMethodFunction(options) {
        var previousStrict, tmp, method;

        previousStrict = strict;
        strict = true;

        tmp = parseParams();

        if (tmp.stricted) {
            throwErrorTolerant(tmp.stricted, tmp.message);
        }


        method = parsePropertyFunction({
            params: tmp.params,
            defaults: tmp.defaults,
            rest: tmp.rest,
            generator: options.generator
        });

        strict = previousStrict;

        return method;
    }


    function parseObjectPropertyKey() {
        var token = lex();

        // Note: This function is called only from parseObjectProperty(), where
        // EOF and Punctuator tokens are already filtered out.

        if (token.type === Token.StringLiteral || token.type === Token.NumericLiteral) {
            if (strict && token.octal) {
                throwErrorTolerant(token, Messages.StrictOctalLiteral);
            }
            return delegate.createLiteral(token);
        }

        return delegate.createIdentifier(token.value);
    }

    function parseObjectProperty() {
        var token, key, id, value, param;

        token = lookahead;

        if (token.type === Token.Identifier) {

            id = parseObjectPropertyKey();

            // Property Assignment: Getter and Setter.

            if (token.value === 'get' && !(match(':') || match('('))) {
                key = parseObjectPropertyKey();
                expect('(');
                expect(')');
                return delegate.createProperty('get', key, parsePropertyFunction({ generator: false }), false, false);
            }
            if (token.value === 'set' && !(match(':') || match('('))) {
                key = parseObjectPropertyKey();
                expect('(');
                token = lookahead;
                param = [ parseVariableIdentifier() ];
                expect(')');
                return delegate.createProperty('set', key, parsePropertyFunction({ params: param, generator: false, name: token }), false, false);
            }
            if (match(':')) {
                lex();
                return delegate.createProperty('init', id, parseAssignmentExpression(), false, false);
            }
            if (match('(')) {
                return delegate.createProperty('init', id, parsePropertyMethodFunction({ generator: false }), true, false);
            }
            return delegate.createProperty('init', id, id, false, true);
        }
        if (token.type === Token.EOF || token.type === Token.Punctuator) {
            if (!match('*')) {
                throwUnexpected(token);
            }
            lex();

            id = parseObjectPropertyKey();

            if (!match('(')) {
                throwUnexpected(lex());
            }

            return delegate.createProperty('init', id, parsePropertyMethodFunction({ generator: true }), true, false);
        }
        key = parseObjectPropertyKey();
        if (match(':')) {
            lex();
            return delegate.createProperty('init', key, parseAssignmentExpression(), false, false);
        }
        if (match('(')) {
            return delegate.createProperty('init', key, parsePropertyMethodFunction({ generator: false }), true, false);
        }
        throwUnexpected(lex());
    }

    function parseObjectInitialiser() {
        var properties = [], property, name, key, kind, map = {}, toString = String;

        expect('{');

        while (!match('}')) {
            property = parseObjectProperty();

            if (property.key.type === Syntax.Identifier) {
                name = property.key.name;
            } else {
                name = toString(property.key.value);
            }
            kind = (property.kind === 'init') ? PropertyKind.Data : (property.kind === 'get') ? PropertyKind.Get : PropertyKind.Set;

            key = '$' + name;
            if (Object.prototype.hasOwnProperty.call(map, key)) {
                if (map[key] === PropertyKind.Data) {
                    if (strict && kind === PropertyKind.Data) {
                        throwErrorTolerant({}, Messages.StrictDuplicateProperty);
                    } else if (kind !== PropertyKind.Data) {
                        throwErrorTolerant({}, Messages.AccessorDataProperty);
                    }
                } else {
                    if (kind === PropertyKind.Data) {
                        throwErrorTolerant({}, Messages.AccessorDataProperty);
                    } else if (map[key] & kind) {
                        throwErrorTolerant({}, Messages.AccessorGetSet);
                    }
                }
                map[key] |= kind;
            } else {
                map[key] = kind;
            }

            properties.push(property);

            if (!match('}')) {
                expect(',');
            }
        }

        expect('}');

        return delegate.createObjectExpression(properties);
    }

    function parseTemplateElement(option) {
        var token = scanTemplateElement(option);
        if (strict && token.octal) {
            throwError(token, Messages.StrictOctalLiteral);
        }
        return delegate.createTemplateElement({ raw: token.value.raw, cooked: token.value.cooked }, token.tail);
    }

    function parseTemplateLiteral() {
        var quasi, quasis, expressions;

        quasi = parseTemplateElement({ head: true });
        quasis = [ quasi ];
        expressions = [];

        while (!quasi.tail) {
            expressions.push(parseExpression());
            quasi = parseTemplateElement({ head: false });
            quasis.push(quasi);
        }

        return delegate.createTemplateLiteral(quasis, expressions);
    }

    // 11.1.6 The Grouping Operator

    function parseGroupExpression() {
        var expr;

        expect('(');

        ++state.parenthesizedCount;

        expr = parseExpression();

        expect(')');

        return expr;
    }


    // 11.1 Primary Expressions

    function parsePrimaryExpression() {
        var type, token;

        token = lookahead;
        type = lookahead.type;

        if (type === Token.Identifier) {
            lex();
            return delegate.createIdentifier(token.value);
        }

        if (type === Token.StringLiteral || type === Token.NumericLiteral) {
            if (strict && lookahead.octal) {
                throwErrorTolerant(lookahead, Messages.StrictOctalLiteral);
            }
            return delegate.createLiteral(lex());
        }

        if (type === Token.Keyword) {
            if (matchKeyword('this')) {
                lex();
                return delegate.createThisExpression();
            }

            if (matchKeyword('function')) {
                return parseFunctionExpression();
            }

            if (matchKeyword('class')) {
                return parseClassExpression();
            }

            if (matchKeyword('super')) {
                lex();
                return delegate.createIdentifier('super');
            }
        }

        if (type === Token.BooleanLiteral) {
            token = lex();
            token.value = (token.value === 'true');
            return delegate.createLiteral(token);
        }

        if (type === Token.NullLiteral) {
            token = lex();
            token.value = null;
            return delegate.createLiteral(token);
        }

        if (match('[')) {
            return parseArrayInitialiser();
        }

        if (match('{')) {
            return parseObjectInitialiser();
        }

        if (match('(')) {
            return parseGroupExpression();
        }

        if (match('/') || match('/=')) {
            return delegate.createLiteral(scanRegExp());
        }

        if (type === Token.Template) {
            return parseTemplateLiteral();
        }

        return throwUnexpected(lex());
    }

    // 11.2 Left-Hand-Side Expressions

    function parseArguments() {
        var args = [], arg;

        expect('(');

        if (!match(')')) {
            while (index < length) {
                arg = parseSpreadOrAssignmentExpression();
                args.push(arg);

                if (match(')')) {
                    break;
                } else if (arg.type === Syntax.SpreadElement) {
                    throwError({}, Messages.ElementAfterSpreadElement);
                }

                expect(',');
            }
        }

        expect(')');

        return args;
    }

    function parseSpreadOrAssignmentExpression() {
        if (match('...')) {
            lex();
            return delegate.createSpreadElement(parseAssignmentExpression());
        }
        return parseAssignmentExpression();
    }

    function parseNonComputedProperty() {
        var token = lex();

        if (!isIdentifierName(token)) {
            throwUnexpected(token);
        }

        return delegate.createIdentifier(token.value);
    }

    function parseNonComputedMember() {
        expect('.');

        return parseNonComputedProperty();
    }

    function parseComputedMember() {
        var expr;

        expect('[');

        expr = parseExpression();

        expect(']');

        return expr;
    }

    function parseNewExpression() {
        var callee, args;

        expectKeyword('new');
        callee = parseLeftHandSideExpression();
        args = match('(') ? parseArguments() : [];

        return delegate.createNewExpression(callee, args);
    }

    function parseLeftHandSideExpressionAllowCall() {
        var expr, args, property;

        expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();

        while (match('.') || match('[') || match('(') || lookahead.type === Token.Template) {
            if (match('(')) {
                args = parseArguments();
                expr = delegate.createCallExpression(expr, args);
            } else if (match('[')) {
                expr = delegate.createMemberExpression('[', expr, parseComputedMember());
            } else if (match('.')) {
                expr = delegate.createMemberExpression('.', expr, parseNonComputedMember());
            } else {
                expr = delegate.createTaggedTemplateExpression(expr, parseTemplateLiteral());
            }
        }

        return expr;
    }


    function parseLeftHandSideExpression() {
        var expr, property;

        expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();

        while (match('.') || match('[') || lookahead.type === Token.Template) {
            if (match('[')) {
                expr = delegate.createMemberExpression('[', expr, parseComputedMember());
            } else if (match('.')) {
                expr = delegate.createMemberExpression('.', expr, parseNonComputedMember());
            } else {
                expr = delegate.createTaggedTemplateExpression(expr, parseTemplateLiteral());
            }
        }

        return expr;
    }

    // 11.3 Postfix Expressions

    function parsePostfixExpression() {
        var expr = parseLeftHandSideExpressionAllowCall(),
            token = lookahead;

        if (lookahead.type !== Token.Punctuator) {
            return expr;
        }

        if ((match('++') || match('--')) && !peekLineTerminator()) {
            // 11.3.1, 11.3.2
            if (strict && expr.type === Syntax.Identifier && isRestrictedWord(expr.name)) {
                throwErrorTolerant({}, Messages.StrictLHSPostfix);
            }

            if (!isLeftHandSide(expr)) {
                throwError({}, Messages.InvalidLHSInAssignment);
            }

            token = lex();
            expr = delegate.createPostfixExpression(token.value, expr);
        }

        return expr;
    }

    // 11.4 Unary Operators

    function parseUnaryExpression() {
        var token, expr;

        if (lookahead.type !== Token.Punctuator && lookahead.type !== Token.Keyword) {
            return parsePostfixExpression();
        }

        if (match('++') || match('--')) {
            token = lex();
            expr = parseUnaryExpression();
            // 11.4.4, 11.4.5
            if (strict && expr.type === Syntax.Identifier && isRestrictedWord(expr.name)) {
                throwErrorTolerant({}, Messages.StrictLHSPrefix);
            }

            if (!isLeftHandSide(expr)) {
                throwError({}, Messages.InvalidLHSInAssignment);
            }

            return delegate.createUnaryExpression(token.value, expr);
        }

        if (match('+') || match('-') || match('~') || match('!')) {
            token = lex();
            expr = parseUnaryExpression();
            return delegate.createUnaryExpression(token.value, expr);
        }

        if (matchKeyword('delete') || matchKeyword('void') || matchKeyword('typeof')) {
            token = lex();
            expr = parseUnaryExpression();
            expr = delegate.createUnaryExpression(token.value, expr);
            if (strict && expr.operator === 'delete' && expr.argument.type === Syntax.Identifier) {
                throwErrorTolerant({}, Messages.StrictDelete);
            }
            return expr;
        }

        return parsePostfixExpression();
    }

    function binaryPrecedence(token, allowIn) {
        var prec = 0;

        if (token.type !== Token.Punctuator && token.type !== Token.Keyword) {
            return 0;
        }

        switch (token.value) {
        case '||':
            prec = 1;
            break;

        case '&&':
            prec = 2;
            break;

        case '|':
            prec = 3;
            break;

        case '^':
            prec = 4;
            break;

        case '&':
            prec = 5;
            break;

        case '==':
        case '!=':
        case '===':
        case '!==':
            prec = 6;
            break;

        case '<':
        case '>':
        case '<=':
        case '>=':
        case 'instanceof':
            prec = 7;
            break;

        case 'in':
            prec = allowIn ? 7 : 0;
            break;

        case '<<':
        case '>>':
        case '>>>':
            prec = 8;
            break;

        case '+':
        case '-':
            prec = 9;
            break;

        case '*':
        case '/':
        case '%':
            prec = 11;
            break;

        default:
            break;
        }

        return prec;
    }

    // 11.5 Multiplicative Operators
    // 11.6 Additive Operators
    // 11.7 Bitwise Shift Operators
    // 11.8 Relational Operators
    // 11.9 Equality Operators
    // 11.10 Binary Bitwise Operators
    // 11.11 Binary Logical Operators

    function parseBinaryExpression() {
        var expr, token, prec, previousAllowIn, stack, right, operator, left, i;

        previousAllowIn = state.allowIn;
        state.allowIn = true;

        expr = parseUnaryExpression();

        token = lookahead;
        prec = binaryPrecedence(token, previousAllowIn);
        if (prec === 0) {
            return expr;
        }
        token.prec = prec;
        lex();

        stack = [expr, token, parseUnaryExpression()];

        while ((prec = binaryPrecedence(lookahead, previousAllowIn)) > 0) {

            // Reduce: make a binary expression from the three topmost entries.
            while ((stack.length > 2) && (prec <= stack[stack.length - 2].prec)) {
                right = stack.pop();
                operator = stack.pop().value;
                left = stack.pop();
                stack.push(delegate.createBinaryExpression(operator, left, right));
            }

            // Shift.
            token = lex();
            token.prec = prec;
            stack.push(token);
            stack.push(parseUnaryExpression());
        }

        state.allowIn = previousAllowIn;

        // Final reduce to clean-up the stack.
        i = stack.length - 1;
        expr = stack[i];
        while (i > 1) {
            expr = delegate.createBinaryExpression(stack[i - 1].value, stack[i - 2], expr);
            i -= 2;
        }
        return expr;
    }


    // 11.12 Conditional Operator

    function parseConditionalExpression() {
        var expr, previousAllowIn, consequent, alternate;

        expr = parseBinaryExpression();

        if (match('?')) {
            lex();
            previousAllowIn = state.allowIn;
            state.allowIn = true;
            consequent = parseAssignmentExpression();
            state.allowIn = previousAllowIn;
            expect(':');
            alternate = parseAssignmentExpression();

            expr = delegate.createConditionalExpression(expr, consequent, alternate);
        }

        return expr;
    }

    // 11.13 Assignment Operators

    function reinterpretAsAssignmentBindingPattern(expr) {
        var i, len, property, element;

        if (expr.type === Syntax.ObjectExpression) {
            expr.type = Syntax.ObjectPattern;
            for (i = 0, len = expr.properties.length; i < len; i += 1) {
                property = expr.properties[i];
                if (property.kind !== 'init') {
                    throwError({}, Messages.InvalidLHSInAssignment);
                }
                reinterpretAsAssignmentBindingPattern(property.value);
            }
        } else if (expr.type === Syntax.ArrayExpression) {
            expr.type = Syntax.ArrayPattern;
            for (i = 0, len = expr.elements.length; i < len; i += 1) {
                element = expr.elements[i];
                if (element) {
                    reinterpretAsAssignmentBindingPattern(element);
                }
            }
        } else if (expr.type === Syntax.Identifier) {
            if (isRestrictedWord(expr.name)) {
                throwError({}, Messages.InvalidLHSInAssignment);
            }
        } else if (expr.type === Syntax.SpreadElement) {
            reinterpretAsAssignmentBindingPattern(expr.argument);
            if (expr.argument.type === Syntax.ObjectPattern) {
                throwError({}, Messages.ObjectPatternAsSpread);
            }
        } else {
            if (expr.type !== Syntax.MemberExpression && expr.type !== Syntax.CallExpression && expr.type !== Syntax.NewExpression) {
                throwError({}, Messages.InvalidLHSInAssignment);
            }
        }
    }


    function reinterpretAsDestructuredParameter(options, expr) {
        var i, len, property, element;

        if (expr.type === Syntax.ObjectExpression) {
            expr.type = Syntax.ObjectPattern;
            for (i = 0, len = expr.properties.length; i < len; i += 1) {
                property = expr.properties[i];
                if (property.kind !== 'init') {
                    throwError({}, Messages.InvalidLHSInFormalsList);
                }
                reinterpretAsDestructuredParameter(options, property.value);
            }
        } else if (expr.type === Syntax.ArrayExpression) {
            expr.type = Syntax.ArrayPattern;
            for (i = 0, len = expr.elements.length; i < len; i += 1) {
                element = expr.elements[i];
                if (element) {
                    reinterpretAsDestructuredParameter(options, element);
                }
            }
        } else if (expr.type === Syntax.Identifier) {
            validateParam(options, expr, expr.name);
        } else {
            if (expr.type !== Syntax.MemberExpression) {
                throwError({}, Messages.InvalidLHSInFormalsList);
            }
        }
    }

    function reinterpretAsCoverFormalsList(expressions) {
        var i, len, param, params, defaults, defaultCount, options, rest;

        params = [];
        defaults = [];
        defaultCount = 0;
        rest = null;
        options = {
            paramSet: {}
        };

        for (i = 0, len = expressions.length; i < len; i += 1) {
            param = expressions[i];
            if (param.type === Syntax.Identifier) {
                params.push(param);
                defaults.push(null);
                validateParam(options, param, param.name);
            } else if (param.type === Syntax.ObjectExpression || param.type === Syntax.ArrayExpression) {
                reinterpretAsDestructuredParameter(options, param);
                params.push(param);
                defaults.push(null);
            } else if (param.type === Syntax.SpreadElement) {
                assert(i === len - 1, 'It is guaranteed that SpreadElement is last element by parseExpression');
                reinterpretAsDestructuredParameter(options, param.argument);
                rest = param.argument;
            } else if (param.type === Syntax.AssignmentExpression) {
                params.push(param.left);
                defaults.push(param.right);
                ++defaultCount;
                validateParam(options, param.left, param.left.name);
            } else {
                return null;
            }
        }

        if (options.message === Messages.StrictParamDupe) {
            throwError(
                strict ? options.stricted : options.firstRestricted,
                options.message
            );
        }

        if (defaultCount === 0) {
            defaults = [];
        }

        return {
            params: params,
            defaults: defaults,
            rest: rest,
            stricted: options.stricted,
            firstRestricted: options.firstRestricted,
            message: options.message
        };
    }

    function parseArrowFunctionExpression(options) {
        var previousStrict, previousYieldAllowed, body;

        expect('=>');

        previousStrict = strict;
        previousYieldAllowed = state.yieldAllowed;
        state.yieldAllowed = false;
        body = parseConciseBody();

        if (strict && options.firstRestricted) {
            throwError(options.firstRestricted, options.message);
        }
        if (strict && options.stricted) {
            throwErrorTolerant(options.stricted, options.message);
        }

        strict = previousStrict;
        state.yieldAllowed = previousYieldAllowed;

        return delegate.createArrowFunctionExpression(options.params, options.defaults, body, options.rest, body.type !== Syntax.BlockStatement);
    }

    function parseAssignmentExpression() {
        var expr, token, params, oldParenthesizedCount;

        if (matchKeyword('yield')) {
            return parseYieldExpression();
        }

        oldParenthesizedCount = state.parenthesizedCount;

        if (match('(')) {
            token = lookahead2();
            if ((token.type === Token.Punctuator && token.value === ')') || token.value === '...') {
                params = parseParams();
                if (!match('=>')) {
                    throwUnexpected(lex());
                }
                return parseArrowFunctionExpression(params);
            }
        }

        token = lookahead;
        expr = parseConditionalExpression();

        if (match('=>') &&
                (state.parenthesizedCount === oldParenthesizedCount ||
                state.parenthesizedCount === (oldParenthesizedCount + 1))) {
            if (expr.type === Syntax.Identifier) {
                params = reinterpretAsCoverFormalsList([ expr ]);
            } else if (expr.type === Syntax.SequenceExpression) {
                params = reinterpretAsCoverFormalsList(expr.expressions);
            }
            if (params) {
                return parseArrowFunctionExpression(params);
            }
        }

        if (matchAssign()) {
            // 11.13.1
            if (strict && expr.type === Syntax.Identifier && isRestrictedWord(expr.name)) {
                throwErrorTolerant(token, Messages.StrictLHSAssignment);
            }

            // ES.next draf 11.13 Runtime Semantics step 1
            if (match('=') && (expr.type === Syntax.ObjectExpression || expr.type === Syntax.ArrayExpression)) {
                reinterpretAsAssignmentBindingPattern(expr);
            } else if (!isLeftHandSide(expr)) {
                throwError({}, Messages.InvalidLHSInAssignment);
            }

            expr = delegate.createAssignmentExpression(lex().value, expr, parseAssignmentExpression());
        }

        return expr;
    }

    // 11.14 Comma Operator

    function parseExpression() {
        var expr, expressions, sequence, coverFormalsList, spreadFound, oldParenthesizedCount;

        oldParenthesizedCount = state.parenthesizedCount;

        expr = parseAssignmentExpression();
        expressions = [ expr ];

        if (match(',')) {
            while (index < length) {
                if (!match(',')) {
                    break;
                }

                lex();
                expr = parseSpreadOrAssignmentExpression();
                expressions.push(expr);

                if (expr.type === Syntax.SpreadElement) {
                    spreadFound = true;
                    if (!match(')')) {
                        throwError({}, Messages.ElementAfterSpreadElement);
                    }
                    break;
                }
            }

            sequence = delegate.createSequenceExpression(expressions);
        }

        if (match('=>')) {
            // Do not allow nested parentheses on the LHS of the =>.
            if (state.parenthesizedCount === oldParenthesizedCount || state.parenthesizedCount === (oldParenthesizedCount + 1)) {
                expr = expr.type === Syntax.SequenceExpression ? expr.expressions : expressions;
                coverFormalsList = reinterpretAsCoverFormalsList(expr);
                if (coverFormalsList) {
                    return parseArrowFunctionExpression(coverFormalsList);
                }
            }
            throwUnexpected(lex());
        }

        if (spreadFound && lookahead2().value !== '=>') {
            throwError({}, Messages.IllegalSpread);
        }

        return sequence || expr;
    }

    // 12.1 Block

    function parseStatementList() {
        var list = [],
            statement;

        while (index < length) {
            if (match('}')) {
                break;
            }
            statement = parseSourceElement();
            if (typeof statement === 'undefined') {
                break;
            }
            list.push(statement);
        }

        return list;
    }

    function parseBlock() {
        var block;

        expect('{');

        block = parseStatementList();

        expect('}');

        return delegate.createBlockStatement(block);
    }

    // 12.2 Variable Statement

    function parseVariableIdentifier() {
        var token = lex();

        if (token.type !== Token.Identifier) {
            throwUnexpected(token);
        }

        return delegate.createIdentifier(token.value);
    }

    function parseVariableDeclaration(kind) {
        var id,
            init = null;
        if (match('{')) {
            id = parseObjectInitialiser();
            reinterpretAsAssignmentBindingPattern(id);
        } else if (match('[')) {
            id = parseArrayInitialiser();
            reinterpretAsAssignmentBindingPattern(id);
        } else {
            id = state.allowKeyword ? parseNonComputedProperty() : parseVariableIdentifier();
            // 12.2.1
            if (strict && isRestrictedWord(id.name)) {
                throwErrorTolerant({}, Messages.StrictVarName);
            }
        }

        if (kind === 'const') {
            if (!match('=')) {
                throwError({}, Messages.NoUnintializedConst);
            }
            expect('=');
            init = parseAssignmentExpression();
        } else if (match('=')) {
            lex();
            init = parseAssignmentExpression();
        }

        return delegate.createVariableDeclarator(id, init);
    }

    function parseVariableDeclarationList(kind) {
        var list = [];

        do {
            list.push(parseVariableDeclaration(kind));
            if (!match(',')) {
                break;
            }
            lex();
        } while (index < length);

        return list;
    }

    function parseVariableStatement() {
        var declarations;

        expectKeyword('var');

        declarations = parseVariableDeclarationList();

        consumeSemicolon();

        return delegate.createVariableDeclaration(declarations, 'var');
    }

    // kind may be `const` or `let`
    // Both are experimental and not in the specification yet.
    // see http://wiki.ecmascript.org/doku.php?id=harmony:const
    // and http://wiki.ecmascript.org/doku.php?id=harmony:let
    function parseConstLetDeclaration(kind) {
        var declarations;

        expectKeyword(kind);

        declarations = parseVariableDeclarationList(kind);

        consumeSemicolon();

        return delegate.createVariableDeclaration(declarations, kind);
    }

    // http://wiki.ecmascript.org/doku.php?id=harmony:modules

    function parseModuleDeclaration() {
        var id, src, body;

        lex();   // 'module'

        if (peekLineTerminator()) {
            throwError({}, Messages.NewlineAfterModule);
        }

        switch (lookahead.type) {

        case Token.StringLiteral:
            id = parsePrimaryExpression();
            body = parseModuleBlock();
            src = null;
            break;

        case Token.Identifier:
            id = parseVariableIdentifier();
            body = null;
            if (!matchContextualKeyword('from')) {
                throwUnexpected(lex());
            }
            lex();
            src = parsePrimaryExpression();
            if (src.type !== Syntax.Literal) {
                throwError({}, Messages.InvalidModuleSpecifier);
            }
            break;
        }

        consumeSemicolon();
        return delegate.createModuleDeclaration(id, src, body);
    }

    function parseExportBatchSpecifier() {
        expect('*');
        return delegate.createExportBatchSpecifier();
    }

    function parseExportSpecifier() {
        var id, name = null;

        id = parseVariableIdentifier();
        if (matchContextualKeyword('as')) {
            lex();
            name = parseNonComputedProperty();
        }

        return delegate.createExportSpecifier(id, name);
    }

    function parseExportDeclaration() {
        var previousAllowKeyword, decl, def, src, specifiers;

        expectKeyword('export');

        if (lookahead.type === Token.Keyword) {
            switch (lookahead.value) {
            case 'let':
            case 'const':
            case 'var':
            case 'class':
            case 'function':
                return delegate.createExportDeclaration(parseSourceElement(), null, null);
            }
        }

        if (isIdentifierName(lookahead)) {
            previousAllowKeyword = state.allowKeyword;
            state.allowKeyword = true;
            decl = parseVariableDeclarationList('let');
            state.allowKeyword = previousAllowKeyword;
            return delegate.createExportDeclaration(decl, null, null);
        }

        specifiers = [];
        src = null;

        if (match('*')) {
            specifiers.push(parseExportBatchSpecifier());
        } else {
            expect('{');
            do {
                specifiers.push(parseExportSpecifier());
            } while (match(',') && lex());
            expect('}');
        }

        if (matchContextualKeyword('from')) {
            lex();
            src = parsePrimaryExpression();
            if (src.type !== Syntax.Literal) {
                throwError({}, Messages.InvalidModuleSpecifier);
            }
        }

        consumeSemicolon();

        return delegate.createExportDeclaration(null, specifiers, src);
    }

    function parseImportDeclaration() {
        var specifiers, kind, src;

        expectKeyword('import');
        specifiers = [];

        if (isIdentifierName(lookahead)) {
            kind = 'default';
            specifiers.push(parseImportSpecifier());

            if (!matchContextualKeyword('from')) {
                throwError({}, Messages.NoFromAfterImport);
            }
            lex();
        } else if (match('{')) {
            kind = 'named';
            lex();
            do {
                specifiers.push(parseImportSpecifier());
            } while (match(',') && lex());
            expect('}');

            if (!matchContextualKeyword('from')) {
                throwError({}, Messages.NoFromAfterImport);
            }
            lex();
        }

        src = parsePrimaryExpression();
        if (src.type !== Syntax.Literal) {
            throwError({}, Messages.InvalidModuleSpecifier);
        }

        consumeSemicolon();

        return delegate.createImportDeclaration(specifiers, kind, src);
    }

    function parseImportSpecifier() {
        var id, name = null;

        id = parseNonComputedProperty();
        if (matchContextualKeyword('as')) {
            lex();
            name = parseVariableIdentifier();
        }

        return delegate.createImportSpecifier(id, name);
    }

    // 12.3 Empty Statement

    function parseEmptyStatement() {
        expect(';');
        return delegate.createEmptyStatement();
    }

    // 12.4 Expression Statement

    function parseExpressionStatement() {
        var expr = parseExpression();
        consumeSemicolon();
        return delegate.createExpressionStatement(expr);
    }

    // 12.5 If statement

    function parseIfStatement() {
        var test, consequent, alternate;

        expectKeyword('if');

        expect('(');

        test = parseExpression();

        expect(')');

        consequent = parseStatement();

        if (matchKeyword('else')) {
            lex();
            alternate = parseStatement();
        } else {
            alternate = null;
        }

        return delegate.createIfStatement(test, consequent, alternate);
    }

    // 12.6 Iteration Statements

    function parseDoWhileStatement() {
        var body, test, oldInIteration;

        expectKeyword('do');

        oldInIteration = state.inIteration;
        state.inIteration = true;

        body = parseStatement();

        state.inIteration = oldInIteration;

        expectKeyword('while');

        expect('(');

        test = parseExpression();

        expect(')');

        if (match(';')) {
            lex();
        }

        return delegate.createDoWhileStatement(body, test);
    }

    function parseWhileStatement() {
        var test, body, oldInIteration;

        expectKeyword('while');

        expect('(');

        test = parseExpression();

        expect(')');

        oldInIteration = state.inIteration;
        state.inIteration = true;

        body = parseStatement();

        state.inIteration = oldInIteration;

        return delegate.createWhileStatement(test, body);
    }

    function parseForVariableDeclaration() {
        var token = lex(),
            declarations = parseVariableDeclarationList();

        return delegate.createVariableDeclaration(declarations, token.value);
    }

    function parseForStatement(opts) {
        var init, test, update, left, right, body, operator, oldInIteration;
        init = test = update = null;
        expectKeyword('for');

        // http://wiki.ecmascript.org/doku.php?id=proposals:iterators_and_generators&s=each
        if (matchContextualKeyword('each')) {
            throwError({}, Messages.EachNotAllowed);
        }

        expect('(');

        if (match(';')) {
            lex();
        } else {
            if (matchKeyword('var') || matchKeyword('let') || matchKeyword('const')) {
                state.allowIn = false;
                init = parseForVariableDeclaration();
                state.allowIn = true;

                if (init.declarations.length === 1) {
                    if (matchKeyword('in') || matchContextualKeyword('of')) {
                        operator = lookahead;
                        if (!((operator.value === 'in' || init.kind !== 'var') && init.declarations[0].init)) {
                            lex();
                            left = init;
                            right = parseExpression();
                            init = null;
                        }
                    }
                }
            } else {
                state.allowIn = false;
                init = parseExpression();
                state.allowIn = true;

                if (matchContextualKeyword('of')) {
                    operator = lex();
                    left = init;
                    right = parseExpression();
                    init = null;
                } else if (matchKeyword('in')) {
                    // LeftHandSideExpression
                    if (!isAssignableLeftHandSide(init)) {
                        throwError({}, Messages.InvalidLHSInForIn);
                    }
                    operator = lex();
                    left = init;
                    right = parseExpression();
                    init = null;
                }
            }

            if (typeof left === 'undefined') {
                expect(';');
            }
        }

        if (typeof left === 'undefined') {

            if (!match(';')) {
                test = parseExpression();
            }
            expect(';');

            if (!match(')')) {
                update = parseExpression();
            }
        }

        expect(')');

        oldInIteration = state.inIteration;
        state.inIteration = true;

        if (!(opts !== undefined && opts.ignoreBody)) {
            body = parseStatement();
        }

        state.inIteration = oldInIteration;

        if (typeof left === 'undefined') {
            return delegate.createForStatement(init, test, update, body);
        }

        if (operator.value === 'in') {
            return delegate.createForInStatement(left, right, body);
        }
        return delegate.createForOfStatement(left, right, body);
    }

    // 12.7 The continue statement

    function parseContinueStatement() {
        var label = null, key;

        expectKeyword('continue');

        // Optimize the most common form: 'continue;'.
        if (source.charCodeAt(index) === 59) {
            lex();

            if (!state.inIteration) {
                throwError({}, Messages.IllegalContinue);
            }

            return delegate.createContinueStatement(null);
        }

        if (peekLineTerminator()) {
            if (!state.inIteration) {
                throwError({}, Messages.IllegalContinue);
            }

            return delegate.createContinueStatement(null);
        }

        if (lookahead.type === Token.Identifier) {
            label = parseVariableIdentifier();

            key = '$' + label.name;
            if (!Object.prototype.hasOwnProperty.call(state.labelSet, key)) {
                throwError({}, Messages.UnknownLabel, label.name);
            }
        }

        consumeSemicolon();

        if (label === null && !state.inIteration) {
            throwError({}, Messages.IllegalContinue);
        }

        return delegate.createContinueStatement(label);
    }

    // 12.8 The break statement

    function parseBreakStatement() {
        var label = null, key;

        expectKeyword('break');

        // Catch the very common case first: immediately a semicolon (char #59).
        if (source.charCodeAt(index) === 59) {
            lex();

            if (!(state.inIteration || state.inSwitch)) {
                throwError({}, Messages.IllegalBreak);
            }

            return delegate.createBreakStatement(null);
        }

        if (peekLineTerminator()) {
            if (!(state.inIteration || state.inSwitch)) {
                throwError({}, Messages.IllegalBreak);
            }

            return delegate.createBreakStatement(null);
        }

        if (lookahead.type === Token.Identifier) {
            label = parseVariableIdentifier();

            key = '$' + label.name;
            if (!Object.prototype.hasOwnProperty.call(state.labelSet, key)) {
                throwError({}, Messages.UnknownLabel, label.name);
            }
        }

        consumeSemicolon();

        if (label === null && !(state.inIteration || state.inSwitch)) {
            throwError({}, Messages.IllegalBreak);
        }

        return delegate.createBreakStatement(label);
    }

    // 12.9 The return statement

    function parseReturnStatement() {
        var argument = null;

        expectKeyword('return');

        if (!state.inFunctionBody) {
            throwErrorTolerant({}, Messages.IllegalReturn);
        }

        // 'return' followed by a space and an identifier is very common.
        if (source.charCodeAt(index) === 32) {
            if (isIdentifierStart(source.charCodeAt(index + 1))) {
                argument = parseExpression();
                consumeSemicolon();
                return delegate.createReturnStatement(argument);
            }
        }

        if (peekLineTerminator()) {
            return delegate.createReturnStatement(null);
        }

        if (!match(';')) {
            if (!match('}') && lookahead.type !== Token.EOF) {
                argument = parseExpression();
            }
        }

        consumeSemicolon();

        return delegate.createReturnStatement(argument);
    }

    // 12.10 The with statement

    function parseWithStatement() {
        var object, body;

        if (strict) {
            throwErrorTolerant({}, Messages.StrictModeWith);
        }

        expectKeyword('with');

        expect('(');

        object = parseExpression();

        expect(')');

        body = parseStatement();

        return delegate.createWithStatement(object, body);
    }

    // 12.10 The swith statement

    function parseSwitchCase() {
        var test,
            consequent = [],
            sourceElement;

        if (matchKeyword('default')) {
            lex();
            test = null;
        } else {
            expectKeyword('case');
            test = parseExpression();
        }
        expect(':');

        while (index < length) {
            if (match('}') || matchKeyword('default') || matchKeyword('case')) {
                break;
            }
            sourceElement = parseSourceElement();
            if (typeof sourceElement === 'undefined') {
                break;
            }
            consequent.push(sourceElement);
        }

        return delegate.createSwitchCase(test, consequent);
    }

    function parseSwitchStatement() {
        var discriminant, cases, clause, oldInSwitch, defaultFound;

        expectKeyword('switch');

        expect('(');

        discriminant = parseExpression();

        expect(')');

        expect('{');

        cases = [];

        if (match('}')) {
            lex();
            return delegate.createSwitchStatement(discriminant, cases);
        }

        oldInSwitch = state.inSwitch;
        state.inSwitch = true;
        defaultFound = false;

        while (index < length) {
            if (match('}')) {
                break;
            }
            clause = parseSwitchCase();
            if (clause.test === null) {
                if (defaultFound) {
                    throwError({}, Messages.MultipleDefaultsInSwitch);
                }
                defaultFound = true;
            }
            cases.push(clause);
        }

        state.inSwitch = oldInSwitch;

        expect('}');

        return delegate.createSwitchStatement(discriminant, cases);
    }

    // 12.13 The throw statement

    function parseThrowStatement() {
        var argument;

        expectKeyword('throw');

        if (peekLineTerminator()) {
            throwError({}, Messages.NewlineAfterThrow);
        }

        argument = parseExpression();

        consumeSemicolon();

        return delegate.createThrowStatement(argument);
    }

    // 12.14 The try statement

    function parseCatchClause() {
        var param, body;

        expectKeyword('catch');

        expect('(');
        if (match(')')) {
            throwUnexpected(lookahead);
        }

        param = parseExpression();
        // 12.14.1
        if (strict && param.type === Syntax.Identifier && isRestrictedWord(param.name)) {
            throwErrorTolerant({}, Messages.StrictCatchVariable);
        }

        expect(')');
        body = parseBlock();
        return delegate.createCatchClause(param, body);
    }

    function parseTryStatement() {
        var block, handlers = [], finalizer = null;

        expectKeyword('try');

        block = parseBlock();

        if (matchKeyword('catch')) {
            handlers.push(parseCatchClause());
        }

        if (matchKeyword('finally')) {
            lex();
            finalizer = parseBlock();
        }

        if (handlers.length === 0 && !finalizer) {
            throwError({}, Messages.NoCatchOrFinally);
        }

        return delegate.createTryStatement(block, [], handlers, finalizer);
    }

    // 12.15 The debugger statement

    function parseDebuggerStatement() {
        expectKeyword('debugger');

        consumeSemicolon();

        return delegate.createDebuggerStatement();
    }

    // 12 Statements

    function parseStatement() {
        var type = lookahead.type,
            expr,
            labeledBody,
            key;

        if (type === Token.EOF) {
            throwUnexpected(lookahead);
        }

        if (type === Token.Punctuator) {
            switch (lookahead.value) {
            case ';':
                return parseEmptyStatement();
            case '{':
                return parseBlock();
            case '(':
                return parseExpressionStatement();
            default:
                break;
            }
        }

        if (type === Token.Keyword) {
            switch (lookahead.value) {
            case 'break':
                return parseBreakStatement();
            case 'continue':
                return parseContinueStatement();
            case 'debugger':
                return parseDebuggerStatement();
            case 'do':
                return parseDoWhileStatement();
            case 'for':
                return parseForStatement();
            case 'function':
                return parseFunctionDeclaration();
            case 'class':
                return parseClassDeclaration();
            case 'if':
                return parseIfStatement();
            case 'return':
                return parseReturnStatement();
            case 'switch':
                return parseSwitchStatement();
            case 'throw':
                return parseThrowStatement();
            case 'try':
                return parseTryStatement();
            case 'var':
                return parseVariableStatement();
            case 'while':
                return parseWhileStatement();
            case 'with':
                return parseWithStatement();
            default:
                break;
            }
        }

        expr = parseExpression();

        // 12.12 Labelled Statements
        if ((expr.type === Syntax.Identifier) && match(':')) {
            lex();

            key = '$' + expr.name;
            if (Object.prototype.hasOwnProperty.call(state.labelSet, key)) {
                throwError({}, Messages.Redeclaration, 'Label', expr.name);
            }

            state.labelSet[key] = true;
            labeledBody = parseStatement();
            delete state.labelSet[key];
            return delegate.createLabeledStatement(expr, labeledBody);
        }

        consumeSemicolon();

        return delegate.createExpressionStatement(expr);
    }

    // 13 Function Definition

    function parseConciseBody() {
        if (match('{')) {
            return parseFunctionSourceElements();
        }
        return parseAssignmentExpression();
    }

    function parseFunctionSourceElements() {
        var sourceElement, sourceElements = [], token, directive, firstRestricted,
            oldLabelSet, oldInIteration, oldInSwitch, oldInFunctionBody, oldParenthesizedCount;

        expect('{');

        while (index < length) {
            if (lookahead.type !== Token.StringLiteral) {
                break;
            }
            token = lookahead;

            sourceElement = parseSourceElement();
            sourceElements.push(sourceElement);
            if (sourceElement.expression.type !== Syntax.Literal) {
                // this is not directive
                break;
            }
            directive = source.slice(token.range[0] + 1, token.range[1] - 1);
            if (directive === 'use strict') {
                strict = true;
                if (firstRestricted) {
                    throwErrorTolerant(firstRestricted, Messages.StrictOctalLiteral);
                }
            } else {
                if (!firstRestricted && token.octal) {
                    firstRestricted = token;
                }
            }
        }

        oldLabelSet = state.labelSet;
        oldInIteration = state.inIteration;
        oldInSwitch = state.inSwitch;
        oldInFunctionBody = state.inFunctionBody;
        oldParenthesizedCount = state.parenthesizedCount;

        state.labelSet = {};
        state.inIteration = false;
        state.inSwitch = false;
        state.inFunctionBody = true;
        state.parenthesizedCount = 0;

        while (index < length) {
            if (match('}')) {
                break;
            }
            sourceElement = parseSourceElement();
            if (typeof sourceElement === 'undefined') {
                break;
            }
            sourceElements.push(sourceElement);
        }

        expect('}');

        state.labelSet = oldLabelSet;
        state.inIteration = oldInIteration;
        state.inSwitch = oldInSwitch;
        state.inFunctionBody = oldInFunctionBody;
        state.parenthesizedCount = oldParenthesizedCount;

        return delegate.createBlockStatement(sourceElements);
    }

    function validateParam(options, param, name) {
        var key = '$' + name;
        if (strict) {
            if (isRestrictedWord(name)) {
                options.stricted = param;
                options.message = Messages.StrictParamName;
            }
            if (Object.prototype.hasOwnProperty.call(options.paramSet, key)) {
                options.stricted = param;
                options.message = Messages.StrictParamDupe;
            }
        } else if (!options.firstRestricted) {
            if (isRestrictedWord(name)) {
                options.firstRestricted = param;
                options.message = Messages.StrictParamName;
            } else if (isStrictModeReservedWord(name)) {
                options.firstRestricted = param;
                options.message = Messages.StrictReservedWord;
            } else if (Object.prototype.hasOwnProperty.call(options.paramSet, key)) {
                options.firstRestricted = param;
                options.message = Messages.StrictParamDupe;
            }
        }
        options.paramSet[key] = true;
    }

    function parseParam(options) {
        var token, rest, param, def;

        token = lookahead;
        if (token.value === '...') {
            token = lex();
            rest = true;
        }

        if (match('[')) {
            param = parseArrayInitialiser();
            reinterpretAsDestructuredParameter(options, param);
        } else if (match('{')) {
            if (rest) {
                throwError({}, Messages.ObjectPatternAsRestParameter);
            }
            param = parseObjectInitialiser();
            reinterpretAsDestructuredParameter(options, param);
        } else {
            param = parseVariableIdentifier();
            validateParam(options, token, token.value);
            if (match('=')) {
                if (rest) {
                    throwErrorTolerant(lookahead, Messages.DefaultRestParameter);
                }
                lex();
                def = parseAssignmentExpression();
                ++options.defaultCount;
            }
        }

        if (rest) {
            if (!match(')')) {
                throwError({}, Messages.ParameterAfterRestParameter);
            }
            options.rest = param;
            return false;
        }

        options.params.push(param);
        options.defaults.push(def);
        return !match(')');
    }

    function parseParams(firstRestricted) {
        var options;

        options = {
            params: [],
            defaultCount: 0,
            defaults: [],
            rest: null,
            firstRestricted: firstRestricted
        };

        expect('(');

        if (!match(')')) {
            options.paramSet = {};
            while (index < length) {
                if (!parseParam(options)) {
                    break;
                }
                expect(',');
            }
        }

        expect(')');

        if (options.defaultCount === 0) {
            options.defaults = [];
        }

        return options;
    }

    function parseFunctionDeclaration() {
        var id, body, token, tmp, firstRestricted, message, previousStrict, previousYieldAllowed, generator;

        expectKeyword('function');

        generator = false;
        if (match('*')) {
            lex();
            generator = true;
        }

        token = lookahead;

        id = parseVariableIdentifier();

        if (strict) {
            if (isRestrictedWord(token.value)) {
                throwErrorTolerant(token, Messages.StrictFunctionName);
            }
        } else {
            if (isRestrictedWord(token.value)) {
                firstRestricted = token;
                message = Messages.StrictFunctionName;
            } else if (isStrictModeReservedWord(token.value)) {
                firstRestricted = token;
                message = Messages.StrictReservedWord;
            }
        }

        tmp = parseParams(firstRestricted);
        firstRestricted = tmp.firstRestricted;
        if (tmp.message) {
            message = tmp.message;
        }

        previousStrict = strict;
        previousYieldAllowed = state.yieldAllowed;
        state.yieldAllowed = generator;

        body = parseFunctionSourceElements();

        if (strict && firstRestricted) {
            throwError(firstRestricted, message);
        }
        if (strict && tmp.stricted) {
            throwErrorTolerant(tmp.stricted, message);
        }
        if (state.yieldAllowed && !state.yieldFound) {
            throwErrorTolerant({}, Messages.NoYieldInGenerator);
        }
        strict = previousStrict;
        state.yieldAllowed = previousYieldAllowed;

        return delegate.createFunctionDeclaration(id, tmp.params, tmp.defaults, body, tmp.rest, generator, false);
    }

    function parseFunctionExpression() {
        var token, id = null, firstRestricted, message, tmp, body, previousStrict, previousYieldAllowed, generator;

        expectKeyword('function');

        generator = false;

        if (match('*')) {
            lex();
            generator = true;
        }

        if (!match('(')) {
            token = lookahead;
            id = parseVariableIdentifier();
            if (strict) {
                if (isRestrictedWord(token.value)) {
                    throwErrorTolerant(token, Messages.StrictFunctionName);
                }
            } else {
                if (isRestrictedWord(token.value)) {
                    firstRestricted = token;
                    message = Messages.StrictFunctionName;
                } else if (isStrictModeReservedWord(token.value)) {
                    firstRestricted = token;
                    message = Messages.StrictReservedWord;
                }
            }
        }

        tmp = parseParams(firstRestricted);
        firstRestricted = tmp.firstRestricted;
        if (tmp.message) {
            message = tmp.message;
        }

        previousStrict = strict;
        previousYieldAllowed = state.yieldAllowed;
        state.yieldAllowed = generator;

        body = parseFunctionSourceElements();

        if (strict && firstRestricted) {
            throwError(firstRestricted, message);
        }
        if (strict && tmp.stricted) {
            throwErrorTolerant(tmp.stricted, message);
        }
        if (state.yieldAllowed && !state.yieldFound) {
            throwErrorTolerant({}, Messages.NoYieldInGenerator);
        }
        strict = previousStrict;
        state.yieldAllowed = previousYieldAllowed;

        return delegate.createFunctionExpression(id, tmp.params, tmp.defaults, body, tmp.rest, generator, false);
    }

    function parseYieldExpression() {
        var delegateFlag, expr;

        expectKeyword('yield');

        if (!state.yieldAllowed) {
            throwErrorTolerant({}, Messages.IllegalYield);
        }

        delegateFlag = false;
        if (match('*')) {
            lex();
            delegateFlag = true;
        }

        expr = parseAssignmentExpression();
        state.yieldFound = true;

        return delegate.createYieldExpression(expr, delegateFlag);
    }

    // 14 Classes

    function parseMethodDefinition(existingPropNames) {
        var token, key, param, propType, isValidDuplicateProp = false;

        if (lookahead.value === 'static') {
            propType = ClassPropertyType.static;
            lex();
        } else {
            propType = ClassPropertyType.prototype;
        }

        if (match('*')) {
            lex();
            return delegate.createMethodDefinition(
                propType,
                '',
                parseObjectPropertyKey(),
                parsePropertyMethodFunction({ generator: true })
            );
        }

        token = lookahead;
        key = parseObjectPropertyKey();

        if (token.value === 'get' && !match('(')) {
            key = parseObjectPropertyKey();

            // It is a syntax error if any other properties have a name
            // duplicating this one unless they are a setter
            if (existingPropNames[propType].hasOwnProperty(key.name)) {
                isValidDuplicateProp =
                    // There isn't already a getter for this prop
                    existingPropNames[propType][key.name].get === undefined
                    // There isn't already a data prop by this name
                    && existingPropNames[propType][key.name].data === undefined
                    // The only existing prop by this name is a setter
                    && existingPropNames[propType][key.name].set !== undefined;
                if (!isValidDuplicateProp) {
                    throwError(key, Messages.IllegalDuplicateClassProperty);
                }
            } else {
                existingPropNames[propType][key.name] = {};
            }
            existingPropNames[propType][key.name].get = true;

            expect('(');
            expect(')');
            return delegate.createMethodDefinition(
                propType,
                'get',
                key,
                parsePropertyFunction({ generator: false })
            );
        }
        if (token.value === 'set' && !match('(')) {
            key = parseObjectPropertyKey();

            // It is a syntax error if any other properties have a name
            // duplicating this one unless they are a getter
            if (existingPropNames[propType].hasOwnProperty(key.name)) {
                isValidDuplicateProp =
                    // There isn't already a setter for this prop
                    existingPropNames[propType][key.name].set === undefined
                    // There isn't already a data prop by this name
                    && existingPropNames[propType][key.name].data === undefined
                    // The only existing prop by this name is a getter
                    && existingPropNames[propType][key.name].get !== undefined;
                if (!isValidDuplicateProp) {
                    throwError(key, Messages.IllegalDuplicateClassProperty);
                }
            } else {
                existingPropNames[propType][key.name] = {};
            }
            existingPropNames[propType][key.name].set = true;

            expect('(');
            token = lookahead;
            param = [ parseVariableIdentifier() ];
            expect(')');
            return delegate.createMethodDefinition(
                propType,
                'set',
                key,
                parsePropertyFunction({ params: param, generator: false, name: token })
            );
        }

        // It is a syntax error if any other properties have the same name as a
        // non-getter, non-setter method
        if (existingPropNames[propType].hasOwnProperty(key.name)) {
            throwError(key, Messages.IllegalDuplicateClassProperty);
        } else {
            existingPropNames[propType][key.name] = {};
        }
        existingPropNames[propType][key.name].data = true;

        return delegate.createMethodDefinition(
            propType,
            '',
            key,
            parsePropertyMethodFunction({ generator: false })
        );
    }

    function parseClassElement(existingProps) {
        if (match(';')) {
            lex();
            return;
        }
        return parseMethodDefinition(existingProps);
    }

    function parseClassBody() {
        var classElement, classElements = [], existingProps = {};

        existingProps[ClassPropertyType.static] = {};
        existingProps[ClassPropertyType.prototype] = {};

        expect('{');

        while (index < length) {
            if (match('}')) {
                break;
            }
            classElement = parseClassElement(existingProps);

            if (typeof classElement !== 'undefined') {
                classElements.push(classElement);
            }
        }

        expect('}');

        return delegate.createClassBody(classElements);
    }

    function parseClassExpression() {
        var id, previousYieldAllowed, superClass = null;

        expectKeyword('class');

        if (!matchKeyword('extends') && !match('{')) {
            id = parseVariableIdentifier();
        }

        if (matchKeyword('extends')) {
            expectKeyword('extends');
            previousYieldAllowed = state.yieldAllowed;
            state.yieldAllowed = false;
            superClass = parseAssignmentExpression();
            state.yieldAllowed = previousYieldAllowed;
        }

        return delegate.createClassExpression(id, superClass, parseClassBody());
    }

    function parseClassDeclaration() {
        var id, previousYieldAllowed, superClass = null;

        expectKeyword('class');

        id = parseVariableIdentifier();

        if (matchKeyword('extends')) {
            expectKeyword('extends');
            previousYieldAllowed = state.yieldAllowed;
            state.yieldAllowed = false;
            superClass = parseAssignmentExpression();
            state.yieldAllowed = previousYieldAllowed;
        }

        return delegate.createClassDeclaration(id, superClass, parseClassBody());
    }

    // 15 Program

    function matchModuleDeclaration() {
        var id;
        if (matchContextualKeyword('module')) {
            id = lookahead2();
            return id.type === Token.StringLiteral || id.type === Token.Identifier;
        }
        return false;
    }

    function parseSourceElement() {
        if (lookahead.type === Token.Keyword) {
            switch (lookahead.value) {
            case 'const':
            case 'let':
                return parseConstLetDeclaration(lookahead.value);
            case 'function':
                return parseFunctionDeclaration();
            case 'export':
                return parseExportDeclaration();
            case 'import':
                return parseImportDeclaration();
            default:
                return parseStatement();
            }
        }

        if (matchModuleDeclaration()) {
            throwError({}, Messages.NestedModule);
        }

        if (lookahead.type !== Token.EOF) {
            return parseStatement();
        }
    }

    function parseProgramElement() {
        if (lookahead.type === Token.Keyword) {
            switch (lookahead.value) {
            case 'export':
                return parseExportDeclaration();
            case 'import':
                return parseImportDeclaration();
            }
        }

        if (matchModuleDeclaration()) {
            return parseModuleDeclaration();
        }

        return parseSourceElement();
    }

    function parseProgramElements() {
        var sourceElement, sourceElements = [], token, directive, firstRestricted;

        while (index < length) {
            token = lookahead;
            if (token.type !== Token.StringLiteral) {
                break;
            }

            sourceElement = parseProgramElement();
            sourceElements.push(sourceElement);
            if (sourceElement.expression.type !== Syntax.Literal) {
                // this is not directive
                break;
            }
            directive = source.slice(token.range[0] + 1, token.range[1] - 1);
            if (directive === 'use strict') {
                strict = true;
                if (firstRestricted) {
                    throwErrorTolerant(firstRestricted, Messages.StrictOctalLiteral);
                }
            } else {
                if (!firstRestricted && token.octal) {
                    firstRestricted = token;
                }
            }
        }

        while (index < length) {
            sourceElement = parseProgramElement();
            if (typeof sourceElement === 'undefined') {
                break;
            }
            sourceElements.push(sourceElement);
        }
        return sourceElements;
    }

    function parseModuleElement() {
        return parseSourceElement();
    }

    function parseModuleElements() {
        var list = [],
            statement;

        while (index < length) {
            if (match('}')) {
                break;
            }
            statement = parseModuleElement();
            if (typeof statement === 'undefined') {
                break;
            }
            list.push(statement);
        }

        return list;
    }

    function parseModuleBlock() {
        var block;

        expect('{');

        block = parseModuleElements();

        expect('}');

        return delegate.createBlockStatement(block);
    }

    function parseProgram() {
        var body;
        strict = false;
        peek();
        body = parseProgramElements();
        return delegate.createProgram(body);
    }

    // The following functions are needed only when the option to preserve
    // the comments is active.

    function addComment(type, value, start, end, loc) {
        assert(typeof start === 'number', 'Comment must have valid position');

        // Because the way the actual token is scanned, often the comments
        // (if any) are skipped twice during the lexical analysis.
        // Thus, we need to skip adding a comment if the comment array already
        // handled it.
        if (extra.comments.length > 0) {
            if (extra.comments[extra.comments.length - 1].range[1] > start) {
                return;
            }
        }

        extra.comments.push({
            type: type,
            value: value,
            range: [start, end],
            loc: loc
        });
    }

    function scanComment() {
        var comment, ch, loc, start, blockComment, lineComment;

        comment = '';
        blockComment = false;
        lineComment = false;

        while (index < length) {
            ch = source[index];

            if (lineComment) {
                ch = source[index++];
                if (isLineTerminator(ch.charCodeAt(0))) {
                    loc.end = {
                        line: lineNumber,
                        column: index - lineStart - 1
                    };
                    lineComment = false;
                    addComment('Line', comment, start, index - 1, loc);
                    if (ch === '\r' && source[index] === '\n') {
                        ++index;
                    }
                    ++lineNumber;
                    lineStart = index;
                    comment = '';
                } else if (index >= length) {
                    lineComment = false;
                    comment += ch;
                    loc.end = {
                        line: lineNumber,
                        column: length - lineStart
                    };
                    addComment('Line', comment, start, length, loc);
                } else {
                    comment += ch;
                }
            } else if (blockComment) {
                if (isLineTerminator(ch.charCodeAt(0))) {
                    if (ch === '\r' && source[index + 1] === '\n') {
                        ++index;
                        comment += '\r\n';
                    } else {
                        comment += ch;
                    }
                    ++lineNumber;
                    ++index;
                    lineStart = index;
                    if (index >= length) {
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }
                } else {
                    ch = source[index++];
                    if (index >= length) {
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }
                    comment += ch;
                    if (ch === '*') {
                        ch = source[index];
                        if (ch === '/') {
                            comment = comment.substr(0, comment.length - 1);
                            blockComment = false;
                            ++index;
                            loc.end = {
                                line: lineNumber,
                                column: index - lineStart
                            };
                            addComment('Block', comment, start, index, loc);
                            comment = '';
                        }
                    }
                }
            } else if (ch === '/') {
                ch = source[index + 1];
                if (ch === '/') {
                    loc = {
                        start: {
                            line: lineNumber,
                            column: index - lineStart
                        }
                    };
                    start = index;
                    index += 2;
                    lineComment = true;
                    if (index >= length) {
                        loc.end = {
                            line: lineNumber,
                            column: index - lineStart
                        };
                        lineComment = false;
                        addComment('Line', comment, start, index, loc);
                    }
                } else if (ch === '*') {
                    start = index;
                    index += 2;
                    blockComment = true;
                    loc = {
                        start: {
                            line: lineNumber,
                            column: index - lineStart - 2
                        }
                    };
                    if (index >= length) {
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }
                } else {
                    break;
                }
            } else if (isWhiteSpace(ch.charCodeAt(0))) {
                ++index;
            } else if (isLineTerminator(ch.charCodeAt(0))) {
                ++index;
                if (ch ===  '\r' && source[index] === '\n') {
                    ++index;
                }
                ++lineNumber;
                lineStart = index;
            } else {
                break;
            }
        }
    }

    function filterCommentLocation() {
        var i, entry, comment, comments = [];

        for (i = 0; i < extra.comments.length; ++i) {
            entry = extra.comments[i];
            comment = {
                type: entry.type,
                value: entry.value
            };
            if (extra.range) {
                comment.range = entry.range;
            }
            if (extra.loc) {
                comment.loc = entry.loc;
            }
            comments.push(comment);
        }

        extra.comments = comments;
    }

    function collectToken() {
        var start, loc, token, range, value;

        skipComment();
        start = index;
        loc = {
            start: {
                line: lineNumber,
                column: index - lineStart
            }
        };

        token = extra.advance();
        loc.end = {
            line: lineNumber,
            column: index - lineStart
        };

        if (token.type !== Token.EOF) {
            range = [token.range[0], token.range[1]];
            value = source.slice(token.range[0], token.range[1]);
            extra.tokens.push({
                type: TokenName[token.type],
                value: value,
                range: range,
                loc: loc
            });
        }

        return token;
    }

    function collectRegex() {
        var pos, loc, regex, token;

        skipComment();

        pos = index;
        loc = {
            start: {
                line: lineNumber,
                column: index - lineStart
            }
        };

        regex = extra.scanRegExp();
        loc.end = {
            line: lineNumber,
            column: index - lineStart
        };

        if (!extra.tokenize) {
            // Pop the previous token, which is likely '/' or '/='
            if (extra.tokens.length > 0) {
                token = extra.tokens[extra.tokens.length - 1];
                if (token.range[0] === pos && token.type === 'Punctuator') {
                    if (token.value === '/' || token.value === '/=') {
                        extra.tokens.pop();
                    }
                }
            }

            extra.tokens.push({
                type: 'RegularExpression',
                value: regex.literal,
                range: [pos, index],
                loc: loc
            });
        }

        return regex;
    }

    function filterTokenLocation() {
        var i, entry, token, tokens = [];

        for (i = 0; i < extra.tokens.length; ++i) {
            entry = extra.tokens[i];
            token = {
                type: entry.type,
                value: entry.value
            };
            if (extra.range) {
                token.range = entry.range;
            }
            if (extra.loc) {
                token.loc = entry.loc;
            }
            tokens.push(token);
        }

        extra.tokens = tokens;
    }

    function LocationMarker() {
        this.range = [index, index];
        this.loc = {
            start: {
                line: lineNumber,
                column: index - lineStart
            },
            end: {
                line: lineNumber,
                column: index - lineStart
            }
        };
    }

    LocationMarker.prototype = {
        constructor: LocationMarker,

        end: function () {
            this.range[1] = index;
            this.loc.end.line = lineNumber;
            this.loc.end.column = index - lineStart;
        },

        applyGroup: function (node) {
            if (extra.range) {
                node.groupRange = [this.range[0], this.range[1]];
            }
            if (extra.loc) {
                node.groupLoc = {
                    start: {
                        line: this.loc.start.line,
                        column: this.loc.start.column
                    },
                    end: {
                        line: this.loc.end.line,
                        column: this.loc.end.column
                    }
                };
                node = delegate.postProcess(node);
            }
        },

        apply: function (node) {
            var nodeType = typeof node;
            assert(nodeType === 'object',
                'Applying location marker to an unexpected node type: ' +
                    nodeType);

            if (extra.range) {
                node.range = [this.range[0], this.range[1]];
            }
            if (extra.loc) {
                node.loc = {
                    start: {
                        line: this.loc.start.line,
                        column: this.loc.start.column
                    },
                    end: {
                        line: this.loc.end.line,
                        column: this.loc.end.column
                    }
                };
                node = delegate.postProcess(node);
            }
        }
    };

    function createLocationMarker() {
        return new LocationMarker();
    }

    function trackGroupExpression() {
        var marker, expr;

        skipComment();
        marker = createLocationMarker();
        expect('(');

        ++state.parenthesizedCount;
        expr = parseExpression();

        expect(')');
        marker.end();
        marker.applyGroup(expr);

        return expr;
    }

    function trackLeftHandSideExpression() {
        var marker, expr;

        skipComment();
        marker = createLocationMarker();

        expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();

        while (match('.') || match('[') || lookahead.type === Token.Template) {
            if (match('[')) {
                expr = delegate.createMemberExpression('[', expr, parseComputedMember());
                marker.end();
                marker.apply(expr);
            } else if (match('.')) {
                expr = delegate.createMemberExpression('.', expr, parseNonComputedMember());
                marker.end();
                marker.apply(expr);
            } else {
                expr = delegate.createTaggedTemplateExpression(expr, parseTemplateLiteral());
                marker.end();
                marker.apply(expr);
            }
        }

        return expr;
    }

    function trackLeftHandSideExpressionAllowCall() {
        var marker, expr, args;

        skipComment();
        marker = createLocationMarker();

        expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();

        while (match('.') || match('[') || match('(') || lookahead.type === Token.Template) {
            if (match('(')) {
                args = parseArguments();
                expr = delegate.createCallExpression(expr, args);
                marker.end();
                marker.apply(expr);
            } else if (match('[')) {
                expr = delegate.createMemberExpression('[', expr, parseComputedMember());
                marker.end();
                marker.apply(expr);
            } else if (match('.')) {
                expr = delegate.createMemberExpression('.', expr, parseNonComputedMember());
                marker.end();
                marker.apply(expr);
            } else {
                expr = delegate.createTaggedTemplateExpression(expr, parseTemplateLiteral());
                marker.end();
                marker.apply(expr);
            }
        }

        return expr;
    }

    function filterGroup(node) {
        var n, i, entry;

        n = (Object.prototype.toString.apply(node) === '[object Array]') ? [] : {};
        for (i in node) {
            if (node.hasOwnProperty(i) && i !== 'groupRange' && i !== 'groupLoc') {
                entry = node[i];
                if (entry === null || typeof entry !== 'object' || entry instanceof RegExp) {
                    n[i] = entry;
                } else {
                    n[i] = filterGroup(entry);
                }
            }
        }
        return n;
    }

    function wrapTrackingFunction(range, loc) {

        return function (parseFunction) {

            function isBinary(node) {
                return node.type === Syntax.LogicalExpression ||
                    node.type === Syntax.BinaryExpression;
            }

            function visit(node) {
                var start, end;

                if (isBinary(node.left)) {
                    visit(node.left);
                }
                if (isBinary(node.right)) {
                    visit(node.right);
                }

                if (range) {
                    if (node.left.groupRange || node.right.groupRange) {
                        start = node.left.groupRange ? node.left.groupRange[0] : node.left.range[0];
                        end = node.right.groupRange ? node.right.groupRange[1] : node.right.range[1];
                        node.range = [start, end];
                    } else if (typeof node.range === 'undefined') {
                        start = node.left.range[0];
                        end = node.right.range[1];
                        node.range = [start, end];
                    }
                }
                if (loc) {
                    if (node.left.groupLoc || node.right.groupLoc) {
                        start = node.left.groupLoc ? node.left.groupLoc.start : node.left.loc.start;
                        end = node.right.groupLoc ? node.right.groupLoc.end : node.right.loc.end;
                        node.loc = {
                            start: start,
                            end: end
                        };
                        node = delegate.postProcess(node);
                    } else if (typeof node.loc === 'undefined') {
                        node.loc = {
                            start: node.left.loc.start,
                            end: node.right.loc.end
                        };
                        node = delegate.postProcess(node);
                    }
                }
            }

            return function () {
                var marker, node;

                skipComment();

                marker = createLocationMarker();
                node = parseFunction.apply(null, arguments);
                marker.end();

                if (range && typeof node.range === 'undefined') {
                    marker.apply(node);
                }

                if (loc && typeof node.loc === 'undefined') {
                    marker.apply(node);
                }

                if (isBinary(node)) {
                    visit(node);
                }

                return node;
            };
        };
    }

    function patch() {

        var wrapTracking;

        if (extra.comments) {
            extra.skipComment = skipComment;
            skipComment = scanComment;
        }

        if (extra.range || extra.loc) {

            extra.parseGroupExpression = parseGroupExpression;
            extra.parseLeftHandSideExpression = parseLeftHandSideExpression;
            extra.parseLeftHandSideExpressionAllowCall = parseLeftHandSideExpressionAllowCall;
            parseGroupExpression = trackGroupExpression;
            parseLeftHandSideExpression = trackLeftHandSideExpression;
            parseLeftHandSideExpressionAllowCall = trackLeftHandSideExpressionAllowCall;

            wrapTracking = wrapTrackingFunction(extra.range, extra.loc);

            extra.parseArrayInitialiser = parseArrayInitialiser;
            extra.parseAssignmentExpression = parseAssignmentExpression;
            extra.parseBinaryExpression = parseBinaryExpression;
            extra.parseBlock = parseBlock;
            extra.parseFunctionSourceElements = parseFunctionSourceElements;
            extra.parseCatchClause = parseCatchClause;
            extra.parseComputedMember = parseComputedMember;
            extra.parseConditionalExpression = parseConditionalExpression;
            extra.parseConstLetDeclaration = parseConstLetDeclaration;
            extra.parseExportBatchSpecifier = parseExportBatchSpecifier;
            extra.parseExportDeclaration = parseExportDeclaration;
            extra.parseExportSpecifier = parseExportSpecifier;
            extra.parseExpression = parseExpression;
            extra.parseForVariableDeclaration = parseForVariableDeclaration;
            extra.parseFunctionDeclaration = parseFunctionDeclaration;
            extra.parseFunctionExpression = parseFunctionExpression;
            extra.parseParams = parseParams;
            extra.parseImportDeclaration = parseImportDeclaration;
            extra.parseImportSpecifier = parseImportSpecifier;
            extra.parseModuleDeclaration = parseModuleDeclaration;
            extra.parseModuleBlock = parseModuleBlock;
            extra.parseNewExpression = parseNewExpression;
            extra.parseNonComputedProperty = parseNonComputedProperty;
            extra.parseObjectInitialiser = parseObjectInitialiser;
            extra.parseObjectProperty = parseObjectProperty;
            extra.parseObjectPropertyKey = parseObjectPropertyKey;
            extra.parsePostfixExpression = parsePostfixExpression;
            extra.parsePrimaryExpression = parsePrimaryExpression;
            extra.parseProgram = parseProgram;
            extra.parsePropertyFunction = parsePropertyFunction;
            extra.parseSpreadOrAssignmentExpression = parseSpreadOrAssignmentExpression;
            extra.parseTemplateElement = parseTemplateElement;
            extra.parseTemplateLiteral = parseTemplateLiteral;
            extra.parseStatement = parseStatement;
            extra.parseSwitchCase = parseSwitchCase;
            extra.parseUnaryExpression = parseUnaryExpression;
            extra.parseVariableDeclaration = parseVariableDeclaration;
            extra.parseVariableIdentifier = parseVariableIdentifier;
            extra.parseMethodDefinition = parseMethodDefinition;
            extra.parseClassDeclaration = parseClassDeclaration;
            extra.parseClassExpression = parseClassExpression;
            extra.parseClassBody = parseClassBody;

            parseArrayInitialiser = wrapTracking(extra.parseArrayInitialiser);
            parseAssignmentExpression = wrapTracking(extra.parseAssignmentExpression);
            parseBinaryExpression = wrapTracking(extra.parseBinaryExpression);
            parseBlock = wrapTracking(extra.parseBlock);
            parseFunctionSourceElements = wrapTracking(extra.parseFunctionSourceElements);
            parseCatchClause = wrapTracking(extra.parseCatchClause);
            parseComputedMember = wrapTracking(extra.parseComputedMember);
            parseConditionalExpression = wrapTracking(extra.parseConditionalExpression);
            parseConstLetDeclaration = wrapTracking(extra.parseConstLetDeclaration);
            parseExportBatchSpecifier = wrapTracking(parseExportBatchSpecifier);
            parseExportDeclaration = wrapTracking(parseExportDeclaration);
            parseExportSpecifier = wrapTracking(parseExportSpecifier);
            parseExpression = wrapTracking(extra.parseExpression);
            parseForVariableDeclaration = wrapTracking(extra.parseForVariableDeclaration);
            parseFunctionDeclaration = wrapTracking(extra.parseFunctionDeclaration);
            parseFunctionExpression = wrapTracking(extra.parseFunctionExpression);
            parseParams = wrapTracking(extra.parseParams);
            parseImportDeclaration = wrapTracking(extra.parseImportDeclaration);
            parseImportSpecifier = wrapTracking(extra.parseImportSpecifier);
            parseModuleDeclaration = wrapTracking(extra.parseModuleDeclaration);
            parseModuleBlock = wrapTracking(extra.parseModuleBlock);
            parseLeftHandSideExpression = wrapTracking(parseLeftHandSideExpression);
            parseNewExpression = wrapTracking(extra.parseNewExpression);
            parseNonComputedProperty = wrapTracking(extra.parseNonComputedProperty);
            parseObjectInitialiser = wrapTracking(extra.parseObjectInitialiser);
            parseObjectProperty = wrapTracking(extra.parseObjectProperty);
            parseObjectPropertyKey = wrapTracking(extra.parseObjectPropertyKey);
            parsePostfixExpression = wrapTracking(extra.parsePostfixExpression);
            parsePrimaryExpression = wrapTracking(extra.parsePrimaryExpression);
            parseProgram = wrapTracking(extra.parseProgram);
            parsePropertyFunction = wrapTracking(extra.parsePropertyFunction);
            parseTemplateElement = wrapTracking(extra.parseTemplateElement);
            parseTemplateLiteral = wrapTracking(extra.parseTemplateLiteral);
            parseSpreadOrAssignmentExpression = wrapTracking(extra.parseSpreadOrAssignmentExpression);
            parseStatement = wrapTracking(extra.parseStatement);
            parseSwitchCase = wrapTracking(extra.parseSwitchCase);
            parseUnaryExpression = wrapTracking(extra.parseUnaryExpression);
            parseVariableDeclaration = wrapTracking(extra.parseVariableDeclaration);
            parseVariableIdentifier = wrapTracking(extra.parseVariableIdentifier);
            parseMethodDefinition = wrapTracking(extra.parseMethodDefinition);
            parseClassDeclaration = wrapTracking(extra.parseClassDeclaration);
            parseClassExpression = wrapTracking(extra.parseClassExpression);
            parseClassBody = wrapTracking(extra.parseClassBody);
        }

        if (typeof extra.tokens !== 'undefined') {
            extra.advance = advance;
            extra.scanRegExp = scanRegExp;

            advance = collectToken;
            scanRegExp = collectRegex;
        }
    }

    function unpatch() {
        if (typeof extra.skipComment === 'function') {
            skipComment = extra.skipComment;
        }

        if (extra.range || extra.loc) {
            parseArrayInitialiser = extra.parseArrayInitialiser;
            parseAssignmentExpression = extra.parseAssignmentExpression;
            parseBinaryExpression = extra.parseBinaryExpression;
            parseBlock = extra.parseBlock;
            parseFunctionSourceElements = extra.parseFunctionSourceElements;
            parseCatchClause = extra.parseCatchClause;
            parseComputedMember = extra.parseComputedMember;
            parseConditionalExpression = extra.parseConditionalExpression;
            parseConstLetDeclaration = extra.parseConstLetDeclaration;
            parseExportBatchSpecifier = extra.parseExportBatchSpecifier;
            parseExportDeclaration = extra.parseExportDeclaration;
            parseExportSpecifier = extra.parseExportSpecifier;
            parseExpression = extra.parseExpression;
            parseForVariableDeclaration = extra.parseForVariableDeclaration;
            parseFunctionDeclaration = extra.parseFunctionDeclaration;
            parseFunctionExpression = extra.parseFunctionExpression;
            parseImportDeclaration = extra.parseImportDeclaration;
            parseImportSpecifier = extra.parseImportSpecifier;
            parseGroupExpression = extra.parseGroupExpression;
            parseLeftHandSideExpression = extra.parseLeftHandSideExpression;
            parseLeftHandSideExpressionAllowCall = extra.parseLeftHandSideExpressionAllowCall;
            parseModuleDeclaration = extra.parseModuleDeclaration;
            parseModuleBlock = extra.parseModuleBlock;
            parseNewExpression = extra.parseNewExpression;
            parseNonComputedProperty = extra.parseNonComputedProperty;
            parseObjectInitialiser = extra.parseObjectInitialiser;
            parseObjectProperty = extra.parseObjectProperty;
            parseObjectPropertyKey = extra.parseObjectPropertyKey;
            parsePostfixExpression = extra.parsePostfixExpression;
            parsePrimaryExpression = extra.parsePrimaryExpression;
            parseProgram = extra.parseProgram;
            parsePropertyFunction = extra.parsePropertyFunction;
            parseTemplateElement = extra.parseTemplateElement;
            parseTemplateLiteral = extra.parseTemplateLiteral;
            parseSpreadOrAssignmentExpression = extra.parseSpreadOrAssignmentExpression;
            parseStatement = extra.parseStatement;
            parseSwitchCase = extra.parseSwitchCase;
            parseUnaryExpression = extra.parseUnaryExpression;
            parseVariableDeclaration = extra.parseVariableDeclaration;
            parseVariableIdentifier = extra.parseVariableIdentifier;
            parseMethodDefinition = extra.parseMethodDefinition;
            parseClassDeclaration = extra.parseClassDeclaration;
            parseClassExpression = extra.parseClassExpression;
            parseClassBody = extra.parseClassBody;
        }

        if (typeof extra.scanRegExp === 'function') {
            advance = extra.advance;
            scanRegExp = extra.scanRegExp;
        }
    }

    // This is used to modify the delegate.

    function extend(object, properties) {
        var entry, result = {};

        for (entry in object) {
            if (object.hasOwnProperty(entry)) {
                result[entry] = object[entry];
            }
        }

        for (entry in properties) {
            if (properties.hasOwnProperty(entry)) {
                result[entry] = properties[entry];
            }
        }

        return result;
    }

    function tokenize(code, options) {
        var toString,
            token,
            tokens;

        toString = String;
        if (typeof code !== 'string' && !(code instanceof String)) {
            code = toString(code);
        }

        delegate = SyntaxTreeDelegate;
        source = code;
        index = 0;
        lineNumber = (source.length > 0) ? 1 : 0;
        lineStart = 0;
        length = source.length;
        lookahead = null;
        state = {
            allowKeyword: true,
            allowIn: true,
            labelSet: {},
            inFunctionBody: false,
            inIteration: false,
            inSwitch: false
        };

        extra = {};

        // Options matching.
        options = options || {};

        // Of course we collect tokens here.
        options.tokens = true;
        extra.tokens = [];
        extra.tokenize = true;
        // The following two fields are necessary to compute the Regex tokens.
        extra.openParenToken = -1;
        extra.openCurlyToken = -1;

        extra.range = (typeof options.range === 'boolean') && options.range;
        extra.loc = (typeof options.loc === 'boolean') && options.loc;

        if (typeof options.comment === 'boolean' && options.comment) {
            extra.comments = [];
        }
        if (typeof options.tolerant === 'boolean' && options.tolerant) {
            extra.errors = [];
        }

        if (length > 0) {
            if (typeof source[0] === 'undefined') {
                // Try first to convert to a string. This is good as fast path
                // for old IE which understands string indexing for string
                // literals only and not for string object.
                if (code instanceof String) {
                    source = code.valueOf();
                }
            }
        }

        patch();

        try {
            peek();
            if (lookahead.type === Token.EOF) {
                return extra.tokens;
            }

            token = lex();
            while (lookahead.type !== Token.EOF) {
                try {
                    token = lex();
                } catch (lexError) {
                    token = lookahead;
                    if (extra.errors) {
                        extra.errors.push(lexError);
                        // We have to break on the first error
                        // to avoid infinite loops.
                        break;
                    } else {
                        throw lexError;
                    }
                }
            }

            filterTokenLocation();
            tokens = extra.tokens;
            if (typeof extra.comments !== 'undefined') {
                filterCommentLocation();
                tokens.comments = extra.comments;
            }
            if (typeof extra.errors !== 'undefined') {
                tokens.errors = extra.errors;
            }
        } catch (e) {
            throw e;
        } finally {
            unpatch();
            extra = {};
        }
        return tokens;
    }

    function parse(code, options) {
        var program, toString;

        toString = String;
        if (typeof code !== 'string' && !(code instanceof String)) {
            code = toString(code);
        }

        delegate = SyntaxTreeDelegate;
        source = code;
        index = 0;
        lineNumber = (source.length > 0) ? 1 : 0;
        lineStart = 0;
        length = source.length;
        lookahead = null;
        state = {
            allowKeyword: false,
            allowIn: true,
            labelSet: {},
            parenthesizedCount: 0,
            inFunctionBody: false,
            inIteration: false,
            inSwitch: false,
            yieldAllowed: false,
            yieldFound: false
        };

        extra = {};
        if (typeof options !== 'undefined') {
            extra.range = (typeof options.range === 'boolean') && options.range;
            extra.loc = (typeof options.loc === 'boolean') && options.loc;

            if (extra.loc && options.source !== null && options.source !== undefined) {
                delegate = extend(delegate, {
                    'postProcess': function (node) {
                        node.loc.source = toString(options.source);
                        return node;
                    }
                });
            }

            if (typeof options.tokens === 'boolean' && options.tokens) {
                extra.tokens = [];
            }
            if (typeof options.comment === 'boolean' && options.comment) {
                extra.comments = [];
            }
            if (typeof options.tolerant === 'boolean' && options.tolerant) {
                extra.errors = [];
            }
        }

        if (length > 0) {
            if (typeof source[0] === 'undefined') {
                // Try first to convert to a string. This is good as fast path
                // for old IE which understands string indexing for string
                // literals only and not for string object.
                if (code instanceof String) {
                    source = code.valueOf();
                }
            }
        }

        patch();
        try {
            program = parseProgram();
            if (typeof extra.comments !== 'undefined') {
                filterCommentLocation();
                program.comments = extra.comments;
            }
            if (typeof extra.tokens !== 'undefined') {
                filterTokenLocation();
                program.tokens = extra.tokens;
            }
            if (typeof extra.errors !== 'undefined') {
                program.errors = extra.errors;
            }
            if (extra.range || extra.loc) {
                program.body = filterGroup(program.body);
            }
        } catch (e) {
            throw e;
        } finally {
            unpatch();
            extra = {};
        }

        return program;
    }

    // Sync with *.json manifests.
    exports.version = '1.1.0-dev-harmony';

    exports.tokenize = tokenize;

    exports.parse = parse;

    // Deep copy.
    exports.Syntax = (function () {
        var name, types = {};

        if (typeof Object.create === 'function') {
            types = Object.create(null);
        }

        for (name in Syntax) {
            if (Syntax.hasOwnProperty(name)) {
                types[name] = Syntax[name];
            }
        }

        if (typeof Object.freeze === 'function') {
            Object.freeze(types);
        }

        return types;
    }());

}));
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],70:[function(require,module,exports){

},{}],71:[function(require,module,exports){
// http://wiki.commonjs.org/wiki/Unit_Testing/1.0
//
// THIS IS NOT TESTED NOR LIKELY TO WORK OUTSIDE V8!
//
// Originally from narwhal.js (http://narwhaljs.org)
// Copyright (c) 2009 Thomas Robinson <280north.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// when used in node, this will actually load the util module we depend on
// versus loading the builtin util module as happens otherwise
// this is a bug in node module loading as far as I am concerned
var util = require('util/');

var pSlice = Array.prototype.slice;
var hasOwn = Object.prototype.hasOwnProperty;

// 1. The assert module provides functions that throw
// AssertionError's when particular conditions are not met. The
// assert module must conform to the following interface.

var assert = module.exports = ok;

// 2. The AssertionError is defined in assert.
// new assert.AssertionError({ message: message,
//                             actual: actual,
//                             expected: expected })

assert.AssertionError = function AssertionError(options) {
  this.name = 'AssertionError';
  this.actual = options.actual;
  this.expected = options.expected;
  this.operator = options.operator;
  if (options.message) {
    this.message = options.message;
    this.generatedMessage = false;
  } else {
    this.message = getMessage(this);
    this.generatedMessage = true;
  }
  var stackStartFunction = options.stackStartFunction || fail;

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, stackStartFunction);
  }
  else {
    // non v8 browsers so we can have a stacktrace
    var err = new Error();
    if (err.stack) {
      var out = err.stack;

      // try to strip useless frames
      var fn_name = stackStartFunction.name;
      var idx = out.indexOf('\n' + fn_name);
      if (idx >= 0) {
        // once we have located the function frame
        // we need to strip out everything before it (and its line)
        var next_line = out.indexOf('\n', idx + 1);
        out = out.substring(next_line + 1);
      }

      this.stack = out;
    }
  }
};

// assert.AssertionError instanceof Error
util.inherits(assert.AssertionError, Error);

function replacer(key, value) {
  if (util.isUndefined(value)) {
    return '' + value;
  }
  if (util.isNumber(value) && (isNaN(value) || !isFinite(value))) {
    return value.toString();
  }
  if (util.isFunction(value) || util.isRegExp(value)) {
    return value.toString();
  }
  return value;
}

function truncate(s, n) {
  if (util.isString(s)) {
    return s.length < n ? s : s.slice(0, n);
  } else {
    return s;
  }
}

function getMessage(self) {
  return truncate(JSON.stringify(self.actual, replacer), 128) + ' ' +
         self.operator + ' ' +
         truncate(JSON.stringify(self.expected, replacer), 128);
}

// At present only the three keys mentioned above are used and
// understood by the spec. Implementations or sub modules can pass
// other keys to the AssertionError's constructor - they will be
// ignored.

// 3. All of the following functions must throw an AssertionError
// when a corresponding condition is not met, with a message that
// may be undefined if not provided.  All assertion methods provide
// both the actual and expected values to the assertion error for
// display purposes.

function fail(actual, expected, message, operator, stackStartFunction) {
  throw new assert.AssertionError({
    message: message,
    actual: actual,
    expected: expected,
    operator: operator,
    stackStartFunction: stackStartFunction
  });
}

// EXTENSION! allows for well behaved errors defined elsewhere.
assert.fail = fail;

// 4. Pure assertion tests whether a value is truthy, as determined
// by !!guard.
// assert.ok(guard, message_opt);
// This statement is equivalent to assert.equal(true, !!guard,
// message_opt);. To test strictly for the value true, use
// assert.strictEqual(true, guard, message_opt);.

function ok(value, message) {
  if (!value) fail(value, true, message, '==', assert.ok);
}
assert.ok = ok;

// 5. The equality assertion tests shallow, coercive equality with
// ==.
// assert.equal(actual, expected, message_opt);

assert.equal = function equal(actual, expected, message) {
  if (actual != expected) fail(actual, expected, message, '==', assert.equal);
};

// 6. The non-equality assertion tests for whether two objects are not equal
// with != assert.notEqual(actual, expected, message_opt);

assert.notEqual = function notEqual(actual, expected, message) {
  if (actual == expected) {
    fail(actual, expected, message, '!=', assert.notEqual);
  }
};

// 7. The equivalence assertion tests a deep equality relation.
// assert.deepEqual(actual, expected, message_opt);

assert.deepEqual = function deepEqual(actual, expected, message) {
  if (!_deepEqual(actual, expected)) {
    fail(actual, expected, message, 'deepEqual', assert.deepEqual);
  }
};

function _deepEqual(actual, expected) {
  // 7.1. All identical values are equivalent, as determined by ===.
  if (actual === expected) {
    return true;

  } else if (util.isBuffer(actual) && util.isBuffer(expected)) {
    if (actual.length != expected.length) return false;

    for (var i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) return false;
    }

    return true;

  // 7.2. If the expected value is a Date object, the actual value is
  // equivalent if it is also a Date object that refers to the same time.
  } else if (util.isDate(actual) && util.isDate(expected)) {
    return actual.getTime() === expected.getTime();

  // 7.3 If the expected value is a RegExp object, the actual value is
  // equivalent if it is also a RegExp object with the same source and
  // properties (`global`, `multiline`, `lastIndex`, `ignoreCase`).
  } else if (util.isRegExp(actual) && util.isRegExp(expected)) {
    return actual.source === expected.source &&
           actual.global === expected.global &&
           actual.multiline === expected.multiline &&
           actual.lastIndex === expected.lastIndex &&
           actual.ignoreCase === expected.ignoreCase;

  // 7.4. Other pairs that do not both pass typeof value == 'object',
  // equivalence is determined by ==.
  } else if (!util.isObject(actual) && !util.isObject(expected)) {
    return actual == expected;

  // 7.5 For all other Object pairs, including Array objects, equivalence is
  // determined by having the same number of owned properties (as verified
  // with Object.prototype.hasOwnProperty.call), the same set of keys
  // (although not necessarily the same order), equivalent values for every
  // corresponding key, and an identical 'prototype' property. Note: this
  // accounts for both named and indexed properties on Arrays.
  } else {
    return objEquiv(actual, expected);
  }
}

function isArguments(object) {
  return Object.prototype.toString.call(object) == '[object Arguments]';
}

function objEquiv(a, b) {
  if (util.isNullOrUndefined(a) || util.isNullOrUndefined(b))
    return false;
  // an identical 'prototype' property.
  if (a.prototype !== b.prototype) return false;
  //~~~I've managed to break Object.keys through screwy arguments passing.
  //   Converting to array solves the problem.
  if (isArguments(a)) {
    if (!isArguments(b)) {
      return false;
    }
    a = pSlice.call(a);
    b = pSlice.call(b);
    return _deepEqual(a, b);
  }
  try {
    var ka = objectKeys(a),
        kb = objectKeys(b),
        key, i;
  } catch (e) {//happens when one is a string literal and the other isn't
    return false;
  }
  // having the same number of owned properties (keys incorporates
  // hasOwnProperty)
  if (ka.length != kb.length)
    return false;
  //the same set of keys (although not necessarily the same order),
  ka.sort();
  kb.sort();
  //~~~cheap key test
  for (i = ka.length - 1; i >= 0; i--) {
    if (ka[i] != kb[i])
      return false;
  }
  //equivalent values for every corresponding key, and
  //~~~possibly expensive deep test
  for (i = ka.length - 1; i >= 0; i--) {
    key = ka[i];
    if (!_deepEqual(a[key], b[key])) return false;
  }
  return true;
}

// 8. The non-equivalence assertion tests for any deep inequality.
// assert.notDeepEqual(actual, expected, message_opt);

assert.notDeepEqual = function notDeepEqual(actual, expected, message) {
  if (_deepEqual(actual, expected)) {
    fail(actual, expected, message, 'notDeepEqual', assert.notDeepEqual);
  }
};

// 9. The strict equality assertion tests strict equality, as determined by ===.
// assert.strictEqual(actual, expected, message_opt);

assert.strictEqual = function strictEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(actual, expected, message, '===', assert.strictEqual);
  }
};

// 10. The strict non-equality assertion tests for strict inequality, as
// determined by !==.  assert.notStrictEqual(actual, expected, message_opt);

assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
  if (actual === expected) {
    fail(actual, expected, message, '!==', assert.notStrictEqual);
  }
};

function expectedException(actual, expected) {
  if (!actual || !expected) {
    return false;
  }

  if (Object.prototype.toString.call(expected) == '[object RegExp]') {
    return expected.test(actual);
  } else if (actual instanceof expected) {
    return true;
  } else if (expected.call({}, actual) === true) {
    return true;
  }

  return false;
}

function _throws(shouldThrow, block, expected, message) {
  var actual;

  if (util.isString(expected)) {
    message = expected;
    expected = null;
  }

  try {
    block();
  } catch (e) {
    actual = e;
  }

  message = (expected && expected.name ? ' (' + expected.name + ').' : '.') +
            (message ? ' ' + message : '.');

  if (shouldThrow && !actual) {
    fail(actual, expected, 'Missing expected exception' + message);
  }

  if (!shouldThrow && expectedException(actual, expected)) {
    fail(actual, expected, 'Got unwanted exception' + message);
  }

  if ((shouldThrow && actual && expected &&
      !expectedException(actual, expected)) || (!shouldThrow && actual)) {
    throw actual;
  }
}

// 11. Expected to throw an error:
// assert.throws(block, Error_opt, message_opt);

assert.throws = function(block, /*optional*/error, /*optional*/message) {
  _throws.apply(this, [true].concat(pSlice.call(arguments)));
};

// EXTENSION! This is annoying to write outside this module.
assert.doesNotThrow = function(block, /*optional*/message) {
  _throws.apply(this, [false].concat(pSlice.call(arguments)));
};

assert.ifError = function(err) { if (err) {throw err;}};

var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) {
    if (hasOwn.call(obj, key)) keys.push(key);
  }
  return keys;
};

},{"util/":77}],72:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        throw TypeError('Uncaught, unspecified "error" event.');
      }
      return false;
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      console.trace();
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],73:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],74:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],75:[function(require,module,exports){
var process=require("__browserify_process");// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
};


exports.basename = function(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPath(path)[3];
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

},{"__browserify_process":74}],76:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],77:[function(require,module,exports){
var process=require("__browserify_process"),global=typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {};// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

},{"./support/isBuffer":76,"__browserify_process":74,"inherits":73}]},{},[1])
(1)
});
