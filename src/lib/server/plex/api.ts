/**
 * Typed, allow-listed Plex operations. Browsers can only reach Plex through these functions; there
 * is no generic path pass-through.
 */
import { z } from 'zod';
import type { Hub, Library, MediaItem, Page, Program, SearchResults } from '#lib/plex-types.js';
import { PlexError, PlexNotFoundError } from './errors';
import { plexId } from './http';
import { imageUrl, presentItem } from './images';
import { toLibrary, toMediaItem } from './normalize';
import { containerSchema, sectionsSchema, type RawMetadata } from './schemas';
import type { PlexSession } from './session';

/** Movie and TV libraries the user's Plex identity can access. */
export async function libraries(plex: PlexSession): Promise<Library[]> {
	const result = await plex.json('/library/sections', sectionsSchema);
	return (result.MediaContainer.Directory ?? [])
		.filter((d) => !d.hidden)
		.map(toLibrary)
		.filter((l): l is Library => l !== null);
}

const VIDEO_TYPES = new Set(['movie', 'show', 'season', 'episode', 'collection', 'clip']);

async function hubs(plex: PlexSession, path: string): Promise<Hub[]> {
	const result = await plex.json(path, containerSchema, { query: { count: 20 } });
	return (result.MediaContainer.Hub ?? [])
		.map((hub) => ({
			id: hub.hubIdentifier,
			title: hub.title,
			type: hub.type,
			more: !!hub.more,
			items: (hub.Metadata ?? []).map((m) => presentItem(toMediaItem(m)))
		}))
		.filter((hub) => hub.items.length > 0 && hub.items.every((i) => VIDEO_TYPES.has(i.type)));
}

export type Discover = {
	featured: MediaItem | null;
	continueWatching: Hub | null;
	nextUp: Hub | null;
	recentlyAdded: Hub[];
	recommended: Hub[];
};

/**
 * The Discover home: Continue Watching (in progress), Next Up (On Deck without what is already
 * in progress), Recently Added per library, then PMS recommendation hubs.
 */
export async function discover(plex: PlexSession): Promise<Discover> {
	const all = await hubs(plex, '/hubs');
	const take = (predicate: (hub: Hub) => boolean) => all.filter(predicate);
	const continueWatching = all.find((h) => h.id === 'home.continue') ?? null;
	const inProgress = new Set(continueWatching?.items.map((i) => i.id));
	const onDeck = all.find((h) => h.id === 'home.ondeck');
	const nextUpItems = onDeck?.items.filter((i) => !inProgress.has(i.id)) ?? [];
	const nextUp = nextUpItems.length ? { ...onDeck!, title: 'Next Up', items: nextUpItems } : null;
	const recentlyAdded = take((h) => /\.recent$/.test(h.id));
	const recommended = take(
		(h) => h.id !== 'home.continue' && h.id !== 'home.ondeck' && !/\.recent$/.test(h.id)
	);
	const featured =
		continueWatching?.items.find((i) => i.art) ??
		recentlyAdded.flatMap((h) => h.items).find((i) => i.art) ??
		null;
	return { featured, continueWatching, nextUp, recentlyAdded, recommended };
}

export const LIBRARY_SORTS = {
	title: { label: 'Title', param: 'titleSort' },
	added: { label: 'Date added', param: 'addedAt:desc' },
	released: { label: 'Release date', param: 'originallyAvailableAt:desc' },
	rating: { label: 'Rating', param: 'audienceRating:desc' },
	duration: { label: 'Duration', param: 'duration:desc' }
} as const;
export type LibrarySort = keyof typeof LIBRARY_SORTS;

export const RESOLUTIONS = [
	{ value: '4k', label: '4K' },
	{ value: '1080', label: '1080p' },
	{ value: '720', label: '720p' },
	{ value: 'sd', label: 'SD' }
] as const;

export type LibraryFilters = {
	unwatched?: boolean;
	genre?: string;
	year?: string;
	contentRating?: string;
	resolution?: string;
};

