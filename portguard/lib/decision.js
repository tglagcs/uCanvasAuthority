/**
 * Decides whether a web request should be blocked. Kept free of
 * badge/notification/storage side effects so the logic stays easy to reason
 * about independently of the extension plumbing.
 */
import { requestMatchesAllowlist } from "./allowlist.js";
import { isTrackerHost } from "./tracker-hosts.js";
import {
	isIpLiteral,
	isLocalRequestTarget,
	isPrivateIp,
	isUnspecified,
	looksLikeRebindingHostname,
	normalizeHost,
} from "./net-address.js";

const DNS_DEADLINE_MS = 8000;

/**
 * Small LRU cache of successful DNS answers for this session, plus
 * in-flight de-duplication so a stampede of requests to one host (common
 * on single-page apps) shares one `browser.dns.resolve` call.
 */
export function createDnsCache(limit = 200) {
	const entries = new Map();
	const inFlight = new Map();
	return {
		get(host) {
			if (!entries.has(host)) return undefined;
			const value = entries.get(host);
			entries.delete(host);
			entries.set(host, value); // touch for LRU ordering
			return value;
		},
		set(host, value) {
			entries.delete(host);
			entries.set(host, value);
			if (entries.size > limit) {
				entries.delete(entries.keys().next().value);
			}
		},
		inFlight,
	};
}

function withDeadline(promise, ms) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("dns-deadline-exceeded")), ms);
		Promise.resolve(promise).then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

/** Resolve a hostname, optionally bypassing the cache for rebinding checks. */
async function resolveHost(host, resolveDns, cache, bypassCache) {
	if (cache && !bypassCache) {
		const cached = cache.get(host);
		if (cached) return cached;
		const pending = cache.inFlight.get(host);
		if (pending) {
			try {
				return await pending;
			} catch {
				return null;
			}
		}
	}

	const promise = withDeadline(resolveDns(host), DNS_DEADLINE_MS);
	if (cache) cache.inFlight.set(host, promise);
	try {
		const result = await promise;
		if (cache && !bypassCache) cache.set(host, result);
		return result;
	} catch {
		return null; // fail open — a resolver outage must not break browsing
	} finally {
		cache?.inFlight.delete(host);
	}
}

/**
 * @param {{ thirdParty?: boolean, originUrl?: string, url: string }} details
 * @param {{ allowlist: string[], resolveDns: (host: string) => Promise<{addresses?: string[], canonicalName?: string}>, dnsCache?: ReturnType<typeof createDnsCache> }} deps
 * @returns {Promise<{ action: "allow" } | { action: "block", kind: "portscan"|"tracker", target: URL }>}
 */
export async function classifyRequest(details, deps) {
	let origin;
	let target;
	try {
		origin = new URL(details.originUrl);
	} catch {
		return { action: "allow" };
	}
	try {
		target = new URL(details.url);
	} catch {
		return { action: "allow" };
	}

	if (requestMatchesAllowlist(origin.host, target.host, deps.allowlist)) {
		return { action: "allow" };
	}

	const thirdParty = Boolean(details.thirdParty);
	const sameHost = normalizeHost(target.hostname) === normalizeHost(origin.hostname);

	// First-party same-host resources (the page's own assets) never need scrutiny.
	if (!thirdParty && sameHost) {
		return { action: "allow" };
	}

	if (thirdParty) {
		if (isLocalRequestTarget(target)) {
			return { action: "block", kind: "portscan", target };
		}
		if (isIpLiteral(target.hostname)) {
			return { action: "allow" }; // literal public IP, no DNS follow-up needed
		}
	} else if (isIpLiteral(target.hostname)) {
		return { action: "allow" }; // same-site literal IP, not a tracker-hostname path
	}

	// Known tracker hosts are blocked without a DNS side-channel, first- or third-party
	// (customer-branded hostnames like tmx.bestbuy.com CNAME into this infrastructure).
	if (isTrackerHost(target.hostname)) {
		return { action: "block", kind: "tracker", target };
	}

	const checkRebinding = thirdParty && looksLikeRebindingHostname(target.hostname);
	const resolved = await resolveHost(target.hostname, deps.resolveDns, deps.dnsCache, checkRebinding);
	if (!resolved) {
		return { action: "allow" };
	}

	if (checkRebinding) {
		for (const address of resolved.addresses ?? []) {
			if (isUnspecified(address)) continue;
			if (isPrivateIp(address)) {
				return { action: "block", kind: "portscan", target };
			}
		}
	}

	if (isTrackerHost(resolved.canonicalName ?? "")) {
		return { action: "block", kind: "tracker", target };
	}

	return { action: "allow" };
}
