<script lang="ts">
	import type { Airing, LiveChannel } from '#lib/plex-types.js';

	/** Details of one airing: what it is, when, where, and (when airing) a way to watch it. */
	let {
		airing,
		channel,
		now,
		watchHref,
		onclose
	}: {
		airing: Airing;
		channel?: LiveChannel;
		now: number;
		/** Where "Watch" leads; shown only while the program is airing. */
		watchHref?: string;
		onclose: () => void;
	} = $props();

	let dialog: HTMLDialogElement;

	const time = (ms: number) =>
		new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	const day = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: 'long' });
	const airingNow = $derived(airing.beginsAt <= now && now < airing.endsAt);
	const episode = $derived(
		[
			airing.season !== undefined ? `S${airing.season}` : '',
			airing.episode !== undefined ? `E${airing.episode}` : ''
		]
			.filter(Boolean)
			.join(' · ')
	);

	$effect(() => {
		dialog.showModal();
	});
</script>

<dialog
	bind:this={dialog}
	class="m-0 mt-auto w-full max-w-none rounded-t-2xl bg-surface p-0 text-text shadow-2xl backdrop:bg-black/60 md:m-auto md:max-w-lg md:rounded-2xl"
	aria-labelledby="program-title"
	{onclose}
	onclick={(e) => {
		if (e.target === dialog) dialog.close();
	}}
	data-testid="program-sheet"
>
	<div class="flex flex-col gap-3 p-5">
		{#if airing.thumb}
			<img
				src={airing.thumb}
				alt=""
				class="h-32 w-full rounded-lg bg-surface-2 object-contain p-2"
			/>
		{/if}
		<div>
			<h2 id="program-title" class="text-xl font-bold">{airing.title}</h2>
			{#if airing.subtitle || episode}
				<p class="text-muted">{[episode, airing.subtitle].filter(Boolean).join(' — ')}</p>
			{/if}
		</div>
		<p class="text-sm" data-testid="program-time">
			{#if airingNow}<span class="font-semibold text-accent">On now · </span>{/if}
			{day(airing.beginsAt)}
			{time(airing.beginsAt)}–{time(airing.endsAt)}{channel
				? ` · ${channel.number} ${channel.title}`
				: ''}
		</p>
		{#if airing.summary}<p class="text-sm text-muted">{airing.summary}</p>{/if}
		<div class="mt-2 flex gap-3">
			{#if airingNow && watchHref}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass resolve()d hrefs -->
				<a class="btn btn-primary flex-1" href={watchHref}>Watch</a>
			{/if}
			<button class="btn btn-secondary" onclick={() => dialog.close()}>Close</button>
		</div>
	</div>
</dialog>
