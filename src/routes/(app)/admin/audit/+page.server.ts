import { AUDIT_EVENTS, listAudit } from '#lib/server/audit.js';
import { listUsers } from '#lib/server/admin/users.js';
import { db } from '#lib/server/db/index.js';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 50;

export const load: PageServerLoad = ({ url }) => {
	const userId = url.searchParams.get('user') || undefined;
	const event = url.searchParams.get('event') || undefined;
	const before = Number(url.searchParams.get('before')) || undefined;
	const entries = listAudit(db(), {
		userId,
		event: event && (AUDIT_EVENTS as readonly string[]).includes(event) ? event : undefined,
		before,
		limit: PAGE_SIZE + 1
	});
	const more = entries.length > PAGE_SIZE;
	const page = entries.slice(0, PAGE_SIZE);
	return {
		entries: page,
		olderThan: more ? page[page.length - 1].id : null,
		filters: { user: userId ?? '', event: event ?? '' },
		users: listUsers(db()).map((u) => ({ id: u.id, username: u.username })),
		events: [...AUDIT_EVENTS]
	};
};
