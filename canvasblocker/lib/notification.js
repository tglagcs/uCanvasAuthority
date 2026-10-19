/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./notification", {});
	}
	
	const extension = require("./extension");
	const settings = require("./settings");
	const lists = require("./lists");
	const logging = require("./logging");
	
	function isWhitelisted(url){
		if (!(url instanceof URL)){
			url = new URL(url);
		}
		return lists.get("white").match(url) ||
			lists.get("sessionWhite").match(url) ||
			settings.get("blockMode", url).startsWith("allow");
	}
	
	const paths = {
		pageAction: {
			none: "icons/pageAction-printed.svg",
			color: "icons/pageAction-printedHighlight.svg",
			blink: "icons/pageAction-printedBlink.svg"
		}
	};

	const tabsData = new Map();
	function getTabData(tabId){
		let data = tabsData.get(tabId);
		if (!data){
			data = {
				url: "",
				apis: new Set(),
				whitelisted: false
			};
			tabsData.set(tabId, data);
		}
		return data;
	}
	scope.show = function showNotification(tabId, url, api){
		if (settings.ignoredAPIs[api]){
			return;
		}
		logging.notice("Show notification for tab", tabId);
		const tabData = getTabData(tabId);
		if (
			settings.get("showNotifications", url) &&
			!lists.get("ignore").match(url)
		){
			browser.pageAction.show(tabId);
			if (browser.pageAction.setIcon){
				browser.pageAction.setIcon({
					tabId: tabId,
					path: paths.pageAction[settings.highlightPageAction]
				});
			}
		}
		// The merged extension's browser-action icon is drawn by
		// shared/badge-composer.js, which also leaves room for uMatrix's own
		// badge in the other corner — browser.browserAction.setIcon()/
		// setBadgeText() only support one badge total, and uMatrix was
		// calling the same API, so one of the two always silently lost.
		const apis = tabData.apis;
		apis.add(api);

		let apiList = "";
		apis.forEach(function(api){
			apiList += extension.getTranslation("browserAction_title_protectedAPIs").replace(/{api}/g, api);
		});

		// "Name (count)" matches uMatrix's "uMatrix (count)" tooltip format,
		// so the two look like one consistent style rather than two bolted
		// together.
		let browserActionTitle = extension.getTranslation("browserAction_title_default") +
			" (" + apis.size + ")";
		if (tabData.whitelisted){
			browserActionTitle += extension.getTranslation("browserAction_title_whitelisted")
				.replace(/{url}/g, tabData.url);
		}
		browserActionTitle += extension.getTranslation("browserAction_title_notified");
		browserActionTitle += apiList;

		if (typeof self.updateCanvasBadge === "function"){
			self.updateCanvasBadge(
				tabId,
				settings.get("displayBadge", url)?
					apis.size.toString():
					"",
				"#c00000",
				browserActionTitle
			);
		}
	};
	
	scope.hide = function hideNotification(tabId, url){
		logging.notice("Hide page action for tab", tabId);
		// clear old data
		tabsData.delete(tabId);
		const tabData = getTabData(tabId);
		tabData.url = url;
		tabData.whitelisted = isWhitelisted(url);
		
		browser.pageAction.hide(tabId);
		if (browser.pageAction.setIcon){
			browser.pageAction.setIcon({
				tabId: tabId,
				path: paths.pageAction.none
			});
		}
		let browserActionTitle = extension.getTranslation("browserAction_title_default") + " (0)";
		if (tabData.whitelisted){
			browserActionTitle += extension.getTranslation("browserAction_title_whitelisted").replace(/{url}/g, url);
		}
		if (typeof self.updateCanvasBadge === "function"){
			self.updateCanvasBadge(tabId, "", "#c00000", browserActionTitle);
		}
	};
	
	settings.on("showNotifications", async function({newValue}){
		if (!newValue){
			logging.message("notifications were disabled -> hide all page actions");
			const tabs = await browser.tabs.query({});
			tabs.forEach(function(tab){
				browser.pageAction.hide(tab.id);
			});
		}
	});
	
	browser.tabs.onRemoved.addListener(function(tabId){
		tabsData.delete(tabId);
	});
	settings.on("displayBadge", async function({newValue}){
		if (!newValue){
			logging.message("badge was disabled -> hide all badges");
			if (browser.browserAction.setBadgeText){
				const tabs = await browser.tabs.query({});
				tabs.forEach(function(tab){
					browser.browserAction.setBadgeText({
						tabId: tab.id,
						text: ""
					});
				});
			}
		}
	});
}());