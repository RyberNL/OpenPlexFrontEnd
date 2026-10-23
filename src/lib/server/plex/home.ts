import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { User } from '../auth/session';
import { config } from '../config';
import { decrypt, encrypt } from '../crypto';
import { contexts } from '../crypto-contexts';
import type { DB } from '../db';
import { plexHomeTokens, plexLink, users } from '../db/schema';
import { PlexError, PlexUnauthorizedError } from './errors';
import { plexJson } from './http';
import { linkedServer, ownerAccountToken, ownerServerToken, serverIdentity } from './link';

export class HomeUserError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'HomeUserError';
	}
}

const homeUsersSchema = z.looseObject({
	users: z.array(
		z.looseObject({
			uuid: z.string(),
			title: z.string(),
			username: z.string().nullish(),
			thumb: z.string().nullish(),
			admin: z.boolean().optional(),
			protected: z.boolean().optional(),
			restricted: z.boolean().optional()
		})
	)
});

export type HomeUser = {
	uuid: string;
	title: string;
	admin: boolean;
	protected: boolean;
	restricted: boolean;
};

function requireLink(db: DB) {
	const server = linkedServer(db);
	const accountToken = ownerAccountToken(db);
	if (!server || !accountToken) throw new HomeUserError('Link a Plex server first.');
	return { server, accountToken };
}

/** Plex Home users of the linked owner account (the owner is one of them). */
export async function listHomeUsers(db: DB, plexTvUrl = config().plexTvUrl): Promise<HomeUser[]> {
	const { accountToken } = requireLink(db);
	const result = await plexJson(plexTvUrl, '/api/v2/home/users', homeUsersSchema, {
		identity: serverIdentity(db),
		token: accountToken
	});
	return result.users.map((u) => ({
		uuid: u.uuid,
		title: u.title,
		admin: !!u.admin,
		protected: !!u.protected,
		restricted: !!u.restricted
	}));
}

const switchSchema = z.looseObject({ authToken: z.string() });
const resourcesSchema = z.array(
	z.looseObject({ clientIdentifier: z.string(), accessToken: z.string().nullish() })
);

/**
 * Obtains a fresh server access token for a Plex Home user: switch to the user on plex.tv, then
 * look up the linked server among that user's resources.
 */
async function fetchHomeServerToken(
	db: DB,
	uuid: string,
	pin: string | null,
	plexTvUrl: string
): Promise<string> {
	const { server, accountToken } = requireLink(db);
	const identity = serverIdentity(db);
	let userToken: string;
	try {
		({ authToken: userToken } = await plexJson(
			plexTvUrl,
			`/api/v2/home/users/${encodeURIComponent(uuid)}/switch`,
			switchSchema,
			{ method: 'POST', identity, token: accountToken, query: { pin: pin ?? undefined } }
		));
	} catch (error) {
		if (error instanceof PlexError && (error.status === 401 || error.status === 403)) {
			throw new HomeUserError(
				pin ? 'That Plex Home PIN is not correct.' : 'This Plex Home user needs their PIN.'
			);
		}
		throw error;
	}
	const resources = await plexJson(plexTvUrl, '/api/v2/resources', resourcesSchema, {
		identity,
		token: userToken,
		query: { includeHttps: 1, includeRelay: 0 }
	});
	const resource = resources.find((r) => r.clientIdentifier === server.machineIdentifier);
	if (!resource?.accessToken) {
		throw new HomeUserError('This Plex Home user does not have access to the linked server.');
	}
	return resource.accessToken;
}

function cachedToken(db: DB, uuid: string) {
	const row = db.select().from(plexHomeTokens).where(eq(plexHomeTokens.homeUserUuid, uuid)).get();
	return {
		token: row?.serverTokenEnc ? decrypt(row.serverTokenEnc, contexts.plexHomeToken(uuid)) : null,
		pin: row?.pinEnc ? decrypt(row.pinEnc, contexts.plexHomePin(uuid)) : null
	};
}

function storeToken(db: DB, uuid: string, token: string, pin: string | null) {
	const values = {
		serverTokenEnc: encrypt(token, contexts.plexHomeToken(uuid)),
		pinEnc: pin ? encrypt(pin, contexts.plexHomePin(uuid)) : null,
		updatedAt: Date.now()
	};
	db.insert(plexHomeTokens)
		.values({ homeUserUuid: uuid, ...values })
		.onConflictDoUpdate({ target: plexHomeTokens.homeUserUuid, set: values })
		.run();
}

/**
 * Maps an app user to a Plex Home user (or clears the mapping with `null`). For other Home users a
 * token is fetched right away, so a wrong PIN is reported to the admin immediately.
 */
export async function mapUser(
	db: DB,
	userId: string,
	homeUuid: string | null,
	pin: string | null = null,
	plexTvUrl = config().plexTvUrl
) {
	if (!homeUuid) {
		db.update(users)
			.set({ plexHomeUserUuid: null, plexHomeUserTitle: null, updatedAt: Date.now() })
			.where(eq(users.id, userId))
			.run();
		return null;
	}
	const homeUser = (await listHomeUsers(db, plexTvUrl)).find((u) => u.uuid === homeUuid);
	if (!homeUser) throw new HomeUserError('That Plex Home user no longer exists.');
	if (homeUuid !== linkedServer(db)!.ownerUuid) {
		const storedPin = pin || cachedToken(db, homeUuid).pin;
		storeToken(
			db,
			homeUuid,
			await fetchHomeServerToken(db, homeUuid, storedPin, plexTvUrl),
			storedPin
		);
	}
	db.update(users)
		.set({
			plexHomeUserUuid: homeUser.uuid,
			plexHomeUserTitle: homeUser.title,
			updatedAt: Date.now()
		})
		.where(eq(users.id, userId))
		.run();
	return homeUser;
}

/** Server token for a user's Plex identity; null when the user is not mapped. */
export async function serverTokenFor(
	db: DB,
	user: Pick<User, 'plexHomeUserUuid'>,
	options: { refresh?: boolean; plexTvUrl?: string } = {}
): Promise<string | null> {
	const uuid = user.plexHomeUserUuid;
	const server = linkedServer(db);
	if (!uuid || !server) return null;
	const plexTvUrl = options.plexTvUrl ?? config().plexTvUrl;

	if (uuid === server.ownerUuid) {
		if (!options.refresh) return ownerServerToken(db);
		// Re-resolve the owner's server token from plex.tv.
		const resources = await plexJson(plexTvUrl, '/api/v2/resources', resourcesSchema, {
			identity: serverIdentity(db),
			token: ownerAccountToken(db),
			query: { includeHttps: 1, includeRelay: 0 }
		});
		const token = resources.find(
			(r) => r.clientIdentifier === server.machineIdentifier
		)?.accessToken;
		if (!token) throw new PlexUnauthorizedError('The owner no longer has access to the server');
		db.update(plexLink)
			.set({ ownerServerTokenEnc: encrypt(token, contexts.plexOwnerServerToken()) })
			.where(eq(plexLink.id, 1))
			.run();
		return token;
	}

	const cached = cachedToken(db, uuid);
	if (cached.token && !options.refresh) return cached.token;
	const token = await fetchHomeServerToken(db, uuid, cached.pin, plexTvUrl);
	storeToken(db, uuid, token, cached.pin);
	return token;
}
