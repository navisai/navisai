<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { apiClient, type DeviceCredentials } from '$lib/api/client'
  import { setDeviceStore } from '$lib/stores/device'

  export let initialToken = ''
  export let defaultName = 'Phone'

  const dispatch = createEventDispatcher<{ paired: DeviceCredentials }>()

  let pairingToken = initialToken
  let clientName = ''
  let clientDeviceInfo = ''
  let statusMessage = ''
  let isSubmitting = false
  const exampleMetadata = '{"platform":"iOS","model":"iPhone 15"}'
  let metadataError = ''

  let prevToken = ''
  $: if (initialToken && initialToken !== prevToken) {
    pairingToken = initialToken
    prevToken = initialToken
  }

  function resetStatus() {
    statusMessage = ''
    metadataError = ''
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    resetStatus()

    if (!pairingToken.trim()) {
      statusMessage = 'Enter the pairing token shown in the QR code or the CLI output.'
      return
    }

    let metadata
    if (clientDeviceInfo.trim()) {
      try {
        metadata = JSON.parse(clientDeviceInfo)
      } catch {
        metadataError = 'Device metadata must be valid JSON.'
        return
      }
    }

    isSubmitting = true

    try {
      const result = await apiClient.startPairing({
        pairingToken: pairingToken.trim(),
        clientName: clientName.trim() || defaultName,
        clientDeviceInfo: metadata
      })

      const credentials = {
        deviceId: result.deviceId,
        deviceSecret: result.deviceSecret,
        deviceName: result.deviceName || clientName.trim() || defaultName
      }

      await setDeviceStore(credentials)
      dispatch('paired', credentials)
      statusMessage = 'Pairing successful!'
    } catch (error) {
      statusMessage =
        error instanceof Error ? error.message : 'Pairing failed; please try again.'
    } finally {
      isSubmitting = false
    }
  }
</script>

<form class="space-y-4" on:submit={handleSubmit}>
  <div>
    <label class="text-sm font-medium text-slate-700" for="pairing-token">Pairing Token</label>
    <input
      id="pairing-token"
      class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy-500"
      type="text"
      bind:value={pairingToken}
      placeholder="e.g., A1B2C3D4E5"
      required
    />
  </div>

  <div>
    <label class="text-sm font-medium text-slate-700" for="pairing-name">Device Name</label>
    <input
      id="pairing-name"
      class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy-500"
      type="text"
      bind:value={clientName}
      placeholder="Friendly device label"
    />
  </div>

  <div>
    <label class="text-sm font-medium text-slate-700" for="pairing-metadata"
      >Optional device metadata (JSON)</label
    >
    <textarea
      id="pairing-metadata"
      rows="3"
      class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy-500"
      bind:value={clientDeviceInfo}
      placeholder={exampleMetadata}
    ></textarea>
    {#if metadataError}
      <p class="text-xs text-rose-600 mt-1">{metadataError}</p>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    <button
      type="submit"
      class="btn btn-primary flex items-center justify-center whitespace-nowrap"
      disabled={isSubmitting}
    >
      {#if isSubmitting}
        Pairing…
      {:else}
        Start pairing
      {/if}
    </button>
    {#if statusMessage}
      <p class="text-sm text-slate-600">{statusMessage}</p>
    {/if}
  </div>
</form>
