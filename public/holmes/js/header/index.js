var $ = require('jquery');

/**
 * init the header component.
 * @api
 * @param {EventEmitter} emitter
 * @param {UserSession} session
 */
module.exports = function (emitter, session) {
  $('header .save').on('click', function () {
    
  });

  var files = $('header .files');
  files.on('click', 'a', function (e) {
    files.find('.active').removeClass('active');
    var el = $(e.target).parent();
    el.addClass('active');
    emitter.emit('component-header:file select', el.attr('data-filename'));
  });
};