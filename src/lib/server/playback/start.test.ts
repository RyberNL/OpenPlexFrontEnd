import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakePms } from '../../../../test/fake-pms/server';
import { users } from '../db/schema';
import { pollLink, startLink } from '../plex/link';
import { plexFor, type PlexSession } from '../plex/session';
import { insertUser, testDb } from '../test-utils';
import { getPlayback } from './sessions';
import { startPlayback, type StartRequest } from './start';

const pms = createFakePms();
const db = testDb();
let base: string;
let plex: PlexSession;
let user: typeof users.$inferSelect;

const chrome = {
	containers: ['mp4'],
	video: ['h264'],
	audio: ['aac'],
	hdr: false,
	nativeHls: false,
	mse: true
};
const request = (overrides: Partial<StartRequest> = {}): StartRequest => ({
	ratingKey: '160',
	from: 'start',
	quality: 'original',
	caps: chrome,
	deviceId: 'device-0001',
	burnSubtitles: false,
	...overrides
});

beforeAll(async () => {
	process.env.PUBLIC_ORIGIN = 'https://plex.example.com';
	process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
	base = `http://127.0.0.1:${await pms.listen()}`;
	process.env.PLEX_TV_URL = `${base}/plextv`;
	await startLink(db, `${base}/plextv`, base);
	await fetch(`${base}/__fake/approve-pins`, { method: 'POST' });
	await pollLink(db, `${base}/plextv`);
	insertUser(db, { plexHomeUserUuid: pms.ownerUuid });
	user = db.select().from(users).all()[0];
	plex = plexFor(db, user);
});
afterAll(() => pms.close());
beforeEach(() => fetch(`${base}/__fake/clear-patches`, { method: 'POST' }));

const decisionQuery = () =>
	pms.state.requests.filter((r) => r.path === '/video/:/transcode/universal/decision').at(-1)!
		.query;

describe('startPlayback', () => {
	it('direct-plays a compatible MP4 at Original quality without asking PMS', async () => {
		const before = pms.state.requests.length;
		const info = await startPlayback(plex, user, 'app', request({ ratingKey: '157' }), null);
		expect(info).toMatchObject({ kind: 'file', method: 'directplay', quality: 'original' });
		expect(pms.state.requests.slice(before).some((r) => r.path.includes('decision'))).toBe(false);
	});

	it('honours a lower quality: HLS transcode with the preset bitrate and resolution', async () => {
		const info = await startPlayback(
			plex,
			user,
			'app',
			request({ ratingKey: '157', quality: '720p-2', offset: 754_000 }),
			null
		);
		expect(info).toMatchObject({
			kind: 'hls',
			method: 'transcode',
			reason: 'Quality set to 720p · 2 Mbps',
			startAt: 754_000,
			// The playlist covers the whole item; the transcoder starts at the offset.
			streamOffset: 0
		});
		expect(decisionQuery()).toMatchObject({
			maxVideoBitrate: '2000',
			videoResolution: '1280x720',
			directStream: '0',
			offset: '754'
		});
	});

	it('plays the picked version', async () => {
		const movie = JSON.parse(fs.readFileSync('test/fixtures/plex/movie-detail.json', 'utf8'))
			.MediaContainer.Metadata[0];
		const hd = {
			...movie.Media[0],
			id: 9001,
			Part: [{ ...movie.Media[0].Part[0], id: 9002, key: '/library/parts/9002/1/file.mp4' }]
		};
		await fetch(`${base}/__fake/patch-metadata`, {
			method: 'POST',
			body: JSON.stringify({
				token: 'owner-token',
				key: '160',
				fields: { Media: [movie.Media[0], hd] }
			})
		});
		const info = await startPlayback(plex, user, 'app', request({ version: 9001 }), null);
		expect(info.versionId).toBe(9001);
		expect(decisionQuery()).toMatchObject({ mediaIndex: '1' });
		expect(getPlayback(info.playbackId, 'app')).toMatchObject({
			partId: 9002,
			partKey: '/library/parts/9002/1/file.mp4'
		});
	});

	it('resumes from the saved position', async () => {
		await fetch(`${base}/__fake/patch-metadata`, {
			method: 'POST',
			body: JSON.stringify({
				token: 'owner-token',
				key: '157',
				fields: { viewOffset: 42 * 60_000 }
			})
		});
		const info = await startPlayback(
			plex,
			user,
			'app',
			request({ ratingKey: '157', from: 'resume' }),
			null
		);
		expect(info).toMatchObject({ startAt: 42 * 60_000, streamOffset: 0, kind: 'file' });
	});
});

