/**
 * Port Guard — background logic.
 *
 * Blocks pages from port-scanning the local network, blocks known
 * LexisNexis/ThreatMetrix fingerprinting endpoints, and gates top-level
 * navigations to local addresses behind a Block / Allow Once / Always
 * Allow prompt instead of silently failing them.
 */
import { readValue, writeValue, updateValue, parseChangedEntry } from "./lib/storage.js";
import { classifyRequest, createDnsCache } from "./lib/decision.js";
import {
	ALWAYS_ALLOW_KEY,
	createPromptRegistry,
	hasAlwaysAllowEntry,
	keyForInitiator,
	validateDecision,
} from "./lib/selective-allow.js";
import { isLocalRequestTarget } from "./lib/net-address.js";
import { getPortForScheme } from "./lib/constants.js";
import {
	bumpCount,
	clearTab,
	lastUrlForTab,
	recordPortScan,
	recordTrackerHost,
	resetForNavigation,
	snapshotForTab,
} from "./lib/activity.js";
import {
	notifyPortScanBlocked,
	notifyPromptOpened,
	notifyTrackerBlocked,
	openPromptWindow,
	setBadgeCount,
} from "./lib/notify.js";
import { pgStorage } from "../shared/storage-namespace.mjs";

const dnsCache = createDnsCache();
const prompts = createPromptRegistry();

let allowlistCache;
let notificationsEnabled = true;

async function currentAllowlist() {
	if (!allowlistCache) allowlistCache = await readValue("allowlist", []);
	return allowlistCache;
}

function portForTarget(url) {
	return url.port || String(getPortForScheme(url.protocol) ?? "");
}

function hostOfOrigin(originUrl) {
	try {
		return new URL(originUrl).host;
	} catch {
		return undefined;
	}
}

function blockPortScan(details, target) {
	const { tabId } = details;
	const { count, firstHit } = bumpCount(tabId);
	setBadgeCount(tabId, count);

	const port = portForTarget(target);
	if (port) recordPortScan(tabId, target.hostname, port);

	if (firstHit && notificationsEnabled) {
		notifyPortScanBlocked(hostOfOrigin(details.originUrl)).catch(() => {});
	}
	return { cancel: true };
}

function blockTracker(details, target) {
	const { tabId } = details;
	const { count, firstHit } = bumpCount(tabId);
	setBadgeCount(tabId, count);
	recordTrackerHost(tabId, target.hostname);

	if (firstHit && notificationsEnabled) {
		notifyTrackerBlocked(hostOfOrigin(details.originUrl)).catch(() => {});
	}
	return { cancel: true };
}

/** Top-level navigations to a local address get a prompt instead of a silent block. */
async function promptForLocalNavigation(details, target) {
	let origin;
	try {
		origin = new URL(details.originUrl);
	} catch {
		return blockPortScan(details, target);
	}

	const originKey = keyForInitiator(origin);
	const destination = target.host;
	if (!originKey || !destination) {
		return blockPortScan(details, target); // unkeyable initiator (e.g. data:)
	}

	if (prompts.isAllowedThisSession(originKey, destination)) {
		return { cancel: false };
	}

	const alwaysAllowed = await readValue(ALWAYS_ALLOW_KEY, []);
	if (hasAlwaysAllowEntry(alwaysAllowed, originKey, destination)) {
		return { cancel: false };
	}

	const tabId = Number.isInteger(details.tabId) && details.tabId >= 0 ? details.tabId : undefined;
	const { record, isNew } = prompts.openOrReuse({
		origin: originKey,
		destination,
		originalUrl: details.url,
		tabId,
	});

	if (isNew) {
		// Open the decision UI outside the blocking webRequest stack.
		queueMicrotask(async () => {
			const opened = await openPromptWindow(
				record.origin,
				record.destination,
				record.originalUrl,
				record.id
			).catch((error) => {
				console.error("Port Guard: failed to open the selective-allow prompt", error);
				return undefined;
			});

			if (!opened || !prompts.bindUi(record.id, opened)) {
				prompts.discard(record.id);
				return;
			}
			if (notificationsEnabled) {
				notifyPromptOpened(record.origin, record.destination).catch(() => {});
			}
		});
	}
	return { cancel: true };
}

