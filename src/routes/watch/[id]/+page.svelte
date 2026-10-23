<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Player from '#lib/player/Player.svelte';
	import { parseQueue } from '#lib/queue.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const ratingKey = $derived(page.params.id!);
	const from = $derived(page.url.searchParams.get('from') === 'resume' ? 'resume' : 'start');
	const version = $derived(Number(page.url.searchParams.get('version')) || undefined);
	const queue = $derived.by(() => {
		const params = page.url.searchParams;
		const value = params.get('queue');
		if (!parseQueue(value)) return undefined;
		const pos = Number(params.get('pos'));
		return {
			queue: value!,
			shuffle: Number(params.get('shuffle')) || undefined,
			pos: Number.isInteger(pos) && pos > 0 ? pos : undefined
		};
	});

	function back() {
		if (history.length > 1) history.back();
		else void goto(resolve('/(app)/item/[id]', { id: ratingKey }));
	}
</script>

<svelte:head>
	<title>Playing · OpenPlexFrontEnd</title>
	<meta name="theme-color" content="#000000" />
</svelte:head>

{#key page.url.search + ratingKey}
	<Player {ratingKey} {from} {version} {queue} prefs={data.prefs} onBack={back} />
{/key}
