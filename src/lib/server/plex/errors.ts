export class PlexError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'PlexError';
	}
}

/** PMS (or plex.tv) could not be reached or did not answer in time. */
export class PlexUnreachableError extends PlexError {
	constructor(
		readonly url: string,
		cause?: unknown
	) {
		super(`Could not reach ${url}`);
		this.name = 'PlexUnreachableError';
		this.cause = cause;
	}
}

/** The token was rejected (HTTP 401). */
export class PlexUnauthorizedError extends PlexError {
	constructor(message = 'Plex rejected the access token') {
		super(message, 401);
		this.name = 'PlexUnauthorizedError';
	}
}

export class PlexNotFoundError extends PlexError {
	constructor(message = 'Not found on the Plex server') {
		super(message, 404);
		this.name = 'PlexNotFoundError';
	}
}

/** The response did not have the expected shape. */
export class PlexResponseError extends PlexError {
	constructor(message: string) {
		super(message, 502);
		this.name = 'PlexResponseError';
	}
}
