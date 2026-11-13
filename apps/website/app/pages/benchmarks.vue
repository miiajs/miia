<script setup lang="ts">
import { type BenchRow, datasets, environments } from '~/data/benchmarks'

const description = 'MiiaJS next to Hono, Elysia, Fastify and NestJS on Bun, Deno and Node.js: throughput and latency in realistic API tests and in synthetic ones.'

usePageSeo('Benchmarks', description)

const env = ref(environments[0]!.key)
const activeEnv = computed(() => environments.find(e => e.key === env.value)!)
const activeData = computed(() => datasets[env.value]!)

const frameworks = [
  { name: 'MiiaJS', version: '0.6.0', type: 'Decorator-driven, DI, guards, middleware', runtimes: 'Bun, Deno, Node (+ uWS adapter)' },
  { name: 'Hono', version: '4.13.3', type: 'Lightweight multi-runtime router', runtimes: 'Bun, Deno, Node (+ uWS adapter)' },
  { name: 'Elysia', version: '1.4.29', type: 'Bun-native framework', runtimes: 'Bun' },
  { name: 'Fastify', version: '5.12.1', type: 'Plugin-based Node.js framework', runtimes: 'Bun, Node' },
  { name: 'NestJS + Fastify', version: '11.2.1', type: 'Enterprise decorator framework', runtimes: 'Bun, Node' }
]

const methodLine = `measured on MiiaJS ${frameworks[0]!.version} · Autocannon · 100 connections · 5 passes of 30 s`

function benchTest(title: string, description: string, rows: BenchRow[]) {
  const top = Math.max(...rows.map(row => row.reqSec))
  return {
    title,
    description,
    rows: rows.map(row => ({
      name: row.framework,
      reqSec: row.reqSec.toLocaleString('en-US'),
      latency: row.latency,
      width: `${(row.reqSec / top * 100).toFixed(1)}%`,
      highlight: row.highlight ?? false
    }))
  }
}

const suites = computed(() => [
  {
    eyebrow: 'realistic api',
    title: 'Realistic API',
    description: 'Full middleware stack - CORS, JWT, routing, body parsing, validation. The way real APIs work.',
    tests: [
      benchTest('GET /api/users/:userId/posts/:postId', 'CORS, JWT verification, nested route params, JSON response.', activeData.value.apiGet),
      benchTest('POST /api/workspaces/:ws/projects/:proj/tasks', 'CORS, JWT, JSON body, path and query params, custom headers, UUID, 201 status. The heaviest test.', activeData.value.apiPost)
    ]
  },
  {
    eyebrow: 'synthetic',
    title: 'Synthetic',
    description: 'Minimal handlers - pure framework overhead with no middleware. Bare routers have a natural edge here.',
    tests: [
      benchTest('GET /', 'Returns { "message": "Hello, World!" }. No middleware, no parsing.', activeData.value.syntheticGet),
      benchTest('POST /json', 'Parse a JSON body, generate a UUID, return a response.', activeData.value.syntheticPost)
    ]
  }
])

const methodology = [
  {
    title: 'Load parameters',
    stacked: false,
    items: [
      { term: 'tool', detail: 'Autocannon v8+' },
      { term: 'connections', detail: '100 concurrent' },
      { term: 'duration', detail: '30 s per pass' },
      { term: 'warmup', detail: '5 s at full connections, for the JIT' },
      { term: 'passes', detail: '5, averaged with stddev' },
      { term: 'workers', detail: '1, single-threaded, no clustering' }
    ]
  },
  {
    title: 'What the API scenarios test',
    stacked: true,
    items: [
      { term: 'cors', detail: 'Origin validation and preflight headers' },
      { term: 'jwt', detail: 'Bearer token extraction and HS256 verification' },
      { term: 'routing', detail: 'Path parameters from nested segments' },
      { term: 'body', detail: 'JSON deserialization, POST scenarios' },
      { term: 'query', detail: 'URL search parameter extraction' },
      { term: 'response', detail: 'JSON serialization with custom status codes' }
    ]
  }
]

// The machine name is the description up to the first comma, without the core count in parentheses
const machines = environments.map(e => ({
  key: e.key,
  name: e.description.split(',')[0]!.replace(/\s*\(.*\)$/, ''),
  lines: [
    e.specs.slice(0, -1),
    e.specs.slice(-1),
    [`Bun ${e.versions.bun}`, `Deno ${e.versions.deno}`, `Node.js ${e.versions.node}`]
  ],
  date: e.date
}))

