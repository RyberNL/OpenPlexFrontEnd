import fs from 'node:fs';
import { expect, test } from './support/test';
import { fakePms } from './support/fake-pms';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';

const recorded = JSON.parse(
	fs.readFileSync('test/fixtures/plex/section-movies-page-200.json', 'utf8')
).MediaContainer;

test.afterEach(() => fakePms('clear-patches'));
// Other tests may have left positions or watch state behind on the fake server.
test.beforeEach(() => fakePms('clear-patches'));
test.beforeEach(async ({ context }) => {
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});

const cards = (page: import('@playwright/test').Page) =>
	page.getByRole('list', { name: 'Films items' }).getByRole('listitem');

test('sorting by date added puts the most recently added movie first', async ({ page }) => {
	const newest = [...recorded.Metadata].sort(
		(a: { addedAt: number }, b: { addedAt: number }) => b.addedAt - a.addedAt
	)[0];
	await page.goto('/library/1');
	await expect(page.getByRole('status')).toHaveText(`${recorded.totalSize} movies`);
	await page.getByLabel('Sort', { exact: true }).selectOption({ label: 'Date added' });
	await expect(page).toHaveURL(/sort=added/);
	await expect(cards(page).first()).toContainText(newest.title);
});

test('the unwatched filter hides watched movies', async ({ page }) => {
	await page.goto('/library/1');
	await page.getByLabel('Unwatched').check();
	await expect(page).toHaveURL(/unwatched=1/);
	const status = page.getByRole('status');
	await expect(status).not.toHaveText(`${recorded.totalSize} movies`);
	await expect(cards(page).first()).toBeVisible();
	await expect(page.getByTestId('watched-badge')).toHaveCount(0);
});

test('filtering by genre narrows the library', async ({ page }) => {
	await page.goto('/library/1');
	await page.getByRole('button', { name: /^Filters/ }).click();
	await page.getByLabel('Genre').selectOption({ label: 'Action' });
	await expect(page).toHaveURL(/genre=76/);
	await expect(page.getByRole('button', { name: 'Filters (1)' })).toBeVisible();
	const count = Number((await page.getByRole('status').innerText()).split(' ')[0]);
	expect(count).toBeGreaterThan(0);
	expect(count).toBeLessThan(recorded.totalSize);
});

test('a large library renders the first page at once and loads more on scroll', async ({
	page
}) => {
	const pages: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/api/library/1'))
			pages.push(new URL(r.url()).searchParams.get('offset')!);
	});
	await page.goto('/library/1');
	expect(recorded.totalSize).toBeGreaterThan(1000);
	await expect(cards(page).first()).toBeVisible();
	const rendered = await cards(page).count();
	expect(rendered).toBeLessThan(recorded.totalSize);

	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
	await expect.poll(() => pages.length).toBeGreaterThan(0);
	expect(pages.every((offset) => Number(offset) >= 60)).toBe(true);
	const loadedBeyondFirstPage = page.locator('[data-index] [data-testid="poster-card"]').last();
	await expect(loadedBeyondFirstPage).toBeVisible();
	expect(
		Number(await loadedBeyondFirstPage.locator('xpath=..').getAttribute('data-index'))
	).toBeGreaterThan(60);
});

test('the A–Z bar jumps to the first title with that letter', async ({ page }) => {
	await page.goto('/library/1');
	await page.getByRole('button', { name: 'Jump to M' }).click();
	const first = page.locator('[data-testid="poster-card"]', { hasText: /^\s*M/ }).first();
	await expect(first).toBeInViewport();
});
