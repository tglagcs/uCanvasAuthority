/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	const extension = require("../lib/extension");
	const logging = require("../lib/logging");
	const settings = require("../lib/settings");
	const settingContainers = require("../lib/settingContainers");
	const lists = require("../lib/lists");
	require("../lib/theme").init();
	logging.message("Opened browser action");
	
	
	browser.tabs.query({active: true, currentWindow: true}).then(async function([currentTab]){
		function isWhitelisted(url){
			if (!(url instanceof URL)){
				url = new URL(url);
			}
			return lists.get("white").match(url) ||
				settings.get("blockMode", url).startsWith("allow");
		}
		
		const currentURL = new URL(currentTab.url);
		const reloadButton = document.getElementById("reload");
		reloadButton.addEventListener("click", async function(){
			await browser.tabs.reload(currentTab.id, {bypassCache: true});
			window.close();
		});
		const addonStatus = document.getElementById("addonStatus");
		addonStatus.addEventListener("click", async function(){
			reloadButton.classList.toggle("hidden");
			if (isWhitelisted(currentURL)){
				settingContainers.resetUrlValue("blockMode", currentURL);
				if (settings.get("blockMode").startsWith("allow")){
					settings.set("blockMode", "fake", currentURL.host);
				}
				if (settings.get("blockDataURLs")){
					settingContainers.resetUrlValue("blockDataURLs", currentURL);
				}
				const entries = lists.get("white").filter(e => e.match(currentURL)).map(e => e.value);
				await Promise.all([
					lists.removeFrom("white", entries),
					lists.removeFrom("sessionWhite", entries)
				]);
			}
			else {
				settings.set("blockMode", "allowEverything", currentURL.hostname);
				if (settings.get("blockDataURLs")){
					settings.set("blockDataURLs", false, currentURL.hostname);
				}
			}
			update();
		});
		function update(){
			if (isWhitelisted(currentURL)){
				addonStatus.className = "off";
				addonStatus.title = extension.getTranslation("browserAction_status_off");
			}
			else {
				addonStatus.className = "on";
				addonStatus.title = extension.getTranslation("browserAction_status_on");
			}
		}
		return settings.onloaded(update);
	}).catch(function(){});
	
	const actionDefinitions = [
		{
			label: "settings",
			icon: extension.getURL("canvasblocker/icons/pageAction-showOptions.svg"),
			action: function(){
				// The merged extension's options_ui page is uMatrix's dashboard
				// shell; open it with the Canvas tab preselected instead of the
				// generic openOptionsPage() (which would land on uMatrix's own tab).
				browser.tabs.create({url: browser.runtime.getURL("umatrix/dashboard.html#canvas-protection")});
				window.close();
			}
		},
		{
			label: "test",
			advanced: true,
			icon: extension.getURL("canvasblocker/icons/browserAction-test.svg"),
			action: function(){
				browser.tabs.create({url: "https://canvasblocker.kkapsner.de/test"});
				window.close();
			}
		},
	];
	settings.onloaded(async function(){
		const actions = document.getElementById("actions");
		actionDefinitions.forEach(function(action){
			logging.verbose("Action", action);
			if (action.advanced && !settings.displayAdvancedSettings){
				logging.verbose("Hiding advanced action");
				return;
			}
			const actionButton = document.createElement("button");
			actionButton.className = "action";
			
			const icon = document.createElement("span");
			icon.className = "icon";
			function setIcon(url){
				icon.style.maskImage = "url(" + url + ")";
			}
			setIcon(action.icon);
			
			actionButton.appendChild(icon);
			
			const textNode = document.createTextNode("");
			function setLabel(label){
				textNode.nodeValue = extension.getTranslation("browserAction_" + label) || label;
			}
			setLabel(action.label);
		
			actionButton.appendChild(textNode);
			actionButton.addEventListener("click", function(){
				action.action.call(this, {setIcon, setLabel});
			});
			actions.appendChild(actionButton);
		});
	});
	
}());