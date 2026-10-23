import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { imageUrl } from './support/images';

test('the manifest and icons are available without signing in', async ({ request }) => {
	const response = await request.get('/manifest.webmanifest');
	expect(response.status()).toBe(200);
	const manifest = await response.json();
	expect(manifest).toMatchObject({
		display: 'standalone',
		start_url: '/',
		name: 'OpenPlexFrontEnd'
	});
	for (const icon of manifest.icons) {
		const iconResponse = await request.get(icon.src);
		expect(iconResponse.status(), icon.src).toBe(200);
	}
	expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
});

test.describe('installed app', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'Uses Chromium DevTools APIs');

	test('is installable', async ({ page, context }) => {
		await page.goto('/login');
		const cdp = await context.newCDPSession(page);
		const { url } = await cdp.send('Page.getAppManifest');
		expect(url).toContain('/manifest.webmanifest');
		const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
		expect(installabilityErrors).toEqual([]);
	});

	test('the service worker caches only the app shell, never media or API responses', async ({
		page,
		context
	}) => {
		const user = await seedUser();
		mapToPlexOwner(user.id);
		await signInAs(context, user.id);
		await page.goto('/');
		await page.evaluate(async () => {
			await navigator.serviceWorker.ready;
		});
		// Reload so the page is controlled by the now-active worker.
		await page.reload();
		expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

		const image = imageUrl('/library/metadata/160/thumb/1789964721', 'poster', 360)!;
		const responses = await Promise.all([
			page.waitForResponse((r) => r.url().includes('/img/')),
			page.evaluate((src) => fetch(src).then((r) => r.status), image)
		]);
		expect(responses[0].fromServiceWorker()).toBe(false);

		const cached = await page.evaluate(async () => {
			const urls: string[] = [];
			for (const key of await caches.keys()) {
				const cache = await caches.open(key);
				for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
			}
			return urls;
		});
		expect(cached.length).toBeGreaterThan(0);
		for (const path of cached) {
			expect(path, `unexpected cache entry ${path}`).toMatch(
				/^\/(_app\/immutable\/|icons\/|manifest\.webmanifest$|robots\.txt$)/
			);
		}
	});
});
