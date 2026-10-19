/**
 * Decision state for top-level navigations to a local address ("Selective
 * Allow"): Block / Allow Once (session-only) / Always Allow (persisted).
 * Pure state + validation — no badge/notification/storage side effects.
 */
import { isLocalRequestTarget } from "./net-address.js";

/** Storage key for persisted { origin, destination } pairs. */
export const ALWAYS_ALLOW_KEY = "alwaysAllowed";

const MAX_KEY_LENGTH = 512;

/**
 * Stable key for the page that initiated the navigation:
 * - http(s)/host-based: `URL.host`
 * - file://: the path, so one HTML file can't authorize every local file
 * - other hostless schemes (blob:, about:, …): full href minus the hash
 * Returns null when the initiator can't be keyed safely (caller should fall back to a silent block).
 */
export function keyForInitiator(originUrl) {
	if (!(originUrl instanceof URL)) return null;
	if (originUrl.protocol === "file:") return `file://${originUrl.pathname}`;
	if (originUrl.host) return originUrl.host;
	if (originUrl.protocol === "data:") return null; // content-addressed, can be huge
	const bare = originUrl.href.split("#")[0];
	return bare && bare.length <= MAX_KEY_LENGTH ? bare : null;
}

function pairKey(origin, destination) {
	return `${origin}\u0000${destination}`;
}

export function hasAlwaysAllowEntry(list, origin, destination) {
	return (list ?? []).some((entry) => entry?.origin === origin && entry?.destination === destination);
}

/**
 * In-memory session-allow set plus in-flight prompt tracking for one
 * background page. One map keyed by prompt id; close handlers scan it
 * (the number of concurrent prompts stays tiny).
 */
export function createPromptRegistry() {
	const sessionAllowed = new Set();
	/** @type {Map<string, { id: string, origin: string, destination: string, originalUrl: string, tabId: number|undefined, windowId?: number, tabRef?: number }>} */
	const pending = new Map();

	function find(predicate) {
		for (const record of pending.values()) {
			if (predicate(record)) return record;
		}
		return undefined;
	}

	return {
		isAllowedThisSession(origin, destination) {
			return sessionAllowed.has(pairKey(origin, destination));
		},
		allowForSession(origin, destination) {
			sessionAllowed.add(pairKey(origin, destination));
		},
		/** Drop a session allow, e.g. when its persisted Always-Allow twin was removed. */
		forgetSessionAllow(origin, destination) {
			sessionAllowed.delete(pairKey(origin, destination));
		},

		/**
		 * Create (or refresh) the pending prompt for one origin/destination
		 * pair. Only open UI when `isNew` is true, so concurrent navigations
		 * to the same pair share one prompt.
		 */
		openOrReuse({ origin, destination, originalUrl, tabId }) {
			const existing = find((r) => r.origin === origin && r.destination === destination);
			if (existing) {
				existing.originalUrl = originalUrl;
				existing.tabId = tabId;
				return { record: existing, isNew: false };
			}
			const record = {
				id: crypto.randomUUID(),
				origin,
				destination,
				originalUrl,
				tabId,
			};
			pending.set(record.id, record);
			return { record, isNew: true };
		},

		get(id) {
			return typeof id === "string" ? pending.get(id) : undefined;
		},

		/** @returns {boolean} false when the opened UI reference can't be bound */
		bindUi(id, opened) {
			const record = pending.get(id);
			if (!record || !opened || !Number.isInteger(opened.id)) return false;
			if (opened.kind === "window") {
				record.windowId = opened.id;
				delete record.tabRef;
			} else if (opened.kind === "tab") {
				record.tabRef = opened.id;
				delete record.windowId;
			} else {
				return false;
			}
			return true;
		},

		discard(id) {
			pending.delete(id);
		},
		discardByWindow(windowId) {
			const record = find((r) => r.windowId === windowId);
			if (record) pending.delete(record.id);
		},
		discardByUiTab(tabId) {
			const record = find((r) => r.tabRef === tabId);
			if (record) pending.delete(record.id);
		},
	};
}

/**
 * Validate a pending prompt record before acting on its decision.
 * @returns {{ ok: true, origin: string, destination: string, originalUrl: string, tabId: number|undefined } | { ok: false }}
 */
export function validateDecision(record) {
	if (!record) return { ok: false };
	const { origin, destination, originalUrl, tabId } = record;
	if (!origin || !destination || !originalUrl) return { ok: false };

	let url;
	try {
		url = new URL(originalUrl);
	} catch {
		return { ok: false };
	}
	if (url.host !== destination || !isLocalRequestTarget(url)) {
		return { ok: false };
	}

	return {
		ok: true,
		origin,
		destination,
		originalUrl,
		tabId: Number.isInteger(tabId) && tabId >= 0 ? tabId : undefined,
	};
}
