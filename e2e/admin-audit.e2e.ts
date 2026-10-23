import { expect, test } from './support/test';
import { signInAs, submitPassword } from './support/auth';
import { seedUser } from './support/db';

test('an admin sees failed sign-ins with time, attempted username and source IP', async ({
	page,
	browser
}) => {
	const target = await seedUser();
	const attacker = await (await browser.newContext()).newPage();
	await submitPassword(attacker, target.username, 'wrong password!!');
	await submitPassword(attacker, `ghost-${target.username}`, 'wrong password!!');

	const admin = await seedUser({ role: 'admin' });
	await signInAs(page.context(), admin.id);
	await page.goto('/admin/audit');
	await page.getByLabel('Event').selectOption({ label: 'Sign-in failed' });
	await page.getByRole('button', { name: 'Filter' }).click();
	await expect(page).toHaveURL(/event=auth.login_failed/);

	const entries = page.getByRole('list', { name: 'Audit entries' }).getByRole('listitem');
	for (const username of [target.username, `ghost-${target.username}`]) {
		const row = entries.filter({
			has: page.getByTestId('audit-target').getByText(username, { exact: true })
		});
		await expect(row).toHaveCount(1);
		await expect(row).toContainText('Sign-in failed');
		await expect(row).toContainText(/127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/);
		await expect(row.locator('time')).toBeVisible();
	}
});

test('the audit log can be filtered by user', async ({ page }) => {
	const admin = await seedUser({ role: 'admin' });
	const anna = await seedUser();
	await submitPassword(page, anna.username, 'wrong password!!');
	await signInAs(page.context(), admin.id);
	await page.goto('/admin/audit');
	await page.getByLabel('User').selectOption({ label: anna.username });
	await page.getByRole('button', { name: 'Filter' }).click();
	const targets = await page.getByTestId('audit-target').allInnerTexts();
	expect(targets.length).toBeGreaterThan(0);
	expect(new Set(targets)).toEqual(new Set([anna.username]));
});
