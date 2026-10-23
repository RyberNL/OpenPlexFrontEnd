<script lang="ts">
	let { codes, next }: { codes: string[]; next?: string } = $props();

	let copied = $state(false);
	const text = $derived(`OpenPlexFrontEnd recovery codes\n\n${codes.join('\n')}\n`);
	const download = $derived(`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`);

	async function copy() {
		await navigator.clipboard.writeText(codes.join('\n'));
		copied = true;
	}
</script>

<div class="flex flex-col gap-4" data-testid="recovery-codes">
	<p class="alert alert-info">
		Save these recovery codes somewhere safe. Each one signs you in once if you lose your passkey or
		phone. <strong>They will not be shown again.</strong>
	</p>
	<ol class="grid grid-cols-2 gap-2 rounded-lg bg-bg p-4 font-mono text-sm sm:text-base">
		{#each codes as code (code)}
			<li>{code}</li>
		{/each}
	</ol>
	<div class="flex flex-wrap gap-3">
		<button type="button" class="btn btn-secondary" onclick={copy}>
			{copied ? 'Copied' : 'Copy codes'}
		</button>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- data: URL download, not navigation -->
		<a class="btn btn-secondary" href={download} download="openplexfrontend-recovery-codes.txt"
			>Download</a
		>
		{#if next}
			<!-- Full reload: the session just changed level. -->
			<button type="button" class="btn btn-primary" onclick={() => window.location.assign(next)}>
				I saved them, continue
			</button>
		{/if}
	</div>
</div>
