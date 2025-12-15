<script lang="ts">
  import { onMount } from 'svelte'
  import { apiClient } from '$lib/api/client'

  let pairingToken = ''
  let clientName = ''
  let clientDeviceInfo = ''
  let statusMessage = ''
  let isSubmitting = false
  const exampleMetadata = '{"platform":"iOS","model":"iPhone 15"}'
  const fieldIds = {
    token: 'pairing-token',
    name: 'pairing-name',
    metadata: 'pairing-metadata'
  }

  const defaultName = 'Phone'

  async function handlePair(event: Event) {
    event.preventDefault()
    if (!pairingToken.trim()) {
      statusMessage = 'Enter the pairing token from the QR code or host dashboard.'
      return
    }

    let metadata
    if (clientDeviceInfo.trim()) {
      try {
        metadata = JSON.parse(clientDeviceInfo)
      } catch {
        statusMessage = 'Device metadata must be valid JSON.'
        return
      }
    }

    isSubmitting = true
    statusMessage = ''

    try {
      await apiClient.startPairing({
        pairingToken: pairingToken.trim(),
        clientName: clientName.trim() || defaultName,
        clientDeviceInfo: metadata
      })
      statusMessage =
        'Pairing successful! Your device is now trusted and can access Navis AI over HTTPS.'
    } catch (error) {
      statusMessage =
        error instanceof Error ? error.message : 'Pairing failed. Try again or refresh.'
    } finally {
      isSubmitting = false
    }
  }

  onMount(() => {
    const pathToken = new URLSearchParams(location.search).get('token')
    if (pathToken) {
      pairingToken = pathToken
    }
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
        <form class="space-y-4" on:submit|preventDefault={handlePair}>
          <div>
            <label for={fieldIds.token} class="text-sm font-medium text-slate-700">Pairing Token</label>
            <input
              id={fieldIds.token}
              type="text"
              bind:value={pairingToken}
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy-500"
              placeholder="e.g., A1B2C3D4E5"
              required
            />
          </div>
          <div>
            <label for={fieldIds.name} class="text-sm font-medium text-slate-700">Device Name</label>
            <input
              id={fieldIds.name}
              type="text"
              bind:value={clientName}
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy-500"
              placeholder="Device Friendly Name"
            />
          </div>
          <div>
            <label for={fieldIds.metadata} class="text-sm font-medium text-slate-700"
              >Optional device metadata (JSON)</label
            >
            <textarea
              id={fieldIds.metadata}
              rows="3"
              bind:value={clientDeviceInfo}
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy-500"
              placeholder={exampleMetadata}
            ></textarea>
          </div>
          <div class="flex flex-col gap-1">
            <button
              type="submit"
              class="btn btn-primary"
              disabled={isSubmitting}
            >
              {#if isSubmitting}
                Pairing…
              {:else}
                Start Pairing
              {/if}
            </button>
            {#if statusMessage}
              <p class="text-sm text-slate-600">{statusMessage}</p>
            {/if}
          </div>
        </form>
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
