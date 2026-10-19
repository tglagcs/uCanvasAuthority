/* ES-module storage namespacing shim used by Port Guard (the only
 * subsystem loaded as a module). Same prefixing behavior as
 * storage-namespace.js — see that file for the rationale. */

function createNamespacedStorage(prefix){
	const area = browser.storage.local;
	const listeners = new Set();

	function addPrefix(key){
		return prefix + key;
	}

	function stripPrefix(key){
		return key.slice(prefix.length);
	}

	function prefixKeys(keysArg){
		if (keysArg === undefined || keysArg === null){
			return undefined;
		}
		if (typeof keysArg === "string"){
			return addPrefix(keysArg);
		}
		if (Array.isArray(keysArg)){
			return keysArg.map(addPrefix);
		}
		if (typeof keysArg === "object"){
			const out = {};
			Object.keys(keysArg).forEach(function(key){
				out[addPrefix(key)] = keysArg[key];
			});
			return out;
		}
		return keysArg;
	}

	function unprefixResult(result){
		const out = {};
		Object.keys(result).forEach(function(key){
			if (key.indexOf(prefix) === 0){
				out[stripPrefix(key)] = result[key];
			}
		});
		return out;
	}

	browser.storage.onChanged.addListener(function(changes, areaName){
		if (areaName !== "local"){
			return;
		}
		const filtered = {};
		let any = false;
		Object.keys(changes).forEach(function(key){
			if (key.indexOf(prefix) === 0){
				filtered[stripPrefix(key)] = changes[key];
				any = true;
			}
		});
		if (!any){
			return;
		}
		listeners.forEach(function(fn){
			fn(filtered, areaName);
		});
	});

	return {
		get: async function(keys){
			const result = await area.get(prefixKeys(keys));
			return unprefixResult(result);
		},
		set: async function(items){
			return area.set(prefixKeys(items));
		},
		remove: async function(keys){
			return area.remove(prefixKeys(keys));
		},
		clear: async function(){
			const all = await area.get();
			const ownKeys = Object.keys(all).filter(function(key){
				return key.indexOf(prefix) === 0;
			});
			if (ownKeys.length){
				await area.remove(ownKeys);
			}
		},
		onChanged: {
			addListener: function(fn){ listeners.add(fn); },
			removeListener: function(fn){ listeners.delete(fn); },
			hasListener: function(fn){ return listeners.has(fn); }
		}
	};
}

export const pgStorage = createNamespacedStorage("pg:");
