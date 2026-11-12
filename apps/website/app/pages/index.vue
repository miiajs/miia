<script setup lang="ts">
import { config as benchEnv, data as benchData } from '~/data/benchmarks/m1'

const { data: page } = await useAsyncData('index', () => queryCollection('index').first())

const title = page.value?.seo?.title || page.value?.title
const description = page.value?.seo?.description || page.value?.description

useSeoMeta({
  titleTemplate: '',
  title,
  ogTitle: title,
  description,
  ogDescription: description
})

const heroTitle = computed(() => page.value?.hero.title.split('\n') ?? [])

const installCommand = 'bun create miia my-app'
const { copied, copy } = useCopy()

const codeDecorators = `@Controller('/users')
export class UserController {
  private userService = inject(UserService)

  @Get('/')
  async list() {
    return this.userService.findAll()
  }

  @Post('/', { body: CreateUserSchema })
  @Status(201)
  async create(ctx: RequestContext) {
    const input = await ctx.json<CreateUserInput>()
    return this.userService.create(input)
  }
}`

const codeRuntime = `const app = new Miia().register(AppModule)

// Bun / Deno - auto-detected
await app.listen(3000)

// Node.js / uWebSockets.js
await app.listen(3000, serve)

// Cloudflare Workers and other fetch platforms
await app.init()
export default { fetch: app.fetch }`

const codeTerminal = `# Bun
bun create miia my-app
# Node.js
npm create miia my-app
# Deno
deno run -A npm:create-miia my-app`

// The realistic POST test of the benchmarks page, Bun rows only
const benchRoute = 'POST /api/workspaces/:ws/projects/:proj/tasks'
const benchRun = `Bun ${benchEnv.versions.bun} on an ${benchEnv.label}, ${benchEnv.date}.`
const benchRows = (() => {
  const rows = benchData.apiPost
    .filter(row => row.framework.endsWith(' (Bun)'))
    .sort((a, b) => b.reqSec - a.reqSec)
  const top = rows[0]?.reqSec ?? 1
  return rows.map(row => ({
    name: row.framework.slice(0, -' (Bun)'.length).replace('+', ' + '),
    reqSec: row.reqSec.toLocaleString('en-US'),
    latency: row.latency,
    width: `${(row.reqSec / top * 100).toFixed(1)}%`,
    highlight: row.highlight ?? false
  }))
})()

const eyebrow = 'font-mono text-meta text-muted'
const heading = 'text-heading font-semibold'
const lead = 'max-w-split text-body-lg text-toned'
const textLink = 'inline-flex min-h-11 items-center gap-2 self-start text-ui font-medium text-primary underline-offset-4 hover:underline lg:min-h-8'
const button = 'min-h-12 justify-center gap-2 rounded-sm px-5 text-ui'
</script>

