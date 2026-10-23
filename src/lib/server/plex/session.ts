import type { z } from 'zod';
import type { User } from '../auth/session';
import type { DB } from '../db';
import { PlexUnauthorizedError } from './errors';
import { serverTokenFor } from './home';
import { plexFetch, plexJson, type ClientIdentity, type RequestOptions } from './http';
import { linkedServer, serverIdentity } from './link';

/** The app has no linked server, or the user has no Plex identity yet. */
export class NotLinkedError extends Error {
	constructor(readonly reason: 'server' | 'user') {
		super(
			reason === 'server'
				? 'No Plex server is linked yet.'
				: 'This account is not linked to Plex yet.'
		);
		this.name = 'NotLinkedError';
	}
}

type Options = Omit<RequestOptions, 'identity' | 'token'> & { identity?: ClientIdentity };

export type PlexSession = {
	serverUrl: string;
	/** JSON request as the user's Plex identity; refreshes the token and retries once on 401. */
	json<S extends z.ZodType>(path: string, schema: S, options?: Options): Promise<z.output<S>>;
	/** Raw request (e.g. media streams) as the user's Plex identity, with the same retry. */
	fetch(path: string, options?: Options): Promise<Response>;
	/** The current server token, for building PMS URLs that are fetched server-side only. */
	token(): Promise<string>;
};

/** A Plex client acting as `user`'s mapped Plex Home user. */
export function plexFor(db: DB, user: Pick<User, 'plexHomeUserUuid'>): PlexSession {
	const server = linkedServer(db);
	if (!server) throw new NotLinkedError('server');
	if (!user.plexHomeUserUuid) throw new NotLinkedError('user');

	async function token(refresh = false) {
		const value = await serverTokenFor(db, user, { refresh });
		if (!value) throw new NotLinkedError('user');
		return value;
	}

	async function withRetry<T>(run: (token: string) => Promise<T>): Promise<T> {
		try {
			return await run(await token());
		} catch (error) {
			if (!(error instanceof PlexUnauthorizedError)) throw error;
			return run(await token(true));
		}
	}

	return {
		serverUrl: server.serverUrl,
		json: (path, schema, options = {}) =>
			withRetry((t) =>
				plexJson(server.serverUrl, path, schema, {
					...options,
					identity: options.identity ?? serverIdentity(db),
					token: t
				})
			),
		fetch: (path, options = {}) =>
			withRetry((t) =>
				plexFetch(server.serverUrl, path, {
					...options,
					identity: options.identity ?? serverIdentity(db),
					token: t
				})
			),
		token: () => token()
	};
}
