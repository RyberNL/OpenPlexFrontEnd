import { expect, test } from './support/test';
import { fakePms } from './support/fake-pms';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';

test.afterEach(() => fakePms('clear-patches'));
// Other tests may have left positions or watch state behind on the fake server.
test.beforeEach(() => fakePms('clear-patches'));
test.beforeEach(async ({ context }) => {
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});

test('the navigation lists only the movie and TV libraries', async ({ page }) => {
	await page.goto('/libraries');
	const list = page.getByRole('list', { name: 'Libraries' });
	await expect(list.getByRole('link')).toHaveText(['Films', 'Tv-series']);
});

test('the Discover home shows continue watching, next up and recently added', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByTestId('featured')).toBeVisible();

	const continueRow = page.getByRole('list', { name: 'Continue Watching' });
	await expect(continueRow.getByRole('listitem').first()).toContainText('American Dad!');
	await expect(continueRow.getByRole('progressbar').first()).toBeAttached();

	const nextUp = page.getByRole('list', { name: 'Next Up' });
	await expect(nextUp).toContainText('Futurama');
	await expect(nextUp).not.toContainText('American Dad!');

	await expect(page.getByRole('region', { name: 'Recently Added Movies' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Recently Added TV' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Oh, The Horror!' })).toBeVisible();
});

test('selecting a Continue Watching item resumes playback', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('list', { name: 'Continue Watching' }).getByRole('link').first().click();
	await expect(page).toHaveURL(/\/watch\/\d+\?from=resume$/);
	await expect(page.getByTestId('player')).toBeVisible();
});
