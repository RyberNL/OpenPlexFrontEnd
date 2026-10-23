// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Session, User } from '#lib/server/auth/session.js';

declare global {
	namespace App {
		interface Error {
			status: number;
			message: string;
			/** Distinguishes states the UI explains specially (e.g. Plex unavailable). */
			code?: 'plex_unavailable' | 'plex_not_linked' | 'server_not_linked';
		}
		interface Locals {
			session: Session | null;
			user: User | null;
			/** Raw session token from the cookie, needed to rotate the session. */
			sessionToken: string | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
