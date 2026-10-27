<script lang="ts">
	import { followSubtitle } from './subtitle-feed';
	import { activeCues, parseSubtitles, settledPart, type Cue } from './subtitles';

	export type SubtitleStyle = {
		size: 'small' | 'medium' | 'large' | 'xlarge';
		color: 'white' | 'yellow' | 'cyan';
		background: number;
		position: 'bottom' | 'raised';
	};

	let {
		url,
		streamTime,
		streamOffset,
		style,
		raised = false
	}: {
		url: string;
		/** Seconds into the current stream (video.currentTime). */
		streamTime: number;
		/** Item time (ms) at which the stream starts. */
		streamOffset: number;
		style: SubtitleStyle;
		/** Lift above the player controls while they are visible. */
		raised?: boolean;
	} = $props();

	let cues = $state<Cue[]>([]);

	/** Keeps the cues up to date, merging in new ones as the subtitle grows. */
	$effect(() => {
		const controller = new AbortController();
		// Bookkeeping inside the effect only; deliberately not reactive.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const seen = new Set<string>();
		cues = [];
		followSubtitle(url, controller.signal, (text, complete) => {
			const fresh = parseSubtitles(complete ? text : settledPart(text)).filter(
				(c) => !seen.has(`${c.start}|${c.text}`)
			);
			if (!fresh.length) return;
			fresh.forEach((c) => seen.add(`${c.start}|${c.text}`));
			cues = [...cues, ...fresh].sort((a, b) => a.start - b.start);
		});
		return () => controller.abort();
	});

	// Cue times are item times: sidecar files are, and PMS keeps original timestamps for streams
	// started at an offset (copyts), e.g. a stream from 10:00 starts with cues at 0:10:03.
	const now = $derived(streamOffset / 1000 + streamTime);
	const visible = $derived(activeCues(cues, now));

	const SIZES = {
		small: 'clamp(14px,2.4vw,22px)',
		medium: 'clamp(16px,3vw,30px)',
		large: 'clamp(20px,4vw,42px)',
		xlarge: 'clamp(24px,5.2vw,56px)'
	};
	const COLORS = { white: '#ffffff', yellow: '#ffe14d', cyan: '#7df9ff' };
</script>

<div
	class="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-1 px-4 text-center transition-[bottom] duration-200"
	style:bottom={raised ? '7.5rem' : style.position === 'raised' ? '18%' : '6%'}
	aria-live="off"
	data-testid="subtitles"
>
	{#each visible as cue (cue.start + cue.text)}
		<p
			class="max-w-[90%] rounded px-2 py-0.5 leading-snug whitespace-pre-line"
			style:font-size={SIZES[style.size]}
			style:color={COLORS[style.color]}
			style:background-color="rgb(0 0 0 / {style.background})"
			style:text-shadow="0 1px 3px rgb(0 0 0 / 0.9)"
			data-testid="subtitle-cue"
		>
			{cue.text}
		</p>
	{/each}
</div>
