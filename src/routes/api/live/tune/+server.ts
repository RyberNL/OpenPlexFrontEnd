import { error } from '@sveltejs/kit';
import { PlaybackError } from '#lib/server/plex/decision.js';
import { userPlex } from '#lib/server/plex/request.js';
import { startLive, TunerBusyError, tuneRequestSchema } from '#lib/server/playback/live.js';
import { UnavailableError } from '#lib/server/playback/start.js';
import type { RequestHandler } from './$types';

/** Tunes a channel and returns its live stream. 409 when no tuner is free. */
export const POST: RequestHandler = async (event) => {
	const parsed = tuneRequestSchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid tune request');
	try {
		const info = await startLive(
			userPlex(event),
			event.locals.user!,
			event.locals.session!.idHash,
			parsed.data,
			event.request.headers.get('user-agent')
		);
		return Response.json(info);
	} catch (e) {
		if (e instanceof TunerBusyError) {
			return Response.json({ message: e.message, code: 'tuner_busy' }, { status: 409 });
		}
		if (e instanceof UnavailableError) {
			return Response.json({ message: e.message, code: 'unavailable' }, { status: 404 });
		}
		if (e instanceof PlaybackError) {
			return Response.json({ message: e.message, code: 'transcoder' }, { status: 502 });
		}
		throw e;
	}
};
