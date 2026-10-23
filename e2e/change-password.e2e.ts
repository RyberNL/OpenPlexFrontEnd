import { expect, test } from './support/test';
import { submitPassword } from './support/auth';
import { seedUser } from './support/db';

test('a user created with a temporary password must change it before anything else', async ({
	page
}) => {
	const user = await seedUser({ mustChangePassword: true });
	await submitPassword(page, user.username, user.password);
	await expect(page).toHaveURL('/change-password');

	await page.goto('/');
	await expect(page).toHaveURL('/change-password');
	await page.goto('/enroll');
	await expect(page).toHaveURL('/change-password');

	await page.getByLabel('New password', { exact: true }).fill('too short');
	await page.getByLabel('Confirm new password').fill('too short');
	await page.getByRole('button', { name: 'Set password' }).click();
	// The browser blocks the submission; the server enforces the same policy (unit-tested).
	expect(
		await page
			.getByLabel('New password', { exact: true })
			.evaluate((el: HTMLInputElement) => el.validity.valid)
	).toBe(false);
	await expect(page).toHaveURL('/change-password');

	await page.getByLabel('New password', { exact: true }).fill('my own new password');
	await page.getByLabel('Confirm new password').fill('my own new passw0rd');
	await page.getByRole('button', { name: 'Set password' }).click();
	await expect(page.getByRole('alert')).toHaveText('The passwords do not match.');

	await page.getByLabel('New password', { exact: true }).fill(user.password);
	await page.getByLabel('Confirm new password').fill(user.password);
	await page.getByRole('button', { name: 'Set password' }).click();
	await expect(page.getByRole('alert')).toHaveText(/different from the one you were given/);

	await page.getByLabel('New password', { exact: true }).fill('my own new password');
	await page.getByLabel('Confirm new password').fill('my own new password');
	await page.getByRole('button', { name: 'Set password' }).click();
	await expect(page).toHaveURL('/enroll');
});

test('after the change only the new password works', async ({ browser }) => {
	const user = await seedUser({ mustChangePassword: true });
	const first = await (await browser.newContext()).newPage();
	await submitPassword(first, user.username, user.password);
	await first.getByLabel('New password', { exact: true }).fill('my own new password');
	await first.getByLabel('Confirm new password').fill('my own new password');
	await first.getByRole('button', { name: 'Set password' }).click();
	await expect(first).toHaveURL('/enroll');

	const second = await (await browser.newContext()).newPage();
	await submitPassword(second, user.username, user.password);
	await expect(second.getByRole('alert')).toHaveText('Invalid username or password.');
	await submitPassword(second, user.username, 'my own new password');
	await expect(second).toHaveURL('/enroll');
});
