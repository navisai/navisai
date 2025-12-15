<script>
	import { page } from '$app/stores'
	import { approvalsStore, pendingApprovals, isResolving } from '$lib/stores/approvals'
	import { projects } from '$lib/stores/projects'

	const { id } = $page.params

	$: approval = $pendingApprovals.find(a => a.id === id)
	$: project = approval?.projectId ? $projects.find(p => p.id === approval.projectId) : null

	async function handleApprove() {
		if (!approval) return
		try {
			await approvalsStore.approve(approval.id)
		} catch (error) {
			console.error('Failed to approve:', error)
		}
	}

	async function handleDeny() {
		if (!approval) return
		try {
			await approvalsStore.reject(approval.id)
		} catch (error) {
			console.error('Failed to reject:', error)
		}
	}
</script>

<svelte:head>
  <title>Approval {id} - Navis AI</title>
</svelte:head>

<div class="page-padding">
  <main class="max-w-4xl mx-auto py-12">
    {#if approval}
      <div class="section-spacing">
        <div class="flex items-center gap-3 mb-6">
          <a href="/" class="text-navy-600 hover:text-navy-800" aria-label="Go back to dashboard">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </a>
          <h1 class="text-2xl font-medium">Approval Request</h1>
          <span class="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-sm"> Pending </span>
        </div>

        <!-- Approval Details -->
        <div class="panel">
          <div class="panel-header">
            <h3>{approval.type}</h3>
            <p class="text-sm text-slate-600">
              Created {new Date(approval.createdAt).toLocaleString()}
            </p>
          </div>
          <div class="panel-body space-y-4">
            {#if project}
              <div class="p-3 bg-slate-50 rounded-lg">
                <p class="text-sm font-medium text-slate-900">Project</p>
                <p class="text-sm text-slate-600">{project.name}</p>
                <p class="text-xs text-slate-500 font-mono mt-1">{project.path}</p>
              </div>
            {/if}

            <div>
              <h4 class="font-medium text-slate-900 mb-2">Action Details</h4>
              <div class="p-4 bg-slate-50 rounded-lg font-mono text-sm whitespace-pre-wrap">
                {approval.payload}
              </div>
            </div>

            <!-- Action Buttons -->
            <div class="flex gap-3 pt-4 border-t border-slate-200">
              <button
                class="btn btn-approve"
                on:click={handleApprove}
                disabled={$isResolving.includes(approval.id)}
              >
                {#if $isResolving.includes(approval.id)}
                  Processing...
                {:else}
                  <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Approve
                {/if}
              </button>
              <button
                class="btn btn-deny"
                on:click={handleDeny}
                disabled={$isResolving.includes(approval.id)}
              >
                {#if $isResolving.includes(approval.id)}
                  Processing...
                {:else}
                  <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                  Deny
                {/if}
              </button>
            </div>
          </div>
        </div>
      </div>
    {:else}
      <div class="text-center py-12">
        <div
          class="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4"
        >
          <svg class="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <h3 class="text-lg font-medium text-slate-900 mb-1">Approval not found</h3>
        <p class="text-slate-600">This approval may have been resolved or the ID is incorrect</p>
        <a href="/" class="btn btn-secondary mt-4">Back to Dashboard</a>
      </div>
    {/if}
  </main>
</div>
