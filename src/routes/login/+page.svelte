<script lang="ts">
	import { browserSupportsWebAuthnAutofill, WebAuthnAbortService } from '@simplewebauthn/browser';
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import AuthCard from '#lib/components/AuthCard.svelte';
	import PasskeyButton from '#lib/components/PasskeyButton.svelte';
	import { signInWithPasskey } from '#lib/passkeys.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let submitting = $state(false);

	const go = (result: unknown) => window.location.assign((result as { redirect: string }).redirect);

	onMount(() => {
		// Offer saved passkeys in the username field's autofill menu.
		browserSupportsWebAuthnAutofill().then((supported) => {
			if (!supported) return;
			signInWithPasskey(data.returnTo, true).then(go, () => {
				// Aborted when the user picks another method; nothing to show.
			});
		});
		// The pending autofill request would otherwise outlive client-side navigation and block
		// the passkey prompt on the next page.
		return () => WebAuthnAbortService.cancelCeremony();
	});
</script>

<AuthCard title="Sign in">
	<form
		method="POST"
		class="flex flex-col gap-4"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		{#if form?.error}
			<p class="alert alert-error" role="alert">{form.error}</p>
		{/if}
		<input type="hidden" name="returnTo" value={data.returnTo} />
		<div class="field">
			<label for="username">Username</label>
			<input
				id="username"
				name="username"
				class="input"
				autocomplete="username webauthn"
				autocapitalize="none"
				spellcheck="false"
				defaultValue={form?.username ?? ''}
				required
			/>
		</div>
		<div class="field">
			<label for="password">Password</label>
			<input
				id="password"
				name="password"
				type="password"
				class="input"
				autocomplete="current-password"
				required
			/>
		</div>
		<button class="btn btn-primary mt-2" disabled={submitting}>Sign in</button>
	</form>

	<div class="my-5 flex items-center gap-3 text-sm text-muted" aria-hidden="true">
		<span class="h-px flex-1 bg-border"></span>or<span class="h-px flex-1 bg-border"></span>
	</div>
	<PasskeyButton
		label="Sign in with a passkey"
		variant="secondary"
		run={() => signInWithPasskey(data.returnTo)}
		onDone={go}
	/>
</AuthCard>
