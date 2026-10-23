const KEY = 'plex-web-device-id';

/** A stable per-browser id, so Plex shows each device as its own player. */
export function deviceId() {
	try {
		let id = localStorage.getItem(KEY);
		if (!id || !/^[\w-]{8,64}$/.test(id)) {
			id = crypto.randomUUID();
			localStorage.setItem(KEY, id);
		}
		return id;
	} catch {
		// Private mode without storage: a per-tab id still works.
		return crypto.randomUUID();
	}
}
