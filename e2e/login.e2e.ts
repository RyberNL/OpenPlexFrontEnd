import { expect, test } from './support/test';
import { submitPassword } from './support/auth';
import { seedUser } from './support/db';
import { seedTotp } from './support/factors';

test('correct password leads to the MFA challenge, with no media access yet', async ({ page }) => {
	const user = await seedUser();
	seedTotp(user.id);
	await submitPassword(page, user.username, user.password);
	await expect(page).toHaveURL('/login/mfa');
	await page.goto('/');
	await expect(page).toHaveURL('/login/mfa');
	expect((await page.request.get('/api/libraries')).status()).toBe(401);
});

test('a user without a second factor is sent to enrollment', async ({ page }) => {
	const user = await seedUser();
	await submitPassword(page, user.username, user.password);
	await expect(page).toHaveURL('/enroll');
});

test('wrong password and unknown username show the same generic message', async ({ page }) => {
	const user = await seedUser();
	await submitPassword(page, user.username, 'wrong password!!');
	await expect(page.getByRole('alert')).toHaveText('Invalid username or password.');
	await submitPassword(page, 'no-such-user', 'wrong password!!');
	await expect(page.getByRole('alert')).toHaveText('Invalid username or password.');
	await expect(page).toHaveURL(/\/login/);
});

test('a disabled account is refused and gets no session', async ({ page, context }) => {
	const user = await seedUser({ disabled: true });
	await submitPassword(page, user.username, user.password);
	await expect(page.getByRole('alert')).toHaveText('This account has been disabled.');
	expect((await context.cookies()).find((c) => c.name === 'session')).toBeUndefined();
	await page.goto('/');
	await expect(page).toHaveURL(/\/login/);
});

test('10 failed attempts lock the account for 15 minutes, even with the right password', async ({
	page
}) => {
	const user = await seedUser();
	for (let i = 1; i <= 9; i++) {
		await submitPassword(page, user.username, `wrong password ${i}`);
		await expect(page.getByRole('alert')).toHaveText('Invalid username or password.');
	}
	await submitPassword(page, user.username, 'wrong password 10');
	await expect(page.getByRole('alert')).toHaveText(
		'Too many failed attempts. Try again in 15 minutes.'
	);
	await submitPassword(page, user.username, user.password);
	await expect(page.getByRole('alert')).toHaveText(/Too many failed attempts/);
	await expect(page).toHaveURL(/\/login/);
});

test('signed-out deep links redirect to sign-in with a return target', async ({ page }) => {
	await page.goto('/item/42');
	await expect(page).toHaveURL('/login?returnTo=%2Fitem%2F42');
});

test('session cookie is HttpOnly and SameSite=Lax', async ({ page, context }) => {
	const user = await seedUser();
	await submitPassword(page, user.username, user.password);
	await expect(page).toHaveURL('/enroll');
	const cookie = (await context.cookies()).find((c) => c.name === 'session');
	expect(cookie?.httpOnly).toBe(true);
	expect(cookie?.sameSite).toBe('Lax');
});
