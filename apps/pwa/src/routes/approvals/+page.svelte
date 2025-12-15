<script>
	import { pendingApprovals, isLoadingApprovals } from '$lib/stores/approvals'
</script>

<svelte:head>
  <title>Approvals - Navis AI</title>
</svelte:head>

<div class="page-padding">
  <main class="max-w-4xl mx-auto py-12">
    <h1 class="text-3xl font-semibold mb-6">Pending Approvals</h1>

    {#if $isLoadingApprovals}
      <div class="text-center py-12">
        <div
          class="w-8 h-8 border-4 border-navy-100 border-t-navy-600 rounded-full animate-spin mx-auto mb-3"
        ></div>
        <p class="text-slate-600">Loading approvals...</p>
      </div>
    {:else if $pendingApprovals.length > 0}
      <div class="space-y-4">
        {#each $pendingApprovals as approval}
          <a href="/approvals/{approval.id}" class="block">
            <div class="panel hover:shadow-md transition-shadow duration-200">
              <div class="panel-header">
                <div class="flex items-center justify-between w-full">
                  <h3>{approval.type}</h3>
                  <span class="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full">
                    Pending
                  </span>
                </div>
              </div>
              <div class="panel-body">
                <p class="text-sm text-slate-600 mb-2">
                  Created {new Date(approval.createdAt).toLocaleString()}
                </p>
                <div class="p-3 bg-slate-50 rounded-lg font-mono text-sm truncate">
                  {approval.payload}
                </div>
                <p class="text-navy-600 text-sm mt-3 hover:text-navy-800">View Details →</p>
              </div>
            </div>
          </a>
        {/each}
      </div>
    {:else}
      <div class="text-center py-12">
        <div
          class="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4"
        >
          <svg class="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h3 class="text-lg font-medium text-slate-900 mb-1">All caught up!</h3>
        <p class="text-slate-600">No pending approvals at the moment</p>
        <a href="/" class="btn btn-secondary mt-4">Back to Dashboard</a>
      </div>
    {/if}
  </main>
</div>
