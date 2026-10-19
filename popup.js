(function(){
	"use strict";

	// Popup size bounds. WebExtension popups can't usefully grow past ~800x600
	// anyway (the browser clamps them), and a panel should never shrink below
	// something still usable.
	const MIN_WIDTH = 260;
	const MAX_WIDTH = 800;
	const MIN_HEIGHT = 120;
	const MAX_HEIGHT = 600;

	const app = document.getElementById("app");
	const tabPanels = document.getElementById("tabPanels");
	const observers = new WeakMap();

	// The box only ever grows to fit whichever tab needs the most room, and
	// never shrinks: switching tabs must not resize the popup, that makes it
	// unpleasant to click through them.
	//
	// Width is set on #app (the shared ancestor of #tabStrip and #tabPanels),
	// not on #tabPanels alone — #tabStrip is #tabPanels' sibling, not its
	// descendant, so sizing #tabPanels alone never gave #tabStrip a definite
	// containing-block width to stretch to, and it shrank to fit just its
	// own three buttons instead of spanning the popup.
	let currentWidth = app.getBoundingClientRect().width;
	let currentHeight = tabPanels.getBoundingClientRect().height;

	function growToFit(panel){
		let doc;
		try {
			doc = panel.contentDocument;
		}
		catch (error){
			return;
		}
		if (!doc || !doc.documentElement){
			return;
		}
		const root = doc.documentElement;
		const width = Math.min(Math.max(root.scrollWidth, MIN_WIDTH), MAX_WIDTH);
		const height = Math.min(Math.max(root.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
		if (width <= currentWidth && height <= currentHeight){
			return;
		}
		currentWidth = Math.max(currentWidth, width);
		currentHeight = Math.max(currentHeight, height);
		app.style.width = currentWidth + "px";
		tabPanels.style.height = currentHeight + "px";
	}

	// Every panel stays laid out (see popup.css: visibility, not display), so
	// it can be measured and can keep resizing itself (uMatrix's matrix grows
	// as rows expand, dropdown menus open, etc.) whether or not it's the
	// active tab right now.
	function watch(panel){
		if (observers.has(panel)){
			return;
		}
		let doc;
		try {
			doc = panel.contentDocument;
		}
		catch (error){
			return;
		}
		if (!doc || !doc.documentElement || !window.ResizeObserver){
			return;
		}
		const observer = new ResizeObserver(function(){
			growToFit(panel);
		});
		observer.observe(doc.documentElement);
		observers.set(panel, observer);
	}

	document.querySelectorAll(".tabPanel").forEach(function(panel){
		panel.addEventListener("load", function(){
			watch(panel);
			growToFit(panel);
		});
	});

	function selectTab(tab){
		document.body.dataset.tab = tab;
		document.querySelectorAll(".tabButton").forEach(function(b){
			b.classList.toggle("selected", b.dataset.tab === tab);
		});
		document.querySelectorAll(".tabPanel").forEach(function(panel){
			panel.classList.toggle("selected", panel.id === "panel-" + tab);
		});
	}

	document.querySelectorAll(".tabButton").forEach(function(button){
		button.addEventListener("click", function(){
			selectTab(button.dataset.tab);
		});
	});

	selectTab(document.querySelector(".tabButton.selected").dataset.tab);
}());
