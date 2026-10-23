import { authenticationOptions } from '#lib/server/auth/passkeys.js';
import { challengeLimiter } from '#lib/server/auth/rate-limit.js';
import { clientInfo } from '#lib/server/auth/request.js';
import { db } from '#lib/server/db/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	if (!challengeLimiter.attempt(clientInfo(event).ip ?? 'unknown')) {
		return Response.json({ message: 'Too many attempts. Try again later.' }, { status: 429 });
	}
	return Response.json(await authenticationOptions(db(), null, null));
};
