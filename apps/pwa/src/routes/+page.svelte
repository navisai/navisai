<script>
	import { onMount } from 'svelte'
	import { appStore, daemonStatus, isConnected } from '$lib/stores/app'
	import { projects, isLoadingProjects, isScanning, scanDirectory } from '$lib/stores/projects'
	import { pendingApprovals } from '$lib/stores/approvals'

	let scanPath = ''
	let scanningPath = ''

	async function handleScan() {
		if (!scanPath.trim()) return
		scanningPath = scanPath
		try {
			await scanDirectory(scanPath.trim(), { depth: 3 })
			scanPath = ''
		} finally {
			scanningPath = ''
		}
	}

	async function handleQuickScan() {
		const homeDir = '/Users/vsmith' // TODO: Get from API or browser
		await scanDirectory(homeDir, { depth: 2 })
	}
</script>

<svelte:head>
  <title>Navis AI - Local-first AI Control</title>
</svelte:head>

<div class="page-padding">
  <main class="max-w-4xl mx-auto py-12">
    <!-- Header -->
    <div class="section-spacing">
      <h1 class="text-3xl font-semibold">Navis AI</h1>
      <p class="text-lg text-slate-600 mt-2">Local-first AI control, without chaos.</p>
      {#if $isConnected}
        <div class="flex items-center gap-2 mt-2">
          <div class="w-2 h-2 bg-green-500 rounded-full"></div>
          <span class="text-sm text-slate-600">Connected to daemon</span>
          {#if $daemonStatus?.database}
            <span class="text-sm text-slate-500">• Database active</span>
          {/if}
        </div>
      {/if}
    </div>

    <!-- System Status Dashboard -->
    <section class="section-spacing">
      <h2 class="text-2xl font-medium">System Status</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <div class="panel">
          <div class="panel-header">
            <div class="flex items-center gap-2">
              <div class="status-dot status-running"></div>
              <h3>Daemon</h3>
            </div>
          </div>
          <div class="panel-body">
            <p class="text-slate-600">
              {$isConnected ? 'Running locally' : 'Disconnected'}
            </p>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="flex items-center gap-2">
              <div class="status-dot status-ready"></div>
              <h3>Projects</h3>
            </div>
          </div>
          <div class="panel-body">
            <p class="text-slate-600">
              {$projects.length} discovered
              {#if $isScanning || scanningPath}
                <span class="text-amber-600">• Scanning...</span>
              {/if}
            </p>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="flex items-center gap-2">
              <div
                class="status-dot {$pendingApprovals.length > 0
                  ? 'status-running'
                  : 'status-paused'}"
              ></div>
              <h3>Approvals</h3>
            </div>
          </div>
          <div class="panel-body">
            <p class="text-slate-600">
              {$pendingApprovals.length} pending
              {#if $pendingApprovals.length > 0}
                <span class="text-amber-600">• Action needed</span>
              {/if}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Project Discovery -->
    <section class="section-spacing">
      <h2 class="text-2xl font-medium">Project Discovery</h2>

      <!-- Quick Actions -->
      <div class="flex flex-wrap gap-3 mt-4">
        <button class="btn btn-primary" on:click={handleQuickScan} disabled={$isScanning}>
          {#if $isScanning}
            Scanning...
          {:else}
            Quick Scan Home
          {/if}
        </button>

        <div class="flex gap-2">
          <input
            type="text"
            bind:value={scanPath}
            placeholder="/path/to/scan"
            class="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
            on:keypress={e => e.key === 'Enter' && handleScan()}
          />
          <button
            class="btn btn-secondary"
            on:click={handleScan}
            disabled={!scanPath.trim() || $isScanning}
          >
            Custom Scan
          </button>
        </div>
      </div>

      <!-- Projects List -->
      {#if $isLoadingProjects}
        <div class="mt-6 text-center py-8">
          <div
            class="w-8 h-8 border-4 border-navy-100 border-t-navy-600 rounded-full animate-spin mx-auto mb-3"
          ></div>
          <p class="text-slate-600">Loading projects...</p>
        </div>
      {:else if $projects.length > 0}
        <div class="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {#each $projects as project}
            <div class="panel">
              <div class="panel-header">
                <h3>{project.name}</h3>
              </div>
              <div class="panel-body">
                <p class="text-sm text-slate-600 font-mono">{project.path}</p>
                {#if project.classification?.primary}
                  <div class="mt-2 flex items-center gap-2">
                    <span class="text-xs px-2 py-1 bg-navy-100 text-navy-700 rounded-full">
                      {project.classification.primary.name}
                    </span>
                    {#if project.classification.language}
                      <span class="text-xs px-2 py-1 bg-slate-100 text-slate-700 rounded-full">
                        {project.classification.language}
                      </span>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="mt-6 text-center py-12">
          <div
            class="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4"
          >
            <svg
              class="w-8 h-8 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
          </div>
          <h3 class="text-lg font-medium text-slate-900 mb-1">No projects discovered</h3>
          <p class="text-slate-600">Start by scanning a directory containing your projects</p>
        </div>
      {/if}
    </section>

    <!-- Pending Approvals -->
    {#if $pendingApprovals.length > 0}
      <section class="section-spacing">
        <h2 class="text-2xl font-medium">Pending Approvals</h2>
        <div class="mt-4 space-y-3">
          {#each $pendingApprovals as approval}
            <div class="panel">
              <div class="panel-header">
                <div class="flex items-center justify-between w-full">
                  <h3>{approval.type}</h3>
                  <span class="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full">
                    Pending
                  </span>
                </div>
              </div>
              <div class="panel-body">
                <p class="text-sm text-slate-600">{approval.payload}</p>
                <div class="flex gap-2 mt-4">
                  <a href="/approvals/{approval.id}" class="btn btn-approve"> View Details </a>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </main>
</div>
