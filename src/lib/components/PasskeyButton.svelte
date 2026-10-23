<script lang="ts">
	import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
	import { onMount } from 'svelte';
	import { PasskeyClientError } from '#lib/passkeys.js';

	let {
		label,
		run,
		onDone,
		variant = 'primary'
	}: {
		label: string;
		run: () => Promise<unknown>;
		onDone: (result: unknown) => void;
		variant?: 'primary' | 'secondary';
	} = $props();

	let supported = $state(true);
	let busy = $state(false);
	let error = $state<string | null>(null);

	onMount(() => {
		supported = browserSupportsWebAuthn();
	});

	async function click() {
		busy = true;
		error = null;
		try {
			onDone(await run());
		} catch (e) {
			error = e instanceof PasskeyClientError ? e.message : 'Something went wrong. Try again.';
		} finally {
			busy = false;
		}
	}
</script>

{#if supported}
	<div class="flex flex-col gap-2">
		<button type="button" class="btn btn-{variant} w-full" disabled={busy} onclick={click}>
			{busy ? 'Waiting for passkey…' : label}
		</button>
		{#if error}
			<p class="alert alert-error" role="alert">{error}</p>
		{/if}
	</div>
{:else}
	<p class="hint">This browser does not support passkeys.</p>
{/if}
