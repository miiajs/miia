# MiiaJS Website

Documentation site for MiiaJS. This CLAUDE.md describes how the site is wired so sessions working in `apps/website/` don't need to re-explore the Nuxt Content setup every time.

## Stack

- **Nuxt 4.6** (ESM, `srcDir: app/`)
- **@nuxt/content 3.16** - file-based collections under `content/`. `content.experimental.sqliteConnector: 'native'` keeps the local database in Node's built-in `node:sqlite`, so there is no `better-sqlite3`
- **@nuxt/ui 4.12** - UI kit, provides `UPage`, `UPageHeader`, `UContentNavigation`, `UBadge`, Prose components
- **@nuxt/fonts 1.2** - IBM Plex Sans and IBM Plex Mono, self-hosted (served from `/_nuxt/fonts/`, no Google Fonts). It is listed in `modules` itself, and the families in `fonts.families` have `global: true`, which also feeds them to the OG image template: nuxt-og-image 7 takes its fonts only from `@nuxt/fonts` 1.x. Without its own entry Nuxt UI brings `@nuxt/fonts` 0.14, and with it the OG image silently falls back to the built-in Inter
- **@nuxtjs/seo 6** - site config, sitemap, robots, schema.org and nuxt-og-image 7 with Takumi 2 (`@takumi-rs/core` 2.x). Two of its modules are off: `aiReady: false` (llms.txt is a separate plan) and `skewProtection: false` (every page is prerendered, so there is no version to poll). The sitemap is prerendered only because `/sitemap.xml` is listed in `nitro.prerender.routes`
- **Tailwind 4.3** - the theme lives in `app/assets/css/main.css` (see Brand, Typography and Layout)
- **Code highlighting** - Shiki themes `miia-light` / `miia-dark` from `shiki-themes.ts`, set in `content.build.markdown.highlight`; Content passes them to `@nuxtjs/mdc`, so `<MDC>` renders with the same themes
- No third-party docs theme (no docus, no shadcn-docs-nuxt) - own layout built on top of `@nuxt/ui` primitives

Exact versions are in `package.json`. Nuxt 4.6 and `@nuxtjs/seo` 6 need Node `^22.22.3 || ^24.15.0 || >=26`.

## Scripts

The site is a workspace of the monorepo (`apps/*`); install from the repository root with `bun install`.

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server on `http://localhost:3000` (`bun run website:dev` from the root) |
| `bun run build` | Production build (`bun run website:build` from the root) |
| `bun run preview` | Serve the production build locally |
| `bun run typecheck` | `nuxt typecheck` (vue-tsc) (`bun run website:typecheck` from the root) |
| `bun run lint` | ESLint via `@nuxt/eslint` (`bun run website:lint` from the root); the pre-commit hook runs it on staged website files |

`bun run build` prerenders every page into `.output/public`. The output also has a Nitro server (`.output/server`, preset `node-server`), and two things come only from it: the `/docs` → `/docs/getting-started` redirect (`prerender: false` in `routeRules`) and the 404 page on a direct hit (the build writes no `404.html`). A static host needs its own redirect rule and its own 404 page.

## Directory layout

