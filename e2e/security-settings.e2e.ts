import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { e2eDb, seedUser } from './support/db';
import { seedTotp, totpFor } from './support/factors';

const TEN_MINUTES = 10 * 60_000;

function factorCount(userId: string) {
	const db = e2eDb();
	const n = db
		.prepare(
			'select (select count(*) from totp_authenticators where user_id = ?) + (select count(*) from webauthn_credentials where user_id = ?)'
		)
		.pluck()
		.get(userId, userId) as number;
	db.close();
	return n;
}

test('a factor can be renamed', async ({ context, page }) => {
	const user = await seedUser();
	seedTotp(user.id);
	await signInAs(context, user.id);
	await page.goto('/settings/security');
	await page.getByRole('button', { name: 'Rename Authenticator app' }).click();
	await page.getByLabel('New name').fill('Pixel 9');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('list', { name: 'Sign-in methods' })).toContainText('Pixel 9');
});

test('the last remaining factor cannot be removed', async ({ context, page }) => {
	const user = await seedUser();
	seedTotp(user.id);
	await signInAs(context, user.id);
	await page.goto('/settings/security');
	await page.getByRole('button', { name: 'Remove Authenticator app' }).click();
	await expect(page.getByRole('alert')).toHaveText(/only sign-in method.*Add another/);
	expect(factorCount(user.id)).toBe(1);
});

test('removing a factor requires a recent step-up', async ({ context, page }) => {
	const user = await seedUser();
	const totp = seedTotp(user.id);
	seedTotp(user.id);
	const db = e2eDb();
	db.prepare(
		"update totp_authenticators set name = 'Old phone' where user_id = ? and rowid = (select max(rowid) from totp_authenticators where user_id = ?)"
	).run(user.id, user.id);
	db.close();
	await signInAs(context, user.id, { stepUpAgoMs: TEN_MINUTES });

	await page.goto('/settings/security');
	await page.getByRole('button', { name: 'Remove Old phone' }).click();
	await expect(page.getByRole('alert')).toHaveText('For your security, verify it’s you first.');
	expect(factorCount(user.id)).toBe(2);

	await page.getByLabel('Authenticator code').fill(totp.generate());
	await page.getByRole('button', { name: 'Verify', exact: true }).click();
	await expect(page.getByTestId('step-up').getByRole('status')).toHaveText(/Verified/);

	await page.getByRole('button', { name: 'Remove Old phone' }).click();
	await expect(page.getByRole('list', { name: 'Sign-in methods' })).not.toContainText('Old phone');
	expect(factorCount(user.id)).toBe(1);
});

test('a second authenticator can be added after verifying', async ({ context, page }) => {
	const user = await seedUser();
	seedTotp(user.id);
	await signInAs(context, user.id);
	await page.goto('/settings/security');
	await page.getByRole('button', { name: 'Use an authenticator app' }).click();
	const secret = (await page.getByTestId('totp-secret').innerText()).replace(/\s/g, '');
	await page.getByLabel('6-digit code').fill(totpFor(secret).generate());
	await page.getByLabel('Name', { exact: true }).fill('Tablet');
	await page.getByRole('button', { name: 'Verify and save' }).click();
	await expect(page.getByText('Authenticator app added.')).toBeVisible();
	await expect(page.getByRole('list', { name: 'Sign-in methods' })).toContainText('Tablet');
	expect(factorCount(user.id)).toBe(2);
});

test('adding an authenticator without a recent step-up is refused', async ({ context, page }) => {
	const user = await seedUser();
	seedTotp(user.id);
	await signInAs(context, user.id, { stepUpAgoMs: TEN_MINUTES });
	await page.goto('/settings/security');
	await page.getByRole('button', { name: 'Use an authenticator app' }).click();
	await expect(page.getByRole('alert')).toHaveText('For your security, verify it’s you first.');
});

test('a user without a factor cannot reach library pages', async ({ page }) => {
	const user = await seedUser();
	const { submitPassword } = await import('./support/auth');
	await submitPassword(page, user.username, user.password);
	for (const path of ['/', '/settings/security', '/library/1']) {
		await page.goto(path);
		await expect(page).toHaveURL('/enroll');
	}
});
