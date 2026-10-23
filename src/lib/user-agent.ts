/** Short human-readable device description from a User-Agent string, e.g. "Safari on iPhone". */
export function describeUserAgent(ua: string | null | undefined): string {
	if (!ua) return 'Unknown device';
	const browser = /Edg\//.test(ua)
		? 'Edge'
		: /OPR\//.test(ua)
			? 'Opera'
			: /Firefox\//.test(ua)
				? 'Firefox'
				: /Chrome\//.test(ua)
					? 'Chrome'
					: /Safari\//.test(ua)
						? 'Safari'
						: 'Browser';
	const os = /iPhone/.test(ua)
		? 'iPhone'
		: /iPad/.test(ua)
			? 'iPad'
			: /Android/.test(ua)
				? 'Android'
				: /Mac OS X|Macintosh/.test(ua)
					? 'macOS'
					: /Windows/.test(ua)
						? 'Windows'
						: /CrOS/.test(ua)
							? 'ChromeOS'
							: /Linux/.test(ua)
								? 'Linux'
								: 'unknown OS';
	return `${browser} on ${os}`;
}
