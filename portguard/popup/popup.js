/** Port Guard popup tab: status icon doubles as the blocking toggle, plus this tab's blocked-activity lists. */
import { readValue } from "../lib/storage.js";

document.getElementById("settings-button").addEventListener("click", () => {
	// The merged extension's options page is uMatrix's dashboard shell;
	// open it with the Ports tab preselected.
	browser.tabs.create({ url: browser.runtime.getURL("umatrix/dashboard.html#port-guard") });
});

const statusIcon = document.getElementById("status-icon");
let blockingEnabled = true;

function setBlockingIndicator(enabled) {
	blockingEnabled = enabled;
	document.body.dataset.blocking = enabled ? "on" : "off";
	statusIcon.setAttribute("aria-pressed", String(enabled));
	statusIcon.title = enabled ? "Blocking on — click to pause" : "Blocking off — click to resume";
}

const blockingReady = readValue("blockingEnabled", true).then(setBlockingIndicator);

statusIcon.addEventListener("click", () => {
	setBlockingIndicator(!blockingEnabled);
	browser.runtime.sendMessage({ type: "portguard:setEnabled", value: blockingEnabled });
});

function portsListItem(host, ports) {
	const li = document.createElement("li");
	li.className = "blocked-host-item";

	const hostSpan = document.createElement("span");
	hostSpan.className = "host";
	hostSpan.textContent = host;
	li.appendChild(hostSpan);

	const sorted = [...ports].sort((a, b) => Number(a) - Number(b));
	const portsSpan = document.createElement("span");
	portsSpan.className = "ports";
	portsSpan.textContent = sorted.length === 1 ? `port ${sorted[0]}` : `ports ${sorted.join(", ")}`;
	li.appendChild(portsSpan);

	return li;
}

function hostsListItem(host) {
	const li = document.createElement("li");
	li.className = "blocked-host-item";
	li.textContent = host;
	return li;
}

async function activeTabId() {
	const [tab] = await browser.tabs.query({ currentWindow: true, active: true });
	return tab?.id;
}

async function loadActivity() {
	const tabId = await activeTabId();
	if (tabId === undefined) return;

	const activity = await browser.runtime
		.sendMessage({ type: "portguard:activity", tabId })
		.catch(() => ({ blockedPorts: {}, blockedHosts: [] }));

	const portsSection = document.getElementById("blocked-ports");
	const portsList = document.getElementById("blocked-ports-list");
	portsList.replaceChildren();
	const portHosts = Object.keys(activity.blockedPorts ?? {});
	if (portHosts.length > 0) {
		for (const host of portHosts) {
			portsList.appendChild(portsListItem(host, activity.blockedPorts[host]));
		}
		portsSection.removeAttribute("hidden");
	} else {
		portsSection.setAttribute("hidden", "");
	}

	const hostsSection = document.getElementById("blocked-hosts");
	const hostsList = document.getElementById("blocked-hosts-list");
	hostsList.replaceChildren();
	const blockedHosts = activity.blockedHosts ?? [];
	if (blockedHosts.length > 0) {
		for (const host of blockedHosts) {
			hostsList.appendChild(hostsListItem(host));
		}
		hostsSection.removeAttribute("hidden");
	} else {
		hostsSection.setAttribute("hidden", "");
	}
}

Promise.allSettled([blockingReady, loadActivity()]).then(() => {
	document.body.getBoundingClientRect(); // force layout before un-hiding transitions
	document.body.classList.remove("loading");
});
