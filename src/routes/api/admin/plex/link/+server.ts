import { audit } from '#lib/server/audit.js';
import { clientInfo } from '#lib/server/auth/request.js';
import { config } from '#lib/server/config.js';
import { db } from '#lib/server/db/index.js';
import { PlexError } from '#lib/server/plex/errors.js';
import { LinkError, pollLink } from '#lib/server/plex/link.js';
import type { RequestHandler } from './$types';

/** Polled by the admin page while waiting for the owner to approve the PIN on plex.tv. */
export const GET: RequestHandler = async (event) => {
	try {
		const result = await pollLink(db(), config().plexTvUrl);
		if (result.status === 'linked') {
			audit(db(), {
				event: 'admin.plex_linked',
				actor: event.locals.user,
				ip: clientInfo(event).ip,
				detail: { server: result.serverName }
			});
		}
		return Response.json(result);
	} catch (error) {
		if (error instanceof LinkError) {
			return Response.json({ status: 'error', message: error.message }, { status: 400 });
		}
		if (error instanceof PlexError) {
			return Response.json(
				{ status: 'error', message: 'Could not reach plex.tv. Try again later.' },
				{ status: 502 }
			);
		}
		throw error;
	}
};
