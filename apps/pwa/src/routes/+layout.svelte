<script>
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte'
	import { appStore, isConnected, error, isLoading } from '$lib/stores/app'
	import { projectsStore } from '$lib/stores/projects'
	import { approvalsStore } from '$lib/stores/approvals'

	let { children } = $props();

	onMount(async () => {
		// Initialize app data
		await Promise.all([
			appStore.refreshStatus(),
			projectsStore.loadProjects(),
			approvalsStore.loadPendingApprovals()
		])
	})
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen bg-white">
  <!-- Connection Status Banner -->
  {#if $error}
    <div class="bg-red-50 border-b border-red-200 px-4 py-2">
      <div class="max-w-4xl mx-auto flex items-center justify-between">
        <p class="text-red-700 text-sm">{$error}</p>
        <button on:click={appStore.clearError} class="text-red-600 hover:text-red-800">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  {/if}

  {#if !$isConnected}
    <div class="bg-amber-50 border-b border-amber-200 px-4 py-2">
      <div class="max-w-4xl mx-auto flex items-center gap-2">
        <div class="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></div>
        <p class="text-amber-700 text-sm">Connecting to Navis daemon...</p>
      </div>
    </div>
  {/if}

  {#if $isLoading}
    <div class="flex items-center justify-center min-h-[60vh]">
      <div class="flex flex-col items-center gap-4">
        <div
          class="w-8 h-8 border-4 border-navy-100 border-t-navy-600 rounded-full animate-spin"
        ></div>
        <p class="text-slate-600">Loading Navis...</p>
      </div>
    </div>
  {:else}
    {@render children()}
  {/if}
</div>