```
apps/website/
├── content/
│   ├── 0.index.yml                 # `index` collection: landing page copy (hero, architecture, runtimes, packages, performance, start, seo)
│   ├── 1.docs/                     # `docs` collection, renders under /docs/*
│   │   ├── 1.getting-started/
│   │   ├── 2.core-concepts/        # 01.index.md ... 16.logger.md
│   │   ├── 3.packages/             # 01.index.md ... 14.multipart.md
│   │   └── 4.roadmap/
│   └── 2.blog/                     # `blog` collection, renders under /blog/*; `<slug>.draft.md` is a draft
├── content.config.ts               # Nuxt Content collection schemas (Zod)
├── nuxt.config.ts                  # modules, fonts, site meta, version, prerender, redirects
├── shiki-themes.ts                 # miia-light / miia-dark code block themes
├── public/                         # favicons, og-image (colors baked in, see Brand)
├── server/
│   └── routes/blog/rss.xml.ts      # RSS 2.0 feed of the blog
└── app/
    ├── app.vue                     # root: the site head (useSiteHead), loading bar, AppSearch
    ├── app.config.ts               # Nuxt UI: primary `brand`, neutral `stone`, type, measure and page edge tokens for tailwind-merge, sidebar, TOC and prose styles
    ├── error.vue                   # 404 and error page: the site head (useSiteHead), header, footer, AppSearch
    ├── assets/css/main.css         # Tailwind 4 theme: Plex font stacks, brand scale, type, measure and page edge tokens, Nuxt UI `--ui-*` tokens per theme
    ├── layouts/
    │   ├── default.vue             # landing, benchmarks and blog shell
    │   └── docs.vue                # doc shell: header, DocsMobileBar, sidebar nav, footer
    ├── pages/
    │   ├── index.vue               # landing page (reads content/0.index.yml)
    │   ├── benchmarks.vue          # benchmarks page
    │   ├── docs/[...slug].vue      # renders one doc page via <ContentRenderer>
    │   └── blog/
    │       ├── index.vue           # post list
    │       └── [slug].vue          # one post
    ├── data/benchmarks/            # benchmark datasets per machine (m1.ts, server.ts)
    ├── components/
    │   ├── AppHeader.vue           # nav (SITE_NAV), search, theme toggle, GitHub; the site menu below lg
    │   ├── AppFooter.vue           # link columns, © and version; one footer for every page, no props
    │   ├── AppLogo.vue             # mark + wordmark, dots in `--ui-primary`
    │   ├── AppSearch.vue           # ⌘K docs search (`UContentSearch`): the doc sections, loaded on the client, and the site links from SITE_NAV; mounted in app.vue and error.vue
    │   ├── CodePanel.vue           # highlighted code outside Markdown (renders through ProsePre)
    │   ├── DocsMobileBar.vue       # docs below lg: the page menu and "on this page"
    │   ├── SplitRow.vue            # text + panel row of the home, benchmarks and 404 pages, two columns from lg: 432 / 472 at 1024, 520 / 640 from 1280
    │   ├── OgImage/MiiaPost.takumi.vue  # OG image template of a blog post
    │   └── content/                # *.global.vue, see Prose components
    │       ├── ProsePre.global.vue
    │       ├── ProseCallout.global.vue  # frame of ::note, ::tip, ::warning, ::caution
    │       ├── ProseNote, ProseTip, ProseWarning, ProseCaution (.global.vue)
    │       └── AppCard.global.vue  # `::app-card` block of blog posts
    ├── composables/
    │   ├── docs-navigation.ts      # useDocsNavigation()
    │   ├── docs-page.ts            # useDocsPage(path), shared by the doc page and DocsMobileBar
    │   ├── site-head.ts            # useSiteHead(): theme-color, title template and default OG tags; called by app.vue and error.vue
    │   ├── page-seo.ts             # usePageSeo(title, description, extra?): title and description of a page plus their og: copies; called by every page
    │   └── copy.ts                 # useCopy() for the copy buttons
    └── utils/
        ├── brand-colors.ts         # BRAND_COLORS, see Brand (auto-imported)
        ├── experimental-badge.ts   # EXPERIMENTAL_BADGE, the badge of experimental pages (auto-imported)
        ├── page-columns.ts         # TOC_COLUMNS (main column + TOC of doc pages and posts) and SIDEBAR_COLUMNS (sidebar + main column of the docs layout and posts), auto-imported
        ├── site-nav.ts             # SITE_NAV, the main navigation (label + to) of the header and the search (auto-imported)
        └── blog.ts                 # formatPostDate(), isDraftPost() (auto-imported)
```

The header links Home, Docs, Benchmarks and Blog, the list in `SITE_NAV` (`app/utils/site-nav.ts`); the search shows the same links without Home, with icons of its own. Roadmap is in the footer (`documentation` column) and in the docs sidebar.

The numbers of the benchmarks page (the datasets in `app/data/benchmarks/` and the figures in its prose) and of the landing page's performance table, which reads the Bun rows of `apiPost` in `m1.ts`, are measured by hand in the [`miiajs/benchmarks`](https://github.com/miiajs/benchmarks) repo; do not edit them without a new run.

`app/utils/*`, `app/composables/*` and `app/components/*` are auto-imported by Nuxt 4 - no explicit imports needed in `.vue` files. Components in `components/content/` keep their own name (`ProsePre`, `AppCard`), without a `Content` prefix.

## Brand

The accent, the neutrals and the fonts are tokens in `app/assets/css/main.css`:

- `@theme static` holds the font stacks (`--font-sans` IBM Plex Sans, `--font-mono` IBM Plex Mono) and the brand scale `--color-brand-50` ... `--color-brand-950`: 600 is the accent of the light theme, 400 the one of the dark theme. `app/app.config.ts` sets `ui.colors.primary: 'brand'` (and `neutral: 'stone'`), so Nuxt UI's `primary` is this scale.
- `:root` and `.dark` set Nuxt UI's `--ui-*` variables per theme: backgrounds (paper `#F3F1EB` in light, `#151517` in dark), borders, text and `--ui-primary` (`primary-600` in light, `primary-400` in dark). Nuxt UI declares them in `@layer theme`, so every variable set in `:root` is set in `.dark` too.
- `--ui-container: 1280px` is the one container width of the site. The header, the footer and every page column take it through `UContainer` (`max-w-(--ui-container)` with `px-4 sm:px-6 lg:px-8`; the gutters change in `ui.container` in `app/app.config.ts`), so no page writes `max-w-(--ui-container)` by hand.

Copies of the values, for places CSS variables do not reach:

