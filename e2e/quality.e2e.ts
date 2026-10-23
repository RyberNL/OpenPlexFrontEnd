import fs from 'node:fs';
import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { fakePms, patchMetadata } from './support/fake-pms';
import { currentTime, seekVideo, waitUntilPlaying } from './support/player';

test.beforeEach(async ({ context }) => {
	test.skip(!test.info().project.name.endsWith('desktop'), 'One viewport per engine is enough');
	await fakePms('clear-patches');
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});
test.afterEach(() => fakePms('clear-patches'));

test('switching quality continues from the same position on a transcoded stream', async ({
	page
}) => {
	const starts: { quality: string; offset?: number }[] = [];
	const deletes: string[] = [];
	page.on('request', (r) => {
		const url = new URL(r.url());
		if (url.pathname === '/api/playback' && r.method() === 'POST') starts.push(r.postDataJSON());
		if (url.pathname.startsWith('/api/playback/') && r.method() === 'DELETE')
			deletes.push(url.pathname);
	});
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await seekVideo(page, 12);

	await page.getByRole('button', { name: 'Quality' }).click();
	await page.getByRole('menuitemradio', { name: '720p · 2 Mbps' }).click();
	await expect.poll(() => starts.length).toBe(2);
	expect(starts[1].quality).toBe('720p-2');
	expect(starts[1].offset).toBeGreaterThanOrEqual(11_000);
	await expect.poll(() => deletes.length).toBe(1);
	await waitUntilPlaying(page);
	await expect(page.getByTestId('quality')).toHaveText('720p');
	// The new stream continues at the old position. Like PMS's, its playlist covers the whole
	// movie, so the video's own time is the movie time too.
	await expect(page.getByTestId('elapsed')).toHaveText(/^0:1\d$/);
	expect(await currentTime(page)).toBeGreaterThanOrEqual(11);
});

test('the default quality from settings is used for new playback', async ({ page }) => {
	await page.goto('/settings/playback');
	await page.getByLabel('Default quality').selectOption({ label: '480p · 1.5 Mbps' });
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('status')).toHaveText('Settings saved.');

	const started = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/playback');
	await page.goto('/watch/157?from=start');
	expect((await started).postDataJSON().quality).toBe('480p-1.5');
	await waitUntilPlaying(page);
	await expect(page.getByTestId('quality')).toHaveText('480p');
});

test('the version picked on the details page is the one played', async ({ page }) => {
	const movie = JSON.parse(fs.readFileSync('test/fixtures/plex/movie-detail.json', 'utf8'))
		.MediaContainer.Metadata[0];
	const hd = {
		...movie.Media[0],
		id: 9001,
		videoResolution: '1080',
		Part: [{ ...movie.Media[0].Part[0], id: 9002 }]
	};
	await patchMetadata('160', { Media: [movie.Media[0], hd] });
	await page.goto('/item/160');
	await page.getByRole('group', { name: 'Version' }).getByRole('radio', { name: /1080p/ }).check();
	const started = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/playback');
	await page.getByRole('link', { name: 'Play', exact: true }).click();
	expect((await started).postDataJSON().version).toBe(9001);
	await waitUntilPlaying(page);
});
