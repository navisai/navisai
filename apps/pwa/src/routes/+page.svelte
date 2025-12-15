<script>
  import '../app.css';
</script>

<div class="page-padding">
  <main class="max-w-4xl mx-auto py-12">
    <!-- Header -->
    <div class="section-spacing">
      <h1>Navis AI</h1>
      <p class="text-lg text-slate-600 mt-2">Local-first AI control, without chaos.</p>
    </div>

    <!-- Status Dashboard -->
    <section class="section-spacing">
      <h2>System Status</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <div class="panel">
          <div class="panel-header">
            <div class="flex items-center gap-2">
              <div class="status-dot status-running"></div>
              <h3>Daemon</h3>
            </div>
          </div>
          <div class="panel-body">
            <p class="text-slate-600">Running locally</p>
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
            <p class="text-slate-600">3 active projects</p>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="flex items-center gap-2">
              <div class="status-dot status-paused"></div>
              <h3>Approvals</h3>
            </div>
          </div>
          <div class="panel-body">
            <p class="text-slate-600">2 pending actions</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Action Demo -->
    <section class="section-spacing">
      <h2>Approval Required</h2>
      <div class="panel mt-4">
        <div class="panel-header">
          <h3>File modification request</h3>
        </div>
        <div class="panel-body space-y-4">
          <div class="p-4 bg-slate-50 rounded-lg font-mono text-sm">
            <p>📁 /Users/vsmith/project/src/app.js</p>
            <p class="text-slate-600">+ import { newFeature } from './feature.js'</p>
          </div>

          <div class="flex gap-2">
            <button class="btn btn-approve">
              Approve
            </button>
            <button class="btn btn-deny">
              Deny
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Typography Demo -->
    <section class="section-spacing">
      <h2>Typography System</h2>
      <div class="space-y-4 mt-4">
        <div>
          <h1 class="text-3xl font-semibold">Heading 1 - Semibold</h1>
        </div>
        <div>
          <h2 class="text-2xl font-medium">Heading 2 - Medium</h2>
        </div>
        <div>
          <h3 class="text-lg font-medium">Heading 3 - Medium</h3>
        </div>
        <div>
          <h4 class="text-base font-medium">Heading 4 - Medium</h4>
        </div>
        <p class="text-slate-600">Regular body text in slate color.</p>
        <p class="font-mono">Monospace text for code and terminal output.</p>
      </div>
    </section>

    <!-- Motion Demo -->
    <section class="section-spacing">
      <h2>Motion & Animation</h2>
      <div class="space-y-4 mt-4">
        <button class="btn btn-primary transition-all duration-180 hover:scale-105">
          Hover me (micro-animation)
        </button>
        <div class="panel animate-state-in">
          <div class="panel-body">
            <p>This panel animates in with brand-approved timing.</p>
          </div>
        </div>
      </div>
    </section>
  </main>
</div>