async function onBeforeRequest(details) {
	const outcome = await classifyRequest(details, {
		allowlist: await currentAllowlist(),
		resolveDns: (host) => browser.dns.resolve(host, ["canonical_name"]),
		dnsCache,
	});

	if (outcome.action !== "block") return { cancel: false };

	if (outcome.kind === "portscan") {
		if (details.type === "main_frame" && isLocalRequestTarget(outcome.target)) {
			return promptForLocalNavigation(details, outcome.target);
		}
		return blockPortScan(details, outcome.target);
	}
	return blockTracker(details, outcome.target);
}

async function enableBlocking() {
	if (!browser.webRequest.onBeforeRequest.hasListener(onBeforeRequest)) {
		browser.webRequest.onBeforeRequest.addListener(
			onBeforeRequest,
			{ urls: ["<all_urls>"] },
			["blocking"]
		);
	}
	await writeValue("blockingEnabled", true);
}

async function disableBlocking() {
	if (browser.webRequest.onBeforeRequest.hasListener(onBeforeRequest)) {
		browser.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
	}
	await writeValue("blockingEnabled", false);
}

async function navigateToAllowedUrl(tabId, url) {
	if (Number.isInteger(tabId) && tabId >= 0) {
		try {
			await browser.tabs.update(tabId, { url, active: true });
			return;
		} catch (error) {
			console.warn("Port Guard: couldn't update the originating tab, opening a new one", error);
		}
	}
	await browser.tabs.create({ url });
}

const extensionOrigin = new URL(browser.runtime.getURL("")).origin;

async function onMessage(message, sender) {
	if (sender.origin !== extensionOrigin) return;

	switch (message.type) {
		case "portguard:setEnabled":
			await (message.value ? enableBlocking() : disableBlocking());
			return undefined;

		case "portguard:activity":
			return snapshotForTab(message.tabId);

		case "portguard:dismissPrompt":
			if (typeof message.promptId === "string") prompts.discard(message.promptId);
			return undefined;

		case "portguard:allowOnce":
		case "portguard:alwaysAllow": {
			const decision = validateDecision(prompts.get(message.promptId));
			prompts.discard(message.promptId);
			if (!decision.ok) {
				console.warn("Port Guard: rejected an unknown or invalid selective-allow decision", message);
				return undefined;
			}

			if (message.type === "portguard:allowOnce") {
				prompts.allowForSession(decision.origin, decision.destination);
			} else {
				await updateValue(ALWAYS_ALLOW_KEY, [], (list) =>
					hasAlwaysAllowEntry(list, decision.origin, decision.destination)
						? list
						: [...list, { origin: decision.origin, destination: decision.destination }]
				);
			}
			await navigateToAllowedUrl(decision.tabId, decision.originalUrl);
			return undefined;
		}

		default:
			console.warn("Port Guard: unknown message", message);
			return undefined;
	}
}

pgStorage.onChanged.addListener((changes) => {
	if ("allowlist" in changes) {
		allowlistCache = parseChangedEntry(changes.allowlist.newValue) ?? [];
	}
	if ("notificationsEnabled" in changes) {
		notificationsEnabled = parseChangedEntry(changes.notificationsEnabled.newValue) ?? true;
	}
	if (ALWAYS_ALLOW_KEY in changes) {
		// A removed Always-Allow pair must drop any matching session allow too.
		const before = parseChangedEntry(changes[ALWAYS_ALLOW_KEY].oldValue) ?? [];
		const after = parseChangedEntry(changes[ALWAYS_ALLOW_KEY].newValue) ?? [];
		for (const entry of before) {
			if (entry?.origin && entry?.destination && !hasAlwaysAllowEntry(after, entry.origin, entry.destination)) {
				prompts.forgetSessionAllow(entry.origin, entry.destination);
			}
		}
	}
});

browser.runtime.onMessage.addListener(onMessage);

browser.tabs.onUpdated.addListener((tabId, change, tab) => {
	if (change.url && lastUrlForTab(tabId) !== change.url) {
		resetForNavigation(tabId, tab.url);
		setBadgeCount(tabId, 0);
	}
});

browser.tabs.onRemoved.addListener((tabId) => {
	prompts.discardByUiTab(tabId);
	clearTab(tabId);
});

browser.windows.onRemoved.addListener((windowId) => prompts.discardByWindow(windowId));

async function start() {
	notificationsEnabled = await readValue("notificationsEnabled", true);
	const shouldBlock = await readValue("blockingEnabled", true);
	await (shouldBlock ? enableBlocking() : disableBlocking());
}

start();
