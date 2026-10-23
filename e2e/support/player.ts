import { expect, type Page } from '@playwright/test';

export const video = (page: Page) => page.getByTestId('video');

export async function currentTime(page: Page) {
	return video(page).evaluate((v: HTMLVideoElement) => v.currentTime);
}

/**
 * Waits until the video is actually playing, judged by its time advancing (WebKit's readyState
 * can lag behind), starting it muted if autoplay was blocked.
 */
export async function waitUntilPlaying(page: Page) {
	await expect(page.getByTestId('player')).toBeVisible();
	let last = -1;
	await expect
		.poll(
			async () => {
				const state = await video(page).evaluate((v: HTMLVideoElement) => {
					if (v.paused && v.readyState >= 1) {
						v.muted = true;
						void v.play().catch(() => {});
					}
					return v.currentTime;
				});
				const advancing = last >= 0 && state > last;
				last = state;
				return advancing;
			},
			{ timeout: 20_000, intervals: [250, 500, 500, 1000] }
		)
		.toBe(true);
}

export async function seekVideo(page: Page, seconds: number) {
	await video(page).evaluate((v: HTMLVideoElement, s) => {
		v.currentTime = s;
	}, seconds);
	await expect.poll(() => currentTime(page)).toBeGreaterThanOrEqual(seconds - 0.5);
}
