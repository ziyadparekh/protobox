var $ = require('jquery');

/**
 * init the header component.
 * @api
 * @param {EventEmitter} emitter
 * @param {UserSession} session
 */
module.exports = function (emitter, session) {
  var files = $('.editor-tabs .files');
  var header = $('.proto-run .action-buttons');
  var stack = $(".scope-tabs .scopes");

  stack.on('click', 'a', function (e) {
    stack.find('.active').removeClass('active');
    var el = $(e.target).parent();
    el.addClass('active');
    var scope = el.attr('data-stack');
    switch(scope){
      case "call-stack":
        $(".var-scope").addClass('hidden');
        $('.call-stack').removeClass('hidden');
        break;
      case "scope":
        $(".var-scope").removeClass('hidden');
        $(".call-stack").addClass('hidden');
        break;
    }
  });

  header.on('click', 'a', function (e) {
    var el = $(e.target).parent();
    var action = el.attr('data-action');
    emitter.emit('component-header:run', action)
  });

  files.on('click', 'a', function (e) {
    files.find('.active').removeClass('active');
    var el = $(e.target).parent();
    el.addClass('active');
    var filename = el.attr('data-filename');
    emitter.emit('component-header:file select', filename);
  });
};