/** Reads sort and filters from URL search params, dropping anything invalid. */
export function parseLibraryQuery(params: URLSearchParams) {
	const sort = (params.get('sort') ?? 'title') as LibrarySort;
	const filters: LibraryFilters = {};
	if (params.get('unwatched') === '1') filters.unwatched = true;
	const genre = params.get('genre');
	if (genre && /^\d{1,9}$/.test(genre)) filters.genre = genre;
	const year = params.get('year');
	if (year && /^\d{4}$/.test(year)) filters.year = year;
	const rating = params.get('rating');
	if (rating && rating.length <= 32) filters.contentRating = rating;
	const resolution = params.get('res');
	if (resolution && RESOLUTIONS.some((r) => r.value === resolution))
		filters.resolution = resolution;
	return { sort: sort in LIBRARY_SORTS ? sort : ('title' as LibrarySort), filters };
}

function filterQuery(filters: LibraryFilters) {
	return {
		unwatched: filters.unwatched ? 1 : undefined,
		genre: filters.genre,
		year: filters.year,
		contentRating: filters.contentRating,
		resolution: filters.resolution
	};
}

/** The library with this id, if the user can access it. */
export async function library(plex: PlexSession, id: string) {
	return (await libraries(plex)).find((l) => l.id === id) ?? null;
}

/** A page of a library's items, sorted and filtered. */
export async function libraryPage(
	plex: PlexSession,
	sectionId: string,
	options: { sort: LibrarySort; filters: LibraryFilters; offset: number; size: number }
): Promise<Page<MediaItem>> {
	const result = await plex.json(`/library/sections/${plexId(sectionId)}/all`, containerSchema, {
		query: {
			sort: LIBRARY_SORTS[options.sort].param,
			...filterQuery(options.filters),
			'X-Plex-Container-Start': options.offset,
			'X-Plex-Container-Size': Math.min(options.size, 200)
		}
	});
	const container = result.MediaContainer;
	return {
		items: (container.Metadata ?? []).map((m) => presentItem(toMediaItem(m))),
		offset: container.offset ?? options.offset,
		total: container.totalSize ?? container.size ?? 0
	};
}

const directorySchema = z.object({
	MediaContainer: z.looseObject({
		Directory: z
			.array(
				z.looseObject({
					key: z.coerce.string(),
					title: z.coerce.string(),
					size: z.coerce.number().optional()
				})
			)
			.optional()
	})
});

/** Filter choices for a library. */
export async function libraryOptions(plex: PlexSession, sectionId: string, type: 'movie' | 'show') {
	const id = plexId(sectionId);
	const [genres, years, ratings] = await Promise.all(
		['genre', 'year', 'contentRating'].map((kind) =>
			plex.json(`/library/sections/${id}/${kind}`, directorySchema).then(
				(r) => r.MediaContainer.Directory ?? [],
				() => []
			)
		)
	);
	return {
		genres: genres.map((g) => ({ value: g.key, label: g.title })),
		years: years
			.map((y) => ({ value: y.key, label: y.title }))
			.filter((y) => /^\d{4}$/.test(y.value))
			.sort((a, b) => b.value.localeCompare(a.value)),
		contentRatings: ratings.map((r) => ({ value: r.title, label: r.title })),
		resolutions: type === 'movie' ? [...RESOLUTIONS] : []
	};
}

/** Offsets of the first item per starting letter, for the A–Z jump bar (title sort only). */
export async function letterIndex(plex: PlexSession, sectionId: string, filters: LibraryFilters) {
	const result = await plex.json(
		`/library/sections/${plexId(sectionId)}/firstCharacter`,
		directorySchema,
		{ query: filterQuery(filters) }
	);
	let offset = 0;
	return (result.MediaContainer.Directory ?? []).map((d) => {
		const entry = { letter: d.title, offset, count: d.size ?? 0 };
		offset += d.size ?? 0;
		return entry;
	});
}

/** Full details of an item (movie, show, season, episode, extra) with extras, markers, chapters. */
export async function itemDetails(plex: PlexSession, id: string): Promise<MediaItem | null> {
	try {
		const result = await plex.json(`/library/metadata/${plexId(id)}`, containerSchema, {
			query: { includeExtras: 1, includeMarkers: 1, includeChapters: 1, includeOnDeck: 1 }
		});
		const raw = result.MediaContainer.Metadata?.[0];
		return raw ? presentItem(toMediaItem(raw)) : null;
	} catch (error) {
		if (error instanceof PlexNotFoundError) return null;
		throw error;
	}
}

/** Seasons of a show, or episodes of a season. */
export async function children(plex: PlexSession, id: string): Promise<MediaItem[]> {
	const result = await plex.json(`/library/metadata/${plexId(id)}/children`, containerSchema);
	return (result.MediaContainer.Metadata ?? []).map((m) => presentItem(toMediaItem(m)));
}

