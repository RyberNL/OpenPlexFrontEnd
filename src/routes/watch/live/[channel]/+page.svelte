<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import LivePlayer from '#lib/player/LivePlayer.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const channel = $derived(page.params.channel!);

	function back() {
		if (history.length > 1) history.back();
		else void goto(resolve('/(app)/live'));
	}
</script>

<svelte:head>
	<title>Live TV · OpenPlexFrontEnd</title>
	<meta name="theme-color" content="#000000" />
</svelte:head>

{#key channel}
	<LivePlayer
		{channel}
		channels={data.channels}
		airings={data.airings}
		quality={data.prefs.quality}
		onBack={back}
		onSwitch={(id) => goto(resolve('/watch/live/[channel]', { channel: id }), { replace: true })}
	/>
{/key}
