import fs from 'node:fs';
import { expect, test, type Page } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser, setPrefs } from './support/db';
import { fakePms, patchMetadata } from './support/fake-pms';
import { seekVideo, waitUntilPlaying } from './support/player';

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

/** The direct-playable 30-second MP4 of movie 157, so items can be played to their end quickly. */
function clipMedia() {
	const listing = JSON.parse(
		fs.readFileSync('test/fixtures/plex/section-movies-page-200.json', 'utf8')
	);
	return listing.MediaContainer.Metadata.find((m: { ratingKey: string }) => m.ratingKey === '157')
		.Media;
}

/** Plays the current item to its end. */
async function playToEnd(page: Page) {
	await waitUntilPlaying(page);
	await seekVideo(page, 28.5);
}

const upNext = (page: Page) => page.getByRole('dialog', { name: 'Up next' });

test('the next episode starts by itself after a 10-second countdown', async ({ page }) => {
	await patchMetadata('12500', { Media: clipMedia() });
	await page.goto('/watch/12500?from=start');
	await playToEnd(page);
	await expect(upNext(page)).toContainText('S1 · E3 · Part Three: Time to Fly');
	await expect(upNext(page).getByRole('button', { name: /Play next in \d+/ })).toBeVisible();
	await expect(page).toHaveURL(/\/watch\/12501\?from=start$/, { timeout: 15_000 });
});

test('cancelling the countdown keeps the episode, with Play next still offered', async ({
	page
}) => {
	await patchMetadata('12500', { Media: clipMedia() });
	await page.goto('/watch/12500?from=start');
	await playToEnd(page);
	await upNext(page).getByRole('button', { name: 'Cancel' }).click();
	await expect(upNext(page).getByRole('button', { name: 'Play next', exact: true })).toBeVisible();
	await page.waitForTimeout(11_000);
	await expect(page).toHaveURL(/\/watch\/12500\?from=start$/);
});

test('with autoplay off the next episode waits for the user', async ({ page }) => {
	setPrefs(userId, { autoplayNext: false });
	await patchMetadata('12500', { Media: clipMedia() });
	await page.goto('/watch/12500?from=start');
	await playToEnd(page);
	const play = upNext(page).getByRole('button', { name: 'Play next', exact: true });
	await expect(play).toBeVisible();
	await expect(upNext(page).getByRole('button', { name: 'Cancel' })).toHaveCount(0);
	await play.click();
	await expect(page).toHaveURL(/\/watch\/12501\?from=start$/);
});

test('a shuffled playlist plays each of its items exactly once', async ({ page }) => {
	await page.goto('/playlist/890001');
	const links = page.getByRole('list', { name: 'Items' }).getByRole('link');
	await expect(links).toHaveCount(3);
	const ids = (await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).map((href) =>
		href!.split('/').pop()!
	);
	for (const id of ids) await patchMetadata(id, { Media: clipMedia() });

	await page.getByRole('button', { name: 'Shuffle' }).click();
	const played: string[] = [];
	for (let i = 0; i < ids.length; i++) {
		await expect(page).toHaveURL(/\/watch\/\d+\?.*queue=playlist%3A890001&shuffle=\d+/);
		played.push(new URL(page.url()).pathname.split('/').pop()!);
		await playToEnd(page);
		if (i < ids.length - 1) {
			await upNext(page)
				.getByRole('button', { name: /Play next/ })
				.click();
			await expect(page).not.toHaveURL(new RegExp(`/watch/${played.at(-1)}\\?`));
		}
	}
	// The queue is done: nothing is offered after the last item.
	await page.waitForTimeout(1_000);
	await expect(upNext(page)).toHaveCount(0);
	expect([...played].sort()).toEqual([...ids].sort());
});
