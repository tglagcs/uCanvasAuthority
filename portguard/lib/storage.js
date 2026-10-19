/**
 * Thin JSON-over-storage helpers for Port Guard settings.
 *
 * The background page is persistent (manifest.json sets no
 * `"persistent": false`), so there is exactly one JS context touching this
 * data for the life of the session — a promise chain is all the mutual
 * exclusion a read-modify-write needs here, no cross-context lock required.
 */
import { pgStorage } from "../../shared/storage-namespace.mjs";

let writeChain = Promise.resolve();

function withWriteLock(task) {
	const result = writeChain.then(task, task);
	writeChain = result.then(
		() => undefined,
		() => undefined
	);
	return result;
}

export async function readValue(key, fallback) {
	const stored = await pgStorage.get(key);
	if (!(key in stored)) return fallback;
	try {
		return JSON.parse(stored[key]);
	} catch {
		return fallback;
	}
}

export function writeValue(key, value) {
	return withWriteLock(async () => {
		await pgStorage.set({ [key]: JSON.stringify(value) });
		return value;
	});
}

/** Read-modify-write a single key under the write lock. */
export function updateValue(key, fallback, updater) {
	return withWriteLock(async () => {
		const current = await readValue(key, fallback);
		const next = await updater(current);
		await pgStorage.set({ [key]: JSON.stringify(next) });
		return next;
	});
}

/** Parse a JSON-stringified `storage.onChanged` value; undefined stays undefined. */
export function parseChangedEntry(raw) {
	if (raw === undefined) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}
