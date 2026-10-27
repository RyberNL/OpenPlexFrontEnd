import { z } from 'zod';
import { METHOD_LABELS, type Quality } from '#lib/playback.js';
import type { Airing, LiveChannel } from '#lib/plex-types.js';
import { describeUserAgent } from '#lib/user-agent.js';
import type { User } from '../auth/session';
import { liveTv } from '../plex/api';
import { pmsDecision } from '../plex/decision';
import { plexId, type ClientIdentity } from '../plex/http';
import { airingNow, channels, guideWindow } from '../plex/livetv';
import type { PlexSession } from '../plex/session';
import { startRequestSchema, UnavailableError } from './start';
import { createPlayback, newPlexSessionId } from './sessions';

export const tuneRequestSchema = startRequestSchema
	.pick({ quality: true, caps: true, deviceId: true })
	.extend({ channel: z.string().regex(/^[\w.-]{1,32}$/) });
export type TuneRequest = z.infer<typeof tuneRequestSchema>;

/** All tuners are in use (PMS reports the grab as conflicting). */
export class TunerBusyError extends Error {
	constructor() {
		super('No tuner available right now');
		this.name = 'TunerBusyError';
	}
}

const tuneSchema = z.object({
	MediaContainer: z.looseObject({
		MediaSubscription: z
			.array(
				z.looseObject({
					MediaGrabOperation: z
						.array(
							z.looseObject({
								key: z.string(),
								status: z.string().optional(),
								error: z.string().optional(),
								Metadata: z
									.looseObject({ ratingKey: z.coerce.string(), key: z.string() })
									.optional()
							})
						)
						.optional()
				})
			)
			.optional()
	})
});

export type LiveInfo = {
	playbackId: string;
	src: string;
	kind: 'hls';
	method: string;
	methodLabel: string;
	reason?: string;
	streamOffset: 0;
	startAt: 0;
	quality: Quality;
	channel: LiveChannel;
	/** The program on air when tuning, if the guide knows it. */
	airing: Airing | null;
};

/**
 * Tunes a channel and starts a live playback of it. The live item plays through the same HLS relay
 * as library items; the tuner is freed when the playback ends (see `releaseTuner`).
 */
export async function startLive(
	plex: PlexSession,
	user: User,
	appSessionHash: string,
	request: TuneRequest,
	userAgent: string | null
): Promise<LiveInfo> {
	const dvr = await liveTv(plex);
	if (!dvr) throw new UnavailableError('Live TV is not set up on this server');
	const lineup = await channels(plex, dvr);
	const channel = lineup.find((c) => c.id === request.channel);
	if (!channel) throw new UnavailableError('This channel is not available');

	const device: ClientIdentity = {
		clientIdentifier: `plex-web-${request.deviceId}`,
		deviceName: describeUserAgent(userAgent),
		platform: 'Web'
	};
	const plexSession = newPlexSessionId();
	// PMS ties the tuner subscription to the session identifier and ends it as idle unless timeline
	// reports come in under that same identifier, as they do for this playback (see reportTimeline).
	const tuned = await plex.json(
		`/livetv/dvrs/${plexId(dvr.dvrId)}/channels/${encodeURIComponent(channel.id)}/tune`,
		tuneSchema,
		{
			method: 'POST',
			identity: device,
			headers: { 'X-Plex-Session-Identifier': plexSession },
			query: { autoPreview: 0 }
		}
	);
	const grab = tuned.MediaContainer.MediaSubscription?.[0]?.MediaGrabOperation?.[0];
	if (!grab) throw new UnavailableError('The channel could not be tuned');
	const release = () =>
		plex.fetch(grab.key, { method: 'DELETE', identity: device }).catch(() => {});
	if (grab.status === 'error' || !grab.Metadata) {
		await release();
		throw new TunerBusyError();
	}

	const quality = request.quality as Quality;
	const streamRequest = {
		ratingKey: grab.Metadata.ratingKey,
		mediaIndex: 0,
		partIndex: 0,
		quality,
		caps: request.caps,
		session: plexSession,
		device
	} as const;
	let decision;
	try {
		decision = await pmsDecision(plex, streamRequest);
	} catch (e) {
		await release();
		throw e;
	}

	const session = createPlayback({
		plexSession,
		appSessionHash,
		userId: user.id,
		ratingKey: grab.Metadata.ratingKey,
		mediaIndex: 0,
		partIndex: 0,
		partId: 0,
		partKey: '',
		method: decision.method,
		reason: decision.reason,
		quality,
		caps: request.caps,
		device,
		streamOffset: 0,
		startAt: 0,
		duration: 0,
		subtitleMode: 'none',
		subtitle: null,
		watchedAt: null,
		live: {
			channelId: channel.id,
			grabKey: grab.key,
			sessionKey: grab.Metadata.key,
			reportedAt: Date.now()
		}
	});
	const now = Date.now();
	const airing = await guideWindow(plex, dvr, now)
		.then((airings) => airingNow(airings, now).get(channel.id) ?? null)
		.catch(() => null);
	return {
		playbackId: session.id,
		src: `/stream/${session.id}/master.m3u8`,
		kind: 'hls',
		method: decision.method,
		methodLabel: METHOD_LABELS[decision.method],
		reason: decision.reason,
		streamOffset: 0,
		startAt: 0,
		quality,
		channel,
		airing
	};
}
