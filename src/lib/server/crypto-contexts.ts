/**
 * Additional-authenticated-data contexts for every encrypted column. A value encrypted for one
 * context cannot be decrypted under another, so ciphertexts cannot be swapped between fields or
 * users. Key rotation uses these to re-encrypt each column.
 */
export const contexts = {
	totpSecret: (userId: string) => `totp:${userId}`,
	totpEnrollment: (userId: string) => `totp-enroll:${userId}`,
	plexOwnerToken: () => 'plex:owner',
	plexOwnerServerToken: () => 'plex:owner-server',
	plexHomeToken: (homeUserUuid: string) => `plex:home:${homeUserUuid}`,
	plexHomePin: (homeUserUuid: string) => `plex:home-pin:${homeUserUuid}`
};
