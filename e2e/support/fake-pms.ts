import { FAKE_PMS_URL } from '../../playwright.config';

export async function fakePms(
	action:
		| 'offline'
		| 'online'
		| 'reset'
		| 'approve-pins'
		| 'clear-patches'
		| 'fail-transcode'
		| 'heal-transcode'
		| 'end-live'
		| 'no-dvr'
		| 'with-dvr'
		| 'occupy-tuner'
		| 'free-tuner'
) {
	const response = await fetch(`${FAKE_PMS_URL}/__fake/${action}`, { method: 'POST' });
	if (!response.ok) throw new Error(`fake PMS ${action} failed`);
}

export async function fakePmsRequests(): Promise<
	{ method: string; path: string; query: Record<string, string>; token: string | null }[]
> {
	return (await fetch(`${FAKE_PMS_URL}/__fake/requests`)).json();
}

/** Merges `fields` into the fake PMS details of item `key`, as seen with `token`. */
export async function patchMetadata(
	key: string,
	fields: Record<string, unknown>,
	token = 'owner-token'
) {
	const response = await fetch(`${FAKE_PMS_URL}/__fake/patch-metadata`, {
		method: 'POST',
		body: JSON.stringify({ token, key, fields })
	});
	if (!response.ok) throw new Error('patch failed');
}

/** Marks items watched or unwatched on the fake PMS for `token`, like another Plex client would. */
export async function setWatched(keys: string[], watched: boolean, token = 'owner-token') {
	for (const key of keys) {
		const response = await fetch(
			`${FAKE_PMS_URL}/:/${watched ? 'scrobble' : 'unscrobble'}?key=${key}&identifier=com.plexapp.plugins.library`,
			{ headers: { 'X-Plex-Token': token } }
		);
		if (!response.ok) throw new Error('scrobble failed');
	}
}

export async function fakeTranscodes(): Promise<
	Record<string, { stopped: boolean; query: Record<string, string> }>
> {
	return (await fetch(`${FAKE_PMS_URL}/__fake/transcodes`)).json();
}

/** Who holds the fake DVR's single tuner, and every tune request so far. */
export async function fakeTuner(): Promise<{
	tuner: { grabKey: string; channel: string; ratingKey: string } | null;
	tunes: { channel: string; client: string; session: string; ok: boolean }[];
}> {
	return (await fetch(`${FAKE_PMS_URL}/__fake/tuner`)).json();
}
