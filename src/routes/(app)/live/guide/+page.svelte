<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import type { Airing } from '#lib/plex-types.js';
	import ProgramSheet from '../ProgramSheet.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const PX_PER_MIN = 4;
	const ROW = 64;
	const WINDOW = 3 * 3600_000;
	const px = (ms: number) => (ms / 60_000) * PX_PER_MIN;

	// svelte-ignore state_referenced_locally
	const start = data.start;
	// svelte-ignore state_referenced_locally
	const end = data.end;
	const width = px(end - start);

	let now = $state(Date.now());
	let scroller: HTMLDivElement | undefined = $state();
	let channelWidth = $state(96);
	let view = $state({ left: 0, top: 0, width: 0, height: 0 });
	let selected = $state<Airing | null>(null);

	/** Loaded 3-hour windows by start time; a pending fetch is a promise placeholder. */
	// svelte-ignore state_referenced_locally
	let windows = $state<Record<number, Airing[]>>(
		Object.fromEntries(data.windows.map((w) => [w.from, w.airings]))
	);
	// Bookkeeping of fetches in flight; deliberately not reactive.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const pending = new Set<number>();

	async function loadWindow(from: number) {
		if (windows[from] || pending.has(from) || from >= end) return;
		pending.add(from);
		try {
			const response = await fetch(`/api/live/guide?from=${from}`);
			if (response.ok) windows[from] = (await response.json()).airings;
		} finally {
			pending.delete(from);
		}
	}

	/** The visible time range (ms), with an hour of margin either side. */
	const MARGIN = 60 * PX_PER_MIN;
	const visibleFrom = $derived(start + ((view.left - MARGIN) / PX_PER_MIN) * 60_000);
	const visibleTo = $derived(
		start + ((view.left + view.width - channelWidth + MARGIN) / PX_PER_MIN) * 60_000
	);
	const firstRow = $derived(Math.max(0, Math.floor(view.top / ROW) - 4));
	const lastRow = $derived(
		Math.min(data.channels.length, Math.ceil((view.top + view.height) / ROW) + 4)
	);

	$effect(() => {
		for (let from = start; from < end; from += WINDOW) {
			if (from + WINDOW > visibleFrom && from < visibleTo) void loadWindow(from);
		}
	});

	/** Visible airings by channel, from all loaded windows (a program can span two windows). */
	const rows = $derived.by(() => {
		// Rebuilt on every change, never mutated afterwards, so plain maps suffice.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const byChannel = new Map<string, Map<string, Airing>>();
		for (const airings of Object.values(windows)) {
			for (const a of airings) {
				if (a.endsAt <= visibleFrom || a.beginsAt >= visibleTo) continue;
				let row = byChannel.get(a.channelId);
				// eslint-disable-next-line svelte/prefer-svelte-reactivity
				if (!row) byChannel.set(a.channelId, (row = new Map()));
				row.set(a.id, a);
			}
		}
		return byChannel;
	});

	const slots = Array.from(
		{ length: Math.ceil((end - start) / 1800_000) },
		(_, i) => start + i * 1800_000
	);

	const time = (ms: number) =>
		new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

	function onScroll() {
		if (!scroller) return;
		view = {
			left: scroller.scrollLeft,
			top: scroller.scrollTop,
			width: scroller.clientWidth,
			height: scroller.clientHeight
		};
	}

	onMount(() => {
		channelWidth = scroller!.querySelector<HTMLElement>('[data-channel-cell]')?.offsetWidth ?? 96;
		// Start at the current half hour.
		scroller!.scrollLeft = px(now - (now % 1800_000) - start);
		onScroll();
		const observer = new ResizeObserver(onScroll);
		observer.observe(scroller!);
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => {
			observer.disconnect();
			clearInterval(timer);
		};
	});
</script>

<svelte:head><title>Guide · Live TV · OpenPlexFrontEnd</title></svelte:head>

