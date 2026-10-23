import { expect, test, type Page } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';

test.beforeEach(async ({ context }) => {
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});

const guide = (page: Page) => page.getByTestId('guide');

test('the guide opens at the current half hour with a now marker', async ({ page }) => {
	await page.goto('/live/guide');
	await expect(page.getByTestId('airing').first()).toBeVisible();
	// The guide starts half an hour early; the current half hour is at the left edge (4 px/min).
	await expect.poll(() => guide(page).evaluate((el) => el.scrollLeft)).toBe(120);
	await expect(page.getByTestId('now-marker')).toBeVisible();
	await expect(page.getByTestId('now-label')).toBeVisible();
	// Every channel has something airing now, highlighted (rows are rendered near the viewport).
	const rows = await page.getByTestId('guide-row').count();
	expect(rows).toBeGreaterThan(5);
	const airingNow = page.locator('[data-testid=airing][data-now=true]');
	await expect(airingNow).toHaveCount(rows);
	await expect(airingNow.first()).toHaveClass(/border-accent/);
});

test('on a 360px phone the guide scrolls inside itself, not the page', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await page.goto('/live/guide');
	await expect(page.getByTestId('airing').first()).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBe(0);
	const inner = await guide(page).evaluate((el) => el.scrollWidth - el.clientWidth);
	expect(inner).toBeGreaterThan(1000);
	// Channels stay pinned while the time axis scrolls.
	const cell = page.getByTestId('guide-row').first().locator('[data-channel-cell]');
	const before = await cell.boundingBox();
	await guide(page).evaluate((el) => el.scrollBy({ left: 600 }));
	await expect.poll(async () => (await cell.boundingBox())?.x).toBe(before?.x);
});

test('scrolling later in the day loads that part of the guide', async ({ page }) => {
	const windows: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/api/live/guide')) windows.push(r.url());
	});
	await page.goto('/live/guide');
	await expect(page.getByTestId('airing').first()).toBeVisible();
	const rendered = await page.getByTestId('airing').count();
	// Only programs near the viewport are rendered, not the whole day.
	expect(rendered).toBeLessThan(200);

	// 12 hours later (4 px per minute).
	await guide(page).evaluate((el) => el.scrollBy({ left: 12 * 60 * 4 }));
	await expect.poll(() => windows.length).toBeGreaterThan(0);
	const view = await guide(page).boundingBox();
	await expect
		.poll(async () => {
			const boxes = await page
				.getByTestId('airing')
				.evaluateAll((els) =>
					els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, right: r.right }))
				);
			return boxes.filter((b) => b.right > view!.x + 100 && b.x < view!.x + view!.width).length;
		})
		.toBeGreaterThan(10);
});

test('a program shows its details, with the time and summary', async ({ page }) => {
	await page.goto('/live/guide');
	const program = page.locator('[data-testid=airing][data-now=true]').first();
	const title = (await program.locator('span').first().textContent())!.trim();
	await program.click();
	const sheet = page.getByRole('dialog', { name: title });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByTestId('program-time')).toContainText('On now');
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
});

test("What's On lists what airs now with channel and time left, and what starts soon", async ({
	page
}) => {
	await page.goto('/live/whats-on');
	const onNow = page.getByRole('region', { name: 'On now' });
	const items = onNow.getByTestId('whats-on-item');
	await expect(items).toHaveCount(18);
	await expect(items.first()).toContainText(/\d+ (h|min)/);
	await expect(items.first()).toContainText('left');
	await expect(onNow).toContainText('NPO 1 HD');
	await expect(
		page.getByRole('region', { name: 'Starting soon' }).getByTestId('whats-on-time').first()
	).toHaveText(/\d{2}:\d{2}.*–/);
});
