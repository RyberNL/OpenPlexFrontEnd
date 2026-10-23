<script lang="ts">
	import AuthCard from '#lib/components/AuthCard.svelte';
	import PasskeyButton from '#lib/components/PasskeyButton.svelte';
	import RecoveryCodes from '#lib/components/RecoveryCodes.svelte';
	import TotpEnroll from '#lib/components/TotpEnroll.svelte';
	import { registerPasskey } from '#lib/passkeys.js';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();

	let passkeyResult = $state<{ redirect: string; recoveryCodes: string[] | null } | null>(null);
	const recovery = $derived(
		form?.recoveryCodes
			? { codes: form.recoveryCodes, next: form.next }
			: passkeyResult?.recoveryCodes
				? { codes: passkeyResult.recoveryCodes, next: passkeyResult.redirect }
				: null
	);

	function passkeyDone(result: unknown) {
		const r = result as { redirect: string; recoveryCodes: string[] | null };
		if (r.recoveryCodes) passkeyResult = r;
		else window.location.assign(r.redirect);
	}
</script>

{#if recovery}
	<AuthCard title="Save your recovery codes" subtitle="Two-factor authentication is set up.">
		<RecoveryCodes codes={recovery.codes} next={recovery.next} />
	</AuthCard>
{:else}
	<AuthCard
		title="Set up two-factor authentication"
		subtitle="Your account needs a passkey or an authenticator app before you can continue."
	>
		<div class="flex flex-col gap-3">
			{#if !form?.enrollment}
				<PasskeyButton label="Add a passkey" run={() => registerPasskey()} onDone={passkeyDone} />
				<p class="hint text-center">Recommended: use Face ID, fingerprint or your device PIN.</p>
				<div class="my-2 flex items-center gap-3 text-sm text-muted" aria-hidden="true">
					<span class="h-px flex-1 bg-border"></span>or<span class="h-px flex-1 bg-border"></span>
				</div>
			{/if}
			<TotpEnroll enrollment={form?.enrollment} error={form?.totpError} />
		</div>
		<form method="POST" action="/logout" class="mt-6 text-center">
			<button class="btn-link text-sm">Sign out</button>
		</form>
	</AuthCard>
{/if}
