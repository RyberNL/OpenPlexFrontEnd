import { error, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { PasskeyError } from './passkeys';

const verifyBody = z.object({
	challengeId: z.string().min(1),
	response: z.looseObject({ id: z.string(), rawId: z.string(), type: z.literal('public-key') }),
	name: z.string().max(64).optional()
});

/** Parses a passkey verification request body; responds 400 when malformed. */
export async function readVerifyBody(event: RequestEvent) {
	const parsed = verifyBody.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'Malformed passkey response');
	return parsed.data;
}

export function passkeyErrorResponse(e: unknown, status = 400) {
	if (e instanceof PasskeyError) return Response.json({ message: e.message }, { status });
	throw e;
}
