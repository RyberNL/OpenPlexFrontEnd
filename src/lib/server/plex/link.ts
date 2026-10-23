import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { decrypt, encrypt } from '../crypto';
import { contexts } from '../crypto-contexts';
import type { DB } from '../db';
import { appSettings, plexLink } from '../db/schema';
import { PlexError, PlexUnreachableError } from './errors';
import { plexJson, type ClientIdentity } from './http';
import { identitySchema, serverRootSchema } from './schemas';

const CLIENT_ID_KEY = 'plex_client_identifier';
const PENDING_KEY = 'plex_pending_link';
/** How long the admin has to approve the PIN on plex.tv. */
const PIN_TTL = 15 * 60_000;

export class LinkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LinkError';
	}
}

function setting(db: DB, key: string) {
	return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value;
}

function setSetting(db: DB, key: string, value: string | null) {
	if (value === null) {
		db.delete(appSettings).where(eq(appSettings.key, key)).run();
		return;
	}
	db.insert(appSettings)
		.values({ key, value })
		.onConflictDoUpdate({ target: appSettings.key, set: { value } })
		.run();
}

/** Stable identifier of this installation towards plex.tv and PMS. */
export function clientIdentifier(db: DB) {
	let id = setting(db, CLIENT_ID_KEY);
	if (!id) {
		id = `plex-web-${randomUUID()}`;
		setSetting(db, CLIENT_ID_KEY, id);
	}
	return id;
}

export function serverIdentity(db: DB): ClientIdentity {
	return { clientIdentifier: clientIdentifier(db), deviceName: 'OpenPlexFrontEnd server' };
}

/** Normalizes and checks a PMS URL; returns its machine identifier and version. */
export async function checkServer(db: DB, rawUrl: string) {
	let url: URL;
	try {
		url = new URL(rawUrl.trim());
		if (!/^https?:$/.test(url.protocol)) throw new Error();
	} catch {
		throw new LinkError('Enter the server address as http://host:32400.');
	}
	const serverUrl = url.origin;
	try {
		const { MediaContainer } = await plexJson(serverUrl, '/identity', identitySchema, {
			identity: serverIdentity(db)
		});
		return {
			serverUrl,
			machineIdentifier: MediaContainer.machineIdentifier,
			version: MediaContainer.version
		};
	} catch (error) {
		if (error instanceof PlexUnreachableError) {
			throw new LinkError(
				`Could not reach ${serverUrl}. Check the address and that Plex is running.`
			);
		}
		if (error instanceof PlexError) throw new LinkError(`${serverUrl} is not a Plex Media Server.`);
		throw error;
	}
}

const pinSchema = z.looseObject({
	id: z.number(),
	code: z.string(),
	authToken: z.string().nullish()
});

const resourcesSchema = z.array(
	z.looseObject({
		name: z.string().optional(),
		provides: z.string().optional(),
		clientIdentifier: z.string(),
		owned: z.boolean().optional(),
		accessToken: z.string().nullish()
	})
);

const userSchema = z.looseObject({
	uuid: z.string(),
	username: z.string().optional(),
	title: z.string().optional()
});

const pendingSchema = z.object({
	pinId: z.number(),
	code: z.string(),
	serverUrl: z.string(),
	machineIdentifier: z.string(),
	expiresAt: z.number()
});

export type PendingLink = z.infer<typeof pendingSchema>;

export function pendingLink(db: DB, now = Date.now()): PendingLink | null {
	const raw = setting(db, PENDING_KEY);
	if (!raw) return null;
	const pending = pendingSchema.safeParse(JSON.parse(raw));
	if (!pending.success || pending.data.expiresAt <= now) return null;
	return pending.data;
}

/**
 * Starts linking: verifies the server answers, then requests a plex.tv PIN for the owner to
 * approve at plex.tv/link.
 */
export async function startLink(db: DB, plexTvUrl: string, rawServerUrl: string, now = Date.now()) {
	const server = await checkServer(db, rawServerUrl);
	let pin;
	try {
		pin = await plexJson(plexTvUrl, '/api/v2/pins', pinSchema, {
			method: 'POST',
			identity: serverIdentity(db)
		});
	} catch (error) {
		if (error instanceof PlexError)
			throw new LinkError('Could not reach plex.tv. Try again later.');
		throw error;
	}
	const pending: PendingLink = {
		pinId: pin.id,
		code: pin.code,
		serverUrl: server.serverUrl,
		machineIdentifier: server.machineIdentifier,
		expiresAt: now + PIN_TTL
	};
	setSetting(db, PENDING_KEY, JSON.stringify(pending));
	return pending;
}

