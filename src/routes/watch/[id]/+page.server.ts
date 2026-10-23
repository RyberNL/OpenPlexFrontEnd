import { db } from '#lib/server/db/index.js';
import { getPrefs } from '#lib/server/prefs.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({ prefs: getPrefs(db(), locals.user!.id) });
