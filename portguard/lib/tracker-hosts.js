/**
 * Known LexisNexis / ThreatMetrix device-fingerprinting infrastructure.
 * This is a factual list of operator-controlled hostnames, not creative
 * expression — extend it as new endpoints are identified.
 */
export const TRACKER_SUFFIXES = Object.freeze([
	"online-metrix.net",
	"threatmetrix.com",
	"lexisnexisrisk.com",
	"lnrsoftware.com",
]);

/** True when `hostname` is one of {@link TRACKER_SUFFIXES} or a subdomain of one. */
export function isTrackerHost(hostname) {
	const host = String(hostname ?? "")
		.replace(/\.+$/, "")
		.toLowerCase();
	if (!host) return false;
	return TRACKER_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