/**
 * The episode to continue a show with: one in progress, else the first unwatched episode after
 * the last watched one, else the first unwatched episode. Null when everything is watched.
 */
export function pickNextEpisode(episodes: MediaItem[]): MediaItem | null {
	const ordered = [...episodes].sort(
		(a, b) => (a.parentIndex ?? 0) - (b.parentIndex ?? 0) || (a.index ?? 0) - (b.index ?? 0)
	);
	const inProgress = ordered.find((e) => e.viewOffset);
	if (inProgress) return inProgress;
	const lastWatched = ordered.findLastIndex((e) => e.watched);
	return (
		ordered.slice(lastWatched + 1).find((e) => !e.watched) ??
		ordered.find((e) => !e.watched) ??
		null
	);
}

async function showEpisodes(plex: PlexSession, showId: string) {
	const result = await plex.json(`/library/metadata/${plexId(showId)}/allLeaves`, containerSchema);
	return (result.MediaContainer.Metadata ?? []).map((m) => presentItem(toMediaItem(m)));
}

export async function nextEpisode(plex: PlexSession, showId: string) {
	return pickNextEpisode(await showEpisodes(plex, showId));
}

/** The episode after `episodeId` in season/episode order, watched or not; null after the last. */
export function followingEpisode(episodes: MediaItem[], episodeId: string): MediaItem | null {
	const ordered = [...episodes].sort(
		(a, b) => (a.parentIndex ?? 0) - (b.parentIndex ?? 0) || (a.index ?? 0) - (b.index ?? 0)
	);
	const at = ordered.findIndex((e) => e.id === episodeId);
	return at < 0 ? null : (ordered[at + 1] ?? null);
}

/** What plays after an item: the following episode of its show, or null (movies, last episode). */
export async function episodeAfter(
	plex: PlexSession,
	item: Pick<MediaItem, 'id' | 'type' | 'grandparentId'>
) {
	if (item.type !== 'episode' || !item.grandparentId) return null;
	return followingEpisode(await showEpisodes(plex, item.grandparentId), item.id);
}

function items(result: { MediaContainer: { Metadata?: RawMetadata[] } }) {
	return (result.MediaContainer.Metadata ?? []).map((m) => presentItem(toMediaItem(m)));
}

/** Collections of a library. */
export async function collections(plex: PlexSession, sectionId: string) {
	return items(
		await plex.json(`/library/sections/${plexId(sectionId)}/collections`, containerSchema)
	);
}

/** Items of a collection, in the collection's order. */
export async function collectionItems(plex: PlexSession, id: string) {
	return items(await plex.json(`/library/collections/${plexId(id)}/children`, containerSchema));
}

/** The user's video playlists (audio and photo playlists are excluded). */
export async function videoPlaylists(plex: PlexSession) {
	const result = await plex.json('/playlists', containerSchema, {
		query: { playlistType: 'video' }
	});
	return (result.MediaContainer.Metadata ?? [])
		.filter((m) => m.playlistType === 'video')
		.map((m) => presentItem(toMediaItem(m)));
}

export async function playlist(plex: PlexSession, id: string) {
	try {
		const result = await plex.json(`/playlists/${plexId(id)}`, containerSchema);
		const raw = result.MediaContainer.Metadata?.[0];
		return raw && raw.playlistType === 'video' ? presentItem(toMediaItem(raw)) : null;
	} catch (error) {
		if (error instanceof PlexNotFoundError) return null;
		throw error;
	}
}

export async function playlistItems(plex: PlexSession, id: string) {
	return items(await plex.json(`/playlists/${plexId(id)}/items`, containerSchema));
}

/** Movies and shows featuring a person, across the user's libraries. */
export async function personItems(plex: PlexSession, personId: string) {
	const libs = await libraries(plex);
	const results = await Promise.all(
		libs.map((lib) =>
			plex
				.json(`/library/sections/${plexId(lib.id)}/all`, containerSchema, {
					query: { actor: plexId(personId) }
				})
				.then(items)
		)
	);
	return results.flat();
}

/** Marks an item (movie, episode, season or show) watched or unwatched for the user. */
export async function setWatched(plex: PlexSession, id: string, watched: boolean) {
	await plex.fetch(watched ? '/:/scrobble' : '/:/unscrobble', {
		query: { key: plexId(id), identifier: 'com.plexapp.plugins.library' }
	});
}

