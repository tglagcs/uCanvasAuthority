/**
 * Classifies hostnames and IP literals as local/private vs. public, for
 * both IPv4 and IPv6. Parsing goes through the URL API wherever possible
 * instead of pattern-matching raw strings.
 */

const NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:", "ftp:", "ftps:"]);

/** Strip IPv6 brackets and a trailing FQDN dot, lowercase the rest. */
export function normalizeHost(value) {
	let host = String(value ?? "");
	if (host.startsWith("[") && host.endsWith("]")) {
		host = host.slice(1, -1);
	}
	return host.replace(/\.+$/, "").toLowerCase();
}

/** @returns {number[]|null} four octets, or null if not a dotted IPv4 literal */
export function toIPv4Bytes(host) {
	const parts = host.split(".");
	if (parts.length !== 4) return null;
	const bytes = [];
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return null;
		const n = Number(part);
		if (n > 255) return null;
		bytes.push(n);
	}
	return bytes;
}

/** RFC1918 + loopback + link-local + CGNAT (RFC6598) + benchmarking (RFC2544) + 0.0.0.0/8. */
function ipv4IsPrivate([a, b]) {
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 198 && (b === 18 || b === 19)) return true;
	return false;
}

/**
 * Expand a (possibly compressed) IPv6 literal into eight 16-bit groups.
 * Accepts a zone id suffix and a trailing dotted-quad (`::ffff:127.0.0.1`).
 * @returns {number[]|null}
 */
export function toIPv6Groups(host) {
	const addr = host.toLowerCase().split("%")[0];
	if ((addr.match(/::/g) || []).length > 1) return null;

	const v4Tail = addr.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
	let working = addr;
	if (v4Tail) {
		const bytes = toIPv4Bytes(v4Tail[2]);
		if (!bytes) return null;
		const hi = ((bytes[0] << 8) | bytes[1]).toString(16);
		const lo = ((bytes[2] << 8) | bytes[3]).toString(16);
		working = `${v4Tail[1]}${hi}:${lo}`;
	}

	const [headStr, tailStr] = working.includes("::")
		? working.split("::")
		: [working, undefined];
	const head = headStr ? headStr.split(":") : [];
	const tail = tailStr ? tailStr.split(":") : [];
	if (head.some((g) => g === "") || tail.some((g) => g === "")) return null;

	const fillCount = 8 - head.length - tail.length;
	if (fillCount < 0) return null;
	if (tailStr === undefined && fillCount !== 0) return null;

	const groups = [...head, ...Array(fillCount).fill("0"), ...tail].map((g) =>
		parseInt(g || "0", 16)
	);
	if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) {
		return null;
	}
	return groups;
}

function groupsToIPv4(groups) {
	const hi = groups[6];
	const lo = groups[7];
	return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join(".");
}

function isV4Mapped(groups) {
	return groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
}

function isV4Compatible(groups) {
	return groups.slice(0, 6).every((g) => g === 0);
}

function ipv6IsPrivate(groups) {
	if (groups.every((g) => g === 0)) return true; // ::
	if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1
	if (isV4Mapped(groups) || isV4Compatible(groups)) {
		return ipv4IsPrivate(toIPv4Bytes(groupsToIPv4(groups)));
	}
	// fe80::/10 link-local, fc00::/7 unique local
	return (groups[0] & 0xffc0) === 0xfe80 || (groups[0] & 0xfe00) === 0xfc00;
}

/** True when `host` is an IPv4 or IPv6 literal (not a domain name). */
export function isIpLiteral(host) {
	const h = normalizeHost(host);
	return h.includes(":") ? toIPv6Groups(h) !== null : toIPv4Bytes(h) !== null;
}

/** If `host` is an IPv4-mapped/compatible IPv6 literal, unwrap to dotted IPv4. */
export function unwrapMappedIPv4(host) {
	const h = normalizeHost(host);
	const groups = toIPv6Groups(h);
	if (!groups) return h;
	if (groups.every((g) => g === 0)) return h; // :: stays itself
	if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return h; // ::1 stays itself
	if (isV4Mapped(groups) || isV4Compatible(groups)) return groupsToIPv4(groups);
	return h;
}

export function isPrivateIp(host) {
	const h = normalizeHost(host);
	if (!h) return false;
	if (h.includes(":")) {
		const groups = toIPv6Groups(h);
		return groups ? ipv6IsPrivate(groups) : false;
	}
	const bytes = toIPv4Bytes(h);
	return bytes ? ipv4IsPrivate(bytes) : false;
}

/** 0.0.0.0 / :: — common DNS-sinkhole answers, not useful scan targets. */
export function isUnspecified(host) {
	const h = normalizeHost(host);
	if (h.includes(":")) {
		const groups = toIPv6Groups(h);
		if (!groups) return false;
		if (isV4Mapped(groups)) return groups[6] === 0 && groups[7] === 0;
		return groups.every((g) => g === 0);
	}
	const bytes = toIPv4Bytes(h);
	return bytes ? bytes.every((b) => b === 0) : false;
}

/** Returns true when `url` targets a local/private address over a supported scheme. */
export function isLocalRequestTarget(url) {
	if (!NETWORK_SCHEMES.has(url.protocol)) return false;
	const host = normalizeHost(url.hostname);
	if (host === "localhost") return true;
	return isPrivateIp(host);
}

/**
 * Hostnames that embed an IP, or use a known local-resolution helper domain,
 * are the practical DNS-rebinding vectors for port scans (e.g.
 * `127.0.0.1.nip.io`). Ordinary domains must not get private-IP DNS
 * blocking — ad/tracker blocklists sinkhole hosts to 0.0.0.0/127.0.0.1 and
 * would otherwise look like port scans.
 */
export function looksLikeRebindingHostname(host) {
	const h = normalizeHost(host);
	if (h.includes(":")) return false;
	if (/(?:^|\.)(?:\d{1,3}\.){3}\d{1,3}(?:\.|$)/.test(h)) return true;
	if (/(?:^|\.)(?:0x[0-9a-f]+|\d{8,10})(?:\.|$)/i.test(h)) return true;
	if (/(?:^|\.)(?:nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me|vcap\.me|lacolhost\.com)$/i.test(h)) {
		return true;
	}
	return false;
}
