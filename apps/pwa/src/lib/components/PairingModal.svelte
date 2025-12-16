<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'
  import { fly } from 'svelte/transition'
  import PairingForm from '$lib/components/PairingForm.svelte'
  import type { DeviceCredentials } from '$lib/api/client'

  export let open = false
  export let initialToken = ''

  const dispatch = createEventDispatcher<{ close: void; paired: DeviceCredentials }>()

  let dialogEl: HTMLDivElement | null = null

  function close() {
    dispatch('close')
  }

  function handlePaired(event: CustomEvent<DeviceCredentials>) {
    dispatch('paired', event.detail)
    close()
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) close()
  }

  function handleBackdropKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') close()
  }

  onMount(() => {
    if (open) dialogEl?.focus()
  })

  onDestroy(() => {
  })

  $: if (open) dialogEl?.focus()
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-center sm:justify-center"
    role="button"
    aria-label="Close pairing modal"
    tabindex="0"
    on:click={handleBackdropClick}
    on:keydown={handleBackdropKeydown}
  >
    <div
      class="w-full rounded-t-3xl bg-white shadow-xl sm:max-w-lg sm:rounded-3xl"
      bind:this={dialogEl}
      role="dialog"
      aria-modal="true"
      aria-label="Pair a device"
      tabindex="-1"
      transition:fly={{ y: 24, duration: 180 }}
    >
      <header class="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <div class="space-y-0.5">
          <p class="text-xs font-medium tracking-wide text-slate-500 uppercase">Pairing</p>
          <h2 class="text-xl font-semibold text-slate-900">Pair a new device</h2>
        </div>
        <button type="button" class="btn btn-secondary" on:click={close}>Close</button>
      </header>

      <div class="px-6 py-5">
        <p class="text-sm text-slate-600 mb-4">
          Enter the pairing token from the onboarding QR code or the CLI. Pairing requires explicit
          approval on the host.
        </p>
        <PairingForm initialToken={initialToken} on:paired={handlePaired} />
      </div>
    </div>
  </div>
{/if}
