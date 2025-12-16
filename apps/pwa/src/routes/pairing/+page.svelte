<script lang="ts">
  import { onMount } from 'svelte'
  import PairingForm from '$lib/components/PairingForm.svelte'

  let tokenFromUrl = ''
  onMount(() => {
    tokenFromUrl = new URLSearchParams(location.search).get('token') ?? ''
  })
</script>

<svelte:head>
  <title>Pair Device — Navis AI</title>
</svelte:head>

<div class="page-padding">
  <main class="max-w-2xl mx-auto py-12 space-y-8">
    <section class="panel">
      <div class="panel-header">
        <h1 class="text-2xl font-semibold">Pair a new device</h1>
      </div>
      <div class="panel-body space-y-4">
        <p class="text-slate-600">
          Enter the pairing token shown in the onboarding QR code. After approval, Navis will
          supply a trusted credential pair (deviceId + secret) and you can reconnect securely.
        </p>
        <PairingForm initialToken={tokenFromUrl} />
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <h2 class="text-lg font-medium">Tips</h2>
      </div>
      <div class="panel-body space-y-2">
        <p class="text-sm text-slate-600">
          • The host dashboard on your laptop always shows a QR + pairing token at
          <strong class="font-mono text-navy-700">https://navis.local/welcome</strong>.
        </p>
        <p class="text-sm text-slate-600">
          • If you already scanned a QR code, the token is embedded in the URL’s <code>?token=</code>
          query parameter and will auto-populate this form.
        </p>
        <p class="text-sm text-slate-600">
          • After pairing, other devices can connect at
          <strong class="font-mono text-navy-700">https://navis.local</strong> using the stored
          credentials.
        </p>
      </div>
    </section>
  </main>
</div>
