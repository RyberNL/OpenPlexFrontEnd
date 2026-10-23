import type { RequestEvent } from '@sveltejs/kit';
import { db } from '../db';
import { plexFor } from './session';

/** The Plex session of the signed-in user handling this request. */
export function userPlex(event: Pick<RequestEvent, 'locals'>) {
	return plexFor(db(), event.locals.user!);
}
