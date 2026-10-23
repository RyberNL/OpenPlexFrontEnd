import fs from 'node:fs';
import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { fakePms, patchMetadata } from './support/fake-pms';

const movie = JSON.parse(fs.readFileSync('test/fixtures/plex/movie-detail.json', 'utf8'))
	.MediaContainer.Metadata[0];

// Other tests may have left positions or watch state behind on the fake server.
test.beforeEach(() => fakePms('clear-patches'));
test.beforeEach(async ({ context }) => {
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});
test.afterEach(() => fakePms('clear-patches'));

test('a movie page shows its details, badges, ratings and cast', async ({ page }) => {
	await page.goto('/item/160');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('2 Fast 2 Furious');
	await expect(page.getByText('2003')).toBeVisible();
	await expect(page.getByText('PG-13')).toBeVisible();
	await expect(page.getByText('1 h 48 min')).toBeVisible();
	await expect(page.getByRole('list', { name: 'Media details' })).toHaveText(
		/4K\s*HDR10\s*AC3 5\.1/
	);
	await expect(page.getByText('IMDb 6.0')).toBeVisible();
	await expect(page.getByText('John Singleton')).toBeVisible();
	const cast = page.getByRole('list', { name: 'Cast' });
	await expect(cast.getByRole('link', { name: /Paul Walker/ })).toHaveAttribute(
		'href',
		'/person/2416?name=Paul%20Walker'
	);
	await expect(page.getByRole('link', { name: 'Play', exact: true })).toHaveAttribute(
		'href',
		'/watch/160?from=start'
	);
});

test('a partly watched movie offers resume and play from beginning', async ({ page }) => {
	await patchMetadata('160', { viewOffset: 42 * 60_000, viewCount: 0 });
	await page.goto('/item/160');
	await expect(page.getByRole('link', { name: 'Resume from 42:00' })).toHaveAttribute(
		'href',
		'/watch/160?from=resume'
	);
	await expect(page.getByRole('link', { name: 'Play from beginning' })).toHaveAttribute(
		'href',
		'/watch/160?from=start'
	);
});

test('multiple versions are listed with badges and the chosen one is played', async ({ page }) => {
	const original = movie.Media[0];
	const hd = {
		...original,
		id: 9001,
		videoResolution: '1080',
		width: 1920,
		height: 800,
		container: 'mp4',
		Part: [
			{
				...original.Part[0],
				id: 9002,
				Stream: original.Part[0].Stream.map((s: Record<string, unknown>) =>
					s.streamType === 1
						? {
								...s,
								colorTrc: 'bt709',
								displayTitle: '1080p',
								extendedDisplayTitle: '1080p (H.264)'
							}
						: s
				)
			}
		]
	};
	await patchMetadata('160', { Media: [original, hd] });
	await page.goto('/item/160');

	const versions = page.getByRole('group', { name: 'Version' });
	await expect(versions.getByRole('radio')).toHaveCount(2);
	await expect(page.getByRole('list', { name: 'Media details' })).toContainText('4K');
	await versions.getByRole('radio', { name: /1080p/ }).check();
	await expect(page.getByRole('list', { name: 'Media details' })).toHaveText(/1080p\s*AC3 5\.1/);
	await expect(page.getByRole('link', { name: 'Play', exact: true })).toHaveAttribute(
		'href',
		'/watch/160?from=start&version=9001'
	);
});

test('extras such as trailers are listed and open in the player', async ({ page }) => {
	await patchMetadata('160', {
		Extras: {
			size: 1,
			Metadata: [
				{
					ratingKey: '77701',
					key: '/library/metadata/77701',
					type: 'clip',
					subtype: 'trailer',
					extraType: 1,
					title: 'Official Trailer',
					duration: 150000
				}
			]
		}
	});
	await page.goto('/item/160');
	const extras = page.getByRole('list', { name: 'Extras' });
	await expect(extras).toContainText('Official Trailer');
	await expect(extras).toContainText('Trailer');
	await extras.getByRole('link', { name: /Official Trailer/ }).click();
	await expect(page).toHaveURL('/watch/77701?from=start');
});

test('an episode page links back to its show', async ({ page }) => {
	await page.goto('/item/12500');
	const episode = JSON.parse(fs.readFileSync('test/fixtures/plex/episode-detail.json', 'utf8'))
		.MediaContainer.Metadata[0];
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(episode.title);
	await expect(
		page.getByText(`Season ${episode.parentIndex} · Episode ${episode.index}`)
	).toBeVisible();
	await expect(
		page.getByRole('link', { name: episode.grandparentTitle, exact: true })
	).toHaveAttribute('href', `/item/${episode.grandparentRatingKey}`);
});

test('an unknown item shows a not-found page', async ({ page }) => {
	const response = await page.goto('/item/999999');
	expect(response?.status()).toBe(404);
});
