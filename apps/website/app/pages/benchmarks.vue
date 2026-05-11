<script setup lang="ts">
import { type BenchRow, datasets, environments } from '~/data/benchmarks'

useSeoMeta({
  title: 'Benchmarks',
  ogTitle: 'Benchmarks',
  description: 'MiiaJS outperforms Hono, Elysia, Fastify, and NestJS in realistic API benchmarks on Bun. Compare throughput and latency across Bun, Deno, and Node.js.',
  ogDescription: 'MiiaJS outperforms Hono, Elysia, Fastify, and NestJS in realistic API benchmarks on Bun. Compare throughput and latency across Bun, Deno, and Node.js.'
})

const env = ref(environments[0]!.key)
const activeEnv = computed(() => environments.find(e => e.key === env.value)!)
const activeData = computed(() => datasets[env.value]!)

function withDelta(rows: BenchRow[]) {
  const leader = rows[0]?.reqSec ?? 0
  return rows.map(r => ({
    ...r,
    delta: r.reqSec === leader ? '-' : `${(((r.reqSec - leader) / leader) * 100).toFixed(1)}%`
  }))
}

const syntheticGet = computed(() => withDelta(activeData.value.syntheticGet))
const syntheticPost = computed(() => withDelta(activeData.value.syntheticPost))
const apiGet = computed(() => withDelta(activeData.value.apiGet))
const apiPost = computed(() => withDelta(activeData.value.apiPost))

const envTabs = environments.map(e => ({ label: e.label, value: e.key, icon: e.icon }))

const columns = [
  { accessorKey: 'framework', header: 'Framework' },
  { accessorKey: 'reqSec', header: 'Req/sec' },
  { accessorKey: 'latency', header: 'Latency (avg)' },
  { accessorKey: 'delta', header: 'vs leader' }
]

function barWidth(value: number, max: number) {
  return `${Math.round((value / max) * 100)}%`
}

function barColor(row: BenchRow) {
  if (row.highlight) return 'bg-primary/80'
  return 'bg-[color:var(--ui-bg-accented)]'
}

function formatNum(n: number) {
  return n.toLocaleString('en-US')
}
</script>