<template>
  <div v-if="page">
    <SplitRow
      as="section"
      class="gap-7 pt-page pb-12 lg:pb-20"
      text-class="gap-5 lg:gap-[26px]"
    >
      <template #text>
        <h1 class="text-display font-semibold">
          {{ heroTitle[0] }}<br><span class="text-dimmed">{{ heroTitle[1] }}</span>
        </h1>
        <p class="max-w-split text-lead text-toned">
          {{ page.hero.description }}
        </p>
        <div class="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-3">
          <UButton
            v-for="link in page.hero.links"
            :key="link.to"
            v-bind="link"
            :class="[button, 'font-semibold']"
          />
          <div class="flex min-h-12 items-center gap-2.5 rounded-sm border border-accented bg-elevated ps-3.5 pe-0.5 font-mono text-code lg:pe-1">
            <span
              class="text-dimmed"
              aria-hidden="true"
            >$</span>
            <span class="flex-1">{{ installCommand }}</span>
            <UButton
              color="neutral"
              variant="ghost"
              :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              :aria-label="copied ? 'Copied' : 'Copy install command'"
              class="size-11 justify-center rounded-[4px] text-toned lg:size-10"
              :ui="{ leadingIcon: 'size-4' }"
              @click="copy(installCommand)"
            />
          </div>
        </div>
      </template>
      <template #panel>
        <CodePanel
          file="users.controller.ts"
          lang="ts"
          :code="codeDecorators"
        />
      </template>
    </SplitRow>

    <section class="border-t border-default">
      <SplitRow
        align="start"
        class="gap-4 py-12 lg:py-20"
      >
        <template #text>
          <p :class="eyebrow">
            architecture
          </p>
          <h2 :class="heading">
            {{ page.architecture.title }}
          </h2>
          <p :class="lead">
            {{ page.architecture.description }}
          </p>
          <NuxtLink
            :to="page.architecture.link.to"
            :class="textLink"
          >
            {{ page.architecture.link.label }}
            <UIcon
              name="i-lucide-arrow-right"
              class="size-3.5"
            />
          </NuxtLink>
        </template>
        <template #panel>
          <div
            v-for="feature in page.architecture.features"
            :key="feature.title"
            class="flex flex-col gap-1.5 border-t border-default py-[18px] last:border-b sm:grid sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-x-6 lg:py-[22px]"
          >
            <h3 class="text-card-title font-semibold">
              {{ feature.title }}
            </h3>
            <p class="text-ui text-toned">
              {{ feature.description }}
            </p>
          </div>
        </template>
      </SplitRow>
    </section>

    <section class="border-t border-default">
      <SplitRow class="gap-5 py-12 lg:py-20">
        <template #text>
          <p :class="eyebrow">
            runtimes
          </p>
          <h2 :class="heading">
            {{ page.runtimes.title }}
          </h2>
          <p :class="lead">
            {{ page.runtimes.description }}
          </p>
          <p class="font-mono text-meta text-muted">
            tested on {{ page.runtimes.tested.join(' · ') }}
          </p>
        </template>
        <template #panel>
          <CodePanel
            file="main.ts"
            lang="ts"
            :code="codeRuntime"
          />
        </template>
      </SplitRow>
    </section>

    <section class="border-t border-default">
      <UContainer class="flex flex-col gap-4 py-12 lg:gap-9 lg:py-20">
        <div class="contents lg:flex lg:flex-wrap lg:items-end lg:justify-between lg:gap-x-12 lg:gap-y-4">
          <div class="flex max-w-reading flex-col gap-4 lg:gap-[18px]">
            <p :class="eyebrow">
              packages
            </p>
            <h2 :class="heading">
              {{ page.packages.title }}
            </h2>
            <p class="text-body-lg text-toned">
              {{ page.packages.description }}
            </p>
          </div>
          <NuxtLink
            :to="page.packages.link.to"
            :class="[textLink, 'order-last lg:order-none lg:self-end']"
          >
            {{ page.packages.link.label }}
            <UIcon
              name="i-lucide-arrow-right"
              class="size-3.5"
            />
          </NuxtLink>
        </div>
        <div class="grid border border-default bg-elevated sm:grid-cols-2 sm:border-r-0 sm:border-b-0 lg:grid-cols-4">
          <div
            v-for="item in page.packages.items"
            :key="item.title"
            class="flex flex-col gap-1.5 border-default p-4 not-first:border-t sm:gap-2.5 sm:border-r sm:border-b sm:p-[22px] sm:not-first:border-t-0"
          >
            <h3 class="text-card-title font-semibold">
              {{ item.title }}
            </h3>
            <p class="text-small text-toned">
              {{ item.description }}
            </p>
            <p class="font-mono text-caption text-muted sm:mt-auto sm:pt-1.5">
              {{ item.packages }}
            </p>
          </div>
        </div>
      </UContainer>
    </section>

    <section class="border-t border-default">
      <SplitRow
        flow
        class="gap-4 py-12 lg:py-20"
      >
        <template #text>
          <p :class="eyebrow">
            performance
          </p>
          <h2 :class="heading">
            {{ page.performance.title }}
          </h2>
          <p :class="lead">
            {{ page.performance.description }} {{ benchRun }}
          </p>
          <NuxtLink
            :to="page.performance.link.to"
            :class="[textLink, 'order-last lg:order-none']"
          >
            {{ page.performance.link.label }}
            <UIcon
              name="i-lucide-arrow-right"
              class="size-3.5"
            />
          </NuxtLink>
        </template>
        <template #panel>
          <figure class="mt-1 overflow-x-auto rounded-[8px] border border-default bg-elevated font-mono lg:mt-0">
            <div class="grid gap-4 border-b border-muted px-3.5 py-2.5 text-caption text-muted sm:grid-cols-[150px_minmax(0,1fr)_84px_64px] sm:px-[18px] sm:py-3">
              <span class="break-all sm:col-span-2">{{ benchRoute }}</span>
              <span class="hidden text-right sm:block">req/s</span>
              <span class="hidden text-right sm:block">latency</span>
            </div>
            <div>
              <div
                v-for="row in benchRows"
                :key="row.name"
                class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-muted px-3.5 py-3 text-meta not-first:border-t sm:grid-cols-[150px_minmax(0,1fr)_84px_64px] sm:gap-4 sm:px-[18px]"
                :class="row.highlight ? 'text-highlighted' : 'text-toned'"
              >
                <span
                  class="col-start-1 row-start-1"
                  :class="row.highlight && 'font-medium'"
                >{{ row.name }}</span>
                <span class="col-start-2 row-start-1 text-right sm:contents">
                  <span
                    class="sm:col-start-3 sm:row-start-1"
                    :class="row.highlight && 'font-medium'"
                  >{{ row.reqSec }}<span class="text-muted sm:hidden"> req/s</span></span>
                  <span class="text-muted sm:col-start-4 sm:row-start-1 sm:text-right"><span class="sm:hidden"> · </span>{{ row.latency }}</span>
                </span>
                <div class="col-span-2 row-start-2 h-2 rounded-[2px] bg-(--ui-border-muted) sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:h-2.5">
                  <div
                    class="h-full rounded-[2px]"
                    :class="row.highlight ? 'bg-primary' : 'bg-(--ui-text-dimmed)/30 dark:bg-(--ui-text-dimmed)/40'"
                    :style="{ width: row.width }"
                  />
                </div>
              </div>
            </div>
          </figure>
        </template>
      </SplitRow>
    </section>

    <section class="border-t border-default">
      <SplitRow
        flow
        class="gap-4 pt-12 pb-page lg:pt-20"
      >
        <template #text>
          <p :class="eyebrow">
            get started
          </p>
          <h2 :class="heading">
            {{ page.start.title }}
          </h2>
          <p :class="lead">
            {{ page.start.description }}
          </p>
          <div class="order-last flex flex-col gap-2.5 pt-1 sm:flex-row sm:flex-wrap sm:gap-3 lg:order-none lg:pt-1.5">
            <UButton
              v-for="link in page.start.links"
              :key="link.to"
              v-bind="link"
              :class="[button, link.variant === 'outline' ? 'bg-transparent ring-inverted' : 'font-semibold']"
              :ui="{ trailingIcon: 'size-3.5' }"
            />
          </div>
        </template>
        <template #panel>
          <CodePanel
            file="terminal"
            lang="bash"
            :code="codeTerminal"
            class="mt-1 lg:mt-0"
          />
        </template>
      </SplitRow>
    </section>
  </div>
</template>
