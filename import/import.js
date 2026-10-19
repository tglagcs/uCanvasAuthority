(function(){
	"use strict";

	const settings = require("./settings");

	function downloadJSON(filename, data){
		vAPI.download({
			url: "data:text/plain," + encodeURIComponent(JSON.stringify(data, null, "\t")),
			filename
		});
	}

	document.getElementById("exportCanvasBlockerButton").addEventListener("click", function(){
		settings.onloaded(function(){
			const data = {};
			settings.forEach(function(def){
				data[def.name] = def.get();
			});
			downloadJSON("CanvasBlocker-settings.json", data);
		});
	});

	document.getElementById("exportUmatrixButton").addEventListener("click", function(){
		vAPI.messaging.send("dashboard", {
			what: "getAllUserData"
		}).then(function(userData){
			downloadJSON("uMatrix-backup.json", userData);
		});
	});

	const filePicker = document.getElementById("filePicker");
	const fileListEl = document.getElementById("fileList");
	const applyButton = document.getElementById("applyButton");
	const restartWarning = document.getElementById("restartWarning");
	const logEl = document.getElementById("log");

	// Each entry: {file, text, kind, parsed}. kind is one of:
	// "canvasblocker-json", "umatrix-backup-json", "umatrix-rules-txt", "unknown".
	let entries = [];

	function detect(text){
		let json;
		try {
			json = JSON.parse(text);
		}
		catch (error){
			json = undefined;
		}

		if (json !== undefined && json !== null && typeof json === "object"){
			if (looksLikeCanvasBlockerExport(json)){
				return {kind: "canvasblocker-json", parsed: json};
			}
			if (
				Array.isArray(json.rules) &&
				typeof json.settings === "object" &&
				typeof json.rawSettings === "object"
			){
				return {kind: "umatrix-backup-json", parsed: json};
			}
			return {kind: "unknown", parsed: json};
		}

		// Not JSON: treat as uMatrix's plain-text "my rules" syntax if at least
		// one non-empty, non-comment line matches "name: selector state".
		const looksLikeRules = text.split(/\r?\n/).some(function(line){
			const trimmed = line.trim();
			if (trimmed === "" || trimmed.startsWith("#")){
				return false;
			}
			return /^[a-z][a-z0-9-]*:\s+\S+\s+\S+$/.test(trimmed) ||
				/^[*a-z0-9.-]+\s+[*a-z0-9-]+\s+(allow|block|noop)$/.test(trimmed);
		});
		if (looksLikeRules){
			return {kind: "umatrix-rules-txt", parsed: text};
		}

		return {kind: "unknown", parsed: undefined};
	}

	function describeKind(kind){
		switch (kind){
			case "canvasblocker-json": return "CanvasBlocker settings export";
			case "umatrix-backup-json": return "uMatrix full backup";
			case "umatrix-rules-txt": return "uMatrix “my rules” (text)";
			default: return "unrecognized format — will be skipped";
		}
	}

	function renderList(){
		fileListEl.innerHTML = "";
		entries.forEach(function(entry, index){
			const li = document.createElement("li");
			li.textContent = entry.file.name + " — " + describeKind(entry.kind);
			if (entry.kind !== "unknown"){
				const label = document.createElement("label");
				const checkbox = document.createElement("input");
				checkbox.type = "checkbox";
				checkbox.checked = true;
				checkbox.dataset.index = String(index);
				label.appendChild(checkbox);
				label.appendChild(document.createTextNode(" apply"));
				li.appendChild(document.createTextNode(" "));
				li.appendChild(label);
			}
			fileListEl.appendChild(li);
		});
		const anyApplicable = entries.some(function(entry){ return entry.kind !== "unknown"; });
		applyButton.disabled = !anyApplicable;
		const anyUmatrixBackup = entries.some(function(entry){ return entry.kind === "umatrix-backup-json"; });
		restartWarning.classList.toggle("hidden", !anyUmatrixBackup);
	}

	function logLine(text){
		const line = document.createElement("div");
		line.textContent = text;
		logEl.appendChild(line);
	}

	filePicker.addEventListener("change", function(){
		const files = Array.from(filePicker.files || []);
		entries = [];
		fileListEl.innerHTML = "";
		logEl.innerHTML = "";
		let remaining = files.length;
		if (remaining === 0){
			renderList();
			return;
		}
		files.forEach(function(file){
			const reader = new FileReader();
			reader.onload = function(){
				entries.push(Object.assign(detect(String(reader.result)), {file}));
				remaining -= 1;
				if (remaining === 0){
					renderList();
				}
			};
			reader.onerror = function(){
				entries.push({file, kind: "unknown", parsed: undefined});
				remaining -= 1;
				if (remaining === 0){
					renderList();
				}
			};
			reader.readAsText(file);
		});
	});

	function isChecked(index){
		const checkbox = fileListEl.querySelector('input[data-index="' + index + '"]');
		return !checkbox || checkbox.checked;
	}

	async function applyUmatrixRules(text){
		await vAPI.messaging.send("dashboard", {
			what: "modifyRuleset",
			permanent: true,
			toAdd: text,
			toRemove: ""
		});
	}

	async function applyUmatrixBackup(userData){
		// Ends in vAPI.app.restart() inside uMatrix's own handler: reloads the whole
		// extension. Must run last, after every other import in this batch.
		await vAPI.messaging.send("dashboard", {
			what: "restoreAllUserData",
			userData
		});
	}

	applyButton.addEventListener("click", async function(){
		applyButton.disabled = true;
		logEl.innerHTML = "";

		const selected = entries
			.map(function(entry, index){ return {entry, index}; })
			.filter(function(item){ return item.entry.kind !== "unknown" && isChecked(item.index); });

		const cbEntries = selected.filter(function(item){ return item.entry.kind === "canvasblocker-json"; });
		const rulesEntries = selected.filter(function(item){ return item.entry.kind === "umatrix-rules-txt"; });
		const backupEntries = selected.filter(function(item){ return item.entry.kind === "umatrix-backup-json"; });

		for (const item of cbEntries){
			const result = applyCanvasBlockerImport(item.entry.parsed);
			logLine(item.entry.file.name + ": applied " + result.applied + " setting(s)" +
				(result.warnings.length ? "; " + result.warnings.length + " warning(s)" : ""));
			result.warnings.forEach(logLine);
		}

		for (const item of rulesEntries){
			await applyUmatrixRules(item.entry.parsed);
			logLine(item.entry.file.name + ": uMatrix rules applied.");
		}

		if (backupEntries.length > 0){
			logLine(backupEntries[0].entry.file.name + ": applying uMatrix full backup — the extension will now reload…");
			await applyUmatrixBackup(backupEntries[0].entry.parsed);
			return;
		}

		applyButton.disabled = false;
	});

	settings.onloaded(function(){
		applyButton.textContent = "Apply selected imports";
	});
}());
