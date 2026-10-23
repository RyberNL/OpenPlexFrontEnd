import type { APIRequestContext } from '@playwright/test';

/** A typical desktop Chrome: plays H.264/AAC MP4 directly, nothing else. */
export const CHROME_CAPS = {
	containers: ['mp4', 'webm'],
	video: ['h264', 'vp9', 'av1'],
	audio: ['aac', 'mp3', 'opus'],
	hdr: false,
	nativeHls: false,
	mse: true
};

export async function startPlayback(
	request: APIRequestContext,
	ratingKey: string,
	extra: Record<string, unknown> = {}
) {
	const response = await request.post('/api/playback', {
		data: { ratingKey, caps: CHROME_CAPS, deviceId: 'e2e-device-0001', ...extra },
		headers: { origin: 'http://localhost:4173' }
	});
	return { status: response.status(), body: await response.json() };
}
