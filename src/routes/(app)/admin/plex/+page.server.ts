import { fail } from '@sveltejs/kit';
import { config } from '#lib/server/config.js';
import { db } from '#lib/server/db/index.js';
import { LinkError, pendingLink, serverStatus, startLink } from '#lib/server/plex/link.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const pending = pendingLink(db());
	return {
		server: await serverStatus(db()),
		pending: pending && { code: pending.code, expiresAt: pending.expiresAt },
		defaultUrl: config().plexUrl
	};
};

export const actions: Actions = {
	start: async ({ request }) => {
		const serverUrl = String((await request.formData()).get('serverUrl') ?? '');
		try {
			const pending = await startLink(db(), config().plexTvUrl, serverUrl);
			return { pending: { code: pending.code, expiresAt: pending.expiresAt } };
		} catch (error) {
			if (error instanceof LinkError) return fail(400, { serverUrl, error: error.message });
			throw error;
		}
	}
};
