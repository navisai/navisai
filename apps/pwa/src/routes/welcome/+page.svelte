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
          <a
            href="/pairing"
            class="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-sm text-navy-700 hover:bg-navy-50"
          >
            Go to pairing page
          </a>
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
