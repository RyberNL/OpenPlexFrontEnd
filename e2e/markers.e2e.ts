import fs from 'node:fs';
import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser, setPrefs } from './support/db';
import { fakePms, patchMetadata } from './support/fake-pms';
import { currentTime, seekVideo, waitUntilPlaying } from './support/player';

let userId: string;

test.beforeEach(async ({ context }) => {
	test.skip(!test.info().project.name.endsWith('desktop'), 'One viewport per engine is enough');
	await fakePms('clear-patches');
	const user = await seedUser();
	userId = user.id;
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});
test.afterEach(() => fakePms('clear-patches'));

/** The direct-playable 30-second MP4 of movie 157, to give other items a quick, seekable file. */
function clipMedia() {
	const listing = JSON.parse(
		fs.readFileSync('test/fixtures/plex/section-movies-page-200.json', 'utf8')
	);
	return listing.MediaContainer.Metadata.find((m: { ratingKey: string }) => m.ratingKey === '157')
		.Media;
}

const INTRO = { type: 'intro', startTimeOffset: 2_000, endTimeOffset: 8_000 };
const CREDITS = { type: 'credits', startTimeOffset: 20_000, endTimeOffset: 29_000, final: true };

test('Skip Intro appears inside the intro and seeks to its end', async ({ page }) => {
	await patchMetadata('157', { Marker: [INTRO] });
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await seekVideo(page, 3);
	const skip = page.getByRole('button', { name: 'Skip Intro' });
	await expect(skip).toBeVisible();
	await skip.click();
	await expect.poll(() => currentTime(page)).toBeGreaterThanOrEqual(8);
	await expect(skip).toHaveCount(0);
});

test('auto-skip passes the intro with a notice to go back', async ({ page }) => {
	setPrefs(userId, { autoSkipIntro: true });
	await patchMetadata('157', { Marker: [INTRO] });
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await seekVideo(page, 2.5);
	await expect.poll(() => currentTime(page)).toBeGreaterThanOrEqual(8);
	const notice = page.getByTestId('skip-notice');
	await expect(notice).toContainText('Intro skipped');

	await notice.getByRole('button', { name: 'Go back' }).click();
	await expect.poll(() => currentTime(page)).toBeLessThan(4);
	// Going back doesn't skip the same intro again; the button is offered instead.
	await expect(page.getByRole('button', { name: 'Skip Intro' })).toBeVisible();
	await page.waitForTimeout(1_000);
	expect(await currentTime(page)).toBeLessThan(6);
});

test('skipping the credits of an episode offers the next episode', async ({ page }) => {
	await patchMetadata('12500', { Media: clipMedia(), Marker: [CREDITS] });
	await page.goto('/watch/12500?from=start');
	await waitUntilPlaying(page);
	await seekVideo(page, 21);
	await page.getByRole('button', { name: 'Skip Credits' }).click();
	const upNext = page.getByRole('dialog', { name: 'Up next' });
	await expect(upNext).toContainText('S1 · E3 · Part Three: Time to Fly');
	await upNext.getByRole('button', { name: 'Play next' }).click();
	await expect(page).toHaveURL(/\/watch\/12501\?from=start$/);
});