- `app/utils/brand-colors.ts` - `BRAND_COLORS`: the `theme-color` meta in `useSiteHead()` (`app/composables/site-head.ts`) and the colors of the OG image template.
- `shiki-themes.ts` - the code block themes (ink, accent, muted text and the code block background of each theme, the `--ui-bg-elevated` value).
- `public/` - `favicon.svg`, `favicon.ico`, `favicon-16/32/192/512.png`, `apple-touch-icon.png` and `og-image.png` have the colors baked in. The icons do not follow the theme: all of them, `favicon.svg` included, are drawn in the dark theme's colors (ink `#ECEAE4`, accent `#7C93FF`) on its paper `#151517`, which fills the frame of the small icons and the whole square of the touch ones. Their sources are in `tmp/design/website/assets/` at the repository root: `icons.html`, `og-image.html`, `favicon.svg` and `render.mjs`, which renders them with playwright-core and Chrome and assembles the ICO. `tmp/` is gitignored, so the sources exist only locally, not in the repository.

When the accent changes, update the brand scale in `main.css`, then `BRAND_COLORS` and `shiki-themes.ts`, and regenerate the `public/` files from their sources.

## Typography

Text sizes are tokens named by role, in `@theme static` of `app/assets/css/main.css`: `--text-<name>` with its `--text-<name>--line-height` and, for headings, `--text-<name>--letter-spacing`, so one class `text-<name>` sets all three. Sizes are in rem. The three heading sizes grow with the viewport through `clamp()`; the others are fixed, with one step at `lg` set in the `@media (min-width: 64rem)` block of `:root`.

| Token | Size, px | From `lg` | Line height | Tracking | Used for |
|---|---|---|---|---|---|
| `display` | 36 to 60, grows from 640 to 1280 | | 1.05 | -0.025em | h1 of the landing, benchmarks, blog and error pages |
| `title` | 32 to 44, grows from 768 to 1280 | | 1.1 | -0.02em | h1 of a doc page and of a post |
| `heading` | 26 to 34, grows from 768 to 1280 | | 1.15 | -0.02em | section headings of the landing and benchmarks pages, the latest post on `/blog` |
| `heading-sm` | 22 | 26 | 1.25 | -0.015em | h2 in prose (docs and posts) |
| `subheading` | 19 | 21 | 1.3 | -0.01em | h3 in prose, older posts on `/blog`, items of the site menu |
| `card-title` | 16 | 17 | 1.35 | | card titles, previous / next, test machines, h4 in prose, `AppCard` name |
| `lead` | 17 | 19 | 1.6 | | intro paragraphs: hero, description of a doc page or a post, error page |
| `body-lg` | 16.5 | 17.5 | 1.7 | | post body, section descriptions, description of the latest post |
| `body` | 16 | 16.5 | 1.7 | | doc body, community links of the site menu |
| `ui` | 15 | 15 | 1.6 | | buttons, text links, card text, callouts, lists, footer links |
| `small` | 14 | 14 | 1.5 | | header nav, docs sidebar, TOC, tables, figure captions, short card descriptions |
| `meta` | 12 | 13 | 1.5 | | mono: eyebrows, breadcrumbs, dates, "measured ..." lines, footer bottom line |
| `caption` | 12 | 12 | 1.5 | | mono: group and panel labels, table heads, ⌘K, the experimental badge |
| `code` | 13 | 14 | 1.7 | | code blocks: `ProsePre`, the error page panel, `AppCard`, the install command of the hero |

- No `text-[Npx]`, `text-[clamp(...)]`, `leading-[...]` or `tracking-[...]`: a size is a token, and a new size is a new token. The exceptions are the em sizes of inline code (`text-[0.86em]` and the like), the logo (its scale in `AppHeader` and `AppFooter`, its tracking in `AppLogo`) and `leading-[inherit]`: prose `p` and `li` (`ui.prose` in `app/app.config.ts`) and the paragraphs of a callout take the line height of the token on their container - `body` on a doc page, `body-lg` in a post, `ui` in a callout.
- A named `leading-*` next to a token only where the line height holds the size of a box: `leading-5` on the sidebar links, `leading-snug` on a callout title, `leading-relaxed` on the specs of a test machine.
- Chips and keys (`EXPERIMENTAL_BADGE`, ⌘K, the tags on `/blog`) take `text-caption/4`, a 16 px line box.
- `UPageHeader` sets `text-3xl sm:text-4xl` on its title, so the doc page writes `text-title sm:text-title` to replace both.
- Nuxt UI merges the classes of its components (`:ui`, `class`, `app.config.ts`) with tailwind-merge, which takes an unknown `text-<name>` for a color: it would drop the token or the color next to it (`text-meta text-muted`). The token names are therefore registered in `app/app.config.ts` under `ui.tv.twMergeConfig.extend.classGroups['font-size']`. The list lives in two places, `main.css` and `app.config.ts`, and they must match. In those merged strings the token goes before a `leading-*`: tailwind-merge drops a `leading-*` that comes before a size.

## Layout

