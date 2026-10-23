#!/usr/bin/env node
/**
 * Records JSON responses from a real Plex Media Server as test fixtures for the fake PMS.
 *
 *   PLEX_URL=http://192.168.1.10:32400 PLEX_TOKEN=... node scripts/record-plex-fixtures.mjs
 *
 * With ONLY=livetv, only the Live TV fixtures are re-recorded and the rest of the manifest is kept
 * (useful after the DVR changes, without disturbing the library fixtures tests depend on).
 *
 * Tokens are scrubbed: the token value itself, any token-like field, and X-Plex-Token query
 * parameters inside URLs. Verify afterwards with: grep -ri "x-plex-token" test/fixtures/plex
 */
import fs from 'node:fs';
import path from 'node:path';

const PLEX_URL = (process.env.PLEX_URL ?? 'http://192.168.1.10:32400').replace(/\/+$/, '');
const TOKEN = process.env.PLEX_TOKEN;
const OUT = path.resolve(process.env.FIXTURES_DIR ?? 'test/fixtures/plex');
if (!TOKEN) {
	console.error('PLEX_TOKEN is required');
	process.exit(1);
}

const CLIENT = {
	'X-Plex-Client-Identifier': 'plex-client-fixture-recorder',
	'X-Plex-Product': 'Plex Web (dev)',
	'X-Plex-Version': '0.0.1',
	'X-Plex-Platform': 'Chrome',
	'X-Plex-Device-Name': 'fixture recorder'
};

const TOKEN_KEYS = /^(token|accessToken|authToken|authenticationToken|X-Plex-Token)$/i;
/** Location and network details that are personal but not needed by tests. */
const PERSONAL_KEYS = /^(postalCode|publicAddress|address|email|mailingListStatus|pin)$/i;
const IPV4 = /\b(?!127\.0\.0\.1\b)(?!192\.168\.)(?!10\.)\d{1,3}(?:\.\d{1,3}){3}\b/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

function scrub(value) {
	if (Array.isArray(value)) return value.map(scrub);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [
				k,
				TOKEN_KEYS.test(k) || PERSONAL_KEYS.test(k) ? 'REDACTED' : scrub(v)
			])
		);
	}
	if (typeof value === 'string') {
		return value
			.split(TOKEN)
			.join('REDACTED')
			.replace(/([?&]X-Plex-Token=)[^&"]+/gi, '$1REDACTED')
			.replace(EMAIL, 'user@example.invalid')
			.replace(IPV4, '203.0.113.1');
	}
	return value;
}

const LIVE_TV_FILES = /^(livetv-|epg-|subscriptions)/;
const ONLY_LIVETV = process.env.ONLY === 'livetv';
const manifest = ONLY_LIVETV
	? JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')).filter(
			(entry) => !LIVE_TV_FILES.test(entry.file)
		)
	: [];

async function get(base, pathAndQuery, name, { method = 'GET', optional = false } = {}) {
	const url = new URL(pathAndQuery, base);
	const response = await fetch(url, {
		method,
		headers: { ...CLIENT, Accept: 'application/json', 'X-Plex-Token': TOKEN }
	});
	if (!response.ok) {
		if (optional) {
			console.warn(`  skipped ${name}: HTTP ${response.status}`);
			return null;
		}
		throw new Error(`${method} ${url.pathname}: HTTP ${response.status}`);
	}
	const text = await response.text();
	const body = text ? scrub(JSON.parse(text)) : null;
	const file = `${name}.json`;
	fs.writeFileSync(path.join(OUT, file), JSON.stringify(body, null, '\t') + '\n');
	if (base === PLEX_URL) {
		manifest.push({
			method,
			path: url.pathname,
			query: Object.fromEntries(url.searchParams),
			file
		});
	}
	console.log(`  ${name} ← ${method} ${url.pathname}${url.search}`);
	return body;
}

