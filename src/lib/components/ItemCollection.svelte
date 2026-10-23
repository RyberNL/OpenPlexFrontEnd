<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatDuration, watchHref } from '#lib/media.js';
	import { newSeed, queueOrder } from '#lib/queue.js';
	import type { MediaItem } from '#lib/plex-types.js';
	import Icon from './Icon.svelte';
	import PosterCard from './PosterCard.svelte';

	/** A collection or playlist: header with play/shuffle and its items in order. */
	let {
		container,
		items,
		queue,
		ordered = false
	}: { container: MediaItem; items: MediaItem[]; queue: string; ordered?: boolean } = $props();

	const total = $derived(items.reduce((sum, i) => sum + (i.duration ?? 0), 0));

	/** Starts the queue in a new random order; each item plays once (see queue.ts). */
	function shuffle() {
		const seed = newSeed();
		const first = items[queueOrder(items.length, seed)[0]];
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- watchHref() uses resolve()
		void goto(watchHref(first, { from: 'start', queue, shuffle: seed }));
	}
</script>

<div class="px-4 py-6 md:px-8">
	<header class="flex flex-col gap-4 md:flex-row md:items-end">
		{#if container.thumb}
			<img src={container.thumb} alt="" class="w-36 rounded-xl shadow-xl md:w-44" />
		{/if}
		<div class="flex flex-col gap-2">
			<p class="text-sm font-semibold tracking-wide text-accent uppercase">
				{container.type === 'playlist' ? 'Playlist' : 'Collection'}
			</p>
			<h1 class="text-3xl font-bold">{container.title}</h1>
			<p class="text-muted">
				{items.length} item{items.length === 1 ? '' : 's'}{total
					? ` · ${formatDuration(total)}`
					: ''}
			</p>
			{#if container.summary}<p class="max-w-prose">{container.summary}</p>{/if}
			{#if items.length}
				<div class="mt-2 flex flex-wrap gap-3">
					<!-- eslint-disable svelte/no-navigation-without-resolve -- watchHref() uses resolve() -->
					<a class="btn btn-primary" href={watchHref(items[0], { from: 'start', queue })}>
						<Icon name="play" size={18} /> Play
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
					<button class="btn btn-secondary" onclick={shuffle}>Shuffle</button>
				</div>
			{/if}
		</div>
	</header>

	{#if ordered}
		<ol class="mt-8 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4" aria-label="Items">
			{#each items as item, i (item.id + ':' + i)}
				<li><PosterCard {item} /></li>
			{/each}
		</ol>
	{:else}
		<ul class="mt-8 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4" aria-label="Items">
			{#each items as item (item.id)}
				<li><PosterCard {item} /></li>
			{/each}
		</ul>
	{/if}
</div>
