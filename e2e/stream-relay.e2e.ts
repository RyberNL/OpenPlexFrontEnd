import { expect, test } from './support/test';
import { FAKE_PMS_PORT } from '../playwright.config';
import { fakePms } from './support/fake-pms';
import { signInAs } from './support/auth';
import { mapToPlexOwner, seedUser } from './support/db';
import { startPlayback } from './support/playback';

const FORBIDDEN = [/x-plex-token/i, /owner-token/, /home-token-/, new RegExp(`:${FAKE_PMS_PORT}`)];

function assertNoSecrets(label: string, text: string) {
	for (const pattern of FORBIDDEN) expect(text, `${label} matches ${pattern}`).not.toMatch(pattern);
}

test.afterEach(() => fakePms('clear-patches'));
// Other tests may have left positions or watch state behind on the fake server.
test.beforeEach(() => fakePms('clear-patches'));
test.beforeEach(async ({ context }) => {
	test.skip(
		test.info().project.name !== 'chromium-desktop',
		'API-level test; one project is enough'
	);
	const user = await seedUser();
	mapToPlexOwner(user.id);
	await signInAs(context, user.id);
});

test('an H.264/AAC MP4 is direct-played through the relay with range requests', async ({
	page
}) => {
	const { status, body } = await startPlayback(page.request, '157');
	expect(status).toBe(200);
	expect(body).toMatchObject({ kind: 'file', method: 'directplay', methodLabel: 'Direct play' });
	expect(body.src).toMatch(/^\/stream\/[\w-]+\/file$/);
	assertNoSecrets('start response', JSON.stringify(body));

	const response = await page.request.get(body.src, { headers: { Range: 'bytes=0-1023' } });
	expect(response.status()).toBe(206);
	expect(response.headers()['content-type']).toBe('video/mp4');
	expect(response.headers()['content-range']).toMatch(/^bytes 0-1023\/\d+$/);
	expect((await response.body()).length).toBe(1024);
	assertNoSecrets('file headers', JSON.stringify(response.headers()));
});

test('an HEVC MKV is streamed as HLS: playlists and segments only via the relay', async ({
	page
}) => {
	const { body } = await startPlayback(page.request, '160');
	expect(body).toMatchObject({ kind: 'hls', method: 'transcode' });
	expect(body.reason).toBe('HEVC video is not supported by this browser');

	const master = await (await page.request.get(body.src)).text();
	assertNoSecrets('master', master);
	const variant = master.split('\n').find((l) => l.startsWith('/stream/'))!;
	expect(variant).toMatch(
		new RegExp(`^/stream/${body.playbackId}/hls/session/[\\w-]+/base/index\\.m3u8$`)
	);

	const variantText = await (await page.request.get(variant)).text();
	assertNoSecrets('variant', variantText);
	const segments = variantText.split('\n').filter((l) => l && !l.startsWith('#'));
	expect(segments).toHaveLength(120);
	for (const segment of segments)
		expect(segment).toMatch(/^\/stream\/[\w-]+\/hls\/session\/.+\/\d{5}\.ts$/);

	const segment = await page.request.get(segments[1]);
	expect(segment.status()).toBe(200);
	expect(segment.headers()['content-type']).toBe('video/mp2t');
	expect((await segment.body()).length).toBeGreaterThan(1000);
});

test('stream URLs are useless to other sessions and outside the transcode session', async ({
	page,
	browser
}) => {
	const { body } = await startPlayback(page.request, '160');
	const master = await (await page.request.get(body.src)).text();
	const variant = master.split('\n').find((l) => l.startsWith('/stream/'))!;

	const other = await browser.newContext();
	const otherUser = await seedUser();
	mapToPlexOwner(otherUser.id);
	await signInAs(other, otherUser.id);
	expect((await other.request.get(body.src)).status()).toBe(404);
	expect((await other.request.get(variant)).status()).toBe(404);
	expect((await other.request.get(`/stream/${body.playbackId}/file`)).status()).toBe(404);

	const traversal = `/stream/${body.playbackId}/hls/session/other-session/base/index.m3u8`;
	expect((await page.request.get(traversal)).status()).toBe(404);
	expect(
		(await page.request.get(`/stream/${body.playbackId}/hls/..%2F..%2F:%2Fprefs`)).status()
	).toBe(404);
});

test('stream URLs require a signed-in session', async ({ page, playwright }) => {
	const { body } = await startPlayback(page.request, '157');
	const anonymous = await playwright.request.newContext({ baseURL: 'http://localhost:4173' });
	expect((await anonymous.get(body.src)).status()).toBe(401);
	await anonymous.dispose();
});

test('a cast URL plays without the session cookie, with CORS, until the playback ends', async ({
	page,
	playwright
}) => {
	const { body } = await startPlayback(page.request, '160');
	const origin = 'http://localhost:4173';
	const cast = await page.request.post(`/api/playback/${body.playbackId}/cast`, {
		headers: { origin }
	});
	expect(cast.status()).toBe(200);
	const { src, contentType } = await cast.json();
	expect(contentType).toBe('application/x-mpegurl');
	expect(src).toMatch(/^http:\/\/localhost:\d+\/stream\/cast_[\w-]{32}\/master\.m3u8$/);

	// A Chromecast or Apple TV: no cookie, and (Chromecast) a cross-origin page.
	const tv = await playwright.request.newContext();
	const preflight = await tv.fetch(src, {
		method: 'OPTIONS',
		headers: { origin: 'https://www.gstatic.com', 'access-control-request-method': 'GET' }
	});
	expect(preflight.status()).toBe(204);
	expect(preflight.headers()['access-control-allow-origin']).toBe('*');

	const master = await tv.get(src, { headers: { origin: 'https://www.gstatic.com' } });
	expect(master.status()).toBe(200);
	expect(master.headers()['access-control-allow-origin']).toBe('*');
	const masterText = await master.text();
	assertNoSecrets('cast master', masterText);
	const castId = new URL(src).pathname.split('/')[2];
	const variant = masterText.split('\n').find((l) => l.startsWith('/stream/'))!;
	expect(variant.startsWith(`/stream/${castId}/hls/`)).toBe(true);
	const variantText = await (await tv.get(new URL(variant, src).href)).text();
	const segment = variantText.split('\n').find((l) => l && !l.startsWith('#'))!;
	expect(segment.startsWith(`/stream/${castId}/hls/`)).toBe(true);
	expect((await tv.get(new URL(segment, src).href)).status()).toBe(200);

	// The cast id opens only the stream, not the playback's API.
	const timeline = new URL(`/api/playback/${castId}/timeline`, src).href;
	expect((await tv.post(timeline, { headers: { origin } })).status()).toBe(401);

	await page.request.delete(`/api/playback/${body.playbackId}`, { headers: { origin } });
	expect((await tv.get(src)).status()).toBe(404);
	expect((await tv.get(new URL('/stream/cast_unknown/master.m3u8', src).href)).status()).toBe(404);
	await tv.dispose();
});
