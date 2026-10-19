const DEFAULT_PORT_BY_SCHEME = {
	"ftp:": 20,
	"ftps:": 21,
	"sftp:": 22,
	"ssh:": 22,
	"tftp:": 69,
	"http:": 80,
	"ws:": 80,
	"https:": 443,
	"wss:": 443,
};

export function getPortForScheme(scheme) {
	return DEFAULT_PORT_BY_SCHEME[String(scheme ?? "").toLowerCase()];
}
