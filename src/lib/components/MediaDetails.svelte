<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		formatDuration,
		formatRating,
		formatTimestamp,
		progress,
		watchHref
	} from '#lib/media.js';
	import type { MediaItem } from '#lib/plex-types.js';
	import Icon from './Icon.svelte';
	import PersonRow from './PersonRow.svelte';
	import WatchedToggle from './WatchedToggle.svelte';

	let { item }: { item: MediaItem } = $props();

	let versionId = $state<number | undefined>(undefined);
	const version = $derived(
		item.versions.find((v) => v.id === versionId) ?? item.versions[0] ?? null
	);
	const versionParam = $derived(item.versions.length > 1 ? version?.id : undefined);
	const fraction = $derived(progress(item));
	const badges = $derived([version?.resolution, version?.hdr, version?.audio].filter(Boolean));
	const facts = $derived(
		[
			item.type === 'episode' && item.releaseDate ? item.releaseDate : item.year,
			item.contentRating,
			formatDuration(item.duration)
		].filter(Boolean)
	);
	const available = $derived(version?.parts.every((p) => p.accessible) ?? true);
</script>

<article class="relative isolate">
	{#if item.art}
		<div class="absolute inset-x-0 top-0 -z-10 h-[60vh] overflow-hidden">
			<img src={item.art} alt="" class="h-full w-full object-cover opacity-50" />
			<div class="absolute inset-0 bg-gradient-to-t from-bg via-bg/60 to-bg/20"></div>
		</div>
	{/if}

	<div class="flex flex-col gap-6 px-4 pt-[18vh] pb-8 md:flex-row md:px-8 md:pt-24">
		{#if item.thumb && item.type !== 'episode'}
			<img
				src={item.thumb}
				alt=""
				class="hidden w-56 shrink-0 self-start rounded-xl shadow-2xl md:block"
			/>
		{/if}
		<div class="flex max-w-3xl flex-col gap-4">
			{#if item.type === 'episode' && item.grandparentId}
				<a
					href={resolve('/(app)/item/[id]', { id: item.grandparentId })}
					class="btn-link self-start text-lg font-semibold">{item.grandparentTitle}</a
				>
				<p class="text-muted">Season {item.parentIndex} · Episode {item.index}</p>
			{/if}
			<h1 class="text-3xl font-bold md:text-5xl">{item.title}</h1>
			{#if item.tagline}<p class="text-lg text-muted italic">{item.tagline}</p>{/if}

			<p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
				{#each facts as fact (fact)}<span>{fact}</span>{/each}
				{#each item.ratings as rating (rating.source + rating.type)}
					<span class="text-text">{formatRating(rating)}</span>
				{/each}
			</p>

			{#if badges.length}
				<ul class="flex flex-wrap gap-2" aria-label="Media details">
					{#each badges as badge (badge)}
						<li class="rounded border border-border px-2 py-0.5 text-xs font-semibold">{badge}</li>
					{/each}
				</ul>
			{/if}

			{#if fraction !== null}
				<div class="flex items-center gap-3 text-sm text-muted">
					<div class="h-1 w-40 rounded bg-white/20">
						<div class="h-full rounded bg-accent" style:width="{fraction * 100}%"></div>
					</div>
					{formatTimestamp(item.viewOffset!)} of {formatTimestamp(item.duration!)}
				</div>
			{/if}

			{#if !available}
				<p class="alert alert-error">This file is currently unavailable on the server.</p>
			{/if}

			<div class="flex flex-wrap gap-3">
				<!-- eslint-disable svelte/no-navigation-without-resolve -- watchHref() uses resolve() -->
				{#if fraction !== null}
					<a
						class="btn btn-primary"
						href={watchHref(item, { from: 'resume', version: versionParam })}
					>
						<Icon name="play" size={18} />
						Resume from {formatTimestamp(item.viewOffset!)}
					</a>
					<a
						class="btn btn-secondary"
						href={watchHref(item, { from: 'start', version: versionParam })}
					>
						Play from beginning
					</a>
				{:else}
					<a
						class="btn btn-primary"
						href={watchHref(item, { from: 'start', version: versionParam })}
					>
						<Icon name="play" size={18} />
						Play
					</a>
				{/if}
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{#if item.type !== 'clip'}
					<WatchedToggle watched={item.watched} />
				{/if}
			</div>

			{#if item.versions.length > 1}
				<fieldset class="flex flex-col gap-2">
					<legend class="label mb-2">Version</legend>
					{#each item.versions as v (v.id)}
						<label class="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3">
							<input
								type="radio"
								name="version"
								value={v.id}
								checked={v.id === version?.id}
								onchange={() => (versionId = v.id)}
								class="h-5 w-5 border-border bg-bg text-accent"
							/>
							<span>
								{[v.resolution, v.hdr, v.audio, v.container?.toUpperCase()]
									.filter(Boolean)
									.join(' · ')}
							</span>
						</label>
					{/each}
				</fieldset>
			{/if}

			{#if item.summary}<p class="max-w-prose leading-relaxed">{item.summary}</p>{/if}

			<dl class="grid max-w-prose grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
				{#if item.genres.length}
					<dt class="text-muted">Genres</dt>
					<dd>{item.genres.join(', ')}</dd>
				{/if}
				{#if item.directors.length}
					<dt class="text-muted">Directed by</dt>
					<dd>{item.directors.map((d) => d.name).join(', ')}</dd>
				{/if}
				{#if item.writers.length}
					<dt class="text-muted">Written by</dt>
					<dd>{item.writers.map((w) => w.name).join(', ')}</dd>
				{/if}
				{#if item.studio}
					<dt class="text-muted">Studio</dt>
					<dd>{item.studio}</dd>
				{/if}
			</dl>
		</div>
	</div>

	<div class="flex flex-col gap-8 pb-10">
		{#if item.cast.length}
			<PersonRow title="Cast" people={item.cast} />
		{/if}
		{#if item.extras.length}
			<section aria-labelledby="extras-title" class="flex flex-col gap-3">
				<h2 id="extras-title" class="px-4 text-lg font-semibold md:px-8">Extras</h2>
				<ul class="flex gap-4 overflow-x-auto px-4 pb-2 md:px-8" aria-label="Extras">
					{#each item.extras as extra (extra.id)}
						<li class="w-60 shrink-0">
							<!-- eslint-disable svelte/no-navigation-without-resolve -- watchHref() uses resolve() -->
							<a href={watchHref(extra, { from: 'start' })} class="flex flex-col gap-2 rounded-lg">
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
								<div class="aspect-video overflow-hidden rounded-lg bg-surface-2">
									{#if extra.thumb}
										<img
											src={extra.thumb}
											alt=""
											loading="lazy"
											class="h-full w-full object-cover"
										/>
									{/if}
								</div>
								<span class="text-sm font-medium">{extra.title}</span>
								{#if extra.extraKind}<span class="text-xs text-muted">{extra.extraKind}</span>{/if}
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>
</article>
