<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatDuration, itemHref, progress, watchHref } from '#lib/media.js';
	import type { MediaItem } from '#lib/plex-types.js';
	import Icon from './Icon.svelte';
	import WatchedToggle from './WatchedToggle.svelte';

	let { season, episodes }: { season: MediaItem; episodes: MediaItem[] } = $props();
</script>

<div class="px-4 py-6 md:px-8">
	{#if season.parentId}
		<a
			href={resolve('/(app)/item/[id]', { id: season.parentId })}
			class="btn-link text-lg font-semibold">{season.parentTitle}</a
		>
	{/if}
	<h1 class="text-3xl font-bold">{season.title}</h1>
	<p class="text-muted">{episodes.length} episodes</p>
	<div class="mt-3">
		<WatchedToggle watched={episodes.length > 0 && episodes.every((e) => e.watched)} />
	</div>

	<ol class="mt-6 flex flex-col gap-4" aria-label="Episodes">
		{#each episodes as episode (episode.id)}
			{@const fraction = progress(episode)}
			<li class="card flex flex-col gap-3 overflow-hidden sm:flex-row" data-testid="episode">
				<!-- eslint-disable svelte/no-navigation-without-resolve -- watchHref()/itemHref() use resolve() -->
				<a
					href={watchHref(episode, { from: fraction !== null ? 'resume' : 'start' })}
					class="relative aspect-video shrink-0 bg-surface-2 sm:w-64"
					aria-label="Play episode {episode.index}: {episode.title}"
				>
					{#if episode.thumb}
						<img src={episode.thumb} alt="" loading="lazy" class="h-full w-full object-cover" />
					{/if}
					<span
						class="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition hover:opacity-100"
					>
						<Icon name="play" size={40} />
					</span>
					{#if fraction !== null}
						<div class="absolute inset-x-0 bottom-0 h-1 bg-black/60">
							<div class="h-full bg-accent" style:width="{fraction * 100}%"></div>
						</div>
					{/if}
				</a>
				<div class="flex flex-1 flex-col gap-1 p-4 sm:pl-0">
					<a href={itemHref(episode)} class="font-semibold hover:underline">
						{episode.index}. {episode.title}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
					<p class="flex flex-wrap gap-x-3 text-sm text-muted">
						<span>{formatDuration(episode.duration)}</span>
						{#if episode.watched}
							<span class="text-success" data-testid="episode-watched">Watched</span>
						{:else if fraction !== null}
							<span>In progress</span>
						{/if}
					</p>
					{#if episode.summary}
						<p class="line-clamp-3 text-sm">{episode.summary}</p>
					{/if}
				</div>
			</li>
		{/each}
	</ol>
</div>
