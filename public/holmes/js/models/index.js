var js = {
  filename: 'index.js',
  text: '',
  breakpoints: [],
  mode: 'javascript'
};
var html = {
  filename: 'index.html',
  text: '',
  breakpoints: [] ,
  mode: 'html'
};
// js.text = ['function randomColor() {',
//    '  var n = Math.floor(Math.random() * 16777215);',
//    '  return "#" + n.toString(16);',
//    '}',
//    '',
//    'function changeColor() {',
//    '  var color = randomColor();',
//    '  var elem = document.querySelector(".hello-world");',
//    '  elem.style.color = color;',
//    '}',
//    '',
//    'setInterval(changeColor, 250);'
//    ].join('\n');

// html.text = '<div class="hello-world">Hello World</div>';

var files = {}
files.html = html;
files.js = js;


module.exports = files;
