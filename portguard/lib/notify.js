/** Toolbar badge, system notifications, and the Selective Allow prompt window. */

export function setBadgeCount(tabId, count) {
	// The toolbar icon is shared with uMatrix and CanvasBlocker and drawn by
	// shared/badge-composer.js (loaded as a classic script before this
	// module, so its global is in place); a native setBadgeText() here would
	// be wiped by the composer's next redraw.
	if (typeof globalThis.updatePortBadge !== "function") return;
	globalThis.updatePortBadge(
		tabId,
		count ? String(count) : "",
		count ? `Port Guard (${count})` : ""
	);
}

async function raiseNotification(id, title, message) {
	return browser.notifications.create(id, {
		type: "basic",
		iconUrl: browser.runtime.getURL("portguard/icons/icon_96.png"),
		title,
		message,
	});
}

export function notifyPortScanBlocked(host) {
	return raiseNotification(
		"portguard-portscan",
		"Local network scan blocked",
		host
			? `${host} tried to probe addresses on your local network.`
			: "A page tried to probe addresses on your local network."
	);
}

export function notifyTrackerBlocked(host) {
	return raiseNotification(
		"portguard-tracker",
		"Fingerprinting script blocked",
		host
			? `A hidden device-fingerprinting endpoint on ${host} was blocked.`
			: "A hidden device-fingerprinting endpoint was blocked."
	);
}

export function notifyPromptOpened(origin, destination) {
	return raiseNotification(
		"portguard-prompt",
		"Local navigation blocked",
		`${origin || "A page"} tried to open ${destination}. Choose Block, Allow Once, or Always Allow in the prompt.`
	);
}

/**
 * Open the Selective Allow decision page, preferring a small popup window
 * and falling back to a tab if the window can't be created.
 * @returns {Promise<{ kind: "window"|"tab", id: number } | undefined>}
 */
export async function openPromptWindow(origin, destination, originalUrl, promptId) {
	const query = new URLSearchParams({ origin, destination, originalUrl, promptId });
	const url = browser.runtime.getURL(`portguard/prompt/prompt.html?${query}`);

	try {
		const win = await browser.windows.create({
			url,
			type: "popup",
			width: 480,
			height: 300,
			focused: true,
		});
		if (Number.isInteger(win?.id) && win.id >= 0) {
			return { kind: "window", id: win.id };
		}
	} catch (error) {
		console.warn("Port Guard: prompt popup window failed, falling back to a tab", error);
	}

	try {
		const tab = await browser.tabs.create({ url, active: true });
		if (Number.isInteger(tab?.id) && tab.id >= 0) {
			return { kind: "tab", id: tab.id };
		}
	} catch (error) {
		console.error("Port Guard: prompt fallback tab failed", error);
	}
	return undefined;
}

export async function activeTabId() {
	const [tab] = await browser.tabs.query({ currentWindow: true, active: true });
	return tab?.id;
}
