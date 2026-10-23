import { expect, test } from './support/test';
import { FAKE_PMS_PORT } from '../playwright.config';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';

/** Plex tokens must never reach a browser, on any page. */
const TOKENS = [
	/x-plex-token/i,
	/owner-token/,
	/owner-account-token/,
	/home-token-/,
	/home-user-token-/
];
/** The PMS address must not appear either, except where admins configure it. */
const ADDRESS = [
	new RegExp(`127\\.0\\.0\\.1:${FAKE_PMS_PORT}`),
	new RegExp(`localhost:${FAKE_PMS_PORT}`)
];
const ADDRESS_ALLOWED = ['/admin/plex'];

/** Pages not reachable by plain links (e.g. only via forms), visited explicitly. */
const EXTRA_PATHS = ['/settings/account', '/settings/security', '/admin/plex', '/admin/audit'];
const API_PATHS = ['/api/admin/plex/link'];
const MAX_PAGES = 80;

test.skip(({ browserName }) => browserName !== 'chromium', 'One engine is enough for the crawl');

test('no page, API response, header or cookie exposes a Plex token or the PMS address', async ({
	page,
	context
}) => {
	const admin = await seedUser({ role: 'admin' });
	mapToPlexOwner(admin.id);
	await signInAs(context, admin.id);

	const problems: string[] = [];
	const inspected = new Set<string>();
	type AnyResponse = {
		url(): string;
		headers(): Record<string, string>;
		body(): Promise<Buffer>;
	};
	async function inspect(response: AnyResponse) {
		const url = response.url();
		if (!url.startsWith('http://localhost:4173') || inspected.has(url)) return;
		inspected.add(url);
		const headers = JSON.stringify(response.headers());
		let body = '';
		try {
			body = (await response.body()).toString('utf8');
		} catch {
			// Redirects and aborted requests have no body.
		}
		const addressAllowed = ADDRESS_ALLOWED.includes(new URL(url).pathname);
		for (const pattern of addressAllowed ? TOKENS : [...TOKENS, ...ADDRESS]) {
			if (pattern.test(headers)) problems.push(`${url} header matches ${pattern}`);
			if (pattern.test(body)) problems.push(`${url} body matches ${pattern}`);
			if (pattern.test(url)) problems.push(`${url} URL matches ${pattern}`);
		}
	}
	page.on('response', (response) => {
		void inspect(response);
	});

	test.setTimeout(120_000);
	const queue = ['/', ...EXTRA_PATHS];
	const visited = new Set<string>();
	// A couple of pages per route shape is enough (e.g. not every /admin/users/<id>).
	const perShape = new Map<string, number>();
	const shape = (path: string) => path.split('?')[0].replace(/\/[0-9a-f-]{8,}|\/\d+/gi, '/:id');
	while (queue.length && visited.size < MAX_PAGES) {
		const path = queue.shift()!;
		if (visited.has(path)) continue;
		visited.add(path);
		await page.goto(path);
		await page.waitForLoadState('networkidle');
		const links = await page.$$eval('a[href]', (anchors) =>
			anchors.map((a) => (a as HTMLAnchorElement).href)
		);
		for (const href of links) {
			const url = new URL(href);
			if (url.origin !== 'http://localhost:4173') continue;
			if (url.pathname.startsWith('/img/') || url.pathname === '/logout') continue;
			const next = url.pathname + url.search;
			if (visited.has(next) || queue.includes(next)) continue;
			const count = perShape.get(shape(next)) ?? 0;
			if (count >= 2) continue;
			perShape.set(shape(next), count + 1);
			queue.push(next);
		}
	}
	for (const path of API_PATHS) await inspect(await page.request.get(path));

	// Streams: the start responses, the direct file, and every HLS playlist and a segment.
	for (const ratingKey of ['157', '160']) {
		const started = await page.request.post('/api/playback', {
			data: {
				ratingKey,
				caps: {
					containers: ['mp4'],
					video: ['h264'],
					audio: ['aac'],
					hdr: false,
					nativeHls: false,
					mse: true
				},
				deviceId: 'leak-check-0001'
			},
			headers: { origin: 'http://localhost:4173' }
		});
		await inspect(started);
		const { src } = await started.json();
		const first = await page.request.get(src, { headers: { Range: 'bytes=0-511' } });
		await inspect(first);
		if (src.endsWith('.m3u8')) {
			const variant = (await first.text()).split('\n').find((l) => l.startsWith('/stream/'))!;
			const variantResponse = await page.request.get(variant);
			await inspect(variantResponse);
			const segment = (await variantResponse.text())
				.split('\n')
				.find((l) => l.startsWith('/stream/'))!;
			await inspect(await page.request.get(segment));
		}
	}

	for (const cookie of await context.cookies()) {
		for (const pattern of [...TOKENS, ...ADDRESS]) {
			if (pattern.test(`${cookie.name}=${cookie.value}`)) {
				problems.push(`cookie ${cookie.name} matches ${pattern}`);
			}
		}
	}

	expect(visited.size).toBeGreaterThanOrEqual(EXTRA_PATHS.length + 1);
	expect(problems).toEqual([]);
});
