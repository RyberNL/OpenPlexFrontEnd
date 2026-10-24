/**
 * A fake Plex Media Server (plus a plex.tv mock under /plextv) for tests. It serves JSON fixtures
 * recorded from a real PMS (see scripts/record-plex-fixtures.mjs) and keeps a little mutable state
 * so tests can assert on what the app sent.
 *
 *   node test/fake-pms/server.ts            # listens on FAKE_PMS_PORT (default 32499)
 *
 * Tokens: `owner-token` is the linked owner's server token; `home-token-<uuid>.<generation>` are
 * per-Plex-Home-user server tokens (a new generation is issued on every switch). Anything else gets 401. Control endpoints live under /__fake/.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

type ManifestEntry = { method: string; path: string; query: Record<string, string>; file: string };

export type RecordedRequest = {
	method: string;
	path: string;
	query: Record<string, string>;
	token: string | null;
	headers: Record<string, string>;
	body?: string;
};

export type FakePmsOptions = { fixturesDir?: string; port?: number };

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/plex');
const OWNER_TOKEN = 'owner-token';
const OWNER_ACCOUNT_TOKEN = 'owner-account-token';
const PIXEL = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64'
);

/** Mutable state, reset with POST /__fake/reset. */
function initialState() {
	return {
		online: true,
		requests: [] as RecordedRequest[],
		revokedTokens: new Set<string>(),
		/** `${token}:${ratingKey}` → watched flag set via scrobble/unscrobble. */
		watched: new Map<string, boolean>(),
		pins: new Map<number, { code: string; approved: boolean }>(),
		/** Test patches merged into /library/metadata/<key> responses: `${token}:${key}` → fields. */
		patches: new Map<string, Record<string, unknown>>(),
		/** `${token}:${partId}` → chosen stream ids (PUT /library/parts/<id>). */
		streamChoices: new Map<string, { audio?: string; subtitle?: string }>(),
		/** `${token}:${showKey}` → languages chosen in that show, applied to its other episodes. */
		showLanguages: new Map<string, { audio?: string; subtitle?: string | null }>(),
		/** Make the transcoder fail (HLS start returns 500). */
		failTranscode: false,
		/** Pretend no DVR is configured (`/livetv/dvrs` empty). */
		noDvr: false,
		/** The DVR's single tuner: which grab holds it (a one-tuner DVR, like many IPTV setups). */
		tuner: null as null | { grabKey: string; channel: string; ratingKey: string },
		/** Every tune request, for assertions. */
		tunes: [] as { channel: string; client: string; ok: boolean }[],
		liveItems: 0,
		/** HLS transcode sessions started (and stopped) by the app. */
		transcodes: new Map<
			string,
			{ query: Record<string, string>; stopped: boolean; startedAt: number }
		>(),
		/** Timeline reports received, newest last. */
		timelines: [] as Record<string, string>[],
		/** `${token}:${ratingKey}` → view offset (ms) from timeline reports. */
		offsets: new Map<string, number>(),
		/** Switch count per Home user; each switch issues a new server token generation. */
		tokenGenerations: new Map<string, number>(),
		nextPinId: 1000
	};
}

