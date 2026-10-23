import { registrationOptions } from '#lib/server/auth/passkeys.js';
import { hasRecentStepUp } from '#lib/server/auth/session.js';
import { db } from '#lib/server/db/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	const session = locals.session!;
	if (session.level === 'full' && !hasRecentStepUp(session)) {
		return Response.json(
			{ message: 'Verify it’s you first.', code: 'step_up_required' },
			{ status: 403 }
		);
	}
	return Response.json(await registrationOptions(db(), locals.user!, session.idHash));
};