- The layout changes only at `sm` (640) and `lg` (1024): the number of columns, a row turning into a column. `md` is not used. `xl` (1280, the container maximum) only widens the sidebar column and the TOC column (`SIDEBAR_COLUMNS`, `TOC_COLUMNS`); no column count changes there.
- No row or grid of columns takes its column count from its content: no `flex-wrap` columns with a basis that does not fit at the breakpoint, no `auto-fill` / `auto-fit`. Columns are set per breakpoint (`sm:grid-cols-2 lg:grid-cols-4`) or come from `SplitRow`. `flex-wrap` without a basis is for inline rows only, where the items are not columns: button rows, tags, meta lines, a section head with its link.
- Below `lg` the reading columns (a doc page, a post) take the full container width: their cap is `lg:max-w-reading`.
- Two text measures, `--container-<name>` in `@theme static` of `app/assets/css/main.css`, so the class is `max-w-<name>`:
  - `split` (520 px) - text in the text column of a `SplitRow`: the section leads of the landing page, the hero, the reproduce lead of benchmarks, the error page lead.
  - `reading` (720 px) - the other capped text: full-width section heads (packages on the landing page, the suites and methodology on benchmarks), page intros (benchmarks, `/blog`), the description of the latest post, the reading column of a doc page and of a post from `lg`.
