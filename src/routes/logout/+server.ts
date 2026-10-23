import { redirect } from '@sveltejs/kit';
import { audit } from '#lib/server/audit.js';
import { clearSession, clientInfo } from '#lib/server/auth/request.js';
import { db } from '#lib/server/db/index.js';
import { plexFor } from '#lib/server/plex/session.js';
import { playbacksOf } from '#lib/server/playback/sessions.js';
import { endPlayback } from '#lib/server/playback/timeline.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { user, session } = event.locals;
	if (user) {
		audit(db(), { event: 'auth.logout', actor: user, target: user, ip: clientInfo(event).ip });
	}
	// Signing out ends this browser's playbacks, so their transcodes don't keep running.
	const playbacks = session ? playbacksOf(session.idHash) : [];
	if (user && playbacks.length) {
		const plex = plexFor(db(), user);
		await Promise.allSettled(playbacks.map((p) => endPlayback(plex, p)));
	}
	clearSession(event);
	redirect(303, '/login');
};
