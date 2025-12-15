<script lang="ts">
  import { approvalsStore } from '$lib/stores/approvals'
  export let approval: import('$lib/api/client').Approval

  let resolving = false

  async function handle(action: 'approve' | 'reject') {
    resolving = true
    try {
      await approvalsStore.resolveApproval(approval.id, action)
    } finally {
      resolving = false
    }
  }
</script>

<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
  <div class="bg-white rounded-2xl shadow-lg w-full max-w-md p-6 space-y-4">
    <header class="space-y-2">
      <p class="text-sm text-slate-500">Pairing approval needed</p>
      <h2 class="text-2xl font-semibold">Allow device access?</h2>
    </header>

    <section class="space-y-1">
      <p class="text-sm text-slate-600">Type</p>
      <p class="font-mono text-base text-slate-900">{approval.type}</p>
    </section>

    <section>
      <p class="text-sm text-slate-600">Payload</p>
      <pre class="mt-2 p-3 bg-slate-50 rounded-lg font-mono text-sm max-h-32 overflow-auto">
        {approval.payload}
      </pre>
    </section>

    <div class="flex gap-3">
      <button
        class="btn btn-primary flex-1"
        on:click={() => handle('approve')}
        disabled={resolving}
      >
        {resolving ? 'Processing…' : 'Approve'}
      </button>
      <button
        class="btn btn-secondary flex-1"
        on:click={() => handle('reject')}
        disabled={resolving}
      >
        {resolving ? 'Processing…' : 'Deny'}
      </button>
    </div>
  </div>
</div>
