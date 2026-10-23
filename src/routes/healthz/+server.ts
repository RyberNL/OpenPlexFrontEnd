import { db } from '#lib/server/db/index.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	db().$client.prepare('select 1').get();
	return new Response('ok', { headers: { 'cache-control': 'no-store' } });
};
