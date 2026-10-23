<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Airing } from '#lib/plex-types.js';
	import ProgramSheet from '../ProgramSheet.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let selected = $state<Airing | null>(null);

	const channel = (id: string) => data.channels.find((c) => c.id === id);
	const time = (ms: number) =>
		new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	function remaining(ms: number) {
		const minutes = Math.max(1, Math.ceil(ms / 60_000));
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
	}
</script>

<svelte:head><title>What's On · Live TV · OpenPlexFrontEnd</title></svelte:head>

{#snippet section(title: string, groups: typeof data.onNow, live: boolean)}
	<section class="flex flex-col gap-3" aria-label={title}>
		<h2 class="text-xl font-bold">{title}</h2>
		{#if !groups.length}
			<p class="text-muted">Nothing in the guide.</p>
		{/if}
		{#each groups as group (group.name)}
			{#if group.name}<h3 class="font-semibold text-muted">{group.name}</h3>{/if}
			<ul
				class="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4"
				aria-label={group.name ?? title}
			>
				{#each group.airings as airing (airing.id)}
					{@const ch = channel(airing.channelId)}
					<li>
						<button
							class="flex w-full flex-col gap-2 rounded-lg text-left"
							onclick={() => (selected = airing)}
							data-testid="whats-on-item"
						>
							<div class="relative aspect-video w-full overflow-hidden rounded-lg bg-surface-2">
								{#if airing.thumb}
									<img
										src={airing.thumb}
										alt=""
										loading="lazy"
										class="h-full w-full object-contain p-3"
									/>
								{/if}
								{#if live}
									<div class="absolute inset-x-0 bottom-0 h-1 bg-black/50">
										<div
											class="h-full bg-accent"
											style:width="{((data.now - airing.beginsAt) /
												(airing.endsAt - airing.beginsAt)) *
												100}%"
										></div>
									</div>
								{/if}
							</div>
							<div class="min-w-0">
								<p class="truncate font-semibold">{airing.title}</p>
								<p class="truncate text-sm text-muted">
									{ch ? `${ch.number} ${ch.title}` : ''}
								</p>
								<p class="text-sm text-muted" data-testid="whats-on-time">
									{live
										? `${remaining(airing.endsAt - data.now)} left`
										: `${time(airing.beginsAt)}–${time(airing.endsAt)}`}
								</p>
							</div>
						</button>
					</li>
				{/each}
			</ul>
		{/each}
	</section>
{/snippet}

<div class="flex flex-col gap-8 px-4 py-6 md:px-8">
	{@render section('On now', data.onNow, true)}
	{@render section('Starting soon', data.soon, false)}
</div>

{#if selected}
	<ProgramSheet
		airing={selected}
		channel={channel(selected.channelId)}
		now={data.now}
		watchHref={resolve('/watch/live/[channel]', { channel: selected.channelId })}
		onclose={() => (selected = null)}
	/>
{/if}
