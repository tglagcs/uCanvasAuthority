/* The merged extension's single browser-action icon/badge/tooltip is a
 * WebExtension resource shared by all three subsystems — uMatrix
 * (blocked/allowed request count), CanvasBlocker (which fingerprinting APIs
 * were touched) and Port Guard (blocked port scans/trackers) all used to call
 * browser.browserAction.setIcon()/setBadgeText()/setTitle() directly, and
 * since there's only one icon/one badge/one tooltip per tab, whichever fired
 * last silently won.
 *
 * This draws all of them onto one icon instead: uMatrix's badge top-right,
 * CanvasBlocker's badge bottom-right, Port Guard's badge bottom-left, and the
 * tooltip messages concatenated. It owns all browser.browserAction calls for
 * every subsystem; nothing else should call setIcon/setBadgeText/setTitle
 * directly (the native badge is cleared on every redraw, so anything written
 * there is lost). */
(function(global){
	"use strict";

	const SIZES = [16, 19, 32, 38];
	const BASE_ICON_URL = "umatrix/img/icon_128.png";

	let baseImage = null;
	const baseImageReady = new Promise(function(resolve){
		const img = new Image();
		img.onload = function(){
			baseImage = img;
			resolve();
		};
		img.onerror = function(){
			resolve();
		};
		img.src = BASE_ICON_URL;
	});

	const tabState = new Map();
	function getState(tabId){
		let state = tabState.get(tabId);
		if (!state){
			state = {
				um: {text: "", color: "#666666"},
				cb: {text: "", color: "#c00000"},
				pg: {text: "", color: "#d97706"},
				umTitle: "",
				cbTitle: "",
				pgTitle: ""
			};
			tabState.set(tabId, state);
		}
		return state;
	}

	function drawBadge(ctx, size, cx, cy, text, color){
		if (!text){
			return;
		}
		const radius = size * 0.27;
		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, Math.PI * 2);
		ctx.fillStyle = color;
		ctx.fill();
		ctx.lineWidth = Math.max(1, size * 0.03);
		ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
		ctx.stroke();
		ctx.fillStyle = "#ffffff";
		// Shrink three-character counts (uMatrix's "123", "1k+") to fit the
		// circle instead of cutting them to two characters.
		const label = String(text).slice(0, 3);
		const fontScale = label.length > 2 ? 0.26 : 0.36;
		ctx.font = "bold " + Math.round(size * fontScale) + "px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(label, cx, cy + size * 0.02);
	}

	// browserAction calls return promises that reject when the tab is
	// already gone; that's expected, so don't surface it as an unhandled
	// rejection.
	function ignore(){}

	async function redraw(tabId){
		await baseImageReady;
		const state = getState(tabId);

		const imageData = {};
		SIZES.forEach(function(size){
			const canvas = document.createElement("canvas");
			canvas.width = size;
			canvas.height = size;
			const ctx = canvas.getContext("2d");
			if (baseImage){
				ctx.drawImage(baseImage, 0, 0, size, size);
			}
			drawBadge(ctx, size, size * 0.78, size * 0.25, state.um.text, state.um.color);
			drawBadge(ctx, size, size * 0.78, size * 0.77, state.cb.text, state.cb.color);
			drawBadge(ctx, size, size * 0.22, size * 0.77, state.pg.text, state.pg.color);
			imageData[size] = ctx.getImageData(0, 0, size, size);
		});

		browser.browserAction.setIcon({tabId, imageData}).catch(ignore);
		// Native badge is unused (drawn into the icon instead), but clear it
		// in case something set it before this ran.
		browser.browserAction.setBadgeText({tabId, text: ""}).catch(ignore);
		const title = [state.umTitle, state.cbTitle, state.pgTitle].filter(Boolean).join("\n\n") ||
			browser.runtime.getManifest().browser_action.default_title;
		browser.browserAction.setTitle({tabId, title}).catch(ignore);
	}

	global.updateMatrixBadge = function(tabId, text, color, title){
		const state = getState(tabId);
		state.um.text = text || "";
		if (color){
			state.um.color = color;
		}
		state.umTitle = title || "";
		redraw(tabId);
	};

	global.updateCanvasBadge = function(tabId, text, color, title){
		const state = getState(tabId);
		state.cb.text = text || "";
		if (color){
			state.cb.color = color;
		}
		state.cbTitle = title || "";
		redraw(tabId);
	};

	global.updatePortBadge = function(tabId, text, title){
		const state = getState(tabId);
		state.pg.text = text || "";
		state.pgTitle = title || "";
		redraw(tabId);
	};

	if (browser.tabs && browser.tabs.onRemoved){
		browser.tabs.onRemoved.addListener(function(tabId){
			tabState.delete(tabId);
		});
	}
}(typeof window !== "undefined" ? window : self));
