import { expect, test, type Page } from './support/test';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { fakePms, fakeTuner } from './support/fake-pms';

test.beforeEach(async ({ context }) => {
	test.skip(!test.info().project.name.endsWith('desktop'), 'One viewport per engine is enough');
	await fakePms('free-tuner');
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});
test.afterEach(() => fakePms('free-tuner'));

/** Waits until the live video's time advances. */
async function waitUntilLive(page: Page) {
	const video = page.getByTestId('video');
	let last = -1;
	await expect
		.poll(
			async () => {
				const t = await video.evaluate((v: HTMLVideoElement) => {
					if (v.paused && v.readyState >= 1) {
						v.muted = true;
						void v.play().catch(() => {});
					}
					return v.currentTime;
				});
				const advancing = last >= 0 && t > last;
				last = t;
				return advancing;
			},
			{ timeout: 20_000, intervals: [250, 500, 500, 1000] }
		)
		.toBe(true);
}

const tunedChannel = async () => (await fakeTuner()).tuner?.channel ?? null;

test('watching a channel tunes it and shows the current program', async ({ page }) => {
	await page.goto('/live');
	await page.getByRole('link', { name: /^Watch .*NPO 1 HD/ }).click();
	await expect(page).toHaveURL('/watch/live/1032');
	await waitUntilLive(page);
	await expect(page.getByTestId('live-channel')).toContainText('1032');
	await expect(page.getByTestId('live-program')).not.toBeEmpty();
	await expect(page.getByTestId('live-badge')).toHaveText('LIVE');
	expect(await tunedChannel()).toBe('1032');
	expect((await fakeTuner()).tunes.at(-1)?.client).toMatch(/^plex-web-/);

	// Back within the app (no page unload) frees the tuner too.
	await page.getByRole('button', { name: 'Back' }).click();
	await expect(page).toHaveURL('/live');
	await expect.poll(tunedChannel).toBeNull();
});

test('when the server ends the stream, the player frees the tuner and Try again tunes afresh', async ({
	page
}) => {
	await page.goto('/watch/live/1032');
	await waitUntilLive(page);

	const released = page.waitForRequest(
		(r) => r.method() === 'DELETE' && /\/api\/playback\/[^/]+$/.test(r.url())
	);
	await fakePms('end-live');
	await expect(page.getByTestId('live-error')).toHaveText('The stream was interrupted.', {
		timeout: 30_000
	});
	await released;

	await page.getByRole('button', { name: 'Try again' }).click();
	await waitUntilLive(page);
	const tunes = (await fakeTuner()).tunes;
	expect(tunes.map((t) => [t.channel, t.ok])).toEqual([
		['1032', true],
		['1032', true]
	]);
	expect(await tunedChannel()).toBe('1032');
});

test('with the tuner in use, the player says so and does not play', async ({ page }) => {
	await fakePms('occupy-tuner');
	await page.goto('/watch/live/1032');
	await expect(page.getByRole('alert')).toContainText('No tuner available right now');
	await expect(page.getByTestId('live-badge')).toHaveCount(0);
	// The other device keeps its tuner.
	expect(await tunedChannel()).toBe('1000');
});

test('leaving the live player with a page load frees the tuner', async ({ page }) => {
	await page.goto('/live');
	await page.goto('/watch/live/1033');
	await waitUntilLive(page);
	expect(await tunedChannel()).toBe('1033');
	await page.getByRole('button', { name: 'Back' }).click();
	await expect(page).toHaveURL('/live');
	await expect.poll(tunedChannel).toBeNull();
});

test('channel up tunes the next channel after freeing the tuner', async ({ page }) => {
	await page.goto('/watch/live/1032');
	await waitUntilLive(page);
	await page.getByRole('button', { name: 'Next channel' }).click();
	await expect(page).toHaveURL('/watch/live/1033');
	await waitUntilLive(page);
	expect(await tunedChannel()).toBe('1033');
	// With one tuner, the switch only works if the first channel was released first.
	const tunes = (await fakeTuner()).tunes;
	expect(tunes.map((t) => [t.channel, t.ok])).toEqual([
		['1032', true],
		['1033', true]
	]);

	// The channel overlay switches too.
	await page.getByRole('button', { name: 'Channels' }).click();
	await page
		.getByRole('dialog', { name: 'Channels' })
		.getByRole('button', { name: /RTL 4/ })
		.click();
	await expect(page).toHaveURL('/watch/live/1035');
	await expect.poll(tunedChannel).toBe('1035');
});

test('pausing falls behind live, and Go live catches up', async ({ page }) => {
	await page.goto('/watch/live/1034');
	await waitUntilLive(page);
	await expect(page.getByTestId('live-badge')).toBeVisible();
	await page.getByRole('button', { name: 'Pause' }).click();
	await expect(page.getByTestId('behind')).toBeVisible({ timeout: 20_000 });
	await page.getByRole('button', { name: 'Go live' }).click();
	await expect(page.getByTestId('live-badge')).toBeVisible({ timeout: 10_000 });
});
