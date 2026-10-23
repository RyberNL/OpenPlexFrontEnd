<script lang="ts">
	let { class: className = '' }: { class?: string } = $props();
</script>

<div class="skeleton rounded-lg bg-surface-2 {className}" aria-hidden="true"></div>

<style>
	.skeleton {
		background-image: linear-gradient(
			90deg,
			transparent 0,
			color-mix(in srgb, var(--color-text) 6%, transparent) 50%,
			transparent 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.4s ease-in-out infinite;
	}
	@keyframes shimmer {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.skeleton {
			animation: none;
		}
	}
</style>
