import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';

test.beforeEach(async ({ context }) => {
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});

test('a collection lists its movies with posters, watch state and play actions', async ({
	page
}) => {
	await page.goto('/library/1');
	await page.getByRole('link', { name: 'Collections' }).click();
	await expect(page).toHaveURL('/library/1/collections');
	await page
		.getByRole('list', { name: 'Collections' })
		.getByRole('link', { name: /Fast & Furious/ })
		.click();
	await expect(page).toHaveURL('/collection/880001');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fast & Furious');

	const items = page.getByRole('list', { name: 'Items' }).getByRole('listitem');
	await expect(items).toHaveCount(4);
	await expect(items.first().getByRole('link')).toHaveAttribute('href', /^\/item\/\d+$/);
	const first = await items.first().getByRole('link').getAttribute('href');
	const firstId = first!.split('/').pop();
	await expect(page.getByRole('link', { name: 'Play', exact: true })).toHaveAttribute(
		'href',
		`/watch/${firstId}?from=start&queue=collection%3A880001`
	);
	// Shuffle starts the collection in a random order, from the order's first item.
	await page.getByRole('button', { name: 'Shuffle' }).click();
	await expect(page).toHaveURL(/\/watch\/\d+\?from=start&queue=collection%3A880001&shuffle=\d+$/);
});

test('only video playlists are listed, and a playlist keeps its order', async ({ page }) => {
	await page.goto('/playlists');
	const playlists = page.getByRole('list', { name: 'Playlists' });
	await expect(playlists.getByRole('link')).toHaveCount(1);
	await expect(playlists).toContainText('Movie Night');
	await expect(playlists).not.toContainText('Road Trip Songs');

	await playlists.getByRole('link', { name: /Movie Night/ }).click();
	await expect(page).toHaveURL('/playlist/890001');
	const items = page.getByRole('list', { name: 'Items' }).getByRole('listitem');
	await expect(items).toHaveCount(3);
	await expect(items.nth(0)).toContainText('47 Ronin');
	await expect(items.nth(1)).toContainText('6 Underground');
	await expect(items.nth(2)).toContainText('21 Bridges');
	await expect(page.getByRole('link', { name: 'Play', exact: true })).toHaveAttribute(
		'href',
		/queue=playlist%3A890001$/
	);
});

test('an audio playlist cannot be opened as a video playlist', async ({ page }) => {
	const response = await page.goto('/playlist/890002');
	expect(response?.status()).toBe(404);
});

test('an actor page lists the movies in the library featuring them', async ({ page }) => {
	await page.goto('/item/160');
	await page
		.getByRole('list', { name: 'Cast' })
		.getByRole('link', { name: /Paul Walker/ })
		.click();
	await expect(page).toHaveURL(/\/person\/2416\?name=Paul%20Walker$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Paul Walker');
	const movies = page.getByRole('list', { name: 'Movies' });
	await expect(movies).toContainText('2 Fast 2 Furious');
	await expect(movies).toContainText('Fast & Furious 6');
	await expect(movies.getByRole('listitem')).toHaveCount(6);
});
