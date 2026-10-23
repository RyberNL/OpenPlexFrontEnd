import { describe, expect, it } from 'vitest';
import { getPrefs, updatePrefs } from './prefs';
import { insertUser, testDb } from './test-utils';
import { userPrefs } from './db/schema';

describe('preferences', () => {
	it('defaults, merges updates and survives bad stored values', () => {
		const db = testDb();
		const { id } = insertUser(db);
		expect(getPrefs(db, id)).toMatchObject({
			quality: 'original',
			autoplayNext: true,
			subtitleSize: 'medium'
		});
		expect(updatePrefs(db, id, { quality: '720p-2' }).quality).toBe('720p-2');
		expect(updatePrefs(db, id, { autoSkipIntro: true })).toMatchObject({
			quality: '720p-2',
			autoSkipIntro: true
		});
		db.update(userPrefs)
			.set({ prefs: { quality: 'bogus', subtitleSize: 42 } })
			.run();
		expect(getPrefs(db, id)).toMatchObject({ quality: 'original', subtitleSize: 'medium' });
	});
});
