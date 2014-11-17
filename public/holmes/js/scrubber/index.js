var scrubber = require("./scrubber");
var $ = require('jquery');


function Scrubber (emiter) {
	this.scrubberView = new scrubber();
	emiter.on("component-debugger:finishedRunning", this.$initScrubber.bind(this));
  //$("#play-pause").on('click', this.playPause.bind(this));
	this.emiter = emiter;

}

Scrubber.prototype.$initScrubber = function(steps, stepno) {
	this.steps = steps || [];
	var self = this;
	this.scrubberView
		.min(0)// 0
		.max(this.steps.length-1) // 1
		.step(1) // 0
		.value(stepno) // 0
		.orientation('horizontal'); // 'horizontal'
  this.scrubberView.elt.style.width = "47%";
	$('#scrubber').empty().append(this.scrubberView.elt);
	this.scrubberView.onValueChanged = function (value) {
		self.emiter.emit("lineNo", self.steps[value].y, value);
	}
};

// Scrubber.prototype.playPause = function(e) {
//   if($(e.currentTarget).hasClass('play')){
//     $(e.currentTarget).removeClass('play').addClass('pause').text('Pause');
//   } else {
//     $(e.currentTarget).removeClass('pause').addClass('play').text('Play');
//     if(interval){
//       this.currentPlayStep = this.scrubberView.value();
//       clearInterval(interval);
//       return;
//     }
//   }
//   this.currentPlayStep = this.currentPlayStep || 0;
//   var self = this;
//   var interval = setInterval(function () {
//     if (this.currentPlayStep === self.steps.length -1){
//       clearInterval(interval)
//     } else {
//       self.scrubberView.value(this.currentPlayStep);
//       this.currentPlayStep++
//     }
//   }, 700);
// };


module.exports = Scrubber;