<template>
  <div>
    <!-- ========================= HERO ========================= -->
    <section class="relative overflow-hidden">
      <HeroBackground />

      <div class="relative mx-auto max-w-5xl px-4 pt-20 pb-16 sm:pt-28 sm:pb-20 text-center">
        <p class="font-mono text-xs uppercase tracking-[0.25em] text-[color:var(--color-plasma-500)] mb-5">
          Benchmarks
        </p>
        <h1 class="font-display font-bold leading-[0.95] tracking-tight text-[clamp(2.25rem,7vw,5.5rem)]">
          <span class="block">Fast as the</span>
          <span class="block text-plasma">fastest routers</span>
        </h1>
        <p class="mx-auto mt-8 max-w-2xl text-base sm:text-lg text-muted leading-relaxed">
          MiiaJS matches the fastest frameworks in realistic API benchmarks -
          with full middleware, JWT, CORS, and validation enabled - while
          staying neck-and-neck with bare routers in synthetic tests.
        </p>
      </div>
    </section>

    <UContainer>
      <!-- Sticky environment tabs -->
      <div
        class="sticky z-30 -mx-4 px-4 py-3 glass border-b border-[color:var(--ui-border)]"
        style="top: calc(4rem + 1px)"
      >
        <div class="flex justify-center">
          <UTabs v-model="env" :items="envTabs" variant="link" :content="false" />
        </div>
        <p class="text-center text-sm text-muted p-1">
          {{ activeEnv.description }}
        </p>
      </div>

      <UPageBody class="space-y-20">
        <!-- ====== REALISTIC API ====== -->
        <div>
          <h2 class="text-3xl font-bold mb-2">
            Realistic API
          </h2>
          <p class="text-muted mb-12">
            Full middleware stack - CORS, JWT, routing, body parsing, validation. The way real APIs work.
          </p>

          <!-- API GET chart + table -->
          <section class="mb-16">
            <h3 class="text-xl font-semibold mb-1">
              GET /api/users/:userId/posts/:postId
            </h3>
            <p class="text-sm text-muted mb-6">
              CORS, JWT verification, nested route params, JSON response.
            </p>

            <div class="space-y-2 mb-8">
              <div
                v-for="row in apiGet"
                :key="row.framework"
                class="flex items-center gap-3"
              >
                <span
                  class="w-44 sm:w-52 text-sm truncate text-right"
                  :class="row.highlight ? 'font-semibold text-primary' : 'text-muted'"
                >
                  {{ row.framework }}
                </span>
                <div class="flex-1 h-7 bg-[color:var(--ui-bg-elevated)] rounded-md overflow-hidden relative">
                  <div
                    class="h-full rounded-md transition-all duration-500"
                    :class="barColor(row)"
                    :style="{ width: barWidth(row.reqSec, apiGet[0]?.reqSec ?? 1) }"
                  />
                  <span
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-xs tabular-nums font-medium"
                    :class="row.highlight ? 'text-primary-800 dark:text-primary-200' : 'text-toned'"
                  >
                    {{ formatNum(row.reqSec) }}
                  </span>
                </div>
              </div>
            </div>

            <details class="group">
              <summary class="cursor-pointer text-sm text-muted hover:text-default select-none">
                Show full table
              </summary>
              <div class="mt-4">
                <UTable :columns="columns" :data="apiGet">
                  <template #framework-cell="{ row }">
                    <span :class="row.original.highlight ? 'font-semibold text-primary' : ''">
                      {{ row.original.framework }}
                    </span>
                  </template>
                  <template #reqSec-cell="{ row }">
                    <span
                      :class="row.original.highlight ? 'font-semibold text-primary' : ''"
                      class="tabular-nums"
                    >
                      {{ formatNum(row.original.reqSec) }}
                    </span>
                  </template>
                  <template #latency-cell="{ row }">
                    <span class="tabular-nums">{{ row.original.latency }}</span>
                  </template>
                  <template #delta-cell="{ row }">
                    <span class="tabular-nums text-muted">{{ row.original.delta }}</span>
                  </template>
                </UTable>
              </div>
            </details>
          </section>

          <!-- API POST chart + table -->
          <section>
            <h3 class="text-xl font-semibold mb-1">
              POST /api/workspaces/:ws/projects/:proj/tasks
            </h3>
            <p class="text-sm text-muted mb-6">
              CORS, JWT, JSON body, path params, query params, custom headers, UUID, <code>201</code> status.
              The heaviest test.
            </p>

            <div class="space-y-2 mb-8">
              <div
                v-for="row in apiPost"
                :key="row.framework"
                class="flex items-center gap-3"
              >
                <span
                  class="w-44 sm:w-52 text-sm truncate text-right"
                  :class="row.highlight ? 'font-semibold text-primary' : 'text-muted'"
                >
                  {{ row.framework }}
                </span>
                <div class="flex-1 h-7 bg-[color:var(--ui-bg-elevated)] rounded-md overflow-hidden relative">
                  <div
                    class="h-full rounded-md transition-all duration-500"
                    :class="barColor(row)"
                    :style="{ width: barWidth(row.reqSec, apiPost[0]?.reqSec ?? 1) }"
                  />
                  <span
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-xs tabular-nums font-medium"
                    :class="row.highlight ? 'text-primary-800 dark:text-primary-200' : 'text-toned'"
                  >
                    {{ formatNum(row.reqSec) }}
                  </span>
                </div>
              </div>
            </div>

            <details class="group">
              <summary class="cursor-pointer text-sm text-muted hover:text-default select-none">
                Show full table
              </summary>
              <div class="mt-4">
                <UTable :columns="columns" :data="apiPost">
                  <template #framework-cell="{ row }">
                    <span :class="row.original.highlight ? 'font-semibold text-primary' : ''">
                      {{ row.original.framework }}
                    </span>
                  </template>
                  <template #reqSec-cell="{ row }">
                    <span
                      :class="row.original.highlight ? 'font-semibold text-primary' : ''"
                      class="tabular-nums"
                    >
                      {{ formatNum(row.original.reqSec) }}
                    </span>
                  </template>
                  <template #latency-cell="{ row }">
                    <span class="tabular-nums">{{ row.original.latency }}</span>
                  </template>
                  <template #delta-cell="{ row }">
                    <span class="tabular-nums text-muted">{{ row.original.delta }}</span>
                  </template>
                </UTable>
              </div>
            </details>
          </section>
        </div>

        <!-- ====== TAKEAWAY ====== -->
        <div class="rounded-xl border border-primary/20 bg-primary/5 p-6 text-center">
          <p class="text-base text-toned">
            <strong>The takeaway:</strong> MiiaJS delivers the throughput of a bare router with the architecture of a full
            framework. In realistic API tests, it matches Elysia and outperforms Hono, Fastify, and NestJS on Bun - while
            offering DI, guards, and middleware they lack or bolt on.
          </p>
        </div>

        <USeparator />

        <!-- ====== SYNTHETIC ====== -->
        <div>
          <h2 class="text-3xl font-bold mb-2">
            Synthetic
          </h2>
          <p class="text-muted mb-12">
            Minimal handlers - pure framework overhead with no middleware. Bare routers have a natural edge here; MiiaJS
            still ranks among the top.
          </p>

          <!-- Synthetic GET chart + table -->
          <section class="mb-16">
            <h3 class="text-xl font-semibold mb-1">
              GET /
            </h3>
            <p class="text-sm text-muted mb-6">
              Return <code>{ "message": "Hello, World!" }</code>. No middleware, no parsing.
            </p>

            <div class="space-y-2 mb-8">
              <div
                v-for="row in syntheticGet"
                :key="row.framework"
                class="flex items-center gap-3"
              >
                <span
                  class="w-44 sm:w-52 text-sm truncate text-right"
                  :class="row.highlight ? 'font-semibold text-primary' : 'text-muted'"
                >
                  {{ row.framework }}
                </span>
                <div class="flex-1 h-7 bg-[color:var(--ui-bg-elevated)] rounded-md overflow-hidden relative">
                  <div
                    class="h-full rounded-md transition-all duration-500"
                    :class="barColor(row)"
                    :style="{ width: barWidth(row.reqSec, syntheticGet[0]?.reqSec ?? 1) }"
                  />
                  <span
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-xs tabular-nums font-medium"
                    :class="row.highlight ? 'text-primary-800 dark:text-primary-200' : 'text-toned'"
                  >
                    {{ formatNum(row.reqSec) }}
                  </span>
                </div>
              </div>
            </div>

            <details class="group">
              <summary class="cursor-pointer text-sm text-muted hover:text-default select-none">
                Show full table
              </summary>
              <div class="mt-4">
                <UTable :columns="columns" :data="syntheticGet">
                  <template #framework-cell="{ row }">
                    <span :class="row.original.highlight ? 'font-semibold text-primary' : ''">
                      {{ row.original.framework }}
                    </span>
                  </template>
                  <template #reqSec-cell="{ row }">
                    <span
                      :class="row.original.highlight ? 'font-semibold text-primary' : ''"
                      class="tabular-nums"
                    >
                      {{ formatNum(row.original.reqSec) }}
                    </span>
                  </template>
                  <template #latency-cell="{ row }">
                    <span class="tabular-nums">{{ row.original.latency }}</span>
                  </template>
                  <template #delta-cell="{ row }">
                    <span class="tabular-nums text-muted">{{ row.original.delta }}</span>
                  </template>
                </UTable>
              </div>
            </details>
          </section>

          <!-- Synthetic POST chart + table -->
          <section>
            <h3 class="text-xl font-semibold mb-1">
              POST /json
            </h3>
            <p class="text-sm text-muted mb-6">
              Parse JSON body, generate UUID, return response.
            </p>

            <div class="space-y-2 mb-8">
              <div
                v-for="row in syntheticPost"
                :key="row.framework"
                class="flex items-center gap-3"
              >
                <span
                  class="w-44 sm:w-52 text-sm truncate text-right"
                  :class="row.highlight ? 'font-semibold text-primary' : 'text-muted'"
                >
                  {{ row.framework }}
                </span>
                <div class="flex-1 h-7 bg-[color:var(--ui-bg-elevated)] rounded-md overflow-hidden relative">
                  <div
                    class="h-full rounded-md transition-all duration-500"
                    :class="barColor(row)"
                    :style="{ width: barWidth(row.reqSec, syntheticPost[0]?.reqSec ?? 1) }"
                  />
                  <span
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-xs tabular-nums font-medium"
                    :class="row.highlight ? 'text-primary-800 dark:text-primary-200' : 'text-toned'"
                  >
                    {{ formatNum(row.reqSec) }}
                  </span>
                </div>
              </div>
            </div>

            <details class="group">
              <summary class="cursor-pointer text-sm text-muted hover:text-default select-none">
                Show full table
              </summary>
              <div class="mt-4">
                <UTable :columns="columns" :data="syntheticPost">
                  <template #framework-cell="{ row }">
                    <span :class="row.original.highlight ? 'font-semibold text-primary' : ''">
                      {{ row.original.framework }}
                    </span>
                  </template>
                  <template #reqSec-cell="{ row }">
                    <span
                      :class="row.original.highlight ? 'font-semibold text-primary' : ''"
                      class="tabular-nums"
                    >
                      {{ formatNum(row.original.reqSec) }}
                    </span>
                  </template>
                  <template #latency-cell="{ row }">
                    <span class="tabular-nums">{{ row.original.latency }}</span>
                  </template>
                  <template #delta-cell="{ row }">
                    <span class="tabular-nums text-muted">{{ row.original.delta }}</span>
                  </template>
                </UTable>
              </div>
            </details>
          </section>
        </div>

        <USeparator />

        <!-- ====== METHODOLOGY ====== -->
        <section>
          <h2 class="text-3xl font-bold mb-6">
            Methodology
          </h2>
          <p class="text-muted mb-8">
            All benchmarks run under controlled conditions with randomized server order to reduce bias. Use the tabs above
            to compare environments.
          </p>

          <div class="grid sm:grid-cols-2 gap-8 mb-10">
            <div>
              <h3 class="font-semibold mb-3">
                Load parameters
              </h3>
              <ul class="space-y-1 text-sm text-muted">
                <li><strong>Tool:</strong> Autocannon v8+</li>
                <li><strong>Connections:</strong> 100 concurrent</li>
                <li><strong>Duration:</strong> 30s per pass</li>
                <li><strong>Warmup:</strong> 5s (full connections for JIT)</li>
                <li><strong>Passes:</strong> 5 (averaged with stddev)</li>
                <li><strong>Workers:</strong> 1 (single-threaded, no clustering)</li>
              </ul>
            </div>

            <div>
              <h3 class="font-semibold mb-3">
                What the API scenarios test
              </h3>
              <ul class="space-y-1 text-sm text-muted">
                <li><strong>CORS</strong> - origin validation and preflight headers</li>
                <li><strong>JWT</strong> - Bearer token extraction and HS256 verification</li>
                <li><strong>Routing</strong> - path parameter extraction from nested segments</li>
                <li><strong>Body parsing</strong> - JSON deserialization (POST scenarios)</li>
                <li><strong>Query parsing</strong> - URL search parameter extraction</li>
                <li><strong>Response</strong> - JSON serialization with custom status codes</li>
              </ul>
            </div>
          </div>

          <h3 class="font-semibold mb-3">
            Test environments
          </h3>
          <div class="grid sm:grid-cols-2 gap-6 mb-10">
            <div
              v-for="e in environments"
              :key="e.key"
              class="rounded-lg border p-4 transition-all duration-300"
              :class="env === e.key ? 'ring-2 ring-primary/50 border-primary/30' : 'border-[color:var(--ui-border)]'"
            >
              <h4 class="font-semibold text-sm mb-2">{{ e.label }}</h4>
              <ul class="text-sm text-muted space-y-1">
                <li v-for="spec in e.specs" :key="spec">{{ spec }}</li>
              </ul>
            </div>
          </div>

          <h3 class="font-semibold mb-3">
            Frameworks compared
          </h3>
          <UTable
            :columns="[
              { accessorKey: 'framework', header: 'Framework' },
              { accessorKey: 'type', header: 'Type' },
              { accessorKey: 'runtimes', header: 'Runtimes' }
            ]"
            :data="[
              { framework: 'MiiaJS', type: 'Decorator-driven, DI, guards, middleware', runtimes: 'Bun, Deno, Node (+ uWS adapter)' },
              { framework: 'Hono', type: 'Lightweight multi-runtime router', runtimes: 'Bun, Deno, Node (+ uWS adapter)' },
              { framework: 'Elysia', type: 'Bun-native framework', runtimes: 'Bun' },
              { framework: 'Fastify', type: 'Plugin-based Node.js framework', runtimes: 'Bun, Node' },
              { framework: 'NestJS+Fastify', type: 'Enterprise decorator framework', runtimes: 'Bun, Node' }
            ]"
          />

          <p class="text-xs text-muted mt-4 italic">
            * Hono uWS uses the same @miiajs/uws-server adapter - the difference is pure framework overhead.
          </p>

          <p class="text-sm text-muted mt-4">
            Last updated: April 10, 2026.
          </p>
        </section>

        <!-- ====== NODE.JS CALLOUT ====== -->
        <div class="rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-bg-muted)] p-6">
          <p class="text-base text-toned">
            <strong>Node.js:</strong> MiiaJS with the uWS adapter outperforms Hono uWS by up to 48% and NestJS+Fastify by
            up to 33% in realistic API tests on M1 Pro. Same transport - the difference is pure framework overhead.
          </p>
        </div>

        <!-- ====== WHY FAST ====== -->
        <section>
          <h2 class="text-3xl font-bold mb-6">
            Why is MiiaJS fast?
          </h2>

          <div class="grid sm:grid-cols-2 gap-8">
            <div>
              <h3 class="font-semibold mb-3">
                Core
              </h3>
              <ul class="space-y-1 text-sm text-muted">
                <li><strong>Trie-based router</strong> - O(1) static path lookup</li>
                <li><strong>Compile-time pipelines</strong> - middleware chains resolved once at startup, not per request</li>
                <li><strong>Sync fast path</strong> - zero Promises when handler and middleware are synchronous</li>
                <li><strong>No runtime reflection</strong> - native decorators resolve at class definition, no metadata scanning</li>
                <li><strong>Minimal allocations</strong> - no wrapper objects between your handler and the runtime</li>
              </ul>
            </div>

            <div>
              <h3 class="font-semibold mb-3">
                Node.js & uWebSockets adapter
              </h3>
              <ul class="space-y-1 text-sm text-muted">
                <li><strong>Lazy Request/Headers proxy</strong> - no allocation until accessed</li>
                <li><strong>Body buffering</strong> - small payloads bypass ReadableStream overhead</li>
                <li><strong>LightResponse cache</strong> - status/body/headers tuple without constructing a real Response</li>
              </ul>
            </div>
          </div>
        </section>

        <USeparator />

        <!-- ====== REPRODUCE ====== -->
        <section>
          <h2 class="text-3xl font-bold mb-4">
            Reproduce
          </h2>
          <p class="text-muted mb-6">
            The benchmark suite is open source. The interactive CLI lets you pick scenarios, runtimes, and number of passes.
          </p>

          <CodeCard file="terminal" class="max-w-2xl">
            <pre class="!m-0 !rounded-none !border-0 !shadow-none overflow-x-auto px-5 py-4 font-mono text-[13px] leading-relaxed text-default bg-transparent"><code><span class="text-dimmed">$ </span>git clone https://github.com/miiajs/benchmarks.git
