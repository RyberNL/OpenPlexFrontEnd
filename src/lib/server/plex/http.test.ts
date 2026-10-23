import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakePms } from '../../../../test/fake-pms/server';
import {
	PlexNotFoundError,
	PlexResponseError,
	PlexUnauthorizedError,
	PlexUnreachableError
} from './errors';
import { buildUrl, plexFetch, plexId, plexJson } from './http';
import { toLibrary, toMediaItem } from './normalize';
import { containerSchema, identitySchema, sectionsSchema } from './schemas';

const identity = { clientIdentifier: 'test-client', deviceName: 'Vitest' };
const fixture = (name: string) =>
	JSON.parse(fs.readFileSync(path.resolve('test/fixtures/plex', name), 'utf8'));

const pms = createFakePms();
let base: string;

beforeAll(async () => {
	base = `http://127.0.0.1:${await pms.listen()}`;
});
afterAll(() => pms.close());

describe('plex http client', () => {
	it('sends the standard X-Plex headers and token', async () => {
		await plexJson(base, '/library/sections', sectionsSchema, { identity, token: 'owner-token' });
		const request = pms.state.requests.at(-1)!;
		expect(request.token).toBe('owner-token');
		expect(request.headers).toMatchObject({
			accept: 'application/json',
			'x-plex-product': 'Plex Web',
			'x-plex-client-identifier': 'test-client',
			'x-plex-device-name': 'Vitest',
			'x-plex-platform': 'Web'
		});
	});

	it('validates responses into typed data', async () => {
		const result = await plexJson(base, '/identity', identitySchema, { identity });
		expect(result.MediaContainer.version).toBe('1.43.5.11029-6bf8af3f0');
		const sections = await plexJson(base, '/library/sections', sectionsSchema, {
			identity,
			token: 'owner-token'
		});
		expect(sections.MediaContainer.Directory!.map(toLibrary).filter(Boolean)).toEqual([
			{ id: '1', type: 'movie', title: 'Films' },
			{ id: '2', type: 'show', title: 'Tv-series' }
		]);
	});

	it('throws PlexUnauthorizedError on 401', async () => {
		await expect(
			plexJson(base, '/library/sections', sectionsSchema, { identity, token: 'bad' })
		).rejects.toBeInstanceOf(PlexUnauthorizedError);
	});

	it('throws PlexNotFoundError on 404', async () => {
		await expect(
			plexFetch(base, '/library/metadata/999999999', { identity, token: 'owner-token' })
		).rejects.toBeInstanceOf(PlexNotFoundError);
	});

	it('throws PlexResponseError when the shape is unexpected', async () => {
		await expect(
			plexJson(base, '/library/sections', identitySchema, { identity, token: 'owner-token' })
		).rejects.toBeInstanceOf(PlexResponseError);
	});

	it('throws PlexUnreachableError when nothing listens', async () => {
		await expect(plexFetch('http://127.0.0.1:9', '/identity', { identity })).rejects.toBeInstanceOf(
			PlexUnreachableError
		);
	});

	it('throws PlexUnreachableError when the server drops connections', async () => {
		pms.state.online = false;
		try {
			await expect(
				plexFetch(base, '/library/sections', { identity, token: 'owner-token' })
			).rejects.toThrow(`Could not reach ${base}`);
		} finally {
			pms.state.online = true;
		}
	});

	it('times out when response headers do not arrive', async () => {
		const { createServer } = await import('node:http');
		const silent = createServer(() => {
			/* never respond */
		});
		await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
		const port = (silent.address() as { port: number }).port;
		const start = Date.now();
		await expect(
			plexFetch(`http://127.0.0.1:${port}`, '/identity', { identity, timeout: 200 })
		).rejects.toBeInstanceOf(PlexUnreachableError);
		expect(Date.now() - start).toBeLessThan(2000);
		silent.closeAllConnections();
		silent.close();
	});

	it('joins paths onto base URLs, keeping a base path prefix', () => {
		expect(buildUrl('http://pms:32400', '/library/sections').href).toBe(
			'http://pms:32400/library/sections'
		);
		expect(buildUrl('http://host/plextv/', '/api/v2/pins', { strong: false }).href).toBe(
			'http://host/plextv/api/v2/pins?strong=false'
		);
		expect(buildUrl('http://pms', '/:/timeline').pathname).toBe('/:/timeline');
	});

	it('rejects identifiers that could alter the request path', () => {
		expect(plexId(160)).toBe('160');
		for (const bad of ['../prefs', '160/../../', '1?x=1', '', 'abc']) {
			expect(() => plexId(bad)).toThrow(PlexNotFoundError);
		}
	});
});

describe('normalization of recorded responses', () => {
	it('normalizes a 4K HDR movie with streams, ratings and chapters', () => {
		const raw = containerSchema.parse(fixture('movie-detail.json')).MediaContainer.Metadata![0];
		const movie = toMediaItem(raw);
		expect(movie).toMatchObject({
			id: '160',
			type: 'movie',
			title: '2 Fast 2 Furious',
			year: 2003
		});
		expect(movie.genres).toContain('Action');
		expect(movie.cast[0]).toMatchObject({
			id: '2416',
			name: 'Paul Walker',
			role: "Brian O'Conner"
		});
		expect(movie.versions[0]).toMatchObject({ resolution: '4K', hdr: 'HDR10', audio: 'AC3 5.1' });
		// Only the file's name reaches the browser, not the server's folders.
		expect(movie.versions[0].parts[0].file).toBe('2 Fast 2 Furious (2003) Bluray-2160p.mkv');
		expect(movie.versions[0].parts[0].streams[0]).toMatchObject({ type: 'video', bitrate: 5454 });
		const streams = movie.versions[0].parts[0].streams;
		expect(streams.filter((s) => s.type === 'subtitle').some((s) => s.external)).toBe(true);
		expect(streams.find((s) => s.type === 'audio' && s.selected)).toBeTruthy();
		expect(movie.chapters[0]).toMatchObject({ index: 1, start: 0 });
		expect(movie.ratings.map((r) => r.source)).toContain('IMDb');
	});

	it('computes watched state for shows from leaf counts', () => {
		const shows = containerSchema
			.parse(fixture('section-shows-all.json'))
			.MediaContainer.Metadata!.map(toMediaItem);
		for (const show of shows) {
			expect(show.watched).toBe(!!show.leafCount && show.viewedLeafCount === show.leafCount);
		}
	});

	it('normalizes every recorded container without errors', () => {
		const dir = path.resolve('test/fixtures/plex');
		const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
		for (const entry of manifest) {
			const parsed = containerSchema.safeParse(fixture(entry.file));
			expect(parsed.success, `${entry.file}: ${parsed.error?.message}`).toBe(true);
			parsed.data?.MediaContainer.Metadata?.forEach((m) => toMediaItem(m));
		}
	});
});
