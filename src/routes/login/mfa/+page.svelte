<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthCard from '#lib/components/AuthCard.svelte';
	import PasskeyButton from '#lib/components/PasskeyButton.svelte';
	import { verifyWithPasskey } from '#lib/passkeys.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let submitting = $state(false);
</script>

<AuthCard title="Verify it's you" subtitle="Confirm your sign-in with your second factor.">
	<div class="flex flex-col gap-6">
		{#if form?.error}
			<p class="alert alert-error" role="alert">{form.error}</p>
		{/if}

		{#if data.hasPasskey}
			<PasskeyButton
				label="Use a passkey"
				run={verifyWithPasskey}
				onDone={(result) => window.location.assign((result as { redirect: string }).redirect)}
				variant={data.hasTotp ? 'secondary' : 'primary'}
			/>
		{/if}

		{#if data.hasTotp}
			<form
				method="POST"
				action="?/totp"
				class="flex flex-col gap-4"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
			>
				<div class="field">
					<label for="code">Code from your authenticator app</label>
					<input
						id="code"
						name="code"
						class="input font-mono tracking-widest"
						inputmode="numeric"
						autocomplete="one-time-code"
						maxlength="7"
						required
					/>
				</div>
				<button class="btn btn-primary" disabled={submitting}>Verify</button>
			</form>
		{/if}

		<details class="group" open={!!form?.recoveryError}>
			<summary class="btn-link inline-flex cursor-pointer items-center text-sm">
				Use a recovery code
			</summary>
			<form method="POST" action="?/recovery" class="mt-3 flex flex-col gap-4" use:enhance>
				{#if form?.recoveryError}
					<p class="alert alert-error" role="alert">{form.recoveryError}</p>
				{/if}
				<div class="field">
					<label for="recoveryCode">Recovery code</label>
					<input
						id="recoveryCode"
						name="recoveryCode"
						class="input font-mono uppercase"
						autocomplete="off"
						autocapitalize="characters"
						spellcheck="false"
						placeholder="XXXXX-XXXXX"
						required
					/>
				</div>
				<button class="btn btn-secondary">Use recovery code</button>
			</form>
		</details>
	</div>
	<form method="POST" action="/logout" class="mt-6 text-center">
		<button class="btn-link text-sm">Cancel and sign out</button>
	</form>
</AuthCard>
