<script setup lang="ts">
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

const codeDecorators = `@Controller('/users')
export class UserController {
  private userService = inject(UserService)

  @Get('/')
  async list() {
    return this.userService.findAll()
  }

  @Post('/')
  @Status(201)
  @ValidateBody(CreateUserSchema)
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

// Cloudflare Workers
await app.init()
export default app`

const runtimes = [
  { name: 'Bun',        icon: 'i-simple-icons-bun' },
  { name: 'Deno',       icon: 'i-simple-icons-deno' },
  { name: 'Node.js',    icon: 'i-simple-icons-nodedotjs' },
  { name: 'Cloudflare', icon: 'i-simple-icons-cloudflare' },
  { name: 'AWS Lambda', icon: 'i-simple-icons-awslambda' },
  { name: 'Vercel',     icon: 'i-simple-icons-vercel' }
]

const installCommand = 'bun add @miiajs/core'
const copied = ref(false)
let copyResetTimer: ReturnType<typeof setTimeout> | null = null

async function copyInstall() {
  try {
    await navigator.clipboard.writeText(installCommand)
    copied.value = true
    if (copyResetTimer) clearTimeout(copyResetTimer)
    copyResetTimer = setTimeout(() => {
      copied.value = false
    }, 1800)
  } catch {
    // clipboard unavailable - graceful no-op
  }
}
</script>

