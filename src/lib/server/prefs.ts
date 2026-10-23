import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { QUALITY_PRESETS } from '#lib/playback.js';
import type { DB } from './db';
import { userPrefs } from './db/schema';

const quality = z.enum(Object.keys(QUALITY_PRESETS) as [keyof typeof QUALITY_PRESETS]);

/** Per-user preferences. Unknown or invalid stored values fall back to defaults. */
export const prefsSchema = z.object({
	quality: quality.catch('original').default('original'),
	subtitleSize: z.enum(['small', 'medium', 'large', 'xlarge']).catch('medium').default('medium'),
	subtitleColor: z.enum(['white', 'yellow', 'cyan']).catch('white').default('white'),
	subtitleBackground: z.number().min(0).max(1).catch(0.5).default(0.5),
	subtitlePosition: z.enum(['bottom', 'raised']).catch('bottom').default('bottom'),
	/** Show styled (ASS/SSA) subtitles as plain text with the appearance settings above. */
	simpleSubtitles: z.boolean().catch(false).default(false),
	autoplayNext: z.boolean().catch(true).default(true),
	autoSkipIntro: z.boolean().catch(false).default(false),
	autoSkipCredits: z.boolean().catch(false).default(false),
	favoriteChannels: z.array(z.string().max(64)).max(500).catch([]).default([])
});
export type Prefs = z.infer<typeof prefsSchema>;

export function getPrefs(db: DB, userId: string): Prefs {
	const row = db.select().from(userPrefs).where(eq(userPrefs.userId, userId)).get();
	return prefsSchema.parse(row?.prefs ?? {});
}

/** Merges validated changes into the user's preferences and returns the result. */
export function updatePrefs(db: DB, userId: string, changes: Partial<Prefs>): Prefs {
	const next = prefsSchema.parse({ ...getPrefs(db, userId), ...changes });
	db.insert(userPrefs)
		.values({ userId, prefs: next })
		.onConflictDoUpdate({ target: userPrefs.userId, set: { prefs: next } })
		.run();
	return next;
}