describe('audio track selection', () => {
	const patch = (key: string, fields: unknown) =>
		fetch(`${base}/__fake/patch-metadata`, {
			method: 'POST',
			body: JSON.stringify({ token: 'owner-token', key, fields })
		});

	it('saves the choice in Plex for the item', async () => {
		const { setStreams, itemDetails } = await import('../plex/api');
		await setStreams(plex, 340, { audioStreamId: 771 });
		const audio = (await itemDetails(plex, '160'))!.versions[0].parts[0].streams.filter(
			(s) => s.type === 'audio'
		);
		expect(audio.find((s) => s.selected)?.id).toBe(771);
		expect(audio.find((s) => s.id === 770)?.selected).toBe(false);
	});

	it('streams another than the first audio track through PMS instead of direct play', async () => {
		const movie = JSON.parse(fs.readFileSync('test/fixtures/plex/movie-detail.json', 'utf8'))
			.MediaContainer.Metadata[0];
		// An MP4/H.264/AAC version the browser could direct-play, with two audio tracks.
		const media = {
			...movie.Media[0],
			container: 'mp4',
			videoCodec: 'h264',
			audioCodec: 'aac',
			Part: [
				{
					...movie.Media[0].Part[0],
					container: 'mp4',
					Stream: [
						{ id: 1, streamType: 1, codec: 'h264' },
						{ id: 2, streamType: 2, codec: 'aac', languageCode: 'ita', language: 'Italiano' },
						{
							id: 3,
							streamType: 2,
							codec: 'aac',
							languageCode: 'eng',
							language: 'English',
							selected: true
						}
					]
				}
			]
		};
		await patch('160', { Media: [media] });
		const info = await startPlayback(plex, user, 'app', request(), null);
		expect(info.kind).toBe('hls');
		expect(info.reason).toBe('The English audio track is streamed by the server');
	});

	it('uses the language chosen for one episode on the next episode of the show', async () => {
		const { setStreams, itemDetails } = await import('../plex/api');
		const episodes = JSON.parse(
			fs.readFileSync('test/fixtures/plex/show-all-episodes.json', 'utf8')
		).MediaContainer.Metadata;
		const [first, second] = episodes;
		const dual = (partId: number) => [
			{
				id: partId,
				videoResolution: '1080',
				Part: [
					{
						id: partId,
						key: `/library/parts/${partId}/1/file.mkv`,
						Stream: [
							{
								id: partId * 10 + 1,
								streamType: 2,
								codec: 'eac3',
								languageCode: 'eng',
								selected: true
							},
							{ id: partId * 10 + 2, streamType: 2, codec: 'eac3', languageCode: 'jpn' }
						]
					}
				]
			}
		];
		await patch(first.ratingKey, { Media: dual(7001) });
		await patch(second.ratingKey, { Media: dual(7002) });

		await setStreams(plex, 7001, { audioStreamId: 70012 });
		const next = await itemDetails(plex, second.ratingKey);
		const selected = next!.versions[0].parts[0].streams.find(
			(s) => s.type === 'audio' && s.selected
		);
		expect(selected?.languageCode).toBe('jpn');
	});
});

describe('image subtitles', () => {
	/** Movie 160 as a direct-playable MP4 whose selected subtitle is `subtitle`. */
	async function withSubtitle(subtitle: Record<string, unknown>) {
		const movie = JSON.parse(fs.readFileSync('test/fixtures/plex/movie-detail.json', 'utf8'))
			.MediaContainer.Metadata[0];
		const part = movie.Media[0].Part[0];
		const media = {
			...movie.Media[0],
			container: 'mp4',
			videoCodec: 'h264',
			audioCodec: 'aac',
			Part: [
				{
					...part,
					container: 'mp4',
					Stream: [
						{ id: 1, streamType: 1, codec: 'h264' },
						{ id: 2, streamType: 2, codec: 'aac', selected: true },
						{ id: 4, streamType: 3, selected: true, ...subtitle }
					]
				}
			]
		};
		await fetch(`${base}/__fake/patch-metadata`, {
			method: 'POST',
			body: JSON.stringify({ token: 'owner-token', key: '160', fields: { Media: [media] } })
		});
	}

	it('hands a PGS sidecar file to the browser and keeps direct play', async () => {
		await withSubtitle({ codec: 'pgs', key: '/library/streams/4' });
		const info = await startPlayback(plex, user, 'app', request(), null);
		expect(info).toMatchObject({
			kind: 'file',
			subtitle: { streamId: 4, codec: 'pgs', url: `/stream/${info.playbackId}/subtitles` }
		});
		expect(getPlayback(info.playbackId, 'app')).toMatchObject({
			subtitleMode: 'none',
			subtitle: { streamId: 4, delivery: 'file', image: true }
		});
	});

	it.each(['pgs', 'vobsub', 'dvb_subtitle'])(
		'burns an embedded %s subtitle in on the server',
		async (codec) => {
			await withSubtitle({ codec });
			const info = await startPlayback(plex, user, 'app', request(), null);
			expect(info).toMatchObject({
				kind: 'hls',
				subtitle: null,
				reason: 'Image subtitles are burned into the video by the server'
			});
			expect(decisionQuery().subtitles).toBe('burn');
			expect(getPlayback(info.playbackId, 'app')?.subtitleMode).toBe('burn');
		}
	);
});