const internals = [
  {
    title: 'Core',
    items: [
      { term: 'Trie-based router', detail: 'O(1) static path lookup' },
      { term: 'Compile-time pipelines', detail: 'middleware chains resolved once at startup, not per request' },
      { term: 'Sync fast path', detail: 'no Promise for a synchronous handler on a route without middleware, guards or schemas' },
      { term: 'No runtime reflection', detail: 'native decorators resolve at class definition' },
      { term: 'Minimal allocations', detail: 'no wrapper objects between your handler and the runtime' }
    ]
  },
  {
    title: 'Node.js and uWebSockets adapters',
    items: [
      { term: 'Lazy Request and Headers proxy', detail: 'no allocation until accessed' },
      { term: 'Body buffering', detail: 'small payloads skip the ReadableStream overhead' },
      { term: 'LightResponse cache', detail: 'status, body and headers without constructing a real Response' }
    ]
  }
]

const codeReproduce = `git clone https://github.com/miiajs/benchmarks.git
cd benchmarks
bun install
bun run bench`

const eyebrow = 'font-mono text-meta text-muted'
const heading = 'text-heading font-semibold'
const lead = 'text-body-lg text-toned'
const subheading = 'text-card-title font-semibold'
const columns = 'flex flex-col gap-6 lg:flex-row lg:flex-wrap lg:gap-x-14 lg:gap-y-8'
const column = 'flex min-w-0 flex-col lg:flex-[1_1_420px]'
const textLink = 'inline-flex min-h-11 items-center gap-2 self-start text-ui font-medium text-primary underline-offset-4 hover:underline lg:min-h-8'
</script>

