import { fail } from '@sveltejs/kit';
import { QUALITY_PRESETS } from '#lib/playback.js';
import { db } from '#lib/server/db/index.js';
import { getPrefs, prefsSchema, updatePrefs } from '#lib/server/prefs.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	prefs: getPrefs(db(), locals.user!.id),
	qualities: Object.entries(QUALITY_PRESETS).map(([value, p]) => ({ value, label: p.label }))
});

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const parsed = prefsSchema.partial().safeParse({
			quality: form.get('quality') ?? undefined,
			autoplayNext: form.get('autoplayNext') === 'on',
			autoSkipIntro: form.get('autoSkipIntro') === 'on',
			autoSkipCredits: form.get('autoSkipCredits') === 'on',
			subtitleSize: form.get('subtitleSize') ?? undefined,
			subtitleColor: form.get('subtitleColor') ?? undefined,
			subtitleBackground:
				form.get('subtitleBackground') !== null
					? Number(form.get('subtitleBackground'))
					: undefined,
			subtitlePosition: form.get('subtitlePosition') ?? undefined,
			simpleSubtitles: form.get('simpleSubtitles') === 'on'
		});
		if (!parsed.success) return fail(400, { error: 'Some settings were not valid.' });
		updatePrefs(db(), locals.user!.id, parsed.data);
		return { saved: true };
	}
};
