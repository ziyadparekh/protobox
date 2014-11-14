var scrubber = require("./scrubber");
var $ = require('jquery');


function Scrubber (emiter) {
	this.scrubberView = new scrubber();
	emiter.on("component-debugger:finishedRunning", this.$initScrubber.bind(this));
	this.emiter = emiter;

}

Scrubber.prototype.$initScrubber = function(steps, stepno) {
	console.log(steps);
	console.log(stepno);
	this.steps = steps || [];
	var self = this;
	this.scrubberView
		.min(0)// 0
		.max(this.steps.length-1) // 1
		.step(1) // 0
		.value(stepno) // 0
		.orientation('horizontal'); // 'horizontal'
	$('#scrubber').empty().append(this.scrubberView.elt);
	this.scrubberView.onValueChanged = function (value) {
		self.emiter.emit("lineNo", self.steps[value].y, value);
	}
};

module.exports = Scrubber;