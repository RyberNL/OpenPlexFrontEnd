<script lang="ts">
	import { formatDuration, itemHref, progress } from '#lib/media.js';
	import type { MediaItem } from '#lib/plex-types.js';

	let { item }: { item: MediaItem } = $props();

	const heading = $derived(
		item.type === 'episode' ? (item.grandparentTitle ?? item.title) : item.title
	);
	const detail = $derived(
		item.type === 'episode'
			? [`S${item.parentIndex} · E${item.index}`, item.title].join(' · ')
			: [item.year, item.contentRating, formatDuration(item.duration)].filter(Boolean).join(' · ')
	);
	const fraction = $derived(progress(item));
</script>

<section
	class="relative isolate overflow-hidden md:mx-8 md:mt-6 md:rounded-2xl"
	aria-labelledby="featured-title"
	data-testid="featured"
>
	{#if item.art}
		<img
			src={item.art}
			alt=""
			class="absolute inset-0 -z-10 h-full w-full object-cover"
			fetchpriority="high"
		/>
	{/if}
	<div
		class="absolute inset-0 -z-10 bg-gradient-to-t from-bg via-bg/70 to-bg/10 md:bg-gradient-to-r md:from-bg md:via-bg/80 md:to-transparent"
	></div>
	<div
		class="flex min-h-[46vh] max-w-2xl flex-col justify-end gap-3 px-4 pt-24 pb-6 md:min-h-[22rem] md:px-10 md:pb-10"
	>
		<p class="text-sm font-semibold tracking-wide text-accent uppercase">
			{fraction !== null ? 'Continue watching' : 'Featured'}
		</p>
		<h2 id="featured-title" class="text-3xl font-bold md:text-4xl">{heading}</h2>
		<p class="text-muted">{detail}</p>
		{#if item.summary}
			<p class="line-clamp-3 max-w-prose text-sm md:text-base">{item.summary}</p>
		{/if}
		{#if fraction !== null}
			<div class="h-1 w-48 rounded bg-white/20">
				<div class="h-full rounded bg-accent" style:width="{fraction * 100}%"></div>
			</div>
		{/if}
		<div class="mt-2 flex flex-wrap gap-3">
			<!-- eslint-disable svelte/no-navigation-without-resolve -- itemHref() uses resolve() -->
			<a class="btn btn-primary" href={itemHref(item)}>More info</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</div>
	</div>
</section>