<template>
  <div v-if="page">
    <!-- ========================= HERO ========================= -->
    <section class="relative overflow-hidden">
      <HeroBackground />

      <div class="relative mx-auto max-w-6xl px-4 pt-20 pb-28 sm:pt-28 sm:pb-36 text-center">
        <!-- Eyebrow badge -->
        <div class="mb-8 flex justify-center">
          <NuxtLink
            to="/benchmarks"
            class="group inline-flex items-center gap-2 rounded-full glass px-3 py-1.5 text-xs sm:text-sm text-muted transition hover:text-default"
          >
            <span class="relative flex h-2 w-2">
              <span class="absolute inset-0 rounded-full gradient-plasma animate-beam" />
              <span class="relative inline-flex h-full w-full rounded-full gradient-plasma" />
            </span>
            <!-- Mobile: compact both-metrics pill -->
            <span class="sm:hidden">
              <span class="font-semibold text-default">17% vs Hono</span>
              <span class="opacity-40 mx-1">·</span>
              <span class="font-semibold text-default">31% vs NestJS</span>
            </span>
            <!-- Desktop: full claim with 'Up to' eyebrow and runtime annotation -->
            <span class="hidden sm:inline">Up to</span>
            <span class="hidden sm:inline font-semibold text-default">17% faster than Hono</span>
            <span class="hidden sm:inline opacity-40">·</span>
            <span class="hidden sm:inline font-semibold text-default">31% vs NestJS</span>
            <span class="hidden sm:inline opacity-60 text-xs font-mono">(on Bun)</span>
            <UIcon name="i-lucide-arrow-right" class="size-3.5 transition group-hover:translate-x-0.5" />
          </NuxtLink>
        </div>

        <!-- Huge display title -->
        <h1 class="font-display font-bold leading-[0.95] tracking-tight text-[clamp(2.75rem,9vw,7.5rem)]">
          <span class="block">The</span>
          <span class="block text-plasma">decorator-driven</span>
          <span class="block">HTTP framework</span>
        </h1>

        <p class="mx-auto mt-8 max-w-2xl text-base sm:text-lg text-muted leading-relaxed">
          Build structured, type-safe APIs with decorators, dependency injection,
          and Koa-style middleware - powered by Web Standards. Deploy to Bun,
          Deno, Node.js, or any serverless / edge platform.
        </p>

        <!-- CTAs -->
        <div class="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <UButton
            to="/docs/getting-started"
            size="xl"
            color="primary"
            trailing-icon="i-lucide-arrow-right"
            class="font-display !rounded-full !px-7 glow-plasma"
          >
            Start building
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
            Star on GitHub
          </UButton>
        </div>

        <!-- Install snippet -->
        <div class="mt-10 flex justify-center">
          <button
            type="button"
            :aria-label="copied ? 'Copied to clipboard' : 'Copy install command'"
            class="group inline-flex items-center gap-3 rounded-full glass px-4 py-2 text-sm font-mono text-muted hover:text-default transition"
            @click="copyInstall"
          >
            <UIcon name="i-lucide-terminal" class="size-4 text-[color:var(--color-plasma-500)]" />
            <span><span class="opacity-50">$</span> bun add <span class="text-default">@miiajs/core</span></span>
            <UIcon
              :name="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              :class="[
                'size-3.5 transition',
                copied ? 'text-[color:var(--color-plasma-500)] opacity-100' : 'opacity-40 group-hover:opacity-100'
              ]"
            />
            <span v-if="copied" class="text-xs text-[color:var(--color-plasma-500)] -ml-1">Copied</span>
          </button>
        </div>

        <!-- Runtime strip -->
        <div class="mt-16">
          <p class="text-xs font-medium uppercase tracking-[0.25em] text-dimmed mb-5">
            Runs everywhere JavaScript runs
          </p>
          <div class="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
            <div
              v-for="rt in runtimes"
              :key="rt.name"
              class="flex items-center gap-2 text-muted"
            >
              <UIcon :name="rt.icon" class="size-5" />
              <span class="text-sm">{{ rt.name }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ========================= SPLIT: DECORATORS ========================= -->
    <section class="relative mx-auto max-w-6xl px-4 py-24 sm:py-32">
      <div class="grid lg:grid-cols-2 gap-12 items-center">
        <div class="text-center lg:text-left">
          <p class="font-mono text-xs uppercase tracking-[0.25em] text-[color:var(--color-plasma-500)] mb-4">
            01 · Developer experience
          </p>
          <h2 class="font-display font-bold text-4xl sm:text-5xl leading-[1.05] tracking-tight">
            Familiar patterns,<br />
            <span class="text-plasma">modern foundation</span>
          </h2>
          <p class="mt-6 text-muted leading-relaxed max-w-lg mx-auto lg:mx-0">
            {{ page.sections[0]?.description }}
          </p>
          <ul class="mt-8 space-y-4 max-w-md mx-auto lg:mx-0 lg:max-w-none">
            <li
              v-for="f in page.sections[0]?.features"
              :key="f.title"
              class="flex gap-4 text-left"
            >
              <span class="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl gradient-plasma-soft ring-1 ring-[color:color-mix(in_oklab,var(--color-plasma-500)_40%,transparent)]">
                <UIcon :name="f.icon" class="size-5 text-[color:var(--color-plasma-500)]" />
              </span>
              <div>
                <h3 class="font-display font-semibold text-default">{{ f.title }}</h3>
                <p class="mt-1 text-sm text-muted leading-relaxed">{{ f.description }}</p>
              </div>
            </li>
          </ul>
        </div>

        <CodeCard file="users.controller.ts" :code="codeDecorators" />
      </div>
    </section>

    <!-- ========================= SPLIT: RUNTIMES ========================= -->
    <section class="relative mx-auto max-w-6xl px-4 py-24 sm:py-32">
      <div class="grid lg:grid-cols-2 gap-12 items-center">
        <!-- Source order: text first, code second.
             On mobile this stacks text-on-top / code-below, matching section 01.
             On desktop the grid places text-left / code-right naturally, no order flip needed. -->
        <div class="text-center lg:text-left">
          <p class="font-mono text-xs uppercase tracking-[0.25em] text-[color:var(--color-violet-accent)] mb-4">
            02 · Portability
          </p>
          <h2 class="font-display font-bold text-4xl sm:text-5xl leading-[1.05] tracking-tight">
            One handler,<br />
            <span class="text-plasma">every platform</span>
          </h2>
          <p class="mt-6 text-muted leading-relaxed max-w-lg mx-auto lg:mx-0">
            {{ page.sections[1]?.description }}
          </p>
          <ul class="mt-8 space-y-4 max-w-md mx-auto lg:mx-0 lg:max-w-none">
            <li
              v-for="f in page.sections[1]?.features"
              :key="f.title"
              class="flex gap-4 text-left"
            >
              <span class="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl gradient-plasma-soft ring-1 ring-[color:color-mix(in_oklab,var(--color-violet-accent)_40%,transparent)]">
                <UIcon :name="f.icon" class="size-5 text-[color:var(--color-violet-accent)]" />
              </span>
              <div>
                <h3 class="font-display font-semibold text-default">{{ f.title }}</h3>
                <p class="mt-1 text-sm text-muted leading-relaxed">{{ f.description }}</p>
              </div>
            </li>
          </ul>
        </div>

        <CodeCard file="main.ts" :code="codeRuntime" />
      </div>
    </section>

    <!-- ========================= BENTO FEATURES ========================= -->
    <section class="relative mx-auto max-w-6xl px-4 py-24 sm:py-32">
      <div class="text-center mb-16">
        <p class="font-mono text-xs uppercase tracking-[0.25em] text-[color:var(--color-cyan-accent)] mb-4">
          03 · Batteries included
        </p>
        <h2 class="font-display font-bold text-4xl sm:text-5xl lg:text-6xl leading-[1.05] tracking-tight">
          Everything you need.<br />
          <span class="text-plasma">Nothing you don't.</span>
        </h2>
        <p class="mx-auto mt-6 max-w-2xl text-muted leading-relaxed">
          {{ page.features.description }}
        </p>
      </div>

      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="(item, i) in page.features.items"
          :key="item.title"
          class="group relative overflow-hidden rounded-2xl glass p-6 transition hover:-translate-y-0.5"
        >
          <!-- animated corner glow -->
          <div
            class="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-0 group-hover:opacity-100 transition"
            :style="{
              background: i % 3 === 0
                ? 'radial-gradient(circle, rgba(255,77,109,0.30), transparent 70%)'
                : i % 3 === 1
                  ? 'radial-gradient(circle, rgba(124,58,237,0.30), transparent 70%)'
                  : 'radial-gradient(circle, rgba(34,211,238,0.30), transparent 70%)'
            }"
          />

          <span
            class="relative inline-flex h-11 w-11 items-center justify-center rounded-xl gradient-plasma-soft ring-1"
            :style="{
              '--tw-ring-color': i % 3 === 0
                ? 'color-mix(in oklab, var(--color-plasma-500) 40%, transparent)'
                : i % 3 === 1
                  ? 'color-mix(in oklab, var(--color-violet-accent) 40%, transparent)'
                  : 'color-mix(in oklab, var(--color-cyan-accent) 40%, transparent)'
            }"
          >
            <UIcon
              :name="item.icon"
              class="size-5"
              :style="{
                color: i % 3 === 0
                  ? 'var(--color-plasma-500)'
                  : i % 3 === 1
                    ? 'var(--color-violet-accent)'
                    : 'var(--color-cyan-accent)'
              }"
            />
          </span>

          <h3 class="relative mt-5 font-display font-semibold text-lg text-default">
            {{ item.title }}
          </h3>
          <p class="relative mt-2 text-sm text-muted leading-relaxed">
            {{ item.description }}
          </p>
        </div>
      </div>
    </section>

    <!-- ========================= STATS STRIP ========================= -->
    <section class="relative mx-auto max-w-6xl px-4 py-16">
      <div class="rounded-3xl glass p-8 sm:p-12 overflow-hidden relative">
        <div class="absolute inset-0 bg-grid opacity-40" />
        <div class="absolute -left-20 -top-20 h-72 w-72 rounded-full blur-3xl"
             style="background: radial-gradient(circle, rgba(255,77,109,0.25), transparent 70%);" />
        <div class="absolute -right-20 -bottom-20 h-72 w-72 rounded-full blur-3xl"
             style="background: radial-gradient(circle, rgba(34,211,238,0.25), transparent 70%);" />

        <div class="relative grid sm:grid-cols-3 gap-8 text-center">
          <div>
            <div class="font-display font-bold text-5xl sm:text-6xl text-plasma">17%</div>
            <p class="mt-2 text-sm text-muted">faster than Hono<br />on Bun (realistic API)</p>
          </div>
          <div class="sm:border-x sm:border-[color:var(--ui-border)] sm:px-6">
            <div class="font-display font-bold text-5xl sm:text-6xl text-plasma">31%</div>
            <p class="mt-2 text-sm text-muted">faster than<br />NestJS + Fastify on Bun</p>
          </div>
          <div>
            <div class="font-display font-bold text-5xl sm:text-6xl text-plasma">0</div>
            <p class="mt-2 text-sm text-muted">reflect-metadata,<br />experimental flags, lock-in</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ========================= CTA ========================= -->
    <section class="relative mx-auto max-w-6xl px-4 py-24 sm:py-32">
      <div class="relative overflow-hidden rounded-[2rem] p-px gradient-plasma">
        <div class="relative rounded-[calc(2rem-1px)] bg-[color:var(--ui-bg)] px-6 sm:px-12 py-20 text-center overflow-hidden">
          <LazyStarsBg />

          <h2 class="relative font-display font-bold text-4xl sm:text-6xl leading-[1.05] tracking-tight">
            Ready to build with<br />
            <span class="text-plasma">MiiaJS?</span>
          </h2>
          <p class="relative mx-auto mt-6 max-w-lg text-muted leading-relaxed">
            {{ page.cta.description }}
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
              View source
            </UButton>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