const pms = (p, name, opts) => get(PLEX_URL, p, name, opts);
const plextv = (p, name, opts) => get('https://plex.tv', p, name, opts);
const items = (body) => body?.MediaContainer?.Metadata ?? [];

fs.mkdirSync(OUT, { recursive: true });
console.log(`Recording from ${PLEX_URL} into ${OUT}`);

/** Live TV (only if a DVR is configured). Guide times are rebased to "now" by the fake PMS. */
async function recordLiveTv() {
	for (const file of fs.readdirSync(OUT)) {
		if (LIVE_TV_FILES.test(file)) fs.rmSync(path.join(OUT, file));
	}
	const dvrs = await pms('/livetv/dvrs', 'livetv-dvrs', { optional: true });
	const dvr = dvrs?.MediaContainer?.Dvr?.[0];
	if (!dvr) {
		console.log('  no DVR configured');
		return;
	}
	console.log(`  DVR found: ${dvr.key} (${dvr.epgIdentifier})`);
	const epg = dvr.epgIdentifier;
	const now = Math.floor(Date.now() / 1000);
	const from = now - (now % 1800);
	await pms(`/livetv/dvrs/${dvr.key}`, 'livetv-dvr');
	await pms(`/${epg}/lineups/dvr/channels`, 'epg-channels');
	await pms(
		`/${epg}/grid?type=1,4&sort=beginsAt&endsAt>=${from}&beginsAt<=${from + 3 * 3600}`,
		'epg-grid'
	);
	await pms(`/${epg}/hubs/search?query=nieuws&limit=10`, 'epg-search-nieuws', { optional: true });
	// Recording needs Plex Pass; without it PMS answers 401 and these are skipped.
	await pms('/media/subscriptions', 'subscriptions', { optional: true });
	await pms('/media/subscriptions/scheduled', 'subscriptions-scheduled', { optional: true });
	fs.writeFileSync(
		path.join(OUT, 'livetv-recorded.json'),
		JSON.stringify({ recordedAt: from }, null, '\t') + '\n'
	);
}

if (ONLY_LIVETV) {
	await recordLiveTv();
	fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');
	console.log(`Done: Live TV fixtures re-recorded (${manifest.length} PMS responses in total).`);
	process.exit(0);
}

await pms('/identity', 'identity');
await pms('/', 'root');
const sections = (await pms('/library/sections', 'sections')).MediaContainer.Directory ?? [];
const movieSection = sections.find((s) => s.type === 'movie');
const showSection = sections.find((s) => s.type === 'show');
console.log(
	`  movie section: ${movieSection?.title ?? '—'}, show section: ${showSection?.title ?? '—'}`
);

await pms('/hubs?count=12', 'hubs-home');
await pms('/hubs/continueWatching?count=12', 'hubs-continue-watching', { optional: true });
await pms('/library/onDeck', 'on-deck');
await pms('/hubs/search?query=the&limit=10&includeCollections=1', 'search-the');
await pms('/hubs/search?query=zzzzzzzzqx&limit=10', 'search-empty');
await pms('/playlists?playlistType=video', 'playlists-video');

for (const [section, label] of [
	[movieSection, 'movies'],
	[showSection, 'shows']
]) {
	if (!section) continue;
	const id = section.key;
	await pms(
		`/library/sections/${id}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=30&sort=titleSort`,
		`section-${label}-all`
	);
	await pms(
		`/library/sections/${id}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=30&sort=addedAt:desc&unwatched=1`,
		`section-${label}-unwatched-recent`
	);
	await pms(`/library/sections/${id}/firstCharacter`, `section-${label}-first-character`);
	await pms(`/library/sections/${id}/genre`, `section-${label}-genres`);
	await pms(`/library/sections/${id}/year`, `section-${label}-years`);
	await pms(`/library/sections/${id}/contentRating`, `section-${label}-content-ratings`);
	await pms(
		`/library/sections/${id}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=200`,
		`section-${label}-page-200`
	);
	await pms(`/library/sections/${id}/sorts`, `section-${label}-sorts`, { optional: true });
	await pms(`/hubs/sections/${id}?count=12`, `hubs-section-${label}`);
	await pms(`/library/sections/${id}/collections`, `section-${label}-collections`);
}

