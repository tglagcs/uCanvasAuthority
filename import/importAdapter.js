/* CanvasBlocker JSON import, lifted from canvasblocker/options/export.js's textarea
 * "input" validation handler so pasting/typing and file-import behave identically.
 * Reuses the same settings/settingsMigration modules the options page itself uses. */
(function(){
	"use strict";

	const settings = require("./settings");
	const settingsMigration = require("./settingsMigration");

	// True if obj has a storageVersion field and at least one key settings recognizes.
	window.looksLikeCanvasBlockerExport = function(obj){
		if (!obj || typeof obj !== "object" || Array.isArray(obj)){
			return false;
		}
		if (!("storageVersion" in obj)){
			return false;
		}
		return Object.keys(obj).some(function(name){
			return !!settings.getDefinition(name);
		});
	};

	// Returns {applied: number, warnings: string[]}.
	window.applyCanvasBlockerImport = function(obj){
		let newSettings = obj;
		const warnings = [];

		while (settingsMigration.transitions.hasOwnProperty(newSettings.storageVersion)){
			const oldVersion = newSettings.storageVersion;
			newSettings = settingsMigration.transitions[newSettings.storageVersion](newSettings);
			if (oldVersion === newSettings.storageVersion){
				break;
			}
		}

		const toApply = [];
		Object.entries(newSettings).forEach(function(entry){
			const [name, value] = entry;
			const def = settings.getDefinition(name);
			if (!def){
				warnings.push("Unknown setting, skipped: " + name);
				return;
			}
			if (def.get() === value){
				return;
			}
			const invalid = def.invalid(value);
			if (invalid){
				warnings.push("Invalid value for " + name + ": " + invalid);
				return;
			}
			toApply.push([name, value]);
		});

		toApply.forEach(function(entry){
			const [name, value] = entry;
			settings[name] = value;
		});

		return {applied: toApply.length, warnings};
	};
}());
