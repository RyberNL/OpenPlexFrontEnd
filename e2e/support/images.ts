// Sign image URLs exactly like the e2e server does (same key as playwright.config.ts).
process.env.PUBLIC_ORIGIN ??= 'http://localhost:4173';
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');

export { imageUrl } from '../../src/lib/server/plex/images';
