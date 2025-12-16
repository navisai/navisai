<svelte:head>
  <title>Welcome - Navis AI</title>
</svelte:head>

<script lang="ts">
  import { onMount } from 'svelte'
  import PairingModal from '$lib/components/PairingModal.svelte'
  import { isPaired, pairedDevice } from '$lib/stores/device'

  let pairingOpen = false
  let tokenFromUrl = ''
  let bleStatus: 'idle' | 'unsupported' | 'ready' | 'scanning' | 'found' | 'error' = 'idle'
  let bleError = ''

  const BLE_SERVICE_UUID = '9f3a2b40-7f6b-4f13-8f1e-0b7a49b4a0a1'

  onMount(() => {
    tokenFromUrl = new URLSearchParams(location.search).get('token') ?? ''
    if (typeof navigator !== 'undefined' && 'bluetooth' in navigator) {
      bleStatus = 'ready'
    } else {
      bleStatus = 'unsupported'
    }
  })

  async function scanBluetooth() {
    bleError = ''
    const nav = navigator as Navigator & { bluetooth?: any }
    if (!nav.bluetooth) {
      bleStatus = 'unsupported'
      return
    }
    bleStatus = 'scanning'
    try {
      const device = await nav.bluetooth.requestDevice({
        filters: [{ services: [BLE_SERVICE_UUID] }],
        optionalServices: [BLE_SERVICE_UUID],
      })
      if (device) bleStatus = 'found'
    } catch (error) {
      bleStatus = 'error'
      bleError = error instanceof Error ? error.message : 'Bluetooth scan failed.'
    }
  }
</script>

<div class="page-padding">
  <main class="max-w-3xl mx-auto py-12">
    <header class="section-spacing">
      <h1 class="text-3xl font-semibold">Welcome to Navis AI</h1>
      <p class="text-lg text-slate-600 mt-2">
        Navis runs on your machine and is reachable on your LAN at
        <span class="font-mono text-slate-900">https://navis.local</span>.
      </p>
      {#if $isPaired && $pairedDevice}
        <p class="text-sm text-slate-600 mt-3">
          Paired as <span class="font-medium text-slate-900">{$pairedDevice.deviceName}</span>.
        </p>
      {/if}
    </header>

    <section class="section-spacing">
      <h2 class="text-2xl font-medium">Trust this certificate (mobile)</h2>
      <p class="text-slate-600 mt-2">
        Navis uses local HTTPS. On iOS you may need to install and trust the local certificate once.
      </p>
      <div class="mt-4 panel">
        <div class="panel-header">
          <h3>Download</h3>
        </div>
        <div class="panel-body">
          <a href="/certs/navis.local.crt" class="btn btn-secondary">Download navis.local certificate</a>
          <ol class="mt-4 list-decimal pl-5 text-slate-600 space-y-2">
            <li>Open this page on your iPhone (same Wi‑Fi), then tap Download.</li>
            <li>
              Install it via Settings → General → VPN &amp; Device Management (or Profiles) → Install.
            </li>
            <li>Enable trust: Settings → General → About → Certificate Trust Settings → trust Navis.</li>
            <li>Return here and continue pairing.</li>
          </ol>
        </div>
      </div>
    </section>

    <section class="section-spacing">
      <h2 class="text-2xl font-medium">Pair your phone</h2>
      <p class="text-slate-600 mt-2">
        Scan this QR code on your phone to start pairing. Pairing requires explicit approval.
      </p>

      <div class="mt-4 panel">
        <div class="panel-header">
          <h3>Pairing QR</h3>
        </div>
        <div class="panel-body">
          <div class="flex items-center justify-center">
            <img
              src="/pairing/qr"
              alt="Pairing QR code"
              class="w-64 h-64 rounded-lg border border-slate-200 bg-white"
              loading="lazy"
            />
          </div>
          <p class="text-sm text-slate-600 mt-3">
            If the QR code doesn’t load, confirm the daemon is running and refresh.
          </p>
          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-primary"
              on:click={() => (pairingOpen = true)}
            >
              Pair a device
            </button>
            <a
              href="/pairing"
              class="btn btn-secondary"
            >
              Open full pairing page
            </a>
          </div>
        </div>
      </div>

      <div class="mt-4 panel">
        <div class="panel-header">
          <h3>Bluetooth (Android)</h3>
        </div>
        <div class="panel-body">
          <p class="text-sm text-slate-600">
            If you’re on Android Chrome, you can confirm the onboarding signal over Bluetooth. This
            requires a tap and may show a device picker.
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="btn btn-secondary"
              on:click={scanBluetooth}
              disabled={bleStatus === 'unsupported' || bleStatus === 'scanning'}
            >
              {bleStatus === 'scanning' ? 'Scanning…' : 'Scan for Navis'}
            </button>
            {#if bleStatus === 'found'}
              <span class="text-sm text-emerald-700">Navis detected nearby.</span>
            {:else if bleStatus === 'unsupported'}
              <span class="text-sm text-slate-600">Bluetooth scanning not supported in this browser.</span>
            {:else if bleStatus === 'error'}
              <span class="text-sm text-rose-700">{bleError}</span>
            {/if}
          </div>
        </div>
      </div>
    </section>

    <section class="section-spacing">
      <h2 class="text-2xl font-medium">Next</h2>
      <div class="flex flex-wrap gap-3 mt-4">
        <a href="/" class="btn btn-primary">Open Dashboard</a>
        <a href="/approvals" class="btn btn-secondary">View Approvals</a>
      </div>
    </section>
  </main>
</div>

<PairingModal
  open={pairingOpen}
  initialToken={tokenFromUrl}
  on:close={() => (pairingOpen = false)}
/>
