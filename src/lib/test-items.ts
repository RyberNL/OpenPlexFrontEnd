import type { MediaItem } from './plex-types';

/** Builds a MediaItem for component tests. */
export function makeItem(overrides: Partial<MediaItem> = {}): MediaItem {
	return {
		id: '1',
		type: 'movie',
		title: 'A Movie',
		watched: false,
		viewCount: 0,
		ratings: [],
		genres: [],
		directors: [],
		writers: [],
		cast: [],
		versions: [],
		markers: [],
		chapters: [],
		extras: [],
		...overrides
	};
}
