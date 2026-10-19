// Packaging config for `npx web-ext build` / `npx web-ext lint`.
// Dotfiles (.eslintrc.json, .gitignore, icons/.suggestions/, …) are already
// excluded by web-ext's defaults; this drops the rest of what isn't needed
// at runtime from the XPI.
export default {
	ignoreFiles: [
		"web-ext-config.mjs",
		"web-ext-artifacts",
		"CLAUDE.md",
		// CanvasBlocker dev tooling.
		"canvasblocker/package.json",
		"canvasblocker/package-lock.json",
		"canvasblocker/crowdin.yml",
		// Firefox only reads the root _locales/ (already merged from both).
		"canvasblocker/_locales",
		"umatrix/_locales",
		// uMatrix's own background page; the root background.html replaces it.
		"umatrix/background.html",
	],
	build: {
		overwriteDest: true,
	},
};
