import { authenticationOptions } from '#lib/server/auth/passkeys.js';
import { db } from '#lib/server/db/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	return Response.json(await authenticationOptions(db(), locals.user!, locals.session!.idHash));
};
