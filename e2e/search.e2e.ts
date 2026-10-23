import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';

test.beforeEach(async ({ context, page }) => {
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
	await page.goto('/search');
});

const box = (page: import('@playwright/test').Page) =>
	page.getByRole('searchbox', { name: /Search movies/ });

test('typing a title shows matching movies and collections, and opens the movie', async ({
	page
}) => {
	await box(page).fill('fast');
	const movies = page.getByRole('region', { name: 'Movies' });
	await expect(movies).toContainText('2 Fast 2 Furious');
	await expect(movies).toContainText('2003');
	await expect(page.getByRole('region', { name: 'Collections' })).toContainText('Fast & Furious');
	await expect(page).toHaveURL('/search?q=fast');
	await movies.getByRole('link', { name: /2 Fast 2 Furious/ }).click();
	await expect(page).toHaveURL('/item/160');
});

test('typing a person’s name lists them under People and opens their page', async ({ page }) => {
	await box(page).fill('Theresa');
	const people = page.getByRole('region', { name: 'People' });
	await expect(people).toContainText('Theresa Randle');
	await people.getByRole('link', { name: 'Theresa Randle' }).click();
	await expect(page).toHaveURL(/\/person\/7147\?name=Theresa%20Randle/);
});

test('upcoming Live TV programs are included', async ({ page }) => {
	await box(page).fill('nieuws');
	const tv = page.getByRole('region', { name: 'Live TV' });
	await expect(tv).toContainText('RTL Z Nieuws');
	await expect(tv).toContainText('RTL Z HD');
});

test('a search without matches says so', async ({ page }) => {
	await box(page).fill('zzqqxxnothing');
	await expect(page.getByTestId('no-results')).toHaveText('No results for “zzqqxxnothing”.');
});

test('input is debounced', async ({ page }) => {
	const calls: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/api/search')) calls.push(r.url());
	});
	await box(page).pressSequentially('furious', { delay: 40 });
	await expect(page.getByRole('region', { name: 'Movies' })).toBeVisible();
	expect(calls.length).toBeLessThanOrEqual(2);
	expect(calls.at(-1)).toContain('q=furious');
});

test('a shared search URL renders results directly', async ({ page }) => {
	await page.goto('/search?q=fast');
	await expect(box(page)).toHaveValue('fast');
	await expect(page.getByRole('region', { name: 'Movies' })).toContainText('2 Fast 2 Furious');
});
