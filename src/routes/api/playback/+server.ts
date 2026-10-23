import { error } from '@sveltejs/kit';
import { PlaybackError } from '#lib/server/plex/decision.js';
import { PlexNotFoundError } from '#lib/server/plex/errors.js';
import { userPlex } from '#lib/server/plex/request.js';
import { startPlayback, startRequestSchema, UnavailableError } from '#lib/server/playback/start.js';
import type { RequestHandler } from './$types';

/** Starts a playback: decides direct play vs HLS and returns the stream URL. */
export const POST: RequestHandler = async (event) => {
	const parsed = startRequestSchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid playback request');
	try {
		const info = await startPlayback(
			userPlex(event),
			event.locals.user!,
			event.locals.session!.idHash,
			parsed.data,
			event.request.headers.get('user-agent')
		);
		return Response.json(info);
	} catch (e) {
		if (e instanceof UnavailableError) {
			return Response.json({ message: e.message, code: 'unavailable' }, { status: 409 });
		}
		if (e instanceof PlaybackError) {
			return Response.json({ message: e.message, code: 'transcoder' }, { status: 502 });
		}
		if (e instanceof PlexNotFoundError) error(404, 'Not found');
		throw e;
	}
};
