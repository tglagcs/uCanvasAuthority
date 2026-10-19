/**
 * Per-tab blocking activity for the current browser session.
 *
 * The background page is persistent for the life of the browser session
 * (see manifest.json), so this plain in-memory map lives exactly as long
 * as the data is useful — there is no event-page restart to survive, so
 * unlike settings there is nothing here worth persisting to disk.
 */

/** @type {Map<number, { ports: Map<string, Set<string>>, hosts: Set<string>, count: number, notified: boolean, url: string }>} */
const tabs = new Map();

function recordFor(tabId) {
	let record = tabs.get(tabId);
	if (!record) {
		record = { ports: new Map(), hosts: new Set(), count: 0, notified: false, url: "" };
		tabs.set(tabId, record);
	}
	return record;
}

export function recordPortScan(tabId, host, port) {
	const record = recordFor(tabId);
	const ports = record.ports.get(host) ?? new Set();
	ports.add(port);
	record.ports.set(host, ports);
}

export function recordTrackerHost(tabId, host) {
	recordFor(tabId).hosts.add(host);
}

/** Increment the block counter; `firstHit` is true only on the first block since the last navigation. */
export function bumpCount(tabId) {
	const record = recordFor(tabId);
	record.count += 1;
	const firstHit = !record.notified;
	record.notified = true;
	return { count: record.count, firstHit };
}

export function snapshotForTab(tabId) {
	const record = tabs.get(tabId);
	if (!record) return { blockedPorts: {}, blockedHosts: [] };
	return {
		blockedPorts: Object.fromEntries(
			[...record.ports].map(([host, ports]) => [host, [...ports]])
		),
		blockedHosts: [...record.hosts],
	};
}

export function resetForNavigation(tabId, url) {
	tabs.set(tabId, { ports: new Map(), hosts: new Set(), count: 0, notified: false, url });
}

export function clearTab(tabId) {
	tabs.delete(tabId);
}

export function lastUrlForTab(tabId) {
	return tabs.get(tabId)?.url;
}
