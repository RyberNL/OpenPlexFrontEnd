import fs from 'node:fs';
import { expect, test, type Page } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { fakePms, patchMetadata } from './support/fake-pms';
import { currentTime, waitUntilPlaying } from './support/player';

test.beforeEach(async ({ context }) => {
	test.skip(!test.info().project.name.endsWith('desktop'), 'One viewport per engine is enough');
	await fakePms('clear-patches');
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});
test.afterEach(() => fakePms('clear-patches'));

/** Movie 157 (a direct-playable 30-second clip) with three chapters and, optionally, previews. */
async function withChapters({ previews }: { previews: boolean }) {
	const listing = JSON.parse(
		fs.readFileSync('test/fixtures/plex/section-movies-page-200.json', 'utf8')
	);
	const movie = listing.MediaContainer.Metadata.find(
		(m: { ratingKey: string }) => m.ratingKey === '157'
	);
	const media = movie.Media.map((m: { Part: object[] }) => ({
		...m,
		Part: m.Part.map((p) => ({ ...p, ...(previews ? { indexes: 'sd' } : {}) }))
	}));
	await patchMetadata('157', {
		Media: media,
		Chapter: [
			{ index: 1, tag: 'Opening', startTimeOffset: 0, endTimeOffset: 10_000 },
			{ index: 2, tag: 'The chase', startTimeOffset: 10_000, endTimeOffset: 20_000 },
			{ index: 3, tag: 'Finale', startTimeOffset: 20_000, endTimeOffset: 30_000 }
		]
	});
}

/** Points at a fraction of the seek bar. */
async function hoverSeekBar(page: Page, fraction: number) {
	const bar = page.getByRole('slider', { name: 'Seek' });
	const box = (await bar.boundingBox())!;
	await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
}

test('chapters show on the seek bar and the chapter list jumps to one', async ({ page }) => {
	await withChapters({ previews: false });
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await expect(page.getByTestId('chapter-tick')).toHaveCount(2);

	await page.getByRole('button', { name: 'Chapters' }).click();
	const menu = page.getByRole('menu', { name: 'Chapters' });
	await expect(menu.getByRole('menuitemradio', { name: /Opening/ })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await menu.getByRole('menuitemradio', { name: /Finale/ }).click();
	await expect.poll(() => currentTime(page)).toBeGreaterThanOrEqual(20);
	await page.getByRole('button', { name: 'Chapters' }).click();
	await expect(
		page.getByRole('menu', { name: 'Chapters' }).getByRole('menuitemradio', { name: /Finale/ })
	).toHaveAttribute('aria-checked', 'true');
});

test('scrubbing shows a preview thumbnail of the position', async ({ page }) => {
	await withChapters({ previews: true });
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);

	await hoverSeekBar(page, 0.5);
	const preview = page.getByTestId('seek-preview');
	await expect(preview).toContainText(/0:1[45] · The chase/);
	const thumbnail = page.getByTestId('seek-thumbnail');
	await expect
		.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
		.toBe(240);
	const middle = await thumbnail.getAttribute('src');

	await hoverSeekBar(page, 0.9);
	await expect(preview).toContainText('Finale');
	const late = await thumbnail.getAttribute('src');
	expect(late).not.toBe(middle);
	// Each position gets its own frame of the clip.
	const [a, b] = await Promise.all(
		[middle!, late!].map((src) => page.request.get(src).then((r) => r.body()))
	);
	expect(a.equals(b)).toBe(false);

	await page.mouse.move(10, 10);
	await expect(preview).toHaveCount(0);
});

test('without preview thumbnails the seek bar still shows time and chapter', async ({ page }) => {
	await withChapters({ previews: false });
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await hoverSeekBar(page, 0.1);
	await expect(page.getByTestId('seek-preview')).toContainText('Opening');
	await expect(page.getByTestId('seek-thumbnail')).toHaveCount(0);
});