- No `max-w-[Npx]` on text: a measure is a token, and a new measure is a new token. The exception is the brand block of the footer (`lg:max-w-[340px]`).
- tailwind-merge does not know the names either: they are registered in `app/app.config.ts` under `ui.tv.twMergeConfig.extend.classGroups['max-w']`. Without that, on a `UContainer`, a `SplitRow` `class` or a `:ui` slot both a token and `max-w-(--ui-container)` would stay and CSS order would decide. The list lives in two places, `main.css` and `app.config.ts`, and they must match.
- Every inner page (docs, posts, `/blog`, benchmarks, 404) has the same space under the header and above the footer: 24 px on phones, 32 px from `lg`. It is a token, `--spacing-page` in `@theme static` of `app/assets/css/main.css` with its lg step in the `@media (min-width: 64rem)` block of `:root`, so the class is `pt-page` / `pb-page` / `py-page` and it changes at `lg` by itself. The first box of a page takes `pt-page` and the last one `pb-page`; the padding of sections inside a page is not the edge. Home does not use it: its first and last sections keep their section padding top and bottom, 48 px on phones, 80 px from `lg`. The 404 page is centred vertically, `py-page` is its minimum edge.
- On doc pages and posts the edge sits on the page container (`py-page` on the `UContainer` of `app/layouts/docs.vue` and of `app/pages/blog/[slug].vue`), not on each column. The sticky columns (the docs sidebar, the left column of a post, the TOC) have no padding of their own: from `lg` they stick at `--page-sticky-top` (the header plus one edge) and are at most `--page-sticky-max-h` tall (they end one edge above the bottom of the viewport), so their first line is level with the breadcrumb. Both variables are in a `:root` block of `main.css` and resolve per breakpoint; the classes that use them are set once in `app/app.config.ts`, `ui.pageAside` (the sidebar and the post's left column) and `ui.contentToc`.
- tailwind-merge reads spacing values through its theme, so `page` is registered in `app/app.config.ts` under `ui.tv.twMergeConfig.extend.theme.spacing`. A `*-page` class in the `class` or `:ui` of a Nuxt UI component replaces the component's default spacing only because of that registration; without it both would stay and CSS order would decide.
- One header and one footer on every page, without variants: `AppHeader` and `AppFooter` take no props, and the docs layout and the error page render the same footer as the rest.

## Version

`nuxt.config.ts` imports `packages/core/package.json` (`with { type: 'json' }`) and puts its `version` into `runtimeConfig.public.miiaVersion` at build time. The footer and the mobile site menu show `v{miiaVersion}`; there is no request to npm. The site shows the version of the checkout it was built from, so it changes when a release bumps `@miiajs/core`.

## How a doc page renders

1. Route `/docs/:slug` hits `app/pages/docs/[...slug].vue` (layout `docs`).
2. `useDocsPage(route.path)` (`app/composables/docs-page.ts`) loads the markdown + frontmatter with `queryCollection('docs').path(path).first()`. `DocsMobileBar` calls it with the same path, and both share one `useAsyncData` entry (`dedupe: 'defer'`).
3. Page chrome from `@nuxt/ui`: `<UPage>` → `<UPageHeader :title :description>` (its `#headline` slot holds the breadcrumb, `core concepts / modules` from `findPageBreadcrumb()` over `useDocsNavigation()`, and the experimental badge) + `<UPageBody>` → `<ContentRenderer :value="page">`.
4. Surrounding pages via `queryCollectionItemSurroundings` → `<UContentSurround>` (labelled `previous` / `next`), then an "Edit this page on GitHub" link built from `page.stem`.
5. Right rail TOC from `page.body.toc.links` → `<UContentToc>`, from `lg` up. Below `lg`, `DocsMobileBar` shows the same links under "on this page".

The columns of `<UPage>` (the page and the TOC on the right) are `TOC_COLUMNS` from `app/utils/page-columns.ts`, shared with blog posts. The desktop look of the TOC lives in `ui.contentToc` in `app/app.config.ts`, for both; a page adds only its own classes below `lg`.

## Navigation and sorting

- Sidebar navigation comes from `useDocsNavigation()` (`app/composables/docs-navigation.ts`): `useAsyncData('navigation', () => queryCollectionNavigation('docs', ['status']))`, transformed to the children of `/docs`, then `expandActiveBranch()` for the current route - a recursive walker that opens a `defaultOpen: false` folder (set in its `.navigation.yml`) when it holds the current page, maps `status → badge` and sets `exact` on leaf links. The docs layout, `DocsMobileBar`, `AppSearch` and the breadcrumb of the doc page call it; they share the one `navigation` entry, so the tree is fetched once. There is no `provide`/`inject`.
- The layout (`app/layouts/docs.vue`) renders each section (`1.getting-started`, `2.core-concepts`, ...) as a group: a lowercase title and a `<UContentNavigation>` over its children. Below `lg`, `DocsMobileBar` puts the tree into a full-screen menu, with the sections as triggers and only the current one open. Both lists take their look from `ui.contentNavigation` in `app/app.config.ts`.
- File ordering uses the `N.name.md` convention. Nested folders follow the same rule. The leading number is stripped from the URL.
- Folders with 10 or more entries use two-digit prefixes (`01.index.md` ... `16.logger.md`): the navigation sorts by the file path as a string, so `10.response` would come before `2.controllers`.

### ⚠️ Gotcha: frontmatter → sidebar

`queryCollectionNavigation('docs')` returns **only** `path`, `title`, and `children` by default. Any custom frontmatter field (like `status`) is dropped on the navigation side unless you list it explicitly:

```ts
queryCollectionNavigation('docs', ['status'])
```

If you add a new frontmatter field that should show up in the sidebar, update this call in `app/composables/docs-navigation.ts`. Otherwise the field will render fine on the page itself but will be silently `undefined` on sidebar items - and no error is thrown.

## Frontmatter schema

Declared in `content.config.ts` for the `docs` collection. Current shape:

```ts
z.object({
  title: z.string().nonempty(),
  description: z.string().nonempty(),
  status: z.enum(['experimental']).optional()
})
```

- `title`, `description` - required on every page. They are also the page's `<title>` and meta description: Nuxt Content fills `page.seo.title` / `page.seo.description` from them for every page collection, and `[...slug].vue` passes those to `usePageSeo()`. The docs schema has no `seo` override; the landing page's `seo:` block in `content/0.index.yml` still sets its title and description.
- `status` - optional, only `experimental`. Shown as a badge in the page header **and** in the sidebar. Use only on package pages (under `3.packages/`), not on getting-started or core-concepts - those describe the framework itself.

## Status indicator

Only `experimental` is marked. `status: experimental` in a package page's frontmatter puts a dashed `experimental` badge next to the page in the sidebar and in the page header; both use `EXPERIMENTAL_BADGE` from `app/utils/experimental-badge.ts`. Every other package page has no `status`. The full maturity scale (`experimental`, `beta`, `stable`, `planned`, `idea`) lives in the tables of `content/1.docs/4.roadmap/1.index.md`, not in frontmatter.

- **experimental**: low/no test coverage, untested failure modes, API still in motion. Use in side projects, expect churn.

Mark or unmark a page by editing its frontmatter - no other changes needed.

## Package documentation template

Use this structure when creating a new package page under `content/1.docs/3.packages/`. No existing page follows it in full. `05.papr.md` and `06.mongoose.md` are the closest: they open with `## Overview` and end with `Testing`, `Exports`, `See also`. The older pages open with a paragraph, and several have no `## See also`.

```markdown
---
title: <Package Name>
description: <one sentence, 10–18 words, what it does and for whom>
status: experimental   # only for an experimental package, otherwise omit
---

## Overview
Brief paragraph (3–5 sentences): what it does, when to reach for it, key concepts.

## Installation
Install commands. Use `::code-group` when showing multiple package managers. Peer deps in a separate block.

## Setup
Minimal working example: `Module.configure({...})` + registration in `AppModule`.

### Configuration options
Table: option | type | default | description.

## Usage
One cohesive 10–25 line example in a service/controller.

## API Reference
Main classes/functions/decorators with signatures and short descriptions. Either a table or H3 subsections.

## Advanced (optional)
Multi-connection, factory configuration, customization. Only when genuinely relevant.

## Testing
`TestApp` pattern + how to mock/stub the package's dependencies. **Required for every package.**

## Troubleshooting (optional)
FAQ-style: common pitfalls, peer-dep issues, lifecycle-hook ordering.

## Exports
Public exports so users can reference them from IDE autocomplete.

## See also
Links to related packages and core concepts.
```

Writing conventions used across the site:
- `##` is the top heading level inside a page (frontmatter provides the actual `<h1>`).
- Specify the language in fenced code blocks. Leave it out only for plain text that should render without a header row: file trees, diagrams, sample output and error messages.
- Prose before and after every code block - never bare code.
- Prefer Nuxt Content callouts (`::note`, `::tip`, `::warning`, `::caution`) over blockquotes for security-critical and best-practice notes.

## Available MDC components

Callable in `.md` files via MDC syntax:

```markdown
::note
General information.
::

::tip{title="Prefer the factory form"}
A best-practice suggestion, with an optional title.
::

::warning
Important caveat.
::

::caution
Security-critical note.
::

::code-group
```ts [Bun]
bun add foo
```
```ts [npm]
npm install foo
```
::
```

The four callouts and code blocks are the site's own components (see Prose components). A callout takes an optional `title`: `::note{title="..."}`. Text after the name on the opening line (`::note Startup order`) is not a title - it is not valid MDC, and the block renders as plain text.

Other available: `::badge`, `::accordion`, `::card`, `::card-group`, and `::code-group` above. They come from `@nuxt/ui`'s Prose layer - no component registration needed. `::callout` is the site's own frame: it takes `type` (`note`, `tip`, `warning`, `caution`) and `title`, not Nuxt UI's `color` or `icon`. Blog posts also have `::app-card` (see Blog).

## Prose components

`app/components/content/` replaces some of Nuxt UI's Prose components where `ui.prose` in `app/app.config.ts` is not enough (it styles slots; it cannot add a header row or a prop):

- `ProsePre` - every fenced code block: a header row with the file name (`` ```ts [app.ts] ``) or the language and a copy button. A block without a language (MDC reports it as `text`) gets neither. Under `::code-group` the tabs take the place of the header (`hideHeader`, set by Nuxt UI's `ProseCodeGroup`; the tabs are styled in `prose.codeGroup`). `CodePanel` renders code outside Markdown through `<MDC>`, so the landing and benchmarks pages get the same block.
- `ProseCallout` - the frame of `::note`, `::tip`, `::warning` and `::caution`: a header row with a marker, the type label and the optional `title`, the body below. `ProseNote`, `ProseTip`, `ProseWarning` and `ProseCaution` wrap it with their `type`.
- `AppCard` - the `::app-card` block (see Blog).

The files must be named `*.global.vue`. Outside `nuxt dev`, Nuxt Content's component map holds only global components and the ones a document names by their tag. Prose components are reached through a mapping instead (`pre` → `ProsePre`, `note` → `ProseNote` in Nuxt UI's `mdc.components.map`), so that list never names them. A plain `ProseNote.vue` here still takes the name over from Nuxt UI's global one, because Content scans `components/content/` first: it works in `nuxt dev` and is missing from the build. The `.global` suffix makes the component global and keeps its name. `AppCard` follows the same convention.

## Checklist: adding a new package

1. Create `content/1.docs/3.packages/<NN.name>.md` following the template above. Pick the next free `NN.` prefix.
2. Add `status: experimental` to the frontmatter if the package is experimental (see Status indicator).
3. Add a row for the new package to `content/1.docs/3.packages/01.index.md` under the appropriate category.
4. Add a row to the package table in `content/1.docs/1.getting-started/1.index.md`.
5. If you introduced a **new frontmatter field** that must appear in the sidebar, extend the field list in `app/composables/docs-navigation.ts`:
   ```ts
   queryCollectionNavigation('docs', ['status', 'yourNewField'])
   ```
6. `bun run dev` and visually verify: header badge, sidebar badge, correct section in the index.

## Blog

Posts live in `content/2.blog/<slug>.md` (the `blog` collection) and render at `/blog/<slug>`; `/blog` lists them, newest first. The header (`Blog`) and the footer (`project` column) link to `/blog`.

Frontmatter:

```yaml
---
title: 'MiiaJS 0.9: module boundaries, typed tokens and a rebuilt CLI'
description: One or two sentences. Also the text of the list entry, the RSS item and the OG image.
date: 2026-11-05        # publication day
author: Ruslan Matiushev
tags: [release]         # optional, defaults to []
topics: [modules, typed tokens, CLI]   # optional
discussion: https://github.com/miiajs/miia/discussions/<n>   # optional, a URL
---
```

- `date` is `z.date()` in the schema, but queries return it as a `YYYY-MM-DD` string. Format it with `formatPostDate()` (`app/utils/blog.ts`, UTC): the string is midnight UTC, and formatting it in the local time zone can show the day before. Both pages render it in a `<time :datetime>`.
- `tags` - the first tag is the post's section: the breadcrumb of the post (`blog / release`) and the top line of its OG image (`blog · release`). `/blog` shows every tag next to the date.
- `topics` - listed under the description of the latest post on `/blog`, joined with ` · `. Older posts do not show them.
- `discussion` - when set, the post gets a "Discuss on GitHub" link before "Share on X" and "Share on LinkedIn": in the left column from `lg`, in the row after the body below `lg`.
- There is no `image` field: every post gets a generated OG image (below).
- The list page selects only the fields it shows (`.select(...)`), otherwise `/blog/_payload.json` carries the body of every post.

Both pages have their own markup, no `UBlogPosts` / `UBlogPost`. `/blog` (`app/pages/blog/index.vue`): a header with the `RSS feed` link, the latest post as a large entry (date, tags, title, description, `topics`, "Read the post"), then one row per older post (date and tags | title and description), and an empty state that links the feed. A post (`app/pages/blog/[slug].vue`): breadcrumb, title and description, then the body with the "In this post" TOC. From `lg` it has the columns of a doc page, `SIDEBAR_COLUMNS` around `TOC_COLUMNS`: the left column holds "All posts", the date, the author and the discussion and share links, sticky like the docs sidebar, its first line level with the breadcrumb; the header and the body are the main column; the TOC is the sticky column on the right with the docs' look, its label level with the breadcrumb. Below `lg` it is one column as before: `date · author` under the description, the TOC as a collapsible block between the header and the body, "All posts" and the discussion and share links after the body.

### Drafts

A draft is a file named `<slug>.draft.md`. Nuxt Content strips `.draft` from the path, so the URL is the same `/blog/<slug>`; the record's `stem` keeps it (`2.blog/<slug>.draft`), and `isDraftPost()` reads it for the `Draft` badge.

Drafts exist only in `nuxt dev`: `content.config.ts` excludes `2.blog/*.draft.md` from the collection source unless `NODE_ENV` is `development`, which only `nuxt dev` sets. Do not replace this with a `draft: true` field and a query filter. Nuxt Content prerenders `/__nuxt_content/blog/sql_dump.txt` with every file the collection matches, so a filtered draft would still be public in that file. With the exclude, a draft is absent from the dump, the payloads, the RSS feed and the sitemap.

Drafts are not in git: `apps/website/.gitignore` lists `content/2.blog/*.draft.md`, so a draft lives only in the local checkout. To publish, rename `<slug>.draft.md` to `<slug>.md`; from then on git sees the post.

### OG images

`blog/[slug].vue` calls `defineOgImage('MiiaPost', { title, description, date: formatPostDate(date), path, tag: tags[0] }, { width: 1200, height: 630 })`. The template is `app/components/OgImage/MiiaPost.takumi.vue`, rendered by Takumi: `@takumi-rs/core` 2.x is a site dependency (nuxt-og-image 7 needs the 2.x line) and the `.takumi.vue` suffix picks the renderer. It draws the light theme from `BRAND_COLORS`: the mark and `blog · <tag>` on top, the title and the description, `miiajs.com<path>` and the date at the bottom.

- The template name must not clash with nuxt-og-image's community templates (`BlogPost` is one of them).
- Pass `width` and `height`: the module defaults to 1200x600, and its tags replace the 1200x630 ones from `useSiteHead()`.
- Keep `font-family` and `font-weight` in static `style` attributes and bind only colors with `:style`: nuxt-og-image reads the template at build time to pick the families and weights it loads. The families come from `@nuxt/fonts` (`global: true` in `fonts.families`), here IBM Plex Sans and IBM Plex Mono.
- The build prerenders the image to `/_og/s/<hash>.png`. Pages without `defineOgImage` (docs, landing, `/blog`) keep the static `/og-image.png`.

### RSS

`server/routes/blog/rss.xml.ts` writes an RSS 2.0 feed (`atom:link` to itself, `dc:creator` for the author, a `category` per tag) from `queryCollection(event, 'blog')`, with the base URL from `getSiteConfig(event).url`. The prerender crawler does not follow `.xml` links, so `/blog/rss.xml` is listed in `nitro.prerender.routes`. `app.head` in `nuxt.config.ts` has the autodiscovery `<link rel="alternate">`. The feed is linked from `/blog` only (the `RSS feed` link of its header and the empty state), not from the footer; the links use `target: '_blank'` so the click does not go through the client router.

### App card

`::app-card` (`app/components/content/AppCard.global.vue`) shows an app the reader can run: name, description, packages, runtimes, what it needs, a `source` link to its folder on GitHub and the commands to start it, with a copy button. The props go in a YAML block:

```markdown
::app-card
---
name: messaging-app
description: An event-driven orders flow on the message bus, with the Redis Streams transport.
packages: ['@miiajs/core', '@miiajs/messaging', '@miiajs/messaging-redis']
runtimes: [Bun, Node.js, Deno]
needs: Redis (`docker compose up -d`)
path: examples/messaging-app
commands:
  - cd examples/messaging-app
  - docker compose up -d
  - bun run dev
---
::
```

| prop | type | description |
|---|---|---|
| `name` | string | Title of the card. |
| `description` | string | Plain text. |
| `packages` | string[] | `@miiajs/*` names; the scope is dropped after the first one, so the row reads `@miiajs/core · messaging · messaging-redis`. Quote them in YAML, a plain value cannot start with `@`. |
| `runtimes` | string[] | Joined with ` · `. |
| `needs` | string, optional | Text in backticks renders as code. |
| `path` | string | Folder in the `miiajs/miia` repository; `source` links to `https://github.com/miiajs/miia/tree/main/<path>`. |
| `commands` | string[] | One per line under "run it"; the copy button copies them all. |

### Checklist: a new post

1. Create `content/2.blog/<slug>.draft.md` with the frontmatter above. `##` is the top heading inside a post, as in docs.
2. `bun run dev`: check `/blog` (with the `Draft` badge), `/blog/<slug>` and the image at the page's `og:image` URL.
3. Set `date` to the publication day and rename the file to `<slug>.md`.
4. `bun run build`, then check `.output/public/blog/<slug>/index.html`, `blog/rss.xml` and `sitemap.xml`.

## Key files (quick reference)

| File | Purpose |
|---|---|
| `app/app.vue` | Root; calls `useSiteHead()`, loading bar, mounts `AppSearch`. |
| `app/composables/site-head.ts` | `useSiteHead()`: `theme-color` from `BRAND_COLORS`, the `%s - MiiaJS` title template, default OG tags; called by `app/app.vue` and `app/error.vue`, because the error page renders without `app.vue`. Nuxt writes the charset and viewport metas itself, and `@nuxtjs/seo` sets `<html lang>` from `site.defaultLocale`. |
| `app/composables/page-seo.ts` | `usePageSeo(title, description, extra?)`: the title and description of a page and their `og:` copies, `extra` for anything more (`titleTemplate: ''` on the landing page, the article tags of a post); called by every page. The error page calls `useSeoMeta()` itself. |
| `app/composables/docs-navigation.ts` | `useDocsNavigation()`: `queryCollectionNavigation('docs', ['status'])` under the `navigation` key, `expandActiveBranch` (which also maps `status → badge`). |
| `app/layouts/docs.vue` | Doc shell; sidebar groups from `useDocsNavigation()`, `DocsMobileBar`, footer. |
| `app/components/DocsMobileBar.vue` | Docs below `lg`: the page menu with the doc tree and "on this page". |
| `app/pages/docs/[...slug].vue` | Renders one doc page; `UPageHeader` with breadcrumb and status badge in `#headline` + `ContentRenderer`, prev/next, edit link, TOC. |
| `app/components/content/*.global.vue` | `ProsePre`, the callouts and `AppCard`. |
| `app/assets/css/main.css` | Font stacks, brand scale, type tokens (`text-<name>`), measure tokens (`max-w-split`, `max-w-reading`), the page edge token (`pt-page`, `pb-page`), the sticky columns of docs and posts (`--page-sticky-top`, `--page-sticky-max-h`), Nuxt UI `--ui-*` tokens per theme, `--ui-container`. |
| `app/utils/brand-colors.ts` | `BRAND_COLORS`, the brand colors for `theme-color` and the OG image, auto-imported. |
| `content.config.ts` | Zod schemas for `index`, `docs` and `blog` collections; the `index` schema describes only what `0.index.yml` uses (text links, button links with `target`, `icon`, `trailing`, `variant: outline`); excludes blog drafts outside `nuxt dev`. |
| `app/utils/experimental-badge.ts` | `EXPERIMENTAL_BADGE`, auto-imported. |
| `app/utils/site-nav.ts` | `SITE_NAV`, the main navigation (`label`, `to`): the header nav, whose active state stays in `AppHeader`, and the search links, whose icons stay in `AppSearch`; auto-imported. |
| `app/utils/page-columns.ts` | `TOC_COLUMNS`, the main column and the TOC column of doc pages and posts, and `SIDEBAR_COLUMNS`, the sidebar and the main column of the docs layout and posts; auto-imported. |
| `app/components/SplitRow.vue` | Text + panel row of the home, benchmarks and 404 pages: two columns from `lg`, 432 / 472 at 1024 and 520 / 640 from 1280, so the panels line up; the gap gives way to a classic scrollbar at 1024; slots `#text` and `#panel`, props `align`, `flow` (the text column dissolves below `lg`), `textClass`; `class` and `as` go to its `UContainer`. |
| `app/pages/blog/index.vue` | Post list: RSS link, the latest post with `topics`, rows of older posts, `Draft` badge in dev. |
| `app/pages/blog/[slug].vue` | One post, three columns from `lg` like a doc page: article SEO tags, schema.org `Article`, `defineOgImage('MiiaPost', ...)`, TOC, discussion and share links. |
| `app/components/OgImage/MiiaPost.takumi.vue` | OG image template of a post (Takumi). |
| `app/utils/blog.ts` | `formatPostDate()`, `isDraftPost()`, auto-imported. |
| `server/routes/blog/rss.xml.ts` | RSS feed of the blog, prerendered to `/blog/rss.xml`. |
| `nuxt.config.ts` | Modules, fonts, highlight themes, `miiaVersion`, SEO defaults, prerender routes. |

## Documentation follow-ups

Known gaps and structural issues deferred from the status-rollout work. High-priority items should land in the next docs PR.

### High-priority (next PR)

- **D1 - Unify auth recipes.** `02.auth/2.jwt.md`, `3.local.md`, `4.oauth2.md` all follow a Problem/Solution recipe pattern but with inconsistent section names. Target order: `Problem → Solution → Wire it up → Variations → Security notes → See also`. `2.jwt.md` follows it. `3.local.md` and `4.oauth2.md` name the wiring section `## Module wiring`, have no `## Variations` and keep `##` sections of their own; in `local.md` two of them sit between `## Problem` and `## Solution`.

### Medium / nice-to-have

- **Split `04.drizzle.md`** into a base page (setup, schemas, basic queries) and an advanced page (type registry, migrations, multi-DB).
- **Extract the optimized/native adapter description** shared by `node-server.md` and `uws-server.md` into a single page; link from both.
- **Centralize the `HttpException` table** in `core-concepts/09.exceptions.md`; replace duplicates in controllers/guards/auth docs with links.
