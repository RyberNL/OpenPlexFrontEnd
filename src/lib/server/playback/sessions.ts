import { randomBytes, randomUUID } from 'node:crypto';
import type { Capabilities, PlaybackMethod, Quality } from '#lib/playback.js';
import type { ClientIdentity } from '../plex/http';
import type { Bif } from './bif';

/** One player instance: what is playing, how, and for whom. Server-side only. */
export type PlaybackSession = {
	/** Opaque id used in /stream URLs; worthless without the owning app session. */
	id: string;
	appSessionHash: string;
	userId: string;
	/** Plex playback/transcode session id. */
	plexSession: string;
	ratingKey: string;
	mediaIndex: number;
	partIndex: number;
	partId: number;
	/** PMS path of the part's file (direct play). */
	partKey: string;
	method: PlaybackMethod;
	reason: string | undefined;
	quality: Quality;
	caps: Capabilities;
	device: ClientIdentity;
	/**
	 * Milliseconds into the item where the stream's time 0 lies. Always 0: a direct file starts at
	 * the item's start, and PMS's HLS playlist covers the whole item too (with copyts, segments
	 * before the transcoder's start point are blank).
	 */
	streamOffset: number;
	/** Item time (ms) the PMS transcoder starts converting at (the `offset` of start.m3u8). */
	startAt: number;
	duration: number;
	createdAt: number;
	lastActiveAt: number;
	/** How the selected subtitle reaches the browser (see StreamRequest.subtitleMode). */
	subtitleMode: 'none' | 'auto' | 'burn';
	/**
	 * The browser-rendered subtitle: a sidecar file (direct play, and PGS files always) or PMS's
	 * converted stream (HLS). `image` marks binary PGS data.
	 */
	subtitle: { streamId: number; delivery: 'file' | 'stream'; image?: boolean } | null;
	/** Item time (ms) from which the item counts as watched; null for extras. */
	watchedAt: number | null;
	/**
	 * Live TV: the tuned channel, the tuner grab to delete when the playback ends, the live session
	 * key PMS reports progress under, and when progress was last reported (see `keepLiveAlive`).
	 */
	live?: {
		channelId: string;
		grabKey: string;
		sessionKey: string;
		reportedAt: number;
	};
	/**
	 * Stands in for `id` in /stream URLs for devices that fetch the stream themselves, without the
	 * session cookie (AirPlay, Chromecast). Made on request, see `castIdFor`.
	 */
	castId?: string;
	/**
	 * PMS's master playlist, fetched once: a cast device reads it again, and PMS's start.m3u8 would
	 * start the transcode afresh.
	 */
	masterPlaylist?: Promise<string>;
	/** Preview thumbnails, loaded on first use; null when PMS has none or they're unreadable. */
	previews?: Promise<Bif | null>;
	/** Whether this playback already marked the item watched. */
	scrobbled?: boolean;
	/** Last reported player state and item time (ms). */
	lastState?: string;
	lastTime?: number;
};

const sessions = new Map<string, PlaybackSession>();
/** Cast id → playback id. */
const castIds = new Map<string, string>();

/** Cast ids start with this, so /stream routes can tell them from playback ids. */
export const CAST_PREFIX = 'cast_';

export function newPlexSessionId() {
	return randomUUID();
}

export function createPlayback(
	fields: Omit<PlaybackSession, 'id' | 'createdAt' | 'lastActiveAt'>
): PlaybackSession {
	const now = Date.now();
	const session: PlaybackSession = {
		...fields,
		id: randomBytes(18).toString('base64url'),
		createdAt: now,
		lastActiveAt: now
	};
	sessions.set(session.id, session);
	return session;
}

/** Looks up a playback owned by the given app session; null for anyone else's. */
export function getPlayback(id: string, appSessionHash: string | undefined) {
	const session = sessions.get(id);
	if (!session || !appSessionHash || session.appSessionHash !== appSessionHash) return null;
	session.lastActiveAt = Date.now();
	return session;
}

export function removePlayback(id: string) {
	const castId = sessions.get(id)?.castId;
	if (castId) castIds.delete(castId);
	sessions.delete(id);
}

/**
 * The playback's cast id: a secret that gives access to this playback's stream (and nothing
 * else) for as long as the playback lasts.
 */
export function castIdFor(session: PlaybackSession) {
	if (!session.castId) {
		session.castId = CAST_PREFIX + randomBytes(24).toString('base64url');
		castIds.set(session.castId, session.id);
	}
	return session.castId;
}

/** Looks up a playback by its cast id. Counts as activity, like `getPlayback`. */
export function getCastPlayback(castId: string) {
	const id = castIds.get(castId);
	const session = id ? sessions.get(id) : undefined;
	if (!session) return null;
	session.lastActiveAt = Date.now();
	return session;
}

export function playbacksOf(appSessionHash: string) {
	return [...sessions.values()].filter((s) => s.appSessionHash === appSessionHash);
}

export function allPlaybacks() {
	return [...sessions.values()];
}

/** Last position (ms) and state the player reported, used when a playback is swept. */
export function recordReport(session: PlaybackSession, state: string, time: number) {
	session.lastState = state;
	session.lastTime = time;
	session.lastActiveAt = Date.now();
}
