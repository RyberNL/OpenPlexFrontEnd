<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { Airing } from '#lib/plex-types.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const time = (ms: number) =>
		new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

	/** "2 h 16 min", "16 min", "<1 min" */
	function remaining(ms: number) {
		const minutes = Math.ceil(ms / 60_000);
		if (minutes < 1) return '<1 min';
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
	}

	function progress(airing: Airing) {
		return Math.min(
			1,
			Math.max(0, (data.now! - airing.beginsAt) / (airing.endsAt - airing.beginsAt))
		);
	}
</script>

<svelte:head><title>Live TV · OpenPlexFrontEnd</title></svelte:head>

<div class="flex flex-col gap-5 px-4 py-6 md:px-8">
	<nav class="flex w-fit gap-1 rounded-lg bg-surface p-1 text-sm" aria-label="Channel filter">
		<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs built with resolve() -->
		<a
			class="rounded px-3 py-2 aria-[current=page]:bg-surface-2 aria-[current=page]:font-semibold"
			href={resolve('/(app)/live')}
			aria-current={data.favoritesOnly ? undefined : 'page'}>All channels</a
		>
		<a
			class="rounded px-3 py-2 aria-[current=page]:bg-surface-2 aria-[current=page]:font-semibold"
			href={`${resolve('/(app)/live')}?favorites=1`}
			aria-current={data.favoritesOnly ? 'page' : undefined}>Favorites</a
		>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</nav>

	{#if !data.channels.length}
		<p class="text-muted" data-testid="no-channels">
			{data.favoritesOnly
				? 'No favorite channels yet. Mark channels with the star to see them here.'
				: 'The DVR has no channels.'}
		</p>
	{:else}
		<ul class="flex flex-col divide-y divide-border" aria-label="Channels">
			{#each data.channels as channel (channel.id)}
				<li class="flex items-center gap-3 py-3" data-testid="channel">
					<div class="flex h-12 w-16 shrink-0 items-center justify-center rounded bg-surface p-1">
						{#if channel.logo}
							<img src={channel.logo} alt="" class="max-h-full max-w-full object-contain" />
						{:else}
							<span class="text-xs font-semibold text-muted">{channel.number}</span>
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<p class="truncate font-semibold">
							<span class="text-muted tabular-nums">{channel.number}</span>
							{channel.title}
						</p>
						{#if channel.now}
							<p class="truncate text-sm" data-testid="now-playing">
								{channel.now.title}{channel.now.subtitle ? ` · ${channel.now.subtitle}` : ''}
							</p>
							<div class="mt-1 flex items-center gap-2 text-xs text-muted">
								<div
									class="h-1 w-24 overflow-hidden rounded bg-surface-2"
									role="progressbar"
									aria-label="Progress of {channel.now.title}"
									aria-valuenow={Math.round(progress(channel.now) * 100)}
									aria-valuemin="0"
									aria-valuemax="100"
								>
									<div class="h-full bg-accent" style:width="{progress(channel.now) * 100}%"></div>
								</div>
								<span class="whitespace-nowrap"
									>{remaining(channel.now.endsAt - data.now!)} left</span
								>
								{#if channel.next}<span class="truncate"
										>· Next {time(channel.next.beginsAt)} {channel.next.title}</span
									>{/if}
							</div>
						{:else}
							<p class="text-sm text-muted">No guide information</p>
						{/if}
					</div>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built with resolve() -->
					<a
						class="btn btn-primary min-h-10 px-4 py-1"
						href={resolve('/watch/live/[channel]', { channel: channel.id })}
						aria-label="Watch {channel.title}">Watch</a
					>
					<form method="POST" action="?/favorite" use:enhance>
						<input type="hidden" name="channel" value={channel.id} />
						<input type="hidden" name="favorite" value={channel.favorite ? '0' : '1'} />
						<button
							class="ctl flex h-11 w-11 items-center justify-center rounded-full text-xl hover:bg-surface-2"
							class:text-accent={channel.favorite}
							aria-pressed={channel.favorite}
							aria-label="Favorite {channel.title}">{channel.favorite ? '★' : '☆'}</button
						>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</div>
