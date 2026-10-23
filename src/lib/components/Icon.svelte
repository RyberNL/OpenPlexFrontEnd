<script lang="ts">
	/** Minimal stroke icon set (24×24, currentColor). Decorative unless `label` is given. */
	import { ICON_PATHS, type IconName } from '#lib/icons.js';

	let {
		name,
		size = 24,
		label,
		class: className = ''
	}: { name: IconName; size?: number; label?: string; class?: string } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	<path d={ICON_PATHS[name]} />
</svg>
