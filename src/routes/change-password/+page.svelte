<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthCard from '#lib/components/AuthCard.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let submitting = $state(false);
</script>

<AuthCard
	title="Choose a new password"
	subtitle="Your account was created with a temporary password. Set your own to continue."
>
	<form
		method="POST"
		class="flex flex-col gap-4"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
	>
		{#if form?.error}
			<p class="alert alert-error" role="alert">{form.error}</p>
		{/if}
		<div class="field">
			<label for="password">New password</label>
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
			<label for="confirm">Confirm new password</label>
			<input
				id="confirm"
				name="confirm"
				type="password"
				class="input"
				autocomplete="new-password"
				required
			/>
		</div>
		<button class="btn btn-primary mt-2" disabled={submitting}>Set password</button>
	</form>
</AuthCard>
