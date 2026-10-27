import fs from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';

const WIDTHS = [360, 390, 768, 1440, 2560];
const PAGES = [
	'/',
	'/libraries',
	'/settings/account',
	'/settings/security',
	'/settings/about',
	'/admin/users'
];

test.beforeEach(async ({ context }) => {
	// Viewports are set per test, so the desktop projects (one per engine) are enough.
	test.skip(!test.info().project.name.endsWith('desktop'), 'Viewports set per test');
	const admin = await seedUser({ role: 'admin' });
	mapToPlexOwner(admin.id);
	await signInAs(context, admin.id);
});

for (const width of WIDTHS) {
	test(`layout at ${width}px has no horizontal scroll and the right navigation`, async ({
		page
	}, info) => {
		await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
		for (const path of PAGES) {
			await page.goto(path);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow, `${path} overflows at ${width}px`).toBeLessThanOrEqual(0);
		}
		await page.goto('/');
		const tabs = page.getByRole('navigation', { name: 'Tabs' });
		const sidebar = page.getByRole('navigation', { name: 'Main' });
		if (width < 768) {
			await expect(tabs).toBeVisible();
			await expect(sidebar).toBeHidden();
		} else {
			await expect(sidebar).toBeVisible();
			await expect(tabs).toBeHidden();
			await expect(sidebar.getByRole('link', { name: 'Films' })).toBeVisible();
		}
		await info.attach(`home-${width}.png`, {
			body: await page.screenshot({ fullPage: true }),
			contentType: 'image/png'
		});
	});
}

test('primary navigation on a phone is one tap away, each library a tab of its own', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/settings/security');
	const tabs = page.getByRole('navigation', { name: 'Tabs' });
	await expect(tabs.getByRole('link')).toHaveText([
		'Home',
		'Films',
		'Tv-series',
		'Live TV',
		'Account'
	]);
	await tabs.getByRole('link', { name: 'Tv-series' }).click();
	await expect(page).toHaveURL('/library/2');
	await expect(tabs.getByRole('link', { name: 'Tv-series' })).toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('the sidebar has no Search or Playlists; search sits on top of Home and each library', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/');
	const sidebar = page.getByRole('navigation', { name: 'Main' });
	await expect(sidebar.getByRole('link', { name: 'Films' })).toBeVisible();
	await expect(sidebar.getByRole('link', { name: /^(Search|Playlists)$/ })).toHaveCount(0);

	for (const path of ['/', '/library/1']) {
		await page.goto(path);
		await expect(page.getByTestId('search-bar')).toBeVisible();
	}
	// Searching starts with the first keystroke; typing carries on in the search page's box.
	await page.getByRole('searchbox', { name: /Search movies/ }).pressSequentially('fast', {
		delay: 30
	});
	await expect(page).toHaveURL('/search?q=fast');
	await expect(page.getByRole('searchbox', { name: /Search movies/ })).toBeFocused();
	await expect(page.getByRole('searchbox', { name: /Search movies/ })).toHaveValue('fast');
	await expect(page.getByRole('region', { name: 'Movies' })).toContainText('2 Fast 2 Furious');
});

test('a skip link moves keyboard focus to the content', async ({ page }) => {
	await page.goto('/');
	await page.keyboard.press('Tab');
	const skip = page.getByRole('link', { name: 'Skip to content' });
	await expect(skip).toBeFocused();
	await expect(skip).toBeVisible();
	await page.keyboard.press('Enter');
	await expect(page.locator('#main')).toBeFocused();
});

for (const path of PAGES) {
	test(`no accessibility violations on ${path}`, async ({ page }) => {
		await page.goto(path);
		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			.analyze();
		expect(
			results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)
		).toEqual([]);
	});
}

test('the sidebar shows the running version, and About lists what changed in it', async ({
	page
}) => {
	const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/');
	await expect(page.getByTestId('sidebar-version')).toHaveText(`Version ${version}`);
	await page.getByTestId('sidebar-version').click();
	await expect(page).toHaveURL('/settings/about');
	await expect(page.getByTestId('app-version')).toHaveText(version);
	const latest = page.getByTestId('release').first();
	await expect(latest.getByRole('heading', { level: 3 })).toContainText(`${version} Running`);
	await expect(latest.getByRole('listitem').first()).toBeVisible();
});
