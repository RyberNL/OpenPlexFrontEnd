import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { fakePmsRequests } from './support/fake-pms';
import { imageUrl } from './support/images';

test('artwork is served from the app origin via PMS, with caching headers', async ({ page }) => {
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(page.context(), user.id);
	const url = imageUrl('/library/metadata/160/thumb/1789964721', 'poster', 360)!;
	const response = await page.request.get(url);
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toMatch(/^image\//);
	expect(response.headers()['cache-control']).toBe('private, max-age=86400, immutable');

	const relayed = (await fakePmsRequests()).filter((r) => r.path === '/photo/:/transcode').at(-1)!;
	expect(relayed.query).toMatchObject({
		url: '/library/metadata/160/thumb/1789964721',
		width: '360',
		height: '540'
	});
	expect(relayed.token).toBe('owner-token');
});

test('a tampered image URL returns 404 without contacting PMS', async ({ page }) => {
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(page.context(), user.id);
	const before = (await fakePmsRequests()).length;
	const url = imageUrl('/library/metadata/160/thumb/1789964721', 'poster', 360)!;
	const forged = url.replace(
		/\/img\/[\w-]+\./,
		`/img/${Buffer.from('poster|/:/prefs').toString('base64url')}.`
	);
	expect((await page.request.get(forged)).status()).toBe(404);
	expect((await fakePmsRequests()).length).toBe(before);
});

test('image requests without a session get 401', async ({ playwright }) => {
	const anonymous = await playwright.request.newContext({ baseURL: 'http://localhost:4173' });
	const url = imageUrl('/library/metadata/160/thumb/1789964721', 'poster', 360)!;
	expect((await anonymous.get(url)).status()).toBe(401);
	await anonymous.dispose();
});
