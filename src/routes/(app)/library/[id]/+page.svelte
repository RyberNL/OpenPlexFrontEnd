<script lang="ts">
	import { resolve } from '$app/paths';
	import { page as appPage } from '$app/state';
	import VirtualGrid from '#lib/components/VirtualGrid.svelte';
	import type { MediaItem } from '#lib/plex-types.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let grid: VirtualGrid | undefined = $state();
	let filtersOpen = $state(false);
	const lib = $derived(data.library);
	const query = $derived(appPage.url.search);
	const activeFilters = $derived(
		[
			data.filters.unwatched,
			data.filters.genre,
			data.filters.year,
			data.filters.contentRating,
			data.filters.resolution
		].filter(Boolean).length
	);

	async function load(offset: number, size: number): Promise<MediaItem[]> {
		const search = appPage.url.search;
		const response = await fetch(
			`/api/library/${lib.id}${search}${search ? '&' : '?'}offset=${offset}&size=${size}`
		);
		if (!response.ok) throw new Error('Could not load more items');
		return (await response.json()).items;
	}

	function submit(event: Event) {
		(event.currentTarget as HTMLFormElement).requestSubmit();
	}
</script>

<svelte:head>
	<title>{lib.title} · OpenPlexFrontEnd</title>
</svelte:head>

<div class="px-4 py-6 md:px-8">
	<header class="flex flex-wrap items-end justify-between gap-3">
		<a
			href={resolve('/(app)/library/[id]/collections', { id: lib.id })}
			class="btn btn-secondary order-last">Collections</a
		>
		<div>
			<h1 class="text-2xl font-bold">{lib.title}</h1>
			<p class="text-sm text-muted" role="status">
				{data.page.total}
				{lib.type === 'movie' ? 'movies' : 'shows'}
			</p>
		</div>
	</header>

	<form
		method="GET"
		class="mt-4 flex flex-col gap-3"
		data-sveltekit-keepfocus
		data-sveltekit-noscroll
		onchange={submit}
		aria-label="Sort and filter"
	>
		<div class="flex flex-wrap items-center gap-3">
			<div class="flex items-center gap-2">
				<label for="sort" class="text-sm text-muted">Sort</label>
				<select id="sort" name="sort" class="input w-auto">
					{#each data.sorts as option (option.value)}
						<option value={option.value} selected={data.sort === option.value}
							>{option.label}</option
						>
					{/each}
				</select>
			</div>
			<label class="flex min-h-11 items-center gap-2 rounded-lg px-1">
				<input
					type="checkbox"
					name="unwatched"
					value="1"
					checked={data.filters.unwatched}
					class="h-5 w-5 rounded border-border bg-bg text-accent"
				/>
				Unwatched
			</label>
			<button
				type="button"
				class="btn btn-secondary"
				aria-expanded={filtersOpen}
				aria-controls="more-filters"
				onclick={() => (filtersOpen = !filtersOpen)}
			>
				Filters{activeFilters ? ` (${activeFilters})` : ''}
			</button>
			<noscript><button class="btn btn-secondary">Apply</button></noscript>
		</div>
		<div
			id="more-filters"
			class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
			hidden={!filtersOpen && !activeFilters}
		>
			<div class="field">
				<label for="genre">Genre</label>
				<select id="genre" name="genre" class="input">
					<option value="">All genres</option>
					{#each data.options.genres as g (g.value)}
						<option value={g.value} selected={data.filters.genre === g.value}>{g.label}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label for="year">Year</label>
				<select id="year" name="year" class="input">
					<option value="">All years</option>
					{#each data.options.years as y (y.value)}
						<option value={y.value} selected={data.filters.year === y.value}>{y.label}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label for="rating">Content rating</label>
				<select id="rating" name="rating" class="input">
					<option value="">All ratings</option>
					{#each data.options.contentRatings as r (r.value)}
						<option value={r.value} selected={data.filters.contentRating === r.value}
							>{r.label}</option
						>
					{/each}
				</select>
			</div>
			{#if data.options.resolutions.length}
				<div class="field">
					<label for="res">Resolution</label>
					<select id="res" name="res" class="input">
						<option value="">Any resolution</option>
						{#each data.options.resolutions as r (r.value)}
							<option value={r.value} selected={data.filters.resolution === r.value}
								>{r.label}</option
							>
						{/each}
					</select>
				</div>
			{/if}
		</div>
	</form>

	{#if data.letters.length > 1}
		<nav
			aria-label="Jump to letter"
			class="sticky top-0 z-20 -mx-4 mt-4 bg-bg/95 px-4 py-1 backdrop-blur md:-mx-8 md:px-8"
		>
			<ul class="flex gap-1 overflow-x-auto">
				{#each data.letters as entry (entry.letter)}
					<li>
						<button
							type="button"
							class="h-11 min-w-11 rounded-md px-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-text"
							aria-label="Jump to {entry.letter === '#' ? 'numbers' : entry.letter}"
							onclick={() => grid?.scrollToIndex(entry.offset)}
						>
							{entry.letter}
						</button>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}

	<div class="mt-4">
		{#if data.page.total === 0}
			<p class="text-muted">Nothing matches these filters.</p>
		{:else}
			{#key query}
				<VirtualGrid
					bind:this={grid}
					total={data.page.total}
					initial={data.page.items}
					{load}
					label="{lib.title} items"
				/>
			{/key}
		{/if}
	</div>
</div>