// A movie with full details: prefer one that is partly watched and has chapters/markers.
if (movieSection) {
	const movies = items(
		JSON.parse(fs.readFileSync(path.join(OUT, 'section-movies-page-200.json'), 'utf8'))
	);
	const movie = movies.find((m) => m.viewOffset) ?? movies[0];
	if (movie) {
		const detail = await pms(
			`/library/metadata/${movie.ratingKey}?includeMarkers=1&includeChapters=1&includeExtras=1&includeOnDeck=1&includeRelated=1`,
			'movie-detail'
		);
		const media = items(detail)[0]?.Media?.[0];
		const part = media?.Part?.[0];
		if (part) {
			await pms(
				`/video/:/transcode/universal/decision?path=${encodeURIComponent(`/library/metadata/${movie.ratingKey}`)}&mediaIndex=0&partIndex=0&protocol=hls&directPlay=1&directStream=1&directStreamAudio=1&videoQuality=100&maxVideoBitrate=20000&videoResolution=1920x1080&session=fixture&X-Plex-Session-Identifier=fixture`,
				'movie-decision',
				{ optional: true }
			);
			await pms(`/library/parts/${part.id}/indexes/sd`, 'movie-bif', { optional: true });
		}
		const actor = items(detail)[0]?.Role?.[0];
		if (actor?.id) {
			await pms(`/library/sections/${movieSection.key}/all?actor=${actor.id}`, 'movies-by-actor', {
				optional: true
			});
		}
	}
	const collection = items(
		JSON.parse(fs.readFileSync(path.join(OUT, 'section-movies-collections.json'), 'utf8'))
	)[0];
	if (collection) {
		await pms(`/library/collections/${collection.ratingKey}/children`, 'collection-children');
	}
}

if (showSection) {
	const shows = items(
		JSON.parse(fs.readFileSync(path.join(OUT, 'section-shows-all.json'), 'utf8'))
	);
	const show =
		shows.find((s) => s.viewedLeafCount > 0 && s.viewedLeafCount < s.leafCount) ?? shows[0];
	if (show) {
		await pms(`/library/metadata/${show.ratingKey}?includeOnDeck=1&includeExtras=1`, 'show-detail');
		const seasons = items(
			await pms(`/library/metadata/${show.ratingKey}/children`, 'show-seasons')
		);
		await pms(`/library/metadata/${show.ratingKey}/allLeaves`, 'show-all-episodes');
		const season = seasons.find((s) => s.index >= 1) ?? seasons[0];
		if (season) {
			const episodes = items(
				await pms(`/library/metadata/${season.ratingKey}/children`, 'season-episodes')
			);
			const episode = episodes[Math.min(1, episodes.length - 1)];
			if (episode) {
				await pms(
					`/library/metadata/${episode.ratingKey}?includeMarkers=1&includeChapters=1`,
					'episode-detail'
				);
			}
		}
	}
}

const playlist = items(
	JSON.parse(fs.readFileSync(path.join(OUT, 'playlists-video.json'), 'utf8'))
)[0];
if (playlist) await pms(`/playlists/${playlist.ratingKey}/items`, 'playlist-items');

await recordLiveTv();

// plex.tv (recorded for reference; served by a mock in tests).
await plextv('/api/v2/resources?includeHttps=1&includeRelay=0', 'plextv-resources');
await plextv('/api/v2/home/users', 'plextv-home-users', { optional: true });
await plextv('/api/v2/user', 'plextv-user');

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');
console.log(`Done: ${manifest.length} PMS responses recorded.`);
