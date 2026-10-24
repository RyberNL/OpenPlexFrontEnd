import { z } from 'zod';
import type { MediaItem } from '#lib/plex-types.js';
import type { DB } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { plexId } from '../plex/http';
import { plexFor, type PlexSession } from '../plex/session';
import { TRANSCODE_BASE } from './playlist';
import { allPlaybacks, recordReport, removePlayback, type PlaybackSession } from './sessions';

export const timelineSchema = z.object({
	state: z.enum(['playing', 'paused', 'buffering', 'stopped']),
	/** Item time in ms. */
	time: z.number().min(0).max(1e9),
	duration: z.number().min(0).max(1e9).optional()
});
export type TimelineReport = z.infer<typeof timelineSchema>;

/**
 * Item time (ms) at which an item counts as watched: the start of its credits, or 90% of its
 * duration. Extras (trailers, featurettes…) never mark anything watched.
 */
export function watchedThreshold(item: Pick<MediaItem, 'type' | 'duration' | 'markers'>) {
	if (item.type === 'clip') return null;
	const credits = item.markers.find((m) => m.type === 'credits');
	if (credits) return credits.start;
	return item.duration ? Math.floor(item.duration * 0.9) : null;
}

/** Tells PMS where the user is, so progress shows up in Plex and resume works everywhere. */
export async function reportTimeline(
	plex: PlexSession,
	playback: PlaybackSession,
	report: TimelineReport
) {
	recordReport(playback, report.state, report.time);
	await plex.fetch('/:/timeline', {
		identity: playback.device,
		headers: { 'X-Plex-Session-Identifier': playback.plexSession },
		query: {
			ratingKey: plexId(playback.ratingKey),
			key: playback.live?.sessionKey ?? `/library/metadata/${plexId(playback.ratingKey)}`,
			state: report.state,
			time: Math.round(report.time),
			duration: Math.round(report.duration ?? playback.duration),
			'X-Plex-Session-Identifier': playback.plexSession
		}
	});
	if (playback.watchedAt !== null && !playback.scrobbled && report.time >= playback.watchedAt) {
		playback.scrobbled = true;
		await plex.fetch('/:/scrobble', {
			identity: playback.device,
			query: { key: plexId(playback.ratingKey), identifier: 'com.plexapp.plugins.library' }
		});
	}
}

/** Stops the PMS transcode of an HLS playback (no-op for direct play). */
export async function stopTranscode(plex: PlexSession, playback: PlaybackSession) {
	if (playback.method === 'directplay') return;
	await plex.fetch(`${TRANSCODE_BASE}stop`, {
		identity: playback.device,
		query: { session: playback.plexSession }
	});
}

/**
 * Frees the tuner of a live playback. PMS doesn't release a tuner grab by itself (not even after a
 * "stopped" report), so it is deleted.
 */
export async function releaseTuner(plex: PlexSession, playback: PlaybackSession) {
	if (!playback.live) return;
	await plex.fetch(playback.live.grabKey, { method: 'DELETE', identity: playback.device });
}

/** How often a live playback tunes its channel again (see `renewTuner`). */
export const RETUNE_AFTER = 60_000;

/**
 * Keeps a live playback's tuner. PMS ends a tuner subscription as idle after about four minutes,
 * however much is streamed from it, unless the client tunes the channel again; Plex's own apps do
 * so every few minutes, and PMS then keeps the existing grab. Called on the player's reports, so
 * renewing stops when the player does.
 */
export async function renewTuner(plex: PlexSession, playback: PlaybackSession, now = Date.now()) {
	const live = playback.live;
	if (!live || now - live.tunedAt < RETUNE_AFTER) return;
	live.tunedAt = now;
	await plex.fetch(live.tunePath, {
		method: 'POST',
		identity: playback.device,
		query: { autoPreview: 0 }
	});
}

/** Ends a playback: final "stopped" report, transcode stop, tuner release, and forget it. */
export async function endPlayback(plex: PlexSession, playback: PlaybackSession, time?: number) {
	removePlayback(playback.id);
	await Promise.allSettled([
		reportTimeline(plex, playback, { state: 'stopped', time: time ?? playback.lastTime ?? 0 }),
		stopTranscode(plex, playback),
		releaseTuner(plex, playback)
	]);
}

/** Playbacks without a report for this long are considered abandoned (crashed tab, lost network). */
export const STALE_AFTER = 60_000;

/** Ends abandoned playbacks so their transcodes don't keep running on the server. */
export async function sweepStalePlaybacks(db: DB, now = Date.now()) {
	const stale = allPlaybacks().filter((p) => now - p.lastActiveAt > STALE_AFTER);
	await Promise.allSettled(
		stale.map(async (playback) => {
			const user = db.select().from(users).where(eq(users.id, playback.userId)).get();
			if (!user) return removePlayback(playback.id);
			await endPlayback(plexFor(db, user), playback);
		})
	);
	return stale.length;
}
