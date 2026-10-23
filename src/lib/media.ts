import { resolve } from '$app/paths';
import type { MediaItem } from './plex-types';

/** App URL of an item's page. */
export function itemHref(item: Pick<MediaItem, 'id' | 'type'>) {
	if (item.type === 'collection') return resolve('/(app)/collection/[id]', { id: item.id });
	if (item.type === 'playlist') return resolve('/(app)/playlist/[id]', { id: item.id });
	return resolve('/(app)/item/[id]', { id: item.id });
}

/** Second line under a poster: year, "S1 · E4", episode count… */
export function subtitle(item: MediaItem) {
	if (item.type === 'episode') {
		const code =
			item.parentIndex !== undefined && item.index !== undefined
				? `S${item.parentIndex} · E${item.index}`
				: undefined;
		return [item.grandparentTitle, code].filter(Boolean).join(' · ');
	}
	if (item.type === 'season') return item.leafCount ? `${item.leafCount} episodes` : undefined;
	if (item.type === 'show' && item.childCount) {
		return `${item.childCount} season${item.childCount === 1 ? '' : 's'}`;
	}
	return item.year ? String(item.year) : undefined;
}

/** Fraction (0–1) watched of a partly watched movie or episode, otherwise null. */
export function progress(item: Pick<MediaItem, 'viewOffset' | 'duration'>) {
	if (!item.viewOffset || !item.duration) return null;
	return Math.min(1, Math.max(0, item.viewOffset / item.duration));
}

/** Unwatched episode count for shows and seasons. */
export function unwatchedCount(item: Pick<MediaItem, 'type' | 'leafCount' | 'viewedLeafCount'>) {
	if (item.type !== 'show' && item.type !== 'season') return 0;
	return Math.max(0, (item.leafCount ?? 0) - (item.viewedLeafCount ?? 0));
}

/** "1 h 47 min", "42 min" */
export function formatDuration(ms: number | undefined) {
	if (!ms) return '';
	const minutes = Math.round(ms / 60_000);
	const hours = Math.floor(minutes / 60);
	return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/** "42:00", "1:05:09" */
export function formatTimestamp(ms: number) {
	const total = Math.floor(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const mm = h ? String(m).padStart(2, '0') : String(m);
	return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Player URL for an item; `from` picks resume or the beginning, `version` a media version. */
export function watchHref(
	item: Pick<MediaItem, 'id'>,
	options: {
		from?: 'resume' | 'start';
		version?: number;
		/** Play the rest of a container after this item, e.g. `playlist:123` (see queue.ts). */
		queue?: string;
		/** Shuffle seed of the queue. */
		shuffle?: number;
		/** Position of this item in the (shuffled) queue. */
		pos?: number;
	} = {}
) {
	const params = [
		options.from ? `from=${options.from}` : '',
		options.version !== undefined ? `version=${options.version}` : '',
		options.queue ? `queue=${encodeURIComponent(options.queue)}` : '',
		options.queue && options.shuffle ? `shuffle=${options.shuffle}` : '',
		options.queue && options.pos ? `pos=${options.pos}` : ''
	].filter(Boolean);
	return resolve('/watch/[id]', { id: item.id }) + (params.length ? `?${params.join('&')}` : '');
}

/** "Rotten Tomatoes 37%", "IMDb 6.0" */
export function formatRating(rating: { source: string; type: string; value: number }) {
	if (rating.source === 'Rotten Tomatoes') {
		return `${rating.type === 'critic' ? 'Critics' : 'Audience'} ${Math.round(rating.value * 10)}%`;
	}
	return `${rating.source} ${rating.value.toFixed(1)}`;
}
