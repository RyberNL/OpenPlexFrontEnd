import { randomUUID } from 'node:crypto';
import { openDatabase, type DB } from './db';
import { users } from './db/schema';

/** A fresh in-memory database with all migrations applied. */
export function testDb(): DB {
	return openDatabase(':memory:');
}

export function insertUser(db: DB, overrides: Partial<typeof users.$inferInsert> = {}) {
	return db
		.insert(users)
		.values({
			id: randomUUID(),
			username: `user-${randomUUID().slice(0, 8)}`,
			displayName: 'Test User',
			role: 'user',
			passwordHash: 'unused',
			webauthnUserId: randomUUID(),
			...overrides
		})
		.returning()
		.get();
}
