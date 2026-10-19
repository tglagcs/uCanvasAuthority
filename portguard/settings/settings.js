import { readValue, writeValue, updateValue } from "../lib/storage.js";
import { normalizeEntry } from "../lib/allowlist.js";
import { ALWAYS_ALLOW_KEY } from "../lib/selective-allow.js";

function removableEntry(label, onRemove) {
	const li = document.createElement("li");

	const span = document.createElement("span");
	span.className = "entry-label";
	span.textContent = label;
	li.appendChild(span);

	const button = document.createElement("button");
	button.type = "button";
	button.className = "remove-button";
	button.setAttribute("aria-label", `Remove ${label}`);
	button.textContent = "✕";
	button.addEventListener("click", onRemove);
	li.appendChild(button);

	return li;
}

// --- Allowlist -------------------------------------------------------------

const allowlistList = document.getElementById("allowlist-items");

async function renderAllowlist(entries) {
	entries ??= await readValue("allowlist", []);
	allowlistList.replaceChildren();

	if (entries.length === 0) {
		allowlistList.setAttribute("hidden", "");
		return;
	}
	for (const entry of entries) {
		allowlistList.appendChild(
			removableEntry(entry, () => {
				updateValue("allowlist", [], (list) => list.filter((e) => e !== entry)).then(renderAllowlist);
			})
		);
	}
	allowlistList.removeAttribute("hidden");
}

document.getElementById("allowlist-form").addEventListener("submit", (event) => {
	event.preventDefault();
	const input = document.getElementById("allowlist-input");

	let entry;
	try {
		entry = normalizeEntry(input.value);
	} catch (error) {
		console.warn("Port Guard: couldn't parse an allowlist entry", { value: input.value, error });
		alert("Please enter a valid domain, IP address, or CIDR range.");
		return;
	}

	input.value = "";
	updateValue("allowlist", [], (list) => {
		if (list.includes(entry)) {
			alert("This entry is already in the list.");
			return list;
		}
		return [...list, entry];
	}).then(renderAllowlist);
});

renderAllowlist();

// --- Notifications -----------------------------------------------------------

const notificationsSwitch = document.getElementById("notifications-switch");
readValue("notificationsEnabled", true).then((enabled) => {
	notificationsSwitch.checked = enabled;
	notificationsSwitch.addEventListener("change", (event) => {
		writeValue("notificationsEnabled", event.target.checked);
	});
});

// --- Always-Allow list -------------------------------------------------------

const alwaysAllowList = document.getElementById("always-allow-items");

async function renderAlwaysAllow(entries) {
	entries ??= await readValue(ALWAYS_ALLOW_KEY, []);
	alwaysAllowList.replaceChildren();

	if (entries.length === 0) {
		alwaysAllowList.setAttribute("hidden", "");
		return;
	}
	for (const entry of entries) {
		const label = `${entry.origin} → ${entry.destination}`;
		alwaysAllowList.appendChild(
			removableEntry(label, () => {
				updateValue(ALWAYS_ALLOW_KEY, [], (list) =>
					list.filter((e) => !(e.origin === entry.origin && e.destination === entry.destination))
				).then(renderAlwaysAllow);
			})
		);
	}
	alwaysAllowList.removeAttribute("hidden");
}

renderAlwaysAllow();
