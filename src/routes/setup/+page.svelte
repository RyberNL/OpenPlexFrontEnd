<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthCard from '#lib/components/AuthCard.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let submitting = $state(false);
</script>

<AuthCard title="Welcome" subtitle="Create the first administrator account.">
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
		<div class="field">
			<label for="token">Setup token</label>
			<input
				id="token"
				name="token"
				class="input font-mono"
				autocomplete="off"
				spellcheck="false"
				required
			/>
			<p class="hint">Printed in the server log when the app starts.</p>
		</div>
		<div class="field">
			<label for="username">Username</label>
			<input
				id="username"
				name="username"
				class="input"
				autocomplete="username"
				autocapitalize="none"
				spellcheck="false"
				defaultValue={form?.username ?? ''}
				required
			/>
		</div>
		<div class="field">
			<label for="displayName">Display name</label>
			<input
				id="displayName"
				name="displayName"
				class="input"
				autocomplete="name"
				defaultValue={form?.displayName ?? ''}
			/>
		</div>
		<div class="field">
			<label for="password">Password</label>
			<input
				id="password"
				name="password"
				type="password"
				class="input"
				autocomplete="new-password"
				minlength="12"
				maxlength="128"
				required
			/>
			<p class="hint">At least 12 characters.</p>
		</div>
		<div class="field">
			<label for="confirm">Confirm password</label>
			<input
				id="confirm"
				name="confirm"
				type="password"
				class="input"
				autocomplete="new-password"
				required
			/>
		</div>
		<button class="btn btn-primary mt-2" disabled={submitting}>Create admin account</button>
	</form>
</AuthCard>
