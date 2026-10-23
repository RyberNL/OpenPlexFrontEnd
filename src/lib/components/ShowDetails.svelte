<script lang="ts">
	import { formatRating, unwatchedCount, watchHref } from '#lib/media.js';
	import type { MediaItem } from '#lib/plex-types.js';
	import Icon from './Icon.svelte';
	import PersonRow from './PersonRow.svelte';
	import PosterCard from './PosterCard.svelte';
	import WatchedToggle from './WatchedToggle.svelte';

	let { show, seasons, next }: { show: MediaItem; seasons: MediaItem[]; next: MediaItem | null } =
		$props();

	const remaining = $derived(unwatchedCount(show));
	const nextLabel = $derived(
		next ? `${next.viewOffset ? 'Resume' : 'Play'} S${next.parentIndex}·E${next.index}` : null
	);
</script>

<article class="relative isolate">
	{#if show.art}
		<div class="absolute inset-x-0 top-0 -z-10 h-[60vh] overflow-hidden">
			<img src={show.art} alt="" class="h-full w-full object-cover opacity-50" />
			<div class="absolute inset-0 bg-gradient-to-t from-bg via-bg/60 to-bg/20"></div>
		</div>
	{/if}
	<div class="flex flex-col gap-6 px-4 pt-[18vh] pb-8 md:flex-row md:px-8 md:pt-24">
		{#if show.thumb}
			<img
				src={show.thumb}
				alt=""
				class="hidden w-56 shrink-0 self-start rounded-xl shadow-2xl md:block"
			/>
		{/if}
		<div class="flex max-w-3xl flex-col gap-4">
			<h1 class="text-3xl font-bold md:text-5xl">{show.title}</h1>
			<p class="flex flex-wrap gap-x-3 gap-y-1 text-muted">
				{#if show.year}<span>{show.year}</span>{/if}
				{#if show.contentRating}<span>{show.contentRating}</span>{/if}
				<span>{seasons.length} season{seasons.length === 1 ? '' : 's'}</span>
				{#if remaining}<span>{remaining} unwatched</span>{/if}
				{#each show.ratings as rating (rating.source + rating.type)}
					<span class="text-text">{formatRating(rating)}</span>
				{/each}
			</p>
			{#if next && nextLabel}
				<div class="flex flex-wrap items-center gap-3">
					<!-- eslint-disable svelte/no-navigation-without-resolve -- watchHref() uses resolve() -->
					<a
						class="btn btn-primary"
						href={watchHref(next, { from: next.viewOffset ? 'resume' : 'start' })}
					>
						<Icon name="play" size={18} />
						{nextLabel}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
					<span class="text-sm text-muted">{next.title}</span>
				</div>
			{:else}
				<p class="text-muted">You have watched every episode.</p>
			{/if}
			<div><WatchedToggle watched={show.watched} /></div>
			{#if show.summary}<p class="max-w-prose leading-relaxed">{show.summary}</p>{/if}
			{#if show.genres.length}<p class="text-sm text-muted">{show.genres.join(', ')}</p>{/if}
		</div>
	</div>

	<div class="flex flex-col gap-8 pb-10">
		<section aria-labelledby="seasons-title" class="flex flex-col gap-3 px-4 md:px-8">
			<h2 id="seasons-title" class="text-lg font-semibold">Seasons</h2>
			<ul class="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-4" aria-label="Seasons">
				{#each seasons as season (season.id)}
					<li><PosterCard item={season} /></li>
				{/each}
			</ul>
		</section>
		{#if show.cast.length}<PersonRow title="Cast" people={show.cast} />{/if}
	</div>
</article>
