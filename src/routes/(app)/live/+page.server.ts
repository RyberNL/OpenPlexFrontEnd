import { fail } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { airingNow, channels, guide } from '#lib/server/plex/livetv.js';
import { userPlex } from '#lib/server/plex/request.js';
import { getPrefs, updatePrefs } from '#lib/server/prefs.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { dvr } = await event.parent();
	if (!dvr) return { channels: [], favoritesOnly: false };
	const plex = userPlex(event);
	const now = Date.now();
	const [lineup, airings] = await Promise.all([
		channels(plex, dvr),
		guide(plex, dvr, now, now + 3 * 3600_000)
	]);
	const onNow = airingNow(airings, now);
	const favorites = new Set(getPrefs(db(), event.locals.user!.id).favoriteChannels);
	const favoritesOnly = event.url.searchParams.get('favorites') === '1';
	return {
		now,
		favoritesOnly,
		channels: lineup
			.map((channel) => {
				const current = onNow.get(channel.id);
				return {
					...channel,
					favorite: favorites.has(channel.id),
					now: current ?? null,
					next:
						airings.find(
							(a) => a.channelId === channel.id && a.beginsAt >= (current?.endsAt ?? now)
						) ?? null
				};
			})
			.filter((c) => !favoritesOnly || c.favorite)
	};
};

export const actions: Actions = {
	/** Adds or removes a channel from the user's favorites. */
	favorite: async ({ request, locals }) => {
		const form = await request.formData();
		const channel = String(form.get('channel') ?? '');
		if (!channel || channel.length > 64) return fail(400, { error: 'Unknown channel' });
		const userId = locals.user!.id;
		const favorites = new Set(getPrefs(db(), userId).favoriteChannels);
		if (form.get('favorite') === '1') favorites.add(channel);
		else favorites.delete(channel);
		updatePrefs(db(), userId, { favoriteChannels: [...favorites] });
		return { saved: true };
	}
};
