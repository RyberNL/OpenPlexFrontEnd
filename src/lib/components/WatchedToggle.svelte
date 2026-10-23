<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from './Icon.svelte';

	let { watched, label = '' }: { watched: boolean; label?: string } = $props();
	let busy = $state(false);
</script>

<form
	method="POST"
	action="?/watched"
	use:enhance={() => {
		busy = true;
		return async ({ update }) => {
			await update();
			busy = false;
		};
	}}
>
	<input type="hidden" name="watched" value={watched ? '0' : '1'} />
	<button class="btn btn-secondary" disabled={busy}>
		<Icon name={watched ? 'close' : 'check'} size={18} />
		{watched ? 'Mark as unwatched' : 'Mark as watched'}{label ? ` ${label}` : ''}
	</button>
</form>
