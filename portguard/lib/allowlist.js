/**
 * Domain / IP / CIDR allowlist used by the settings UI and the request
 * filter. Parsing goes through the URL API; CIDR is handled as a special
 * case since the URL standard treats `/24` as a path, not a prefix length.
 */
import {
	isIpLiteral,
	normalizeHost,
	toIPv4Bytes,
	toIPv6Groups,
	unwrapMappedIPv4,
} from "./net-address.js";

/**
 * Parse a user-supplied value into a URL. Bare hosts/CIDRs get an
 * `http://` scheme; bare IPv6 literals are bracketed so `URL()` accepts them.
 */
function parseEntryInput(input) {
	const trimmed = input.trim();
	const hasScheme = trimmed.includes("://");

	try {
		const direct = new URL(trimmed);
		if (direct.host) return direct;
		if (hasScheme) throw new TypeError("missing host");
	} catch (error) {
		if (hasScheme) throw error instanceof TypeError ? error : new TypeError("invalid url");
	}

	const slash = trimmed.indexOf("/");
	const hostPort = slash === -1 ? trimmed : trimmed.slice(0, slash);
	const rest = slash === -1 ? "" : trimmed.slice(slash);
	const colonCount = hostPort.split(":").length - 1;
	const bracketed = hostPort.startsWith("[") || colonCount < 2 ? hostPort : `[${hostPort}]`;
	return new URL(`http://${bracketed}${rest}`);
}

/** @param {string} url e.g. `https://example.com/path`, `discord.com`, `example.com:8080` */
export function extractHost(url) {
	return parseEntryInput(url).host;
}

/** True when `entry` is a well-formed IPv4 or IPv6 CIDR range. */
export function isCidrEntry(entry) {
	const slashIndex = entry.lastIndexOf("/");
	if (slashIndex <= 0 || slashIndex === entry.length - 1) return false;

	const prefix = Number(entry.slice(slashIndex + 1));
	if (!Number.isInteger(prefix)) return false;

	const network = normalizeHost(entry.slice(0, slashIndex));
	if (toIPv4Bytes(network)) return prefix >= 0 && prefix <= 32;
	if (network.includes(":")) return prefix >= 0 && prefix <= 128 && toIPv6Groups(network) !== null;
	return false;
}

/** True when an entry is a bare IP (no port) or a CIDR range. */
export function isBareIpEntry(entry) {
	if (isCidrEntry(entry)) return true;
	try {
		const url = new URL(`http://${entry}/`);
		return url.port === "" && isIpLiteral(url.hostname);
	} catch {
		return false;
	}
}

/**
 * Normalize and validate a user-supplied allowlist entry.
 * @throws {Error} When empty or invalid.
 */
export function normalizeEntry(input) {
	const value = String(input ?? "").trim();
	if (!value) throw new Error("empty allowlist entry");

	const url = parseEntryInput(value);
	const host = normalizeHost(url.hostname);

	if (isIpLiteral(host)) {
		const segments = url.pathname.split("/").filter((s) => s.length > 0);
		if (segments.length === 1 && /^\d+$/.test(segments[0])) {
			const candidate = `${host}/${segments[0]}`;
			if (isCidrEntry(candidate)) return candidate;
			throw new Error("invalid CIDR prefix");
		}
	}
	return url.host;
}

/** Canonical form for IP compares: unwrap IPv4-mapped IPv6, map localhost → 127.0.0.1. */
function canonicalIp(host) {
	const unwrapped = unwrapMappedIPv4(host);
	return unwrapped === "localhost" ? "127.0.0.1" : unwrapped;
}

function ipv4ToInt(bytes) {
	return ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
}

function ipv6ToBigInt(groups) {
	return groups.reduce((acc, g) => (acc << 16n) + BigInt(g), 0n);
}

/** True when `ip` falls within `cidr`, e.g. `192.168.1.0/24` or `fe80::/10`. */
export function ipMatchesCidr(ip, cidr) {
	const target = canonicalIp(ip);
	const slashIndex = cidr.lastIndexOf("/");
	if (slashIndex <= 0) return false;

	const network = normalizeHost(cidr.slice(0, slashIndex));
	const prefix = Number(cidr.slice(slashIndex + 1));
	if (!Number.isInteger(prefix)) return false;

	const targetV4 = toIPv4Bytes(target);
	const networkV4 = toIPv4Bytes(network);
	if (targetV4 && networkV4) {
		if (prefix < 0 || prefix > 32) return false;
		const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
		return (ipv4ToInt(targetV4) & mask) === (ipv4ToInt(networkV4) & mask);
	}

	const targetV6 = toIPv6Groups(target);
	const networkV6 = toIPv6Groups(network);
	if (targetV6 && networkV6) {
		if (prefix < 0 || prefix > 128) return false;
		const mask = prefix === 0 ? 0n : ((1n << 128n) - 1n) << BigInt(128 - prefix);
		return (ipv6ToBigInt(targetV6) & mask) === (ipv6ToBigInt(networkV6) & mask);
	}
	return false;
}

/**
 * Whether a host (origin or request target) matches one allowlist entry.
 * Domains require an exact match (subdomains aren't implied). Portless IP
 * entries also match the same address on any port; CIDR entries match any
 * address in range. `localhost` is treated as `127.0.0.1`.
 */
export function hostMatchesEntry(host, entry) {
	if (host === entry) return true;

	if (isCidrEntry(entry)) {
		let hostname;
		try {
			hostname = new URL(`http://${host}/`).hostname;
		} catch {
			return false;
		}
		return ipMatchesCidr(hostname, entry);
	}

	let hostUrl;
	let entryUrl;
	try {
		hostUrl = new URL(`http://${host}/`);
		entryUrl = new URL(`http://${entry}/`);
	} catch {
		return false;
	}

	if (entryUrl.port === "" && isIpLiteral(entryUrl.hostname)) {
		return canonicalIp(hostUrl.hostname) === canonicalIp(entryUrl.hostname);
	}
	return false;
}

/** True when any entry matches `originHost` (domain entries) or `requestHost` (IP/CIDR entries). */
export function requestMatchesAllowlist(originHost, requestHost, list) {
	return list.some((entry) => {
		if (hostMatchesEntry(originHost, entry)) return true;
		if (!requestHost || !isBareIpEntry(entry)) return false;
		return hostMatchesEntry(requestHost, entry);
	});
}
