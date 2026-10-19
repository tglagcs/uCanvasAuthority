const params = new URLSearchParams(location.search);
const origin = params.get("origin") ?? "unknown";
const destination = params.get("destination") ?? "unknown";
const originalUrl = params.get("originalUrl") ?? "";
const promptId = params.get("promptId") ?? "";

function protocolOf(url) {
	try {
		return new URL(url).protocol.replace(":", "");
	} catch {
		return "unknown";
	}
}

document.getElementById("detail-origin").textContent = origin;
document.getElementById("detail-destination").textContent = destination;
document.getElementById("detail-protocol").textContent = protocolOf(originalUrl);

async function sendDecision(type) {
	try {
		await browser.runtime.sendMessage({ type, promptId });
	} finally {
		window.close();
	}
}

document.getElementById("btn-block").addEventListener("click", () => {
	sendDecision("portguard:dismissPrompt");
});
document.getElementById("btn-allow-once").addEventListener("click", () => {
	sendDecision("portguard:allowOnce");
});
document.getElementById("btn-always-allow").addEventListener("click", () => {
	sendDecision("portguard:alwaysAllow");
});
