import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { fakePms } from './support/fake-pms';
import { seekVideo, waitUntilPlaying } from './support/player';

test.beforeEach(async ({ context }) => {
	test.skip(!test.info().project.name.endsWith('desktop'), 'One viewport per engine is enough');
	await fakePms('clear-patches');
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});
test.afterEach(() => fakePms('clear-patches'));

test('switching to another audio track continues from the same position and is saved', async ({
	page
}) => {
	const posts: { url: string; body: Record<string, unknown> }[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().includes('/api/playback')) {
			posts.push({ url: new URL(r.url()).pathname, body: r.postDataJSON() });
		}
	});
	await page.goto('/watch/160?from=start');
	await waitUntilPlaying(page);
	await seekVideo(page, 15);

	await page.getByRole('button', { name: 'Audio', exact: true }).click();
	const tracks = page.getByRole('menu', { name: 'Audio' }).getByRole('menuitemradio');
	await expect(tracks).toHaveCount(2);
	await expect(tracks.first()).toHaveAttribute('aria-checked', 'true');
	await tracks.nth(1).click();

	await expect.poll(() => posts.filter((p) => p.url === '/api/playback').length).toBe(2);
	expect(posts.find((p) => p.url.endsWith('/streams'))?.body).toEqual({ audioStreamId: 771 });
	expect(
		Number(posts.filter((p) => p.url === '/api/playback')[1].body.offset)
	).toBeGreaterThanOrEqual(14_000);
	await waitUntilPlaying(page);

	await page.getByRole('button', { name: 'Audio', exact: true }).click();
	await expect(
		page.getByRole('menu', { name: 'Audio' }).getByRole('menuitemradio').nth(1)
	).toHaveAttribute('aria-checked', 'true');
});