<template>
  <div>
    <UContainer
      as="section"
      class="flex flex-col gap-4 pt-page pb-7 lg:gap-5 lg:pb-10"
    >
      <p :class="eyebrow">
        benchmarks
      </p>
      <h1 class="text-display font-semibold">
        Throughput and latency,<br><span class="text-dimmed">with the full stack on.</span>
      </h1>
      <p class="max-w-reading text-lead text-toned">
        MiiaJS next to Hono, Elysia, Fastify and NestJS on Bun, Deno and Node.js. The realistic tests run with CORS, JWT,
        routing, body parsing and validation enabled; the synthetic ones measure bare framework overhead.
      </p>
      <p class="font-mono text-meta text-muted">
        {{ methodLine }}
      </p>
    </UContainer>

    <div class="border-y border-default bg-muted">
      <UContainer class="flex flex-col gap-2.5 py-3 sm:items-start lg:flex-row lg:items-center lg:gap-x-6 lg:py-3.5">
        <div
          role="group"
          aria-label="Test machine"
          class="flex gap-1 rounded-[8px] border border-accented bg-elevated p-[3px]"
        >
          <button
            v-for="e in environments"
            :key="e.key"
            type="button"
            :aria-pressed="env === e.key"
            class="min-h-11 flex-1 rounded-sm px-4 font-mono text-meta sm:flex-none lg:min-h-10"
            :class="env === e.key ? 'bg-inverted font-semibold text-inverted' : 'text-toned hover:text-highlighted'"
            @click="env = e.key"
          >
            {{ e.label }}
          </button>
        </div>
        <p class="min-w-0 font-mono text-meta text-muted">
          {{ activeEnv.description }} · measured {{ activeEnv.date }}
        </p>
      </UContainer>
    </div>

    <UContainer
      v-for="(suite, index) in suites"
      :key="suite.title"
      as="section"
      :class="['flex flex-col gap-4 pb-2 lg:gap-6 lg:pb-6', index === 0 ? 'pt-10 lg:pt-16' : 'pt-8 lg:pt-12']"
    >
      <div class="flex max-w-reading flex-col gap-4 lg:gap-2.5">
        <p :class="eyebrow">
          {{ suite.eyebrow }}
        </p>
        <h2 :class="heading">
          {{ suite.title }}
        </h2>
        <p :class="lead">
          {{ suite.description }}
        </p>
      </div>
      <div class="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <figure
          v-for="test in suite.tests"
          :key="test.title"
          class="min-w-0 rounded-[8px] border border-default bg-elevated sm:row-span-3 sm:grid sm:grid-rows-subgrid sm:gap-y-0"
        >
          <figcaption class="flex flex-col gap-1 border-b border-muted px-3.5 py-3 sm:px-[18px] sm:py-3.5">
            <h3 class="font-mono text-meta font-semibold break-all text-highlighted">
              {{ test.title }}
            </h3>
            <p class="text-small text-muted">
              {{ test.description }}
            </p>
          </figcaption>
          <div class="hidden grid-cols-[170px_minmax(0,1fr)_72px_64px] gap-3.5 px-[18px] pt-2.5 pb-1 font-mono text-caption text-muted sm:grid">
            <span>framework</span>
            <span />
            <span class="text-right">req/s</span>
            <span class="text-right">latency</span>
          </div>
          <div class="sm:pb-2.5">
            <div
              v-for="row in test.rows"
              :key="row.name"
              class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-[5px] px-3.5 py-2 font-mono text-meta sm:grid-cols-[170px_minmax(0,1fr)_72px_64px] sm:gap-3.5 sm:px-[18px] sm:py-1.5"
            >
              <span
                class="col-start-1 row-start-1"
                :class="row.highlight ? 'font-semibold text-highlighted' : 'text-toned'"
              >{{ row.name }}</span>
              <span class="col-start-2 row-start-1 text-right sm:contents">
                <span
                  class="text-highlighted sm:col-start-3 sm:row-start-1"
                  :class="row.highlight && 'font-semibold'"
                >{{ row.reqSec }}</span>
                <span class="text-muted sm:col-start-4 sm:row-start-1 sm:text-right"><span class="sm:hidden"> · </span>{{ row.latency }}</span>
              </span>
              <div
                aria-hidden="true"
                class="col-span-2 row-start-2 h-[7px] rounded-[2px] bg-(--ui-border-muted) sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:h-2"
              >
                <div
                  class="h-full rounded-[2px] motion-safe:transition-[width] motion-safe:duration-500"
                  :class="row.highlight ? 'bg-primary' : 'bg-(--ui-text-dimmed)/30 dark:bg-(--ui-text-dimmed)/40'"
                  :style="{ width: row.width }"
                />
              </div>
            </div>
          </div>
        </figure>
      </div>
    </UContainer>

    <UContainer class="pt-6 lg:pt-8 [&>aside]:my-0">
      <ProseNote title="Node.js">
        <p>
          MiiaJS with the uWS adapter outperforms Hono uWS by up to 44% and NestJS+Fastify by up to 23% in realistic API
          tests on M1 Pro. Same transport - the difference is pure framework overhead.
        </p>
      </ProseNote>
    </UContainer>

    <section class="mt-12 border-t border-default lg:mt-16">
      <UContainer class="flex flex-col gap-4 py-10 lg:gap-8 lg:py-16">
        <div class="flex max-w-reading flex-col gap-4 lg:gap-2.5">
          <p :class="eyebrow">
            methodology
          </p>
          <h2 :class="heading">
            How it is measured
          </h2>
          <p :class="lead">
            All benchmarks run under controlled conditions with randomized server order to reduce bias.
          </p>
        </div>

        <div :class="[columns, 'mt-2 lg:mt-0']">
          <div
            v-for="group in methodology"
            :key="group.title"
            :class="[column, 'gap-4 lg:gap-2']"
          >
            <h3 :class="subheading">
              {{ group.title }}
            </h3>
            <dl class="text-ui">
              <div
                v-for="item in group.items"
                :key="item.term"
                class="flex border-t border-muted py-2.5 last:border-b sm:grid sm:grid-cols-[120px_minmax(0,1fr)] sm:items-baseline sm:gap-4"
                :class="group.stacked ? 'flex-col gap-0.5' : 'items-baseline justify-between gap-3'"
              >
                <dt class="font-mono text-meta text-muted">
                  {{ item.term }}
                </dt>
                <dd :class="!group.stacked && 'text-right sm:text-left'">
                  {{ item.detail }}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <h3 :class="[subheading, 'mt-2 lg:mt-4']">
          Test machines
        </h3>
        <div class="flex flex-col gap-4 sm:grid sm:grid-cols-2 sm:gap-5">
          <div
            v-for="machine in machines"
            :key="machine.key"
            class="flex min-w-0 flex-col gap-1.5 rounded-[8px] border border-default bg-elevated px-4 py-3.5 lg:px-5 lg:py-[18px]"
          >
            <h4 class="text-card-title font-semibold lg:mb-1">
              {{ machine.name }}
            </h4>
            <p class="font-mono text-meta leading-relaxed text-toned">
              <span
                v-for="(line, i) in machine.lines"
                :key="i"
                class="block"
              >
                <template
                  v-for="(part, j) in line"
                  :key="part"
                >{{ j ? ' · ' : '' }}<span class="whitespace-nowrap">{{ part }}</span></template>
              </span>
            </p>
            <p class="font-mono text-meta text-muted lg:mt-1.5">
              measured {{ machine.date }}
            </p>
          </div>
        </div>

        <h3 :class="[subheading, 'mt-2 lg:mt-4']">
          Frameworks compared
        </h3>
        <ul class="rounded-[8px] border border-default bg-elevated sm:hidden">
          <li
            v-for="framework in frameworks"
            :key="framework.name"
            class="flex flex-col gap-[3px] border-muted px-3.5 py-3 not-first:border-t"
          >
            <div class="flex items-baseline justify-between gap-2.5">
              <span :class="framework.name === 'MiiaJS' && 'font-semibold'">{{ framework.name }}</span>
              <span class="font-mono text-caption">{{ framework.version }}</span>
            </div>
            <span class="text-small text-muted">{{ framework.type }} · {{ framework.runtimes }}</span>
          </li>
        </ul>
        <div class="hidden overflow-x-auto rounded-[8px] border border-default bg-elevated sm:block">
          <table class="w-full border-collapse text-small">
            <thead>
              <tr class="font-mono text-caption text-muted">
                <th
                  v-for="label in ['framework', 'version', 'type', 'runtimes']"
                  :key="label"
                  scope="col"
                  class="px-4 py-3 text-left font-normal"
                >
                  {{ label }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="framework in frameworks"
                :key="framework.name"
                class="border-t border-muted"
              >
                <th
                  scope="row"
                  class="px-4 py-3 text-left"
                  :class="framework.name === 'MiiaJS' ? 'font-semibold' : 'font-normal'"
                >
                  {{ framework.name }}
                </th>
                <td class="px-4 py-3 font-mono text-meta">
                  {{ framework.version }}
                </td>
                <td class="px-4 py-3 text-toned">
                  {{ framework.type }}
                </td>
                <td class="px-4 py-3 text-toned">
                  {{ framework.runtimes }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="font-mono text-caption text-muted">
          Hono uWS uses the same @miiajs/uws-server adapter (uWebSockets.js 20.69.0), so the difference is pure framework
          overhead.
        </p>
      </UContainer>
    </section>

    <section class="border-t border-default">
      <UContainer class="flex flex-col gap-3.5 py-10 lg:gap-7 lg:py-16">
        <div class="flex flex-col gap-3.5 lg:gap-2.5">
          <p :class="eyebrow">
            internals
          </p>
          <h2 :class="heading">
            Where the speed comes from
          </h2>
        </div>
        <div :class="[columns, 'mt-1.5 lg:mt-0']">
          <div
            v-for="group in internals"
            :key="group.title"
            :class="[column, 'gap-3.5 lg:gap-2']"
          >
            <h3 :class="subheading">
              {{ group.title }}
            </h3>
            <ul class="text-ui text-toned">
              <li
                v-for="item in group.items"
                :key="item.term"
                class="border-t border-muted py-2.5 last:border-b lg:py-3"
              >
                <strong class="font-semibold text-highlighted">{{ item.term }}</strong> - {{ item.detail }}
              </li>
            </ul>
          </div>
        </div>
      </UContainer>
    </section>

    <section class="border-t border-default">
      <SplitRow
        flow
        class="gap-3.5 pt-10 pb-page lg:pt-16"
        text-class="lg:gap-3.5"
      >
        <template #text>
          <p :class="eyebrow">
            reproduce
          </p>
          <h2 :class="heading">
            Run it yourself
          </h2>
          <p :class="[lead, 'max-w-split']">
            The benchmark suite is open source. Its CLI lets you pick scenarios, runtimes and the number of passes.
          </p>
          <NuxtLink
            to="https://github.com/miiajs/benchmarks"
            target="_blank"
            :class="[textLink, 'order-last lg:order-none']"
          >
            github.com/miiajs/benchmarks
            <UIcon
              name="i-lucide-arrow-up-right"
              class="size-3.5"
            />
          </NuxtLink>
        </template>
        <template #panel>
          <CodePanel
            file="terminal"
            lang="bash"
            :code="codeReproduce"
            class="mt-1 lg:mt-0"
          />
        </template>
      </SplitRow>
    </section>
  </div>
</template>
