import { z } from 'zod';
import type { Airing, LiveChannel } from '#lib/plex-types.js';
import { containerSchema, type RawMetadata } from './schemas';
import type { PlexSession } from './session';
import { imageUrl } from './images';

/** The DVR the app works with (see `liveTv()` in api.ts). */
export type Dvr = { dvrId: string; epg: string };

const channelsSchema = z.object({
	MediaContainer: z.looseObject({
		Channel: z
			.array(
				z.looseObject({
					id: z.coerce.string(),
					vcn: z.coerce.string().optional(),
					title: z.string().optional(),
					callSign: z.string().optional(),
					thumb: z.string().optional()
				})
			)
			.optional()
	})
});

/** The DVR's channels in lineup order. */
export async function channels(plex: PlexSession, dvr: Dvr): Promise<LiveChannel[]> {
	const result = await plex.json(`/${dvr.epg}/lineups/dvr/channels`, channelsSchema);
	return (result.MediaContainer.Channel ?? []).map((c) => ({
		id: c.id,
		number: c.vcn ?? c.id,
		title: c.title ?? c.callSign ?? c.id,
		logo: imageUrl(c.thumb, 'logo', 120)
	}));
}

/** Guide windows are fetched in these steps, aligned to the half hour, and cached briefly. */
export const GUIDE_WINDOW = 3 * 3600_000;
const HALF_HOUR = 1800_000;
const CACHE_TTL = 5 * 60_000;
const cache = new Map<string, { at: number; airings: Promise<Airing[]> }>();

/**
 * The guide for the 3-hour window starting at `from` (rounded down to the half hour). The guide is
 * the same for every user, so windows are shared in a small cache for 5 minutes.
 */
export function guideWindow(plex: PlexSession, dvr: Dvr, from: number) {
	const start = from - (from % HALF_HOUR);
	const key = `${dvr.epg}|${start}`;
	const now = Date.now();
	const hit = cache.get(key);
	if (hit && now - hit.at < CACHE_TTL) return hit.airings;
	for (const [k, v] of cache) if (now - v.at >= CACHE_TTL || cache.size > 64) cache.delete(k);
	const airings = guide(plex, dvr, start, start + GUIDE_WINDOW);
	cache.set(key, { at: now, airings });
	airings.catch(() => cache.delete(key));
	return airings;
}

/** Guide airings overlapping [from, to) (ms), each program airing as its own entry. */
export async function guide(plex: PlexSession, dvr: Dvr, from: number, to: number) {
	const result = await plex.json(`/${dvr.epg}/grid`, containerSchema, {
		query: {
			type: '1,4',
			sort: 'beginsAt',
			'endsAt>': Math.floor(from / 1000),
			'beginsAt<': Math.ceil(to / 1000)
		}
	});
	return toAirings(result.MediaContainer.Metadata ?? [], from, to);
}

export function toAirings(metadata: RawMetadata[], from: number, to: number): Airing[] {
	const seen = new Set<string>();
	const airings: Airing[] = [];
	for (const m of metadata) {
		for (const media of m.Media ?? []) {
			if (!media.beginsAt || !media.endsAt || !media.channelIdentifier) continue;
			const beginsAt = media.beginsAt * 1000;
			const endsAt = media.endsAt * 1000;
			if (endsAt <= from || beginsAt >= to) continue;
			const id = `${media.channelIdentifier}@${media.beginsAt}`;
			// Guides can list the same airing twice; keep one.
			if (seen.has(id)) continue;
			seen.add(id);
			const isEpisode = m.type === 'episode';
			airings.push({
				id,
				programKey: m.ratingKey,
				channelId: media.channelIdentifier,
				title: isEpisode ? (m.grandparentTitle ?? m.title) : m.title,
				subtitle: isEpisode && m.grandparentTitle ? m.title : undefined,
				season: isEpisode ? m.parentIndex : undefined,
				episode: isEpisode ? m.index : undefined,
				type: m.type ?? 'movie',
				category: m.Genre?.[0]?.tag,
				summary: m.summary,
				year: m.year,
				beginsAt,
				endsAt,
				// XMLTV guides often use the channel logo as program image: fit it, don't crop.
				thumb: imageUrl(m.thumb, 'logo', 480)
			});
		}
	}
	return airings.sort((a, b) => a.beginsAt - b.beginsAt || a.channelId.localeCompare(b.channelId));
}

/** What each channel airs at `time` (ms), by channel id. */
export function airingNow(airings: Airing[], time: number) {
	const now = new Map<string, Airing>();
	for (const a of airings) if (a.beginsAt <= time && time < a.endsAt) now.set(a.channelId, a);
	return now;
}

/**
 * Groups airings by category. Without categories from the guide there is one unnamed group:
 * Plex then labels every program a "movie", which would be misleading as a heading.
 */
export function groupByCategory(airings: Airing[]) {
	if (!airings.some((a) => a.category)) return airings.length ? [{ name: null, airings }] : [];
	const byName = new Map<string, Airing[]>();
	for (const a of airings) {
		const name = a.category ?? 'Other';
		byName.set(name, [...(byName.get(name) ?? []), a]);
	}
	return [...byName]
		.sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))
		.map(([name, list]) => ({ name, airings: list }));
}
