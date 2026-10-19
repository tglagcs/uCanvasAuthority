/* Classic-script storage namespacing shim shared by CanvasBlocker and uMatrix.
 *
 * All three merged subsystems used to assume they owned the entire flat
 * browser.storage.local key space. This file gives each one a drop-in
 * replacement for browser.storage.local / browser.storage.onChanged that
 * transparently prefixes/strips its own keys, so none of the three can ever
 * collide with or clear another's data.
 *
 * Exposes globals: cbStorage (CanvasBlocker), umStorage (uMatrix).
 * Port Guard is an ES module and uses storage-namespace.mjs instead. */
(function(global){
	"use strict";

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

	global.createNamespacedStorage = createNamespacedStorage;
	global.cbStorage = createNamespacedStorage("cb:");
	global.umStorage = createNamespacedStorage("um:");
}(typeof window !== "undefined" ? window : self));
