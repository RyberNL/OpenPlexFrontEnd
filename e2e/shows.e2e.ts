import fs from 'node:fs';
import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { fakePms, setWatched } from './support/fake-pms';

const episodes: { ratingKey: string; index: number; title: string }[] = JSON.parse(
	fs.readFileSync('test/fixtures/plex/show-all-episodes.json', 'utf8')
).MediaContainer.Metadata;
const SHOW = '12497';
const SEASON = '12498';

// Other tests may have left positions or watch state behind on the fake server.
test.beforeEach(() => fakePms('clear-patches'));
test.beforeEach(async ({ context }) => {
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});
test.afterEach(() => fakePms('clear-patches'));

test('after watching S01E01–E03 the show page offers S01E04', async ({ page }) => {
	await setWatched(
		episodes.filter((e) => e.index <= 3).map((e) => e.ratingKey),
		true
	);
	await setWatched(
		episodes.filter((e) => e.index > 3).map((e) => e.ratingKey),
		false
	);
	const e4 = episodes.find((e) => e.index === 4)!;

	await page.goto(`/item/${SHOW}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ahsoka');
	const play = page.getByRole('link', { name: 'Play S1·E4' });
	await expect(play).toHaveAttribute('href', `/watch/${e4.ratingKey}?from=start`);
	await expect(page.getByText(e4.title)).toBeVisible();
});

test('the show lists its seasons, and a season lists its episodes with watch state', async ({
	page
}) => {
	await setWatched([episodes[0].ratingKey], true);
	await setWatched([episodes[1].ratingKey], false);
	await page.goto(`/item/${SHOW}`);
	const seasons = page.getByRole('list', { name: 'Seasons' });
	await seasons.getByRole('link', { name: /Season 1/ }).click();
	await expect(page).toHaveURL(`/item/${SEASON}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Season 1');
	await expect(page.getByRole('link', { name: 'Ahsoka' })).toHaveAttribute('href', `/item/${SHOW}`);

	const rows = page.getByTestId('episode');
	await expect(rows).toHaveCount(episodes.length);
	await expect(rows.nth(0).getByTestId('episode-watched')).toBeVisible();
	await expect(rows.nth(1).getByTestId('episode-watched')).toHaveCount(0);
	await expect(rows.nth(0)).toContainText(`1. ${episodes[0].title}`);
	await rows
		.nth(1)
		.getByRole('link', { name: `2. ${episodes[1].title}` })
		.click();
	await expect(page).toHaveURL(`/item/${episodes[1].ratingKey}`);
	await expect(page.getByText('Season 1 · Episode 2')).toBeVisible();
});

test('a fully watched show says so instead of offering an episode', async ({ page }) => {
	await setWatched(
		episodes.map((e) => e.ratingKey),
		true
	);
	await page.goto(`/item/${SHOW}`);
	await expect(page.getByText('You have watched every episode.')).toBeVisible();
});

test('marking a season watched marks every episode', async ({ page }) => {
	await setWatched(
		episodes.map((e) => e.ratingKey),
		false
	);
	await page.goto(`/item/${SEASON}`);
	await expect(page.getByTestId('episode-watched')).toHaveCount(0);
	await page.getByRole('button', { name: 'Mark as watched' }).click();
	await expect(page.getByTestId('episode-watched')).toHaveCount(episodes.length);
	await expect(page.getByRole('button', { name: 'Mark as unwatched' })).toBeVisible();

	await page.getByRole('button', { name: 'Mark as unwatched' }).click();
	await expect(page.getByTestId('episode-watched')).toHaveCount(0);
});

test('a movie can be marked watched and unwatched', async ({ page }) => {
	await page.goto('/item/157');
	await page.getByRole('button', { name: 'Mark as watched' }).click();
	await expect(page.getByRole('button', { name: 'Mark as unwatched' })).toBeVisible();
	await page.goto('/library/1');
	const card = page.locator('a[href="/item/157"]');
	await expect(card.getByTestId('watched-badge')).toBeVisible();
	await page.goto('/item/157');
	await page.getByRole('button', { name: 'Mark as unwatched' }).click();
	await expect(page.getByRole('button', { name: 'Mark as watched' })).toBeVisible();
});
