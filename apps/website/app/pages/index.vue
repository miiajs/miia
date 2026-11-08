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

const container = 'mx-auto flex max-w-(--ui-container) flex-col gap-4 px-4 sm:px-6 lg:px-8 lg:flex-row lg:flex-wrap lg:gap-x-14 lg:gap-y-10'
const eyebrow = 'font-mono text-xs text-muted lg:text-[13px]'
const heading = 'text-[26px] leading-[1.18] font-semibold tracking-[-0.02em] lg:text-[length:clamp(28px,3vw,36px)] lg:leading-[1.15]'
const lead = 'max-w-[460px] text-base leading-[1.6] text-toned lg:text-[17px]'
const textLink = 'inline-flex min-h-11 items-center gap-2 self-start text-[15px] font-medium text-primary underline-offset-4 hover:underline lg:min-h-8'
const button = 'min-h-12 justify-center gap-2 rounded-sm px-5 text-[15px]'
</script>

<template>
  <div v-if="page">
    <section class="mx-auto flex max-w-(--ui-container) flex-col gap-7 px-4 pt-10 pb-12 sm:px-6 lg:flex-row lg:px-8 lg:flex-wrap lg:items-center lg:gap-14 lg:pt-[88px] lg:pb-20">
      <div class="flex min-w-0 flex-col gap-5 lg:flex-[1_1_480px] lg:gap-[26px]">
        <h1 class="text-[36px] leading-[1.08] font-semibold tracking-[-0.025em] lg:text-[length:clamp(40px,4.6vw,62px)] lg:leading-[1.04]">
          {{ heroTitle[0] }}<br><span class="text-dimmed">{{ heroTitle[1] }}</span>
        </h1>
        <p class="max-w-[520px] text-[17px] leading-[1.6] text-toned lg:text-lg">
          {{ page.hero.description }}
        </p>
        <div class="flex flex-col gap-2.5 lg:flex-row lg:flex-wrap lg:gap-3">
          <UButton
            v-for="link in page.hero.links"
            :key="link.to"
            v-bind="link"
            :class="[button, 'font-semibold']"
          />
          <div class="flex min-h-12 items-center gap-2.5 rounded-sm border border-accented bg-elevated ps-3.5 pe-0.5 font-mono text-sm lg:pe-1">
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
      </div>
      <CodePanel
        file="users.controller.ts"
        lang="ts"
        :code="codeDecorators"
        class="min-w-0 lg:flex-[1_1_520px]"
      />
    </section>

    <section class="border-t border-default">
      <div :class="[container, 'py-12 lg:items-start lg:py-20']">
        <div class="flex min-w-0 flex-col gap-4 lg:flex-[1_1_400px] lg:gap-[18px]">
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
        </div>
        <div class="flex min-w-0 flex-col lg:flex-[1_1_560px]">
          <div
            v-for="feature in page.architecture.features"
            :key="feature.title"
            class="flex flex-col gap-1.5 border-t border-default py-[18px] last:border-b lg:flex-row lg:flex-wrap lg:gap-x-8 lg:gap-y-2 lg:py-[22px]"
          >
            <h3 class="text-base font-semibold lg:flex-[0_0_220px] lg:text-[17px]">
              {{ feature.title }}
            </h3>
            <p class="text-[15px] leading-[1.6] text-toned lg:flex-[1_1_280px]">
              {{ feature.description }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <section class="border-t border-default">
      <div :class="[container, 'gap-5 py-12 lg:items-center lg:py-20']">
        <div class="flex min-w-0 flex-col gap-4 lg:flex-[1_1_400px] lg:gap-[18px]">
          <p :class="eyebrow">
            runtimes
          </p>
          <h2 :class="heading">
            {{ page.runtimes.title }}
          </h2>
          <p :class="lead">
            {{ page.runtimes.description }}
          </p>
          <p class="font-mono text-xs leading-[1.6] text-muted lg:text-[13px]">
            tested on {{ page.runtimes.tested.join(' · ') }}
          </p>
        </div>
        <CodePanel
          file="main.ts"
          lang="ts"
          :code="codeRuntime"
          class="min-w-0 lg:flex-[1_1_520px]"
        />
      </div>
    </section>

    <section class="border-t border-default">
      <div class="mx-auto flex max-w-(--ui-container) flex-col gap-4 px-4 py-12 sm:px-6 lg:gap-9 lg:px-8 lg:py-20">
        <div class="contents lg:flex lg:flex-wrap lg:items-end lg:justify-between lg:gap-x-12 lg:gap-y-4">
          <div class="flex max-w-[640px] flex-col gap-4 lg:gap-[18px]">
            <p :class="eyebrow">
              packages
            </p>
            <h2 :class="heading">
              {{ page.packages.title }}
            </h2>
            <p :class="lead">
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
        <div class="grid border border-default bg-elevated sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] sm:border-r-0 sm:border-b-0">
          <div
            v-for="item in page.packages.items"
            :key="item.title"
            class="flex flex-col gap-1.5 border-default p-4 not-first:border-t sm:gap-2.5 sm:border-r sm:border-b sm:p-[22px] sm:not-first:border-t-0"
          >
            <h3 class="text-[15.5px] font-semibold sm:text-base">
              {{ item.title }}
            </h3>
            <p class="text-sm leading-[1.55] text-toned sm:text-[14.5px]">
              {{ item.description }}
            </p>
            <p class="font-mono text-xs text-muted sm:mt-auto sm:pt-1.5 sm:text-[12.5px]">
              {{ item.packages }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <section class="border-t border-default">
      <div :class="[container, 'py-12 lg:items-center lg:py-20']">
        <div class="contents lg:flex lg:min-w-0 lg:flex-[1_1_380px] lg:flex-col lg:gap-[18px]">
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
        </div>
        <figure class="mt-1 min-w-0 overflow-x-auto rounded-[8px] border border-default bg-elevated font-mono lg:mt-0 lg:flex-[1_1_560px]">
          <div class="sm:min-w-[500px]">
            <div class="grid gap-4 border-b border-muted px-3.5 py-2.5 text-[11.5px] leading-[1.5] text-muted sm:grid-cols-[150px_minmax(0,1fr)_84px_64px] sm:px-[18px] sm:py-3 sm:text-xs">
              <span class="sm:col-span-2">{{ benchRoute }}</span>
              <span class="hidden text-right sm:block">req/s</span>
              <span class="hidden text-right sm:block">latency</span>
            </div>
            <div>
              <div
                v-for="row in benchRows"
                :key="row.name"
                class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-muted px-3.5 py-3 text-[13px] not-first:border-t sm:grid-cols-[150px_minmax(0,1fr)_84px_64px] sm:gap-4 sm:px-[18px] sm:text-[13.5px]"
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
          </div>
        </figure>
      </div>
    </section>

    <section class="border-t border-default">
      <div :class="[container, 'pt-12 pb-14 lg:items-center lg:pt-20 lg:pb-24']">
        <div class="contents lg:flex lg:min-w-0 lg:flex-[1_1_400px] lg:flex-col lg:gap-[18px]">
          <p :class="eyebrow">
            get started
          </p>
          <h2 :class="heading">
            {{ page.start.title }}
          </h2>
          <p :class="lead">
            {{ page.start.description }}
          </p>
          <div class="order-last flex flex-col gap-2.5 pt-1 lg:order-none lg:flex-row lg:flex-wrap lg:gap-3 lg:pt-1.5">
            <UButton
              v-for="link in page.start.links"
              :key="link.to"
              v-bind="link"
              :class="[button, link.variant === 'outline' ? 'bg-transparent ring-inverted' : 'font-semibold']"
              :ui="{ trailingIcon: 'size-3.5' }"
            />
          </div>
        </div>
        <CodePanel
          file="terminal"
          lang="bash"
          :code="codeTerminal"
          class="mt-1 min-w-0 lg:mt-0 lg:flex-[1_1_520px]"
        />
      </div>
    </section>
  </div>
</template>
