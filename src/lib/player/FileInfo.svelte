<script lang="ts">
	import type { MediaVersion, Part, Stream } from '#lib/plex-types.js';

	/** What is playing and how: the version, its streams, and the playback decision. */
	let {
		version,
		part,
		methodLabel,
		reason,
		onclose
	}: {
		version: MediaVersion;
		part: Part;
		methodLabel: string;
		reason?: string;
		onclose: () => void;
	} = $props();

	const kbps = (value: number | undefined) =>
		value === undefined
			? undefined
			: value >= 1000
				? `${(value / 1000).toFixed(1)} Mbps`
				: `${value} kbps`;

	function bytes(value: number | undefined) {
		if (value === undefined) return undefined;
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let size = value;
		let unit = 0;
		while (size >= 1024 && unit < units.length - 1) {
			size /= 1024;
			unit++;
		}
		return `${size.toFixed(unit >= 3 ? 2 : 0)} ${units[unit]}`;
	}

	const details = $derived(
		[
			['File', part.file],
			['Container', (part.container ?? version.container)?.toUpperCase()],
			['Resolution', [version.resolution, version.hdr].filter(Boolean).join(' ') || undefined],
			['Bitrate', kbps(version.bitrate)],
			['Size', bytes(part.size)]
		].filter((row): row is [string, string] => !!row[1])
	);

	const GROUPS: [Stream['type'], string][] = [
		['video', 'Video'],
		['audio', 'Audio'],
		['subtitle', 'Subtitles']
	];

	function describe(stream: Stream) {
		return [
			stream.displayTitle ?? stream.codec?.toUpperCase() ?? `Stream ${stream.id}`,
			kbps(stream.bitrate),
			stream.external ? 'file' : undefined
		]
			.filter(Boolean)
			.join(' · ');
	}
</script>

<div
	class="absolute inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col gap-5 overflow-y-auto bg-black/90 p-5 shadow-2xl"
	role="dialog"
	aria-label="File info"
	data-testid="file-info"
>
	<div class="flex items-center justify-between">
		<h2 class="text-lg font-semibold">File info</h2>
		<button class="btn btn-secondary min-h-9 px-3 py-1" onclick={onclose}>Close</button>
	</div>

	<section class="flex flex-col gap-1">
		<h3 class="text-xs font-semibold tracking-wide text-white/60 uppercase">Playback</h3>
		<p class="font-semibold" data-testid="file-info-method">{methodLabel}</p>
		{#if reason}<p class="text-sm text-white/80" data-testid="file-info-reason">{reason}</p>{/if}
	</section>

	<section class="flex flex-col gap-1">
		<h3 class="text-xs font-semibold tracking-wide text-white/60 uppercase">Version</h3>
		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
			{#each details as [label, value] (label)}
				<dt class="text-white/60">{label}</dt>
				<dd class="break-all">{value}</dd>
			{/each}
		</dl>
	</section>

	{#each GROUPS as [type, label] (type)}
		{@const streams = part.streams.filter((s) => s.type === type)}
		{#if streams.length}
			<section class="flex flex-col gap-1">
				<h3 class="text-xs font-semibold tracking-wide text-white/60 uppercase">{label}</h3>
				<ul class="flex flex-col gap-1 text-sm" aria-label="{label} streams">
					{#each streams as stream (stream.id)}
						<li class:text-accent={stream.selected}>
							{describe(stream)}{stream.selected && type !== 'video' ? ' (playing)' : ''}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/each}
</div>
