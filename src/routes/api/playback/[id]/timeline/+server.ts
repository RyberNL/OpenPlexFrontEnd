import { error } from '@sveltejs/kit';
import { plexForPlayback, requirePlayback } from '#lib/server/playback/relay.js';
import { endPlayback, reportTimeline, timelineSchema } from '#lib/server/playback/timeline.js';
import type { RequestHandler } from './$types';

/** Progress reports from the player (also sent with navigator.sendBeacon on page close). */
export const POST: RequestHandler = async (event) => {
	const playback = requirePlayback(event);
	const parsed = timelineSchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid timeline report');
	const plex = plexForPlayback(event);
	if (parsed.data.state === 'stopped') await endPlayback(plex, playback, parsed.data.time);
	else await reportTimeline(plex, playback, parsed.data);
	return new Response(null, { status: 204 });
};
