/**
 * Caches only the app shell (built JS/CSS, icons, manifest) so the installed app starts fast.
 * Pages, API responses, artwork and media are never cached: they are per-user and authenticated.
 */
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { self } from '$app/service-worker';

const CACHE = `shell-${version}`;
// Manifest paths are relative to the base path, which is empty for this app.
const SHELL = new Set([...immutable, ...assets].map((asset) => `/${asset.path}`));

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll([...SHELL]))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
	// Everything outside the shell goes straight to the network, untouched.
	if (!SHELL.has(url.pathname)) return;
	event.respondWith(caches.match(url.pathname).then((cached) => cached ?? fetch(event.request)));
});
