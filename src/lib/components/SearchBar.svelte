<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { searchDraft } from '#lib/search-draft.svelte.js';
	import Icon from './Icon.svelte';

	let query = $state('');
	const id = $props.id();

	// Back here (e.g. from the search page): the next keystroke opens search again.
	onMount(() => {
		searchDraft.pending = false;
	});

	/**
	 * Searches as the user types: the first keystroke opens the search page, which takes over the
	 * typing (see searchDraft) and shows results as they go on.
	 */
	function open() {
		searchDraft.text = query;
		if (searchDraft.pending) return;
		searchDraft.pending = true;
		const q = query.trim();
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- path comes from resolve()
		void goto(`${resolve('/(app)/search')}${q ? `?q=${encodeURIComponent(q)}` : ''}`);
	}
</script>

<!-- Without JavaScript the form still opens the search page with the query. -->
<form
	role="search"
	method="GET"
	action={resolve('/(app)/search')}
	class="relative px-4 pt-4 md:px-8 md:pt-6"
	onsubmit={(event) => (event.preventDefault(), open())}
	data-testid="search-bar"
>
	<label for="{id}-q" class="sr-only">Search movies, shows, people and Live TV</label>
	<span
		class="pointer-events-none absolute top-1/2 left-7 mt-2 -translate-y-1/2 text-muted md:left-11 md:mt-3"
	>
		<Icon name="search" size={18} />
	</span>
	<input
		id="{id}-q"
		name="q"
		type="search"
		enterkeyhint="search"
		class="input pl-10"
		placeholder="Search movies, shows, people…"
		autocomplete="off"
		bind:value={query}
		oninput={open}
	/>
</form>
