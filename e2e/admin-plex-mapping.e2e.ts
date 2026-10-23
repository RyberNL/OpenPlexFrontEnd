import { expect, test } from './support/test';
import { signInAs } from './support/auth';
import { e2eDb, seedUser } from './support/db';

test('an admin maps a user to a PIN-protected Plex Home user', async ({ page }) => {
	// Start without a stored PIN for Anna (other projects in this run may have saved one).
	const reset = e2eDb();
	reset.prepare("delete from plex_home_tokens where home_user_uuid = 'home-anna'").run();
	reset.close();
	const admin = await seedUser({ role: 'admin' });
	const anna = await seedUser();
	await signInAs(page.context(), admin.id);
	await page.goto(`/admin/users/${anna.id}`);

	const section = page.getByRole('region', { name: 'Plex user' });
	await section.getByLabel('Plex Home user').selectOption({ label: 'Anna 🔒' });
	await section.getByRole('button', { name: 'Save Plex user' }).click();
	await expect(section.getByRole('alert')).toHaveText('This Plex Home user needs their PIN.');

	await section.getByLabel('Plex Home user').selectOption({ label: 'Anna 🔒' });
	await section.getByLabel('Plex Home PIN').fill('1234');
	await section.getByRole('button', { name: 'Save Plex user' }).click();
	await expect(section.getByRole('status')).toHaveText('Linked to Plex user Anna.');

	const db = e2eDb();
	const stored = db
		.prepare('select plex_home_user_uuid from users where id = ?')
		.pluck()
		.get(anna.id);
	const pinColumn = db
		.prepare("select pin_enc from plex_home_tokens where home_user_uuid = 'home-anna'")
		.pluck()
		.get() as string;
	db.close();
	expect(stored).toBe('home-anna');
	expect(pinColumn).not.toContain('1234');

	await page.goto('/admin/users');
	await expect(page.getByRole('link', { name: new RegExp(`@${anna.username}`) })).toContainText(
		'Plex: Anna'
	);
});

test('an admin can remove a Plex mapping', async ({ page }) => {
	const admin = await seedUser({ role: 'admin' });
	const ben = await seedUser();
	await signInAs(page.context(), admin.id);
	await page.goto(`/admin/users/${ben.id}`);
	const section = page.getByRole('region', { name: 'Plex user' });
	await section.getByLabel('Plex Home user').selectOption({ label: 'Ben' });
	await section.getByRole('button', { name: 'Save Plex user' }).click();
	await expect(section.getByRole('status')).toHaveText('Linked to Plex user Ben.');
	await section.getByLabel('Plex Home user').selectOption({ label: 'Not linked' });
	await section.getByRole('button', { name: 'Save Plex user' }).click();
	await expect(section.getByRole('status')).toHaveText('Plex link removed.');
});
