import { expect, test } from './support/test';
import { fakePms } from './support/fake-pms';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { currentTime, seekVideo, video, waitUntilPlaying } from './support/player';

test.afterEach(() => fakePms('clear-patches'));
// Other tests may have left positions or watch state behind on the fake server.
test.beforeEach(() => fakePms('clear-patches'));
test.beforeEach(async ({ context }) => {
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});

test('an MP4 is direct-played and its title is shown', async ({ page }) => {
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await expect(page.getByTestId('player-title')).toHaveText('12 Strong');
	expect(await video(page).evaluate((v: HTMLVideoElement) => v.currentSrc)).toMatch(
		/\/stream\/[\w-]+\/file$/
	);
});

test('an HEVC movie plays through HLS', async ({ page }) => {
	await page.goto('/watch/160?from=start');
	await waitUntilPlaying(page);
	await expect(page.getByTestId('player-title')).toHaveText('2 Fast 2 Furious');
});

test('the right arrow key jumps forward 10 seconds', async ({ page }) => {
	test.skip(test.info().project.name.endsWith('mobile'), 'Keyboard shortcuts are for desktop');
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await seekVideo(page, 5);
	const before = await currentTime(page);
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => currentTime(page)).toBeGreaterThanOrEqual(before + 9.5);
	const after = await currentTime(page);
	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => currentTime(page)).toBeLessThan(after - 8);
});

test('double-tapping the left side jumps back 10 seconds', async ({ page }) => {
	test.skip(!test.info().project.name.endsWith('mobile'), 'Touch gestures are for touch devices');
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await seekVideo(page, 20);
	const surface = page.getByTestId('gesture-surface');
	const box = (await surface.boundingBox())!;
	const point = { x: box.x + box.width * 0.2, y: box.y + box.height / 2 };
	await page.touchscreen.tap(point.x, point.y);
	await page.touchscreen.tap(point.x, point.y);
	await expect.poll(() => currentTime(page)).toBeLessThan(13);
});

test('a single tap toggles the controls on touch devices', async ({ page }) => {
	test.skip(!test.info().project.name.endsWith('mobile'), 'Touch gestures are for touch devices');
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	const controls = page.getByTestId('controls');
	const surface = (await page.getByTestId('gesture-surface').boundingBox())!;
	const visible = await controls.getAttribute('data-visible');
	await page.touchscreen.tap(surface.x + surface.width / 2, surface.y + surface.height / 2);
	await expect(controls).not.toHaveAttribute('data-visible', visible!);
});

test('playback speed can be changed up to 3×', async ({ page }) => {
	await page.goto('/watch/157?from=start');
	await waitUntilPlaying(page);
	await page.getByRole('button', { name: 'Playback speed' }).click();
	await page.getByRole('menuitemradio', { name: '1.5×' }).click();
	expect(await video(page).evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5);
	await expect(page.getByTestId('speed')).toHaveText('1.5×');
	await page.getByRole('button', { name: 'Playback speed' }).click();
	await expect(page.getByRole('menuitemradio')).toHaveCount(12);
	await page.getByRole('menuitemradio', { name: '3×' }).click();
	expect(await video(page).evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(3);
});

test('the back button returns to the previous page', async ({ page }) => {
	await page.goto('/item/157');
	await page.getByRole('link', { name: 'Play', exact: true }).click();
	await expect(page).toHaveURL('/watch/157?from=start');
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await expect(page).toHaveURL('/item/157');
});
