/**
 * Follows a subtitle URL until `signal` aborts. PMS converts embedded subtitles progressively and
 * returns what it has so far (and refuses until the stream's transcode has started), so the
 * subtitle is fetched again periodically. `onText` receives the text read so far, repeatedly;
 * `complete` is false while the response is still arriving (its end may be cut off mid-line).
 */
export function followSubtitle(
	url: string,
	signal: AbortSignal,
	onText: (text: string, complete: boolean) => void
) {
	const wait = (ms: number) =>
		new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, ms);
			signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
		});
	(async () => {
		while (!signal.aborted) {
			const response = await fetch(url, { signal }).catch(() => null);
			if (response?.ok && response.body) {
				const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
				let text = '';
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					text += value;
					onText(text, false);
				}
				onText(text, true);
				await wait(10_000);
			} else {
				await wait(1_500);
			}
		}
	})().catch(() => {
		// Aborted: the stream or the subtitle changed.
	});
}
