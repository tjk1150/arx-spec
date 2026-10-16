/** Base URL used for manifests read from a local directory or `.arx` package. */
export const LOCAL_MANIFEST_URL = "arx-package://root/manifest.json";
export const LOCAL_ORIGIN = "arx-package://root/";

export const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
export const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
