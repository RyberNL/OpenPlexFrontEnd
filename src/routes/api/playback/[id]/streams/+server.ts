import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { setStreams } from '#lib/server/plex/api.js';
import { plexForPlayback, requirePlayback } from '#lib/server/playback/relay.js';
import type { RequestHandler } from './$types';

const body = z
	.object({
		audioStreamId: z.number().int().positive().optional(),
		subtitleStreamId: z.number().int().min(0).optional()
	})
	.refine((b) => b.audioStreamId !== undefined || b.subtitleStreamId !== undefined);

/** Saves an audio/subtitle choice in Plex; the player then restarts the stream with it. */
export const POST: RequestHandler = async (event) => {
	const playback = requirePlayback(event);
	const parsed = body.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid stream selection');
	await setStreams(plexForPlayback(event), playback.partId, parsed.data);
	return new Response(null, { status: 204 });
};