export type LinkStatus =
	| { status: 'idle' }
	| { status: 'pending'; code: string; expiresAt: number }
	| { status: 'linked'; serverName: string };

/** Checks whether the pending PIN was approved; completes the link when it was. */
export async function pollLink(db: DB, plexTvUrl: string, now = Date.now()): Promise<LinkStatus> {
	const pending = pendingLink(db, now);
	if (!pending) return { status: 'idle' };
	const identity = serverIdentity(db);

	const pin = await plexJson(plexTvUrl, `/api/v2/pins/${pending.pinId}`, pinSchema, { identity });
	if (!pin.authToken)
		return { status: 'pending', code: pending.code, expiresAt: pending.expiresAt };
	const accountToken = pin.authToken;

	const resources = await plexJson(plexTvUrl, '/api/v2/resources', resourcesSchema, {
		identity,
		token: accountToken,
		query: { includeHttps: 1, includeRelay: 0 }
	});
	const resource = resources.find(
		(r) => r.clientIdentifier === pending.machineIdentifier && r.owned && r.accessToken
	);
	setSetting(db, PENDING_KEY, null);
	if (!resource) {
		throw new LinkError(
			`The plex.tv account you approved with does not own the server at ${pending.serverUrl}. Sign in to plex.tv as the server owner and try again.`
		);
	}
	const serverToken = resource.accessToken!;

	const [root, user] = await Promise.all([
		plexJson(pending.serverUrl, '/', serverRootSchema, { identity, token: serverToken }),
		plexJson(plexTvUrl, '/api/v2/user', userSchema, { identity, token: accountToken })
	]);
	const values = {
		id: 1,
		serverUrl: pending.serverUrl,
		machineIdentifier: pending.machineIdentifier,
		serverName: root.MediaContainer.friendlyName ?? resource.name ?? 'Plex Media Server',
		serverVersion: root.MediaContainer.version,
		ownerTokenEnc: encrypt(accountToken, contexts.plexOwnerToken()),
		ownerServerTokenEnc: encrypt(serverToken, contexts.plexOwnerServerToken()),
		ownerUuid: user.uuid,
		clientIdentifier: identity.clientIdentifier,
		linkedAt: now
	};
	db.insert(plexLink).values(values).onConflictDoUpdate({ target: plexLink.id, set: values }).run();
	return { status: 'linked', serverName: values.serverName };
}

export type LinkedServer = {
	serverUrl: string;
	machineIdentifier: string;
	serverName: string;
	serverVersion: string;
	ownerUuid: string | null;
	clientIdentifier: string;
	linkedAt: number;
};

/** The linked server, without its secrets; null when not linked yet. */
export function linkedServer(db: DB): LinkedServer | null {
	const row = db.select().from(plexLink).where(eq(plexLink.id, 1)).get();
	if (!row) return null;
	return {
		serverUrl: row.serverUrl,
		machineIdentifier: row.machineIdentifier,
		serverName: row.serverName,
		serverVersion: row.serverVersion,
		ownerUuid: row.ownerUuid,
		clientIdentifier: row.clientIdentifier,
		linkedAt: row.linkedAt
	};
}

export function ownerAccountToken(db: DB) {
	const row = db.select().from(plexLink).where(eq(plexLink.id, 1)).get();
	return row ? decrypt(row.ownerTokenEnc, contexts.plexOwnerToken()) : null;
}

export function ownerServerToken(db: DB) {
	const row = db.select().from(plexLink).where(eq(plexLink.id, 1)).get();
	return row ? decrypt(row.ownerServerTokenEnc, contexts.plexOwnerServerToken()) : null;
}

/** Live check of the linked server: refreshes the stored version when reachable. */
export async function serverStatus(db: DB) {
	const server = linkedServer(db);
	if (!server) return null;
	try {
		const { MediaContainer } = await plexJson(server.serverUrl, '/identity', identitySchema, {
			identity: serverIdentity(db)
		});
		if (MediaContainer.version !== server.serverVersion) {
			db.update(plexLink)
				.set({ serverVersion: MediaContainer.version })
				.where(eq(plexLink.id, 1))
				.run();
		}
		return { ...server, serverVersion: MediaContainer.version, connected: true };
	} catch {
		return { ...server, connected: false };
	}
}
