import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { fakePms } from './support/fake-pms';

test.beforeEach(async ({ context }) => {
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});
test.afterEach(() => fakePms('with-dvr'));

const liveLink = (page: import('@playwright/test').Page) =>
	page.getByRole('navigation').getByRole('link', { name: 'Live TV' }).filter({ visible: true });

test('Live TV is offered when the server has a DVR', async ({ page }) => {
	await page.goto('/');
	await liveLink(page).click();
	await expect(page).toHaveURL('/live');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Live TV');
	await expect(page.getByTestId('live-unavailable')).toHaveCount(0);
});

test('without a DVR, Live TV is hidden and its pages say it is not set up', async ({ page }) => {
	await fakePms('no-dvr');
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
	await expect(liveLink(page)).toHaveCount(0);
	await page.goto('/live');
	await expect(page.getByTestId('live-unavailable')).toContainText(
		'Live TV is not set up on this server.'
	);
});

test('channels show what is on now, with progress and what is next', async ({ page }) => {
	await page.goto('/live');
	const channels = page.getByRole('list', { name: 'Channels' }).getByTestId('channel');
	await expect(channels).toHaveCount(18);
	const npo1 = channels.filter({ hasText: 'NPO 1 HD' }).first();
	await expect(npo1).toContainText('1032');
	await expect(npo1.getByTestId('now-playing')).not.toBeEmpty();
	await expect(npo1.getByRole('progressbar')).toBeVisible();
	await expect(npo1).toContainText(/left/);
	// Logos come through the app's image relay.
	await expect(npo1.locator('img')).toHaveAttribute('src', /^\/img\//);
});

test('a favorite channel shows under the Favorites filter, per user', async ({ page, browser }) => {
	await page.goto('/live');
	const npo2 = page.getByTestId('channel').filter({ hasText: 'NPO 2 HD' }).first();
	await npo2.getByRole('button', { name: /^Favorite/ }).click();
	await expect(npo2.getByRole('button', { name: /^Favorite/ })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	await page.getByRole('link', { name: 'Favorites' }).click();
	await expect(page).toHaveURL('/live?favorites=1');
	const shown = page.getByTestId('channel');
	await expect(shown).toHaveCount(1);
	await expect(shown).toContainText('NPO 2 HD');

	// Another app user has their own (empty) favorites.
	const other = await seedUser();
	mapToPlexOwner(other.id);
	const context = await browser.newContext();
	await signInAs(context, other.id);
	const otherPage = await context.newPage();
	await otherPage.goto('/live?favorites=1');
	await expect(otherPage.getByTestId('no-channels')).toContainText('No favorite channels yet');
});