function readJson(dir: string, file: string) {
	return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

export function createFakePms({ fixturesDir = FIXTURES }: FakePmsOptions = {}) {
	const manifest: ManifestEntry[] = readJson(fixturesDir, 'manifest.json');
	const identity = readJson(fixturesDir, 'identity.json');
	const machineIdentifier: string = identity.MediaContainer.machineIdentifier;
	type HomeUser = {
		uuid: string;
		title: string;
		admin: boolean;
		protected: boolean;
		restricted?: boolean;
	};
	const recordedHomeUsers: HomeUser[] = readJson(fixturesDir, 'plextv-home-users.json').users ?? [];
	const owner = recordedHomeUsers.find((u) => u.admin) ?? recordedHomeUsers[0];
	/** The recorded owner plus two managed users for multi-user tests (Anna's PIN is 1234). */
	const homeUsers: HomeUser[] = [
		...recordedHomeUsers,
		{ uuid: 'home-anna', title: 'Anna', admin: false, protected: true, restricted: false },
		{ uuid: 'home-ben', title: 'Ben', admin: false, protected: false, restricted: true }
	];
	let state = initialState();

	const isServerToken = (token: string | null) =>
		!!token &&
		!state.revokedTokens.has(token) &&
		(token === OWNER_TOKEN || token.startsWith('home-token-'));

	function findFixture(method: string, pathname: string, query: Record<string, string>) {
		const candidates = manifest.filter((e) => e.method === method && e.path === pathname);
		let best: ManifestEntry | undefined;
		let bestScore = -1;
		for (const entry of candidates) {
			const keys = Object.keys(entry.query).filter((k) => !k.startsWith('X-Plex-'));
			const score = keys.filter((k) => query[k] === entry.query[k]).length;
			if (score > bestScore) {
				best = entry;
				bestScore = score;
			}
		}
		return best;
	}

	/** Episode keys below a recorded show or season. */
	function descendants(key: string): string[] {
		const episodes = (file: string): Item[] =>
			readJson(fixturesDir, file).MediaContainer.Metadata ?? [];
		const season = readJson(fixturesDir, 'season-episodes.json').MediaContainer;
		const all = episodes('show-all-episodes.json');
		if (all.some((e) => e.grandparentRatingKey === key)) return all.map((e) => e.ratingKey);
		if (
			String(season.key ?? '').includes(`/${key}/`) ||
			episodes('season-episodes.json').some((e) => e.parentRatingKey === key)
		) {
			return episodes('season-episodes.json').map((e) => e.ratingKey);
		}
		return [];
	}

	type Stream = {
		id: number | string;
		streamType: number;
		languageCode?: string;
		selected?: boolean;
	};
	type Part = { id: number | string; Stream?: Stream[] };

	/** The item (and part) a part id belongs to, searched in recorded details and patches. */
	function findPartOwner(partId: string) {
		const candidates: Item[] = [];
		for (const key of ['160', '12500', ...[...state.patches.keys()].map((k) => k.split(':')[1])]) {
			const item = metadataItem(key);
			if (item) candidates.push({ ...item, ...(state.patches.get(`owner-token:${key}`) ?? {}) });
		}
		for (const item of candidates) {
			for (const media of (item.Media as { Part?: Part[] }[] | undefined) ?? []) {
				const part = media.Part?.find((p) => String(p.id) === partId);
				if (part)
					return {
						item,
						part,
						grandparentRatingKey: item.grandparentRatingKey as string | undefined
					};
			}
		}
		return null;
	}

	/** Applies chosen streams (per part, or the show's languages) to an item's parts. */
	function applyStreamChoices(item: Record<string, unknown>, token: string) {
		const show = item.grandparentRatingKey
			? state.showLanguages.get(`${token}:${item.grandparentRatingKey}`)
			: undefined;
		for (const media of (item.Media as { Part?: Part[] }[] | undefined) ?? []) {
			for (const part of media.Part ?? []) {
				const choice = state.streamChoices.get(`${token}:${part.id}`);
				if (!choice && !show) continue;
				const pick = (type: number, id?: string, language?: string | null) => {
					const streams = (part.Stream ?? []).filter((x) => x.streamType === type);
					const target =
						id !== undefined
							? streams.find((x) => String(x.id) === id)
							: language
								? streams.find((x) => x.languageCode === language)
								: undefined;
					if (id === '0' || language === null) streams.forEach((x) => delete x.selected);
					else if (target)
						streams.forEach((x) => (x === target ? (x.selected = true) : delete x.selected));
				};
				pick(2, choice?.audio, choice?.audio ? undefined : show?.audio);
				pick(3, choice?.subtitle, choice?.subtitle !== undefined ? undefined : show?.subtitle);
			}
		}
	}

	/** Overlays this token's scrobble/unscrobble changes onto items in a response. */
	function applyWatched(body: unknown, token: string): unknown {
		if (Array.isArray(body)) return body.map((b) => applyWatched(b, token));
		if (!body || typeof body !== 'object') return body;
		const item = Object.fromEntries(
			Object.entries(body).map(([k, v]) => [k, applyWatched(v, token)])
		) as Record<string, unknown>;
		if (typeof item.ratingKey === 'string' && Array.isArray(item.Media))
			applyStreamChoices(item, token);
		const offset =
			typeof item.ratingKey === 'string' && state.offsets.get(`${token}:${item.ratingKey}`);
		if (offset) item.viewOffset = offset;
		const watched =
			typeof item.ratingKey === 'string' && state.watched.get(`${token}:${item.ratingKey}`);
		if (watched === true) {
			item.viewCount = Math.max(1, Number(item.viewCount ?? 0));
			delete item.viewOffset;
		} else if (watched === false) {
			delete item.viewCount;
			delete item.viewOffset;
		}
		return item;
	}

	type Item = Record<string, unknown> & {
		ratingKey: string;
		title: string;
		titleSort?: string;
		viewCount?: number;
		leafCount?: number;
		viewedLeafCount?: number;
		Genre?: { tag: string }[];
		Media?: { videoResolution?: string }[];
	};

	/** All items of a section: the recorded page, padded to the recorded total with copies. */
	function sectionItems(sectionId: string): Item[] | null {
		const file = { '1': 'section-movies-page-200.json', '2': 'section-shows-page-200.json' }[
			sectionId
		];
		if (!file) return null;
		const container = readJson(fixturesDir, file).MediaContainer;
		const recorded: Item[] = container.Metadata ?? [];
		const total: number = container.totalSize ?? recorded.length;
		// Synthetic fillers get titles spread over A–Z so alphabetical jumps have targets.
		return Array.from({ length: total }, (_, i) => {
			if (i < recorded.length) return recorded[i];
			const source = recorded[i % recorded.length];
			const title = `${String.fromCharCode(65 + (i % 26))} – ${source.title}`;
			return { ...source, ratingKey: String(900000 + i), title, titleSort: title };
		});
	}

	function filterItems(sectionId: string, items: Item[], query: Record<string, string>) {
		let result = items;
		if (query.unwatched === '1') {
			result = result.filter((m) =>
				m.leafCount !== undefined ? (m.viewedLeafCount ?? 0) < m.leafCount : !m.viewCount
			);
		}
		if (query.genre) {
			const label = sectionId === '1' ? 'movies' : 'shows';
			const genres = readJson(fixturesDir, `section-${label}-genres.json`).MediaContainer.Directory;
			const tag = genres.find((g: { key: string }) => g.key === query.genre)?.title;
			result = result.filter((m) => m.Genre?.some((g) => g.tag === tag));
		}
		if (query.year) result = result.filter((m) => String(m.year) === query.year);
		if (query.contentRating) result = result.filter((m) => m.contentRating === query.contentRating);
		if (query.resolution) {
			result = result.filter((m) => m.Media?.[0]?.videoResolution === query.resolution);
		}
		return result;
	}

	function sortItems(items: Item[], sort = 'titleSort') {
		const [field, direction = field === 'titleSort' ? 'asc' : 'desc'] = sort.split(':');
		const key = (m: Item) =>
			field === 'titleSort' ? String(m.titleSort ?? m.title).toLowerCase() : (m[field] ?? 0);
		const sign = direction === 'desc' ? -1 : 1;
		return [...items].sort((a, b) => {
			const x = key(a) as string | number;
			const y = key(b) as string | number;
			return x < y ? -sign : x > y ? sign : 0;
		});
	}

	function firstCharacter(m: Item) {
		const c = String(m.titleSort ?? m.title)
			.charAt(0)
			.toUpperCase();
		return /[A-Z]/.test(c) ? c : '#';
	}

	/**
	 * Synthetic collections and playlists (the recorded server has none), built from real recorded
	 * movies. Includes an audio playlist to check that the app filters it out.
	 */
	function synthetic() {
		const movies = sectionItems('1')!.slice(0, 12);
		const collection = (key: string, title: string, items: Item[]) => ({
			ratingKey: key,
			key: `/library/collections/${key}/children`,
			type: 'collection',
			subtype: 'movie',
			title,
			childCount: items.length,
			thumb: items[0].thumb,
			art: items[0].art,
			summary: `Test collection: ${title}`,
			items
		});
		const playlist = (key: string, title: string, playlistType: string, items: Item[]) => ({
			ratingKey: key,
			key: `/playlists/${key}/items`,
			type: 'playlist',
			playlistType,
			title,
			smart: false,
			leafCount: items.length,
			duration: items.reduce((sum, m) => sum + Number(m.duration ?? 0), 0),
			composite: items[0]?.thumb,
			items
		});
		return {
			collections: [
				collection('880001', 'Fast & Furious', movies.slice(0, 4)),
				collection('880002', 'Weekend Picks', movies.slice(4, 9))
			],
			playlists: [
				playlist('890001', 'Movie Night', 'video', [movies[9], movies[2], movies[7]]),
				playlist('890002', 'Road Trip Songs', 'audio', [])
			]
		};
	}

	function withoutItems<T extends { items: unknown }>(entry: T) {
		const rest: Record<string, unknown> = { ...entry };
		delete rest.items;
		return rest;
	}

	const matches = (text: unknown, q: string) =>
		!!q &&
		String(text ?? '')
			.toLowerCase()
			.includes(q.toLowerCase());

	/** Search over the recorded movies, shows, episodes, people and synthetic collections. */
	function search(q: string) {
		const recorded = readJson(fixturesDir, 'search-the.json').MediaContainer.Hub ?? [];
		const people = recorded
			.filter((h: { type: string }) => h.type === 'actor' || h.type === 'director')
			.flatMap((h: { Metadata?: Item[]; Directory?: Item[] }) => h.Metadata ?? h.Directory ?? []);
		const hub = (type: string, items: unknown[]) => ({
			hubIdentifier: type,
			title: type,
			type,
			size: items.length,
			Metadata: items.slice(0, 10)
		});
		const movies = sectionItems('1')!
			.slice(0, 200)
			.filter((m) => matches(m.title, q));
		const shows = sectionItems('2')!.filter((m) => matches(m.title, q));
		const episodes = (
			readJson(fixturesDir, 'show-all-episodes.json').MediaContainer.Metadata ?? []
		).filter((m: Item) => matches(m.title, q));
		const collections = synthetic()
			.collections.filter((c) => matches(c.title, q))
			.map(withoutItems);
		return {
			MediaContainer: {
				size: 5,
				Hub: [
					hub('movie', movies),
					hub('show', shows),
					hub('episode', episodes),
					// Like PMS, people come back as a Directory list.
					(({ Metadata, ...rest }) => ({ ...rest, Directory: Metadata }))(
						hub(
							'actor',
							people.filter((p: Item) => matches(p.tag ?? p.title, q))
						)
					),
					hub('collection', collections),
					hub('artist', [])
				]
			}
		};
	}

	/**
	 * The recorded 3-hour guide, moved to the current half hour and repeated every 3 hours so any
	 * window (e.g. 24 hours ahead) has programs. Per channel, each 3-hour block is made seamless:
	 * its first airing starts at the block start and its last one ends at the block end. Only
	 * airings overlapping [from, to] (s) are returned.
	 */
	function epgGrid(from: number, to: number) {
		const PERIOD = 3 * 3600;
		type Airing = { beginsAt: number; endsAt: number; channelIdentifier: string };
		const { recordedAt } = readJson(fixturesDir, 'livetv-recorded.json');
		const programs: Item[] = readJson(fixturesDir, 'epg-grid.json').MediaContainer.Metadata ?? [];
		const block = programs.map((program) =>
			((program.Media as Airing[]) ?? [])
				.filter((m) => m.endsAt > recordedAt && m.beginsAt < recordedAt + PERIOD)
				.map((m) => ({ ...m }))
		);
		const byChannel = new Map<string, Airing[]>();
		for (const m of block.flat()) {
			byChannel.set(m.channelIdentifier, [...(byChannel.get(m.channelIdentifier) ?? []), m]);
		}
		for (const list of byChannel.values()) {
			list.sort((a, b) => a.beginsAt - b.beginsAt);
			list[0].beginsAt = recordedAt;
			list.at(-1)!.endsAt = recordedAt + PERIOD;
		}
		const now = Math.floor(Date.now() / 1000);
		const base = now - (now % 1800) - recordedAt;
		const first = Math.floor((from - recordedAt - base) / PERIOD) - 1;
		const last = Math.ceil((to - recordedAt - base) / PERIOD) + 1;
		const metadata: Item[] = [];
		for (let k = first; k <= last; k++) {
			const shift = base + k * PERIOD;
			programs.forEach((program, i) => {
				const airings = block[i]
					.map((m) => ({ ...m, beginsAt: m.beginsAt + shift, endsAt: m.endsAt + shift }))
					.filter((m) => m.endsAt >= from && m.beginsAt <= to);
				if (airings.length) metadata.push({ ...program, Media: airings as Item['Media'] });
			});
		}
		return { MediaContainer: { size: metadata.length, Metadata: metadata } };
	}

	/**
	 * Guide search over the recorded programs. Airtimes are shifted so the earliest program starts
	 * ten minutes from now, keeping their spacing: recorded guide data would otherwise be in the past.
	 */
	function epgSearch(q: string) {
		const recorded = readJson(fixturesDir, 'epg-search-nieuws.json').MediaContainer.Hub ?? [];
		const starts = recorded.flatMap((h: { Metadata?: Item[] }) =>
			(h.Metadata ?? []).flatMap((m) =>
				((m.Media as { beginsAt?: number }[] | undefined) ?? []).map((x) => x.beginsAt ?? Infinity)
			)
		);
		const shift = Math.floor(Date.now() / 1000) + 600 - Math.min(...starts);
		const moved = (m: Item) => ({
			...m,
			Media: ((m.Media as { beginsAt: number; endsAt: number }[] | undefined) ?? []).map((x) => ({
				...x,
				beginsAt: x.beginsAt + shift,
				endsAt: x.endsAt + shift
			}))
		});
		return {
			MediaContainer: {
				size: recorded.length,
				Hub: recorded.map((h: { Metadata?: Item[] }) => {
					const found = (h.Metadata ?? []).filter((m) => matches(m.title, q)).map(moved);
					return { ...h, size: found.length, Metadata: found };
				})
			}
		};
	}

	/** Full details recorded for an item, or its entry from a recorded listing or hub. */
	function metadataItem(key: string): Item | null {
		for (const entry of manifest) {
			if (entry.path === `/library/metadata/${key}`) {
				return readJson(fixturesDir, entry.file).MediaContainer.Metadata?.[0] ?? null;
			}
		}
		for (const sectionId of ['1', '2']) {
			const found = sectionItems(sectionId)?.find((m) => m.ratingKey === key);
			if (found) return found;
		}
		const hubs = readJson(fixturesDir, 'hubs-home.json').MediaContainer.Hub ?? [];
		for (const hub of hubs) {
			const found = (hub.Metadata ?? []).find((m: Item) => m.ratingKey === key);
			if (found) return found;
		}
		for (const file of ['season-episodes.json', 'show-seasons.json', 'show-all-episodes.json']) {
			const list: Item[] = readJson(fixturesDir, file).MediaContainer.Metadata ?? [];
			const found = list.find((m) => m.ratingKey === key);
			if (found) return found;
		}
		return null;
	}

	function sectionListing(sectionId: string, query: Record<string, string>) {
		const all = sectionItems(sectionId);
		if (!all) return null;
		const items = sortItems(filterItems(sectionId, all, query), query.sort);
		const start = Number(query['X-Plex-Container-Start'] ?? 0);
		const size = Number(query['X-Plex-Container-Size'] ?? items.length);
		const page = items.slice(start, start + size);
		return {
			MediaContainer: { size: page.length, totalSize: items.length, offset: start, Metadata: page }
		};
	}

	function sectionFirstCharacters(sectionId: string, query: Record<string, string>) {
		const all = sectionItems(sectionId);
		if (!all) return null;
		const counts = new Map<string, number>();
		for (const m of filterItems(sectionId, all, query)) {
			counts.set(firstCharacter(m), (counts.get(firstCharacter(m)) ?? 0) + 1);
		}
		const keys = [...counts.keys()].sort((a, b) =>
			a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)
		);
		return {
			MediaContainer: {
				size: keys.length,
				Directory: keys.map((k) => ({ key: encodeURIComponent(k), title: k, size: counts.get(k) }))
			}
		};
	}

	const MEDIA_DIR = path.resolve(import.meta.dirname, '../fixtures/media');
	const HLS_SEGMENTS = 120;

	/** Cues of the test subtitle file, in seconds. */
	function srtCues() {
		const text = fs.readFileSync(path.join(MEDIA_DIR, 'subtitles.srt'), 'utf8');
		const toSeconds = (t: string) => {
			const [h, m, rest] = t.trim().split(':');
			return Number(h) * 3600 + Number(m) * 60 + Number(rest.replace(',', '.'));
		};
		return text
			.trim()
			.split(/\n\s*\n/)
			.map((block) => {
				const lines = block.split('\n');
				const [from, to] = lines[1].split('-->');
				return {
					start: toSeconds(from),
					end: toSeconds(to),
					text: lines
						.slice(2)
						.join('\n')
						.replace(/<[^>]+>/g, '')
				};
			});
	}

	function assTime(seconds: number) {
		const s = Math.max(0, seconds);
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return `${h}:${String(m).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
	}

	/** Serves a file with HTTP Range support, like PMS does for direct play. */
	function sendFile(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		file: string,
		type: string
	) {
		const size = fs.statSync(file).size;
		const range = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range ?? ''));
		if (range) {
			const start = range[1] ? Number(range[1]) : 0;
			const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
			res.writeHead(206, {
				'content-type': type,
				'content-length': end - start + 1,
				'content-range': `bytes ${start}-${end}/${size}`,
				'accept-ranges': 'bytes'
			});
			fs.createReadStream(file, { start, end }).pipe(res);
			return;
		}
		res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
		fs.createReadStream(file).pipe(res);
	}

	/** Media endpoints backed by the generated test clip (H.264/AAC, 30 s). */
	function mediaRoute(
		pathname: string,
		query: Record<string, string>,
		req: http.IncomingMessage,
		res: http.ServerResponse
	): void | false {
		if (/^\/library\/parts\/\d+\/\d+\/file(\.\w+)?$/.test(pathname)) {
			return sendFile(req, res, path.join(MEDIA_DIR, 'clip.mp4'), 'video/mp4');
		}
		const base = '/video/:/transcode/universal';
		if (pathname === `${base}/start.m3u8` && state.failTranscode) {
			return send(res, 500, { error: 'Transcoder failed' });
		}
		if (pathname === `${base}/start.m3u8`) {
			state.transcodes.set(query.session, { query, stopped: false, startedAt: Date.now() });
			res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
			res.end(
				[
					'#EXTM3U',
					'#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=300000,RESOLUTION=320x180',
					`session/${query.session}/base/index.m3u8`
				].join('\n') + '\n'
			);
			return;
		}
		const hls = new RegExp(
			`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/session/([^/]+)/base/(index\\.m3u8|\\d{5}\\.ts)$`
		).exec(pathname);
		if (hls) {
			const transcode = state.transcodes.get(hls[1]);
			if (!transcode || transcode.stopped) return send(res, 404, { error: 'No such session' });
			if (hls[2] === 'index.m3u8') {
				// A 12-minute stream looping the five 6 s test segments (discontinuities between
				// loops), so buffering can't swallow the whole stream. Token-bearing URIs exercise
				// the app's token stripping.
				// A live item (tuned channel) grows like PMS's live playlist: no end, one more segment
				// every 6 s since the stream started, starting with three.
				const live = /^\/library\/metadata\/77\d{4}$/.test(transcode.query.path ?? '');
				// Like PMS, a stream started at an offset still lists the item from 0:00 (the
				// transcoder starts at the offset; earlier segments are blank there), and the
				// player seeks to the offset. Long enough to play on from the offset.
				const count = live
					? Math.min(HLS_SEGMENTS, 3 + Math.floor((Date.now() - transcode.startedAt) / 6000))
					: HLS_SEGMENTS + Math.ceil(Number(transcode.query.offset ?? 0) / 6);
				const lines = [
					'#EXTM3U',
					'#EXT-X-VERSION:3',
					'#EXT-X-TARGETDURATION:6',
					'#EXT-X-MEDIA-SEQUENCE:0',
					...(live ? ['#EXT-X-PLAYLIST-TYPE:EVENT'] : [])
				];
				for (let i = 0; i < count; i++) {
					if (i > 0 && i % 5 === 0) lines.push('#EXT-X-DISCONTINUITY');
					lines.push(
						'#EXTINF:6.000000,',
						`${String(i).padStart(5, '0')}.ts?X-Plex-Token=owner-token`
					);
				}
				if (!live) lines.push('#EXT-X-ENDLIST');
				const playlist = lines.join('\n') + '\n';
				res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
				res.end(playlist);
				return;
			}
			const segment = Number(hls[2].slice(0, 5)) % 5;
			return sendFile(
				req,
				res,
				path.join(MEDIA_DIR, 'hls', `${String(segment).padStart(5, '0')}.ts`),
				'video/mp2t'
			);
		}
		if (pathname === `${base}/subtitles`) {
			// Like PMS: only for a running transcode session; the selected subtitle as ASS. Times are
			// item times (PMS keeps original timestamps with copyts=1).
			const transcode = state.transcodes.get(query.session);
			if (!transcode || transcode.stopped) return send(res, 400, { error: 'No session' });
			const offset = Number(query.offset ?? 0);
			const cues = srtCues().filter((c) => c.end > offset);
			const ass = [
				'[Script Info]',
				'ScriptType: v4.00+',
				'',
				'[Events]',
				'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
				...cues.map(
					(c) =>
						`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.text.replace(/\n/g, '\\N')}`
				)
			].join('\n');
			res.writeHead(200, { 'content-type': 'text/vtt' });
			res.end(ass + '\n');
			return;
		}
		if (/^\/library\/parts\/\d+\/indexes\/sd$/.test(pathname)) {
			// Preview thumbnails: the clip's BIF for every part (tests add `indexes: 'sd'`).
			res.writeHead(200, { 'content-type': 'application/octet-stream' });
			res.end(fs.readFileSync(path.join(MEDIA_DIR, 'clip.bif')));
			return;
		}
		if (/^\/library\/streams\/\d+$/.test(pathname)) {
			// Streams 1574 and 1575 are the styled ASS and PGS fixtures; other sidecars are the SRT.
			const file =
				{ '1574': 'styled.ass', '1575': 'subtitles.sup' }[pathname.split('/').at(-1)!] ??
				'subtitles.srt';
			res.writeHead(200, { 'content-type': 'text/plain' });
			res.end(fs.readFileSync(path.join(MEDIA_DIR, file)));
			return;
		}
		if (pathname === `${base}/stop`) {
			const transcode = state.transcodes.get(query.session);
			if (transcode) transcode.stopped = true;
			return send(res, 200);
		}
		if (pathname === '/:/timeline') {
			const token = (req.headers['x-plex-token'] as string | undefined) ?? query['X-Plex-Token'];
			state.timelines.push({
				...query,
				token: token ?? '',
				session: String(req.headers['x-plex-session-identifier'] ?? '')
			});
			// Like PMS, remember the position as the item's view offset for this user.
			if (query.ratingKey && query.time) {
				state.offsets.set(`${token}:${query.ratingKey}`, Number(query.time));
			}
			return send(res, 200);
		}
		return false;
	}

	function send(res: http.ServerResponse, status: number, body?: unknown) {
		res.writeHead(status, { 'content-type': 'application/json' });
		res.end(body === undefined ? '' : JSON.stringify(body));
	}

	function plextv(req: http.IncomingMessage, url: URL, res: http.ServerResponse) {
		const route = url.pathname.replace(/^\/plextv/, '');
		const token = (req.headers['x-plex-token'] as string) ?? url.searchParams.get('X-Plex-Token');

		if (req.method === 'POST' && route === '/api/v2/pins') {
			const id = state.nextPinId++;
			const code = `P${id}`.slice(-4);
			state.pins.set(id, { code, approved: false });
			return send(res, 201, { id, code, authToken: null, expiresIn: 900 });
		}
		const pin = /^\/api\/v2\/pins\/(\d+)$/.exec(route);
		if (req.method === 'GET' && pin) {
			const entry = state.pins.get(Number(pin[1]));
			if (!entry) return send(res, 404, { errors: [{ message: 'Not found' }] });
			return send(res, 200, {
				id: Number(pin[1]),
				code: entry.code,
				authToken: entry.approved ? OWNER_ACCOUNT_TOKEN : null
			});
		}

		const accountUser = token?.startsWith('home-user-token-')
			? token.slice('home-user-token-'.length)
			: token === OWNER_ACCOUNT_TOKEN
				? 'owner'
				: null;
		if (!accountUser) return send(res, 401, { errors: [{ message: 'Unauthorized' }] });

		if (req.method === 'GET' && route === '/api/v2/resources') {
			return send(res, 200, [
				{
					name: 'Fake PMS',
					provides: 'server',
					clientIdentifier: machineIdentifier,
					owned: accountUser === 'owner',
					accessToken:
						accountUser === 'owner'
							? OWNER_TOKEN
							: `home-token-${accountUser}.${state.tokenGenerations.get(accountUser) ?? 0}`
				}
			]);
		}
		if (req.method === 'GET' && route === '/api/v2/user') {
			return send(res, 200, {
				uuid: accountUser === 'owner' ? owner.uuid : accountUser,
				username: accountUser === 'owner' ? 'owner' : accountUser,
				title: accountUser === 'owner' ? 'Owner' : accountUser
			});
		}
		if (req.method === 'GET' && route === '/api/v2/home/users') {
			return send(res, 200, { users: homeUsers });
		}
		const sw = /^\/api\/v2\/home\/users\/([^/]+)\/switch$/.exec(route);
		if (req.method === 'POST' && sw) {
			const user = homeUsers.find((u) => u.uuid === sw[1]);
			if (!user) return send(res, 404, { errors: [{ message: 'Not found' }] });
			if (user.protected && url.searchParams.get('pin') !== '1234') {
				return send(res, 403, { errors: [{ message: 'Invalid PIN' }] });
			}
			state.tokenGenerations.set(user.uuid, (state.tokenGenerations.get(user.uuid) ?? 0) + 1);
			return send(res, 201, { authToken: `home-user-token-${user.uuid}` });
		}
		return send(res, 404, { errors: [{ message: 'Not found' }] });
	}

	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://fake-pms');
		const chunks: Buffer[] = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => {
			const query = Object.fromEntries(url.searchParams);
			const token =
				(req.headers['x-plex-token'] as string | undefined) ?? url.searchParams.get('X-Plex-Token');

			// Control endpoints for tests.
			if (url.pathname.startsWith('/__fake/')) {
				const action = url.pathname.slice('/__fake/'.length);
				if (action === 'requests') return send(res, 200, state.requests);
				if (action === 'transcodes') {
					return send(res, 200, Object.fromEntries(state.transcodes));
				}
				if (action === 'timelines') return send(res, 200, state.timelines);
				if (action === 'reset') {
					state = initialState();
					return send(res, 200, { ok: true });
				}
				if (action === 'offline') {
					state.online = false;
					return send(res, 200, { ok: true });
				}
				if (action === 'online') {
					state.online = true;
					return send(res, 200, { ok: true });
				}
				if (action === 'revoke-token') {
					state.revokedTokens.add(String(query.token));
					return send(res, 200, { ok: true });
				}
				if (action === 'patch-metadata') {
					// body: { token, key, fields }
					const { token: t, key, fields } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
					state.patches.set(`${t}:${key}`, fields);
					return send(res, 200, { ok: true });
				}
				if (action === 'tuner') return send(res, 200, { tuner: state.tuner, tunes: state.tunes });
				if (action === 'occupy-tuner') {
					// Another device is watching: the tuner is taken by a grab this app didn't make.
					state.tuner = {
						grabKey: '/media/grabbers/operations/1000-other-device',
						channel: '1000',
						ratingKey: '779999'
					};
					return send(res, 200, { ok: true });
				}
				if (action === 'end-live') {
					// PMS ends the tuner subscription by itself: the grab is gone and live streams stop.
					state.tuner = null;
					for (const transcode of state.transcodes.values()) {
						if (/^\/library\/metadata\/77\d{4}$/.test(transcode.query.path ?? '')) {
							transcode.stopped = true;
						}
					}
					return send(res, 200, { ok: true });
				}
				if (action === 'free-tuner') {
					state.tuner = null;
					state.tunes = [];
					return send(res, 200, { ok: true });
				}
				if (action === 'no-dvr' || action === 'with-dvr') {
					state.noDvr = action === 'no-dvr';
					return send(res, 200, { ok: true });
				}
				if (action === 'fail-transcode' || action === 'heal-transcode') {
					state.failTranscode = action === 'fail-transcode';
					return send(res, 200, { ok: true });
				}
				if (action === 'clear-patches') {
					// Clears test overrides: metadata patches, scrobble state and view offsets.
					state.patches.clear();
					state.watched.clear();
					state.offsets.clear();
					state.streamChoices.clear();
					state.showLanguages.clear();
					return send(res, 200, { ok: true });
				}
				if (action === 'approve-pins') {
					for (const entry of state.pins.values()) entry.approved = true;
					return send(res, 200, { ok: true });
				}
				return send(res, 404, { error: 'unknown control action' });
			}

			state.requests.push({
				method: req.method ?? 'GET',
				path: url.pathname,
				query,
				token: token ?? null,
				headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
				body: chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined
			});

			if (url.pathname.startsWith('/plextv/')) return plextv(req, url, res);

			if (!state.online) {
				// Simulate an unreachable server: drop the connection.
				req.socket.destroy();
				return;
			}
			if (url.pathname === '/identity') return send(res, 200, identity);
			if (!isServerToken(token ?? null)) return send(res, 401, { error: 'Unauthorized' });

			const partSelect = /^\/library\/parts\/(\d+)$/.exec(url.pathname);
			if (partSelect && req.method === 'PUT') {
				const key = `${token}:${partSelect[1]}`;
				const choice = { ...state.streamChoices.get(key) };
				if (query.audioStreamID) choice.audio = query.audioStreamID;
				if (query.subtitleStreamID !== undefined) choice.subtitle = query.subtitleStreamID;
				state.streamChoices.set(key, choice);
				// Like PMS, remember the languages for the rest of the show.
				const owner = findPartOwner(partSelect[1]);
				if (owner?.grandparentRatingKey) {
					const streams = owner.part.Stream ?? [];
					const lang = (id?: string) => streams.find((x) => String(x.id) === id)?.languageCode;
					const show = `${token}:${owner.grandparentRatingKey}`;
					const prefs = { ...state.showLanguages.get(show) };
					if (query.audioStreamID) prefs.audio = lang(query.audioStreamID);
					if (query.subtitleStreamID !== undefined) {
						prefs.subtitle = query.subtitleStreamID === '0' ? null : lang(query.subtitleStreamID);
					}
					state.showLanguages.set(show, prefs);
				}
				return send(res, 200);
			}

			if (url.pathname === '/:/scrobble' || url.pathname === '/:/unscrobble') {
				const watched = url.pathname === '/:/scrobble';
				// Like PMS, (un)scrobbling a show or season applies to all of its episodes.
				for (const key of [query.key, ...descendants(query.key)]) {
					state.watched.set(`${token}:${key}`, watched);
				}
				return send(res, 200);
			}

			const media = mediaRoute(url.pathname, query, req, res);
			if (media !== false) return media;

			if (url.pathname === '/photo/:/transcode') {
				// A 1×1 PNG stands in for any transcoded artwork.
				res.writeHead(200, { 'content-type': 'image/png' });
				return res.end(PIXEL);
			}

			if (url.pathname === '/hubs/search')
				return send(res, 200, applyWatched(search(query.query ?? ''), token!));
			if (/^\/tv\.plex\.providers\.epg\.[^/]+\/grid$/.test(url.pathname)) {
				const from = Number(query['endsAt>'] ?? 0);
				const to = Number(query['beginsAt<'] ?? from + 3 * 3600);
				return send(res, 200, epgGrid(from, to));
			}
			if (/^\/tv\.plex\.providers\.epg\.[^/]+\/hubs\/search$/.test(url.pathname)) {
				return send(res, 200, epgSearch(query.query ?? ''));
			}

			const { collections, playlists } = synthetic();
			if (url.pathname === '/library/sections/1/collections') {
				return send(res, 200, {
					MediaContainer: { size: 2, Metadata: collections.map(withoutItems) }
				});
			}
			const collectionItems = /^\/library\/collections\/(\d+)\/children$/.exec(url.pathname);
			if (collectionItems) {
				const c = collections.find((x) => x.ratingKey === collectionItems[1]);
				if (!c) return send(res, 404, { error: 'Not found' });
				return send(
					res,
					200,
					applyWatched({ MediaContainer: { size: c.items.length, Metadata: c.items } }, token!)
				);
			}
			if (url.pathname === '/playlists') {
				// Like PMS, honour playlistType when given.
				const list = playlists.filter(
					(p) => !query.playlistType || p.playlistType === query.playlistType
				);
				return send(res, 200, {
					MediaContainer: { size: list.length, Metadata: list.map(withoutItems) }
				});
			}
			const playlistItems = /^\/playlists\/(\d+)\/items$/.exec(url.pathname);
			if (playlistItems) {
				const p = playlists.find((x) => x.ratingKey === playlistItems[1]);
				if (!p) return send(res, 404, { error: 'Not found' });
				return send(
					res,
					200,
					applyWatched({ MediaContainer: { size: p.items.length, Metadata: p.items } }, token!)
				);
			}
			const synthetic1 = /^\/(?:library\/metadata|playlists)\/(88\d{4}|89\d{4})$/.exec(
				url.pathname
			);
			if (synthetic1) {
				const entry = [...collections, ...playlists].find((x) => x.ratingKey === synthetic1[1]);
				if (!entry) return send(res, 404, { error: 'Not found' });
				return send(res, 200, { MediaContainer: { size: 1, Metadata: [withoutItems(entry)] } });
			}

			const metadata = /^\/library\/metadata\/(\d+)$/.exec(url.pathname);
			if (metadata && req.method === 'GET') {
				const item = metadataItem(metadata[1]);
				if (!item) return send(res, 404, { error: 'Not found' });
				const patched = { ...item, ...(state.patches.get(`${token}:${metadata[1]}`) ?? {}) };
				return send(
					res,
					200,
					applyWatched({ MediaContainer: { size: 1, Metadata: [patched] } }, token!)
				);
			}

			const section = /^\/library\/sections\/(\d+)\/(all|firstCharacter)$/.exec(url.pathname);
			if (section && section[2] === 'all' && query.actor) {
				const recordedActor = manifest.find((e) => e.file === 'movies-by-actor.json');
				const body =
					section[1] === '1' && recordedActor?.query.actor === query.actor
						? readJson(fixturesDir, 'movies-by-actor.json')
						: { MediaContainer: { size: 0, totalSize: 0, Metadata: [] } };
				return send(res, 200, applyWatched(body, token!));
			}
			if (section && req.method === 'GET') {
				const body =
					section[2] === 'all'
						? sectionListing(section[1], query)
						: sectionFirstCharacters(section[1], query);
				if (body) return send(res, 200, applyWatched(body, token!));
			}

			const tune = /^\/livetv\/dvrs\/\d+\/channels\/([^/]+)\/tune$/.exec(url.pathname);
			if (tune && req.method === 'POST') {
				// Like PMS: HTTP 200 either way; a busy tuner shows as a grab in error.
				const channel = decodeURIComponent(tune[1]);
				const client = String(
					req.headers['x-plex-client-identifier'] ?? query['X-Plex-Client-Identifier'] ?? ''
				);
				const grabKey = `/media/grabbers/operations/${channel}-${client}`;
				// Tuning again keeps the client's existing grab (and its subscription alive).
				const again = state.tuner?.grabKey === grabKey;
				const busy = state.tuner !== null && !again;
				state.tunes.push({ channel, client, ok: !busy });
				const ratingKey = busy
					? ''
					: again
						? state.tuner!.ratingKey
						: String(770000 + ++state.liveItems);
				if (!busy) state.tuner = { grabKey, channel, ratingKey };
				return send(res, 200, {
					MediaContainer: {
						size: 1,
						MediaSubscription: [
							{
								key: '17',
								type: 4,
								channelIdentifier: channel,
								MediaGrabOperation: [
									busy
										? {
												key: grabKey,
												status: 'error',
												error: 'The recording conflicts with other recordings'
											}
										: {
												key: grabKey,
												status: 'inprogress',
												Metadata: {
													ratingKey,
													key: `/livetv/sessions/live-${ratingKey}`,
													type: 'movie',
													title: 'Live'
												}
											}
								]
							}
						]
					}
				});
			}
			if (/^\/media\/grabbers\/operations\/[^/]+$/.test(url.pathname) && req.method === 'DELETE') {
				if (state.tuner?.grabKey === url.pathname) state.tuner = null;
				return send(res, 200, { ok: true });
			}
			if (url.pathname === '/livetv/dvrs' && state.noDvr) {
				return send(res, 200, { MediaContainer: { size: 0 } });
			}
			const fixture = findFixture(req.method ?? 'GET', url.pathname, query);
			if (!fixture) return send(res, 404, { error: 'No fixture' });
			return send(res, 200, applyWatched(readJson(fixturesDir, fixture.file), token!));
		});
	});

	return {
		server,
		machineIdentifier,
		listen(port = 0) {
			return new Promise<number>((resolve) => {
				server.listen(port, '127.0.0.1', () => {
					const address = server.address();
					resolve(typeof address === 'object' && address ? address.port : port);
				});
			});
		},
		close() {
			return new Promise<void>((resolve) => server.close(() => resolve()));
		},
		get state() {
			return state;
		},
		homeUsers,
		ownerUuid: owner.uuid
	};
}

if (import.meta.main) {
	const pms = createFakePms();
	const port = await pms.listen(Number(process.env.FAKE_PMS_PORT ?? 32499));
	console.log(`Fake PMS listening on http://127.0.0.1:${port}`);
}