<div class="px-4 pt-4 pb-4 md:px-8">
	<div
		bind:this={scroller}
		onscroll={onScroll}
		class="relative h-[calc(100dvh-14rem)] min-h-80 overflow-auto rounded-lg border border-border bg-surface md:h-[calc(100dvh-9rem)]"
		data-testid="guide"
		role="region"
		aria-label="Program guide"
		tabindex="-1"
	>
		<div class="relative" style:width="calc(var(--cw) + {width}px)" style="--cw: 6rem">
			<!-- Time header -->
			<div
				class="sticky top-0 z-20 flex h-10 bg-surface-2"
				style:width="calc(var(--cw) + {width}px)"
			>
				<div class="sticky left-0 z-30 w-[var(--cw)] shrink-0 bg-surface-2"></div>
				<div class="relative" style:width="{width}px">
					{#each slots as slot (slot)}
						<span
							class="absolute top-0 flex h-10 items-center border-l border-border pl-2 text-xs text-muted"
							style:left="{px(slot - start)}px"
							style:width="{px(1800_000)}px">{time(slot)}</span
						>
					{/each}
					{#if now >= start && now < end}
						<span
							class="absolute bottom-0 z-10 -translate-x-1/2 rounded bg-accent px-1 text-[10px] font-bold text-on-accent"
							style:left="{px(now - start)}px"
							data-testid="now-label">{time(now)}</span
						>
					{/if}
				</div>
			</div>

			<!-- Rows (only those near the viewport are rendered) -->
			<div class="relative" style:height="{data.channels.length * ROW}px">
				{#each data.channels.slice(firstRow, lastRow) as channel, i (channel.id)}
					<div
						class="absolute flex w-full border-b border-border"
						style:top="{(firstRow + i) * ROW}px"
						style:height="{ROW}px"
						data-testid="guide-row"
						data-channel={channel.id}
					>
						<div
							class="sticky left-0 z-10 flex w-[var(--cw)] shrink-0 flex-col items-center justify-center gap-0.5 border-r border-border bg-surface px-1"
							data-channel-cell
						>
							{#if channel.logo}
								<img src={channel.logo} alt="" class="max-h-6 max-w-16 object-contain" />
							{/if}
							<span class="w-full truncate text-center text-[11px] text-muted"
								>{channel.number}</span
							>
							<span class="w-full truncate text-center text-[11px]" title={channel.title}
								>{channel.title}</span
							>
						</div>
						<div class="relative" style:width="{width}px">
							{#each [...(rows.get(channel.id)?.values() ?? [])] as airing (airing.id)}
								{@const airingNow = airing.beginsAt <= now && now < airing.endsAt}
								<button
									class="absolute top-1 bottom-1 overflow-hidden rounded border px-2 text-left text-sm hover:border-accent"
									class:border-accent={airingNow}
									class:bg-accent-soft={airingNow}
									class:border-border={!airingNow}
									class:bg-surface-2={!airingNow}
									style:left="{px(Math.max(airing.beginsAt, start) - start) + 1}px"
									style:width="{Math.max(
										px(Math.min(airing.endsAt, end) - Math.max(airing.beginsAt, start)) - 2,
										4
									)}px"
									onclick={() => (selected = airing)}
									data-testid="airing"
									data-now={airingNow}
									aria-label="{airing.title}, {time(airing.beginsAt)}–{time(
										airing.endsAt
									)}, {channel.title}"
								>
									<span class="block truncate font-semibold">{airing.title}</span>
									<span class="block truncate text-xs text-muted"
										>{time(airing.beginsAt)}{airing.subtitle ? ` · ${airing.subtitle}` : ''}</span
									>
								</button>
							{/each}
						</div>
					</div>
				{/each}
				{#if now >= start && now < end}
					<div
						class="pointer-events-none absolute top-0 bottom-0 z-[5] w-0.5 bg-accent"
						style:left="calc(var(--cw) + {px(now - start)}px)"
						data-testid="now-marker"
					></div>
				{/if}
			</div>
		</div>
	</div>
</div>

{#if selected}
	<ProgramSheet
		airing={selected}
		channel={data.channels.find((c) => c.id === selected?.channelId)}
		{now}
		watchHref={resolve('/watch/live/[channel]', { channel: selected.channelId })}
		onclose={() => (selected = null)}
	/>
{/if}

<style>
	.bg-accent-soft {
		background: color-mix(in srgb, var(--color-accent) 18%, var(--color-surface-2));
	}
</style>