<span class="text-dimmed">$ </span>cd benchmarks
<span class="text-dimmed">$ </span>bun install
<span class="text-dimmed">$ </span>bun run bench</code></pre>
          </CodeCard>
        </section>
      </UPageBody>

      <!-- ====== CTA ====== -->
      <section class="relative py-20 sm:py-24">
        <div class="relative overflow-hidden rounded-[2rem] p-px gradient-plasma">
          <div class="relative rounded-[calc(2rem-1px)] bg-[color:var(--ui-bg)] px-6 sm:px-12 py-16 sm:py-20 text-center overflow-hidden">
            <div class="absolute inset-0 bg-grid opacity-30" />
            <div
              class="absolute -left-20 -top-20 h-72 w-72 rounded-full blur-3xl"
              style="background: radial-gradient(circle, rgba(255,77,109,0.25), transparent 70%);"
            />
            <div
              class="absolute -right-20 -bottom-20 h-72 w-72 rounded-full blur-3xl"
              style="background: radial-gradient(circle, rgba(34,211,238,0.25), transparent 70%);"
            />

            <h2 class="relative font-display font-bold text-4xl sm:text-5xl leading-[1.05] tracking-tight">
              Ready to build<br>
              <span class="text-plasma">something fast?</span>
            </h2>
            <p class="relative mx-auto mt-6 max-w-lg text-muted leading-relaxed">
              Start building in minutes. Open source, MIT licensed.
            </p>

            <div class="relative mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
              <UButton
                to="/docs/getting-started"
                size="xl"
                color="primary"
                trailing-icon="i-lucide-arrow-right"
                class="font-display !rounded-full !px-7 glow-plasma"
              >
                Get started
              </UButton>
              <UButton
                to="https://github.com/miiajs/miia"
                target="_blank"
                size="xl"
                color="neutral"
                variant="outline"
                icon="i-simple-icons-github"
                class="font-display !rounded-full !px-7 !border-[color:var(--ui-border-accented)]"
              >
                View on GitHub
              </UButton>
            </div>
          </div>
        </div>
      </section>
    </UContainer>
  </div>
</template>
