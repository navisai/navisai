<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/stores'
  import { apiClient, type Approval } from '$lib/api/client'
  import { approvalsStore, isResolving } from '$lib/stores/approvals'

  let approval: Approval | null = null
  let loading = true
  let error: string | null = null

  $: approvalId = $page.params.id ?? ''
  $: resolving = approvalId ? $isResolving.includes(approvalId) : false

  async function load() {
    loading = true
    error = null
    try {
      if (!approvalId) throw new Error('Missing approval id')
      approval = await apiClient.getApproval(approvalId)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load approval'
    } finally {
      loading = false
    }
  }

  async function handleAction(action: 'approve' | 'reject') {
    if (!approval) return
    error = null
    try {
      await approvalsStore.resolveApproval(approval.id, action)
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : `Failed to ${action} approval`
    }
  }

  onMount(load)
</script>

<svelte:head>
  <title>Approval - Navis AI</title>
</svelte:head>

<div class="page-padding">
  <main class="max-w-4xl mx-auto py-12">
    <div class="flex items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-3xl font-semibold">Approval</h1>
        <p class="text-slate-600 mt-1">Review and approve or deny this request.</p>
      </div>
      <a href="/approvals" class="btn btn-secondary">Back</a>
    </div>

    {#if error}
      <div class="panel border border-red-200 bg-red-50">
        <div class="panel-body">
          <p class="text-red-700 text-sm">{error}</p>
        </div>
      </div>
    {/if}

    {#if loading}
      <div class="text-center py-12">
        <div
          class="w-8 h-8 border-4 border-navy-100 border-t-navy-600 rounded-full animate-spin mx-auto mb-3"
        ></div>
        <p class="text-slate-600">Loading approval...</p>
      </div>
    {:else if approval}
      <div class="panel">
        <div class="panel-header">
          <div class="flex items-center justify-between w-full">
            <h2 class="text-lg font-medium">{approval.type}</h2>
            <span
              class="text-xs px-2 py-1 rounded-full {approval.status === 'pending'
                ? 'bg-amber-100 text-amber-700'
                : approval.status === 'approved'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-slate-100 text-slate-700'}"
            >
              {approval.status}
            </span>
          </div>
        </div>
        <div class="panel-body">
          <p class="text-sm text-slate-600">
            Created {new Date(approval.createdAt).toLocaleString()}
          </p>

          <div class="mt-4">
            <h3 class="text-sm font-medium text-slate-900">Payload</h3>
            <pre class="mt-2 p-3 bg-slate-50 rounded-lg font-mono text-sm overflow-auto">{approval.payload}</pre>
          </div>

          {#if approval.status === 'pending'}
            <div class="mt-6 flex flex-wrap gap-3">
              <button class="btn btn-primary" on:click={() => handleAction('approve')} disabled={resolving}>
                {resolving ? 'Working...' : 'Approve'}
              </button>
              <button class="btn btn-secondary" on:click={() => handleAction('reject')} disabled={resolving}>
                {resolving ? 'Working...' : 'Deny'}
              </button>
            </div>
          {:else}
            <div class="mt-6">
              <a href="/approvals" class="btn btn-secondary">Back to Approvals</a>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <div class="text-center py-12">
        <h3 class="text-lg font-medium text-slate-900 mb-1">Approval not found</h3>
        <p class="text-slate-600">It may have been resolved or expired.</p>
        <a href="/approvals" class="btn btn-secondary mt-4">Back to Approvals</a>
      </div>
    {/if}
  </main>
</div>
