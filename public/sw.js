// Minimal service worker so browsers offer "Install CDEMS". It does not cache anything:
// every request goes to the network, so users always see live data.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
