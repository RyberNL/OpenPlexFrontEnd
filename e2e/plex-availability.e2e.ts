import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { fakePms } from './support/fake-pms';

test('a user without a Plex mapping is told to ask an admin', async ({ page }) => {
	const user = await seedUser();
	await signInAs(page.context(), user.id);
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Not linked to Plex yet' })).toBeVisible();
	await expect(page.getByRole('alert')).toContainText('Ask an administrator');
});

test('an unmapped admin can link their own account from the message', async ({ page }) => {
	const admin = await seedUser({ role: 'admin' });
	await signInAs(page.context(), admin.id);
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Not linked to Plex yet' })).toBeVisible();
	await expect(page.getByRole('alert')).not.toContainText('Ask an administrator');
	await page.getByRole('link', { name: 'Link your account' }).click();
	await expect(page).toHaveURL(`/admin/users/${admin.id}`);
	await expect(page.getByLabel('Plex Home user')).toBeVisible();
});

test('an unavailable media server is explained, and the app recovers on retry', async ({
	page
}) => {
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(page.context(), user.id);
	await page.goto('/');
	await expect(page.getByRole('region', { name: 'Continue Watching' })).toBeVisible();

	await fakePms('offline');
	try {
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Media server unavailable' })).toBeVisible();
		await page.getByRole('button', { name: 'Retry' }).click();
		await expect(page.getByRole('heading', { name: 'Media server unavailable' })).toBeVisible();
	} finally {
		await fakePms('online');
	}
	await page.getByRole('button', { name: 'Retry' }).click();
	await expect(page.getByRole('region', { name: 'Continue Watching' })).toBeVisible();
});
