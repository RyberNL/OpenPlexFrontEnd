import fs from 'node:fs';
import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { fakePms, patchMetadata } from './support/fake-pms';
import { waitUntilPlaying } from './support/player';

test.afterEach(async () => {
	await fakePms('heal-transcode');
	await fakePms('online');
	await fakePms('clear-patches');
});
test.beforeEach(async ({ context }) => {
	test.skip(!test.info().project.name.endsWith('desktop'), 'One viewport per engine is enough');
	await fakePms('clear-patches');
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});

test('a file the server reports unavailable is explained instead of a blank player', async ({
	page
}) => {
	const movie = JSON.parse(fs.readFileSync('test/fixtures/plex/movie-detail.json', 'utf8'))
		.MediaContainer.Metadata[0];
	const media = movie.Media.map((m: { Part: object[] }) => ({
		...m,
		Part: m.Part.map((p) => ({ ...p, accessible: false, exists: false }))
	}));
	await patchMetadata('160', { Media: media });
	await page.goto('/watch/160?from=start');
	await expect(page.getByTestId('player-error')).toHaveText(
		'This file is currently unavailable on the server.'
	);
	await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('a transcoder failure shows an error, and retry recovers', async ({ page }) => {
	await fakePms('fail-transcode');
	await page.goto('/watch/160?from=start');
	await expect(page.getByTestId('player-error')).toHaveText(/could not be played|interrupted/);
	await fakePms('heal-transcode');
	await page.getByRole('button', { name: 'Retry' }).click();
	await waitUntilPlaying(page);
	await expect(page.getByTestId('player-error')).toHaveCount(0);
});

test('an interrupted stream offers retry and continues', async ({ page }) => {
	await page.goto('/watch/160?from=start');
	await waitUntilPlaying(page);
	await fakePms('offline');
	// Jump far ahead of the buffer so new segments are needed.
	await page.getByTestId('video').evaluate((v: HTMLVideoElement) => {
		v.currentTime = 300;
	});
	await expect(page.getByTestId('player-error')).toBeVisible({ timeout: 20_000 });
	await fakePms('online');
	await page.getByRole('button', { name: 'Retry' }).click();
	await waitUntilPlaying(page);
});