const dvrsSchema = z.object({
	MediaContainer: z.looseObject({
		Dvr: z
			.array(z.looseObject({ key: z.coerce.string(), epgIdentifier: z.string().optional() }))
			.optional()
	})
});

/** The configured DVR, or null when Live TV is not set up (or not available to this user). */
export async function liveTv(plex: PlexSession) {
	try {
		const result = await plex.json('/livetv/dvrs', dvrsSchema);
		const dvr = result.MediaContainer.Dvr?.[0];
		return dvr?.epgIdentifier ? { dvrId: dvr.key, epg: dvr.epgIdentifier } : null;
	} catch (error) {
		if (error instanceof PlexError && (error.status === 401 || error.status === 404)) return null;
		throw error;
	}
}

/** Converts guide search results to programs. */
function toPrograms(metadata: RawMetadata[]): Program[] {
	return metadata.flatMap((m) =>
		(m.Media ?? [])
			.filter((media) => media.beginsAt && media.endsAt)
			.map((media) => ({
				id: m.ratingKey,
				title: m.grandparentTitle ?? m.title,
				subtitle: m.grandparentTitle ? m.title : undefined,
				type: m.type,
				channel: media.channelTitle ?? media.channelCallSign,
				beginsAt: media.beginsAt! * 1000,
				endsAt: media.endsAt! * 1000,
				thumb: imageUrl(m.thumb, 'thumb', 320)
			}))
	);
}

/** Search across the user's libraries, people, collections and (if set up) Live TV programs. */
export async function search(plex: PlexSession, query: string): Promise<SearchResults> {
	const q = query.trim().slice(0, 100);
	const empty: SearchResults = {
		movies: [],
		shows: [],
		episodes: [],
		people: [],
		collections: [],
		programs: []
	};
	if (q.length < 2) return empty;

	const [library, tv] = await Promise.all([
		plex.json('/hubs/search', containerSchema, {
			query: { query: q, limit: 12, includeCollections: 1 }
		}),
		liveTv(plex)
	]);
	const results = { ...empty };
	for (const hub of library.MediaContainer.Hub ?? []) {
		const media = (hub.Metadata ?? []).map((m) => presentItem(toMediaItem(m)));
		if (hub.type === 'movie') results.movies = media;
		else if (hub.type === 'show') results.shows = media;
		else if (hub.type === 'episode') results.episodes = media;
		else if (hub.type === 'collection') results.collections = media;
		else if (hub.type === 'actor' || hub.type === 'director') {
			for (const p of hub.Directory ?? []) {
				if (!p.id || results.people.some((x) => x.id === String(p.id))) continue;
				results.people.push({
					id: String(p.id),
					name: p.tag ?? p.title ?? '',
					thumb: imageUrl(p.thumb, 'square', 160)
				});
			}
		}
	}
	if (tv) {
		const guide = await plex
			.json(`/${encodeURIComponent(tv.epg).replace(/%3A/gi, ':')}/hubs/search`, containerSchema, {
				query: { query: q, limit: 10 }
			})
			.catch((error) => {
				// Library results are still useful without the guide.
				console.warn('Live TV guide search failed:', error);
				return null;
			});
		const now = Date.now();
		const seen = new Set<string>();
		results.programs = toPrograms(
			(guide?.MediaContainer.Hub ?? []).flatMap((h) => h.Metadata ?? [])
		)
			// The same airing can appear in several guide hubs.
			.filter((p) => !seen.has(`${p.id}@${p.beginsAt}`) && !!seen.add(`${p.id}@${p.beginsAt}`))
			.filter((p) => p.endsAt > now)
			.sort((a, b) => a.beginsAt - b.beginsAt)
			.slice(0, 10);
	}
	return results;
}

/**
 * Saves the user's audio and/or subtitle choice for a part in Plex (0 turns subtitles off). Plex
 * applies the choice to this item and uses the language for later episodes of the same show.
 */
export async function setStreams(
	plex: PlexSession,
	partId: number,
	streams: { audioStreamId?: number; subtitleStreamId?: number }
) {
	await plex.fetch(`/library/parts/${plexId(partId)}`, {
		method: 'PUT',
		query: {
			audioStreamID: streams.audioStreamId,
			subtitleStreamID: streams.subtitleStreamId,
			allParts: 1
		}
	});
}
