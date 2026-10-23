import type { Library } from '#lib/plex-types.js';
import { libraries, liveTv } from '#lib/server/plex/api.js';
import { userPlex } from '#lib/server/plex/request.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	const user = event.locals.user!;
	// Navigation must render even when Plex is unreachable or the user is not linked; the page
	// itself explains those states.
	// userPlex() throws synchronously when nothing is linked, so wrap it before catching.
	const [nav, live] = await Promise.all([
		(async (): Promise<Library[]> => libraries(userPlex(event)))().catch(() => []),
		(async () => !!(await liveTv(userPlex(event))))().catch(() => false)
	]);
	return {
		me: {
			id: user.id,
			displayName: user.displayName,
			username: user.username,
			isAdmin: user.role === 'admin'
		},
		libraries: nav,
		/** The server has a DVR, so Live TV is offered. */
		liveTv: live
	};
};
