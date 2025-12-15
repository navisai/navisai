<svelte:head>
  <title>Welcome - Navis AI</title>
</svelte:head>

<div class="page-padding">
  <main class="max-w-3xl mx-auto py-12">
    <header class="section-spacing">
      <h1 class="text-3xl font-semibold">Welcome to Navis AI</h1>
      <p class="text-lg text-slate-600 mt-2">
        Navis runs on your machine and is reachable on your LAN at
        <span class="font-mono text-slate-900">https://navis.local</span>.
      </p>
    </header>

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

