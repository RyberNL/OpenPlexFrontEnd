import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';

const PAGES = [
	'/',
	'/libraries',
	'/settings/account',
	'/settings/security',
	'/admin/users',
	'/admin/plex'
];

test.beforeEach(async ({ context }) => {
	test.skip(!test.info().project.name.endsWith('mobile'), 'Touch targets apply to touch devices');
	const admin = await seedUser({ role: 'admin' });
	mapToPlexOwner(admin.id);
	await signInAs(context, admin.id);
});

for (const path of PAGES) {
	test(`every control on ${path} is at least 44×44 px`, async ({ page }) => {
		await page.goto(path);
		await page.waitForLoadState('networkidle');
		const small = await page.$$eval(
			'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button]',
			(elements) =>
				elements
					.filter((el) => {
						const style = getComputedStyle(el);
						const rect = el.getBoundingClientRect();
						const visible =
							rect.width > 0 &&
							rect.height > 0 &&
							style.visibility !== 'hidden' &&
							!el.closest('.sr-only');
						return visible && (rect.width < 44 || rect.height < 44);
					})
					.map((el) => {
						const rect = el.getBoundingClientRect();
						const name = (el.getAttribute('aria-label') ?? el.textContent ?? '')
							.trim()
							.slice(0, 40);
						return `<${el.tagName.toLowerCase()}> "${name}" ${Math.round(rect.width)}×${Math.round(rect.height)}`;
					})
		);
		expect(small).toEqual([]);
	});
}
