<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PosterCard from '#lib/components/PosterCard.svelte';
	import { searchDraft } from '#lib/search-draft.svelte.js';
	import type { SearchResults } from '#lib/plex-types.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Seeded once from the server-rendered search; afterwards the page updates them itself.
	// svelte-ignore state_referenced_locally
	let query = $state(data.q);
	// svelte-ignore state_referenced_locally
	let results = $state<SearchResults | null>(data.results);
	let loading = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;

	const time = new Intl.DateTimeFormat(undefined, {
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});

	const total = $derived(
		results
			? results.movies.length +
					results.shows.length +
					results.episodes.length +
					results.people.length +
					results.collections.length +
					results.programs.length
			: 0
	);

	let input: HTMLInputElement | undefined = $state();

	onMount(() => {
		// Opened by typing into a SearchBar: carry on where the typing is, with the cursor here.
		if (searchDraft.pending && input) {
			searchDraft.pending = false;
			query = searchDraft.text;
			input.focus();
			input.setSelectionRange(query.length, query.length);
			if (query.trim() !== data.q) void run();
			return;
		}
		// Text typed before the page finished loading never fired our input handler.
		if (input && input.value !== data.q) {
			query = input.value;
			void run();
		}
	});

	function onInput() {
		clearTimeout(timer);
		timer = setTimeout(run, 300);
	}

	async function run() {
		const q = query.trim();
		// Keep the query in the URL (shareable, survives reload) without reloading the page.
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- path comes from resolve()
		void goto(`${resolve('/(app)/search')}${q ? `?q=${encodeURIComponent(q)}` : ''}`, {
			shallow: true,
			replace: true,
			reset: false
		});
		controller?.abort();
		if (q.length < 2) {
			results = null;
			return;
		}
		controller = new AbortController();
		loading = true;
		try {
			const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
				signal: controller.signal
			});
			if (response.ok) results = await response.json();
		} catch {
			// Superseded by a newer query.
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Search · OpenPlexFrontEnd</title>
</svelte:head>

<div class="px-4 py-6 md:px-8">
	<h1 class="sr-only">Search</h1>
	<form role="search" method="GET" onsubmit={(e) => (e.preventDefault(), run())}>
		<label for="q" class="sr-only">Search movies, shows, people and Live TV</label>
		<input
			id="q"
			name="q"
			type="search"
			class="input text-lg"
			placeholder="Search movies, shows, people…"
			autocomplete="off"
			bind:value={query}
			bind:this={input}
			oninput={onInput}
		/>
	</form>

	<div class="mt-6 flex flex-col gap-8" aria-live="polite" aria-busy={loading}>
		{#if results && total === 0}
			<p class="text-muted" data-testid="no-results">No results for “{query.trim()}”.</p>
		{:else if results}
			{#each [{ title: 'Movies', list: results.movies }, { title: 'Shows', list: results.shows }, { title: 'Collections', list: results.collections }] as group (group.title)}
				{#if group.list.length}
					<section aria-label={group.title}>
						<h2 class="text-lg font-semibold">{group.title}</h2>
						<ul class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-4">
							{#each group.list as item (item.id)}<li><PosterCard {item} /></li>{/each}
						</ul>
					</section>
				{/if}
			{/each}
			{#if results.episodes.length}
				<section aria-label="Episodes">
					<h2 class="text-lg font-semibold">Episodes</h2>
					<ul class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
						{#each results.episodes as item (item.id)}<li>
								<PosterCard {item} landscape />
							</li>{/each}
					</ul>
				</section>
			{/if}
			{#if results.people.length}
				<section aria-label="People">
					<h2 class="text-lg font-semibold">People</h2>
					<ul class="mt-3 flex flex-wrap gap-4">
						{#each results.people as person (person.id)}
							<li class="w-24 text-center">
								<a
									href="{resolve('/(app)/person/[id]', {
										id: person.id!
									})}?name={encodeURIComponent(person.name)}"
									class="flex flex-col items-center gap-2"
								>
									<span class="h-20 w-20 overflow-hidden rounded-full bg-surface-2">
										{#if person.thumb}<img
												src={person.thumb}
												alt=""
												class="h-full w-full object-cover"
											/>{/if}
									</span>
									<span class="text-sm">{person.name}</span>
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
			{#if results.programs.length}
				<section aria-label="Live TV">
					<h2 class="text-lg font-semibold">On Live TV</h2>
					<ul class="mt-3 flex flex-col gap-2">
						{#each results.programs as program (program.id + program.beginsAt)}
							<li class="card flex flex-wrap justify-between gap-2 p-3">
								<span class="font-medium">{program.title}</span>
								<span class="text-sm text-muted"
									>{program.channel} · {time.format(program.beginsAt)}</span
								>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/if}
	</div>
</div>
