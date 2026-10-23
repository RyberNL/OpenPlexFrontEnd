import { expect, test, type Page } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { fakePms, fakeTranscodes } from './support/fake-pms';
import { startPlayback } from './support/playback';
import { waitUntilPlaying } from './support/player';

test.beforeEach(async ({ context }) => {
	test.skip(!test.info().project.name.endsWith('desktop'), 'One viewport per engine is enough');
	await fakePms('clear-patches');
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});

/** Starts an HLS transcode in the player and returns its PMS session id. */
async function playTranscode(page: Page) {
	const before = new Set(Object.keys(await fakeTranscodes()));
	await page.goto('/watch/160?from=start');
	await waitUntilPlaying(page);
	const started = Object.keys(await fakeTranscodes()).filter((id) => !before.has(id));
	expect(started).toHaveLength(1);
	return started[0];
}

const stopped = async (session: string) => (await fakeTranscodes())[session]?.stopped;

test('stopping playback with the back button stops the transcode', async ({ page }) => {
	await page.goto('/item/160');
	const session = await playTranscode(page);
	expect(await stopped(session)).toBe(false);
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await expect.poll(() => stopped(session)).toBe(true);
});

test('navigating away from the player stops the transcode', async ({ page }) => {
	const session = await playTranscode(page);
	await page.goto('/');
	await expect.poll(() => stopped(session)).toBe(true);
});

test('signing out stops the transcode', async ({ page }) => {
	const before = new Set(Object.keys(await fakeTranscodes()));
	const { body } = await startPlayback(page.request, '160');
	await page.request.get(body.src);
	const session = Object.keys(await fakeTranscodes()).find((id) => !before.has(id))!;
	expect(await stopped(session)).toBe(false);
	await page.request.post('/logout', {
		headers: { origin: 'http://localhost:4173' },
		maxRedirects: 0
	});
	await expect.poll(() => stopped(session)).toBe(true);
});

test('replacing a stream (new quality, version or position) stops the old transcode', async ({
	page
}) => {
	const before = new Set(Object.keys(await fakeTranscodes()));
	const { body } = await startPlayback(page.request, '160');
	await page.request.get(body.src);
	const session = Object.keys(await fakeTranscodes()).find((id) => !before.has(id))!;
	const response = await page.request.delete(`/api/playback/${body.playbackId}`, {
		headers: { origin: 'http://localhost:4173' }
	});
	expect(response.status()).toBe(204);
	await expect.poll(() => stopped(session)).toBe(true);
	expect((await page.request.get(body.src)).status()).toBe(404);
});
