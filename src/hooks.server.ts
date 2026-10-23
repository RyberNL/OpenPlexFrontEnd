import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit/hooks';
import { createAuthHandle } from '#lib/server/auth/handle.js';
import { pruneChallenges } from '#lib/server/auth/passkeys.js';
import { prepareSetup } from '#lib/server/auth/setup.js';
import { config } from '#lib/server/config.js';
import { db } from '#lib/server/db/index.js';
import { PlexUnreachableError } from '#lib/server/plex/errors.js';
import { NotLinkedError } from '#lib/server/plex/session.js';
import { sweepStalePlaybacks } from '#lib/server/playback/timeline.js';

export const init: ServerInit = () => {
	// Fail fast with a readable message instead of erroring on the first request.
	config();
	// Opening the database applies pending migrations.
	prepareSetup(db(), config().publicOrigin);
	setInterval(() => pruneChallenges(db()), 10 * 60_000).unref();
	setInterval(() => void sweepStalePlaybacks(db()), 30_000).unref();
};

export const handle: Handle = createAuthHandle({ db, publicOrigin: () => config().publicOrigin });

export const handleError: HandleServerError = ({ kind, error }) => {
	if (kind !== 'unknown') return;
	if (error instanceof PlexUnreachableError) {
		return {
			status: 503,
			message: 'The media server is unavailable right now.',
			code: 'plex_unavailable'
		};
	}
	if (error instanceof NotLinkedError) {
		return error.reason === 'server'
			? { status: 409, message: 'No Plex server is linked yet.', code: 'server_not_linked' }
			: {
					status: 409,
					message: 'Your account is not linked to Plex yet. Ask an administrator to link it.',
					code: 'plex_not_linked'
				};
	}
	console.error(error);
};
