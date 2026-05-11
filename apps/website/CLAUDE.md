# MiiaJS Website

Documentation site for MiiaJS. This CLAUDE.md describes how the site is wired so sessions working in `apps/website/` don't need to re-explore the Nuxt Content setup every time.

## Stack

- **Nuxt 4.4** (ESM, `srcDir: app/`)
- **@nuxt/content 3.12** - file-based collections under `content/`
- **@nuxt/ui 4.6** - UI kit, provides `UPage`, `UPageHeader`, `UContentNavigation`, `UBadge`, Prose components
- **@nuxt/image**, **@nuxtjs/seo**, **Tailwind 4**
- No third-party docs theme (no docus, no shadcn-docs-nuxt) - own layout built on top of `@nuxt/ui` primitives

## Directory layout

```
apps/website/
├── content/
│   └── 1.docs/                     # only collection that renders under /docs/*
│       ├── 1.getting-started/
│       ├── 2.core-concepts/
│       └── 3.packages/
├── content.config.ts               # Nuxt Content collection schemas (Zod)
├── nuxt.config.ts
└── app/
    ├── app.vue                     # root, builds navigation + search data, provides navigation
    ├── app.config.ts
    ├── layouts/
    │   └── docs.vue                # doc shell: header, sidebar nav, footer
    ├── pages/
    │   └── docs/[...slug].vue      # renders one doc page via <ContentRenderer>
    ├── components/                 # AppHeader, AppFooter, AppLogo, etc.
    └── utils/
        └── status.ts               # statusColor() helper (auto-imported)
```

`app/utils/*` and `app/components/*` are auto-imported by Nuxt 4 - no explicit imports needed in `.vue` files.

## How a doc page renders

1. Route `/docs/:slug` hits `app/pages/docs/[...slug].vue`.
2. `queryCollection('docs').path(route.path).first()` loads the markdown + frontmatter.
3. Page chrome from `@nuxt/ui`: `<UPage>` → `<UPageHeader :title :description>` (with `#headline` slot for the status badge) + `<UPageBody>` → `<ContentRenderer :value="page">`.
4. Surrounding pages via `queryCollectionItemSurroundings` → `<UContentSurround>`.
5. Right rail TOC from `page.body.toc.links` → `<UContentToc>`.

## Navigation and sorting

- Sidebar navigation is built once in `app/app.vue` via `queryCollectionNavigation('docs', [...extraFields])` and `provide`-d to the docs layout.
- The layout (`app/layouts/docs.vue`) `inject`s the navigation, runs `expandActiveBranch()` over it (recursive walker that also maps `status → badge`), and renders `<UContentNavigation :navigation highlight>`.
- File ordering uses the `N.name.md` convention. Nested folders follow the same rule. The leading number is stripped from the URL.

### ⚠️ Gotcha: frontmatter → sidebar

`queryCollectionNavigation('docs')` returns **only** `path`, `title`, and `children` by default. Any custom frontmatter field (like `status`) is dropped on the navigation side unless you list it explicitly:

```ts
queryCollectionNavigation('docs', ['status'])
```

If you add a new frontmatter field that should show up in the sidebar, update this call in `app/app.vue`. Otherwise the field will render fine on the page itself but will be silently `undefined` on sidebar items - and no error is thrown.

## Frontmatter schema

Declared in `content.config.ts` for the `docs` collection. Current shape:

```ts
z.object({
  title: z.string().nonempty(),
  description: z.string().nonempty(),
  status: z.enum(['experimental', 'beta', 'stable']).optional(),
  seo: z.object({
    title: z.string().optional(),
    description: z.string().optional()
  }).optional()
})
```

- `title`, `description` - required on every page.
- `seo.title` / `seo.description` - optional overrides, read in `[...slug].vue` for `useSeoMeta`.
- `status` - optional, package maturity indicator. Shown as a colored badge in the page header **and** in the sidebar. Use only on package pages (under `3.packages/`), not on getting-started or core-concepts - those describe the framework itself.

## Status indicator

`app/utils/status.ts` exports `statusColor(status)`:

| status | color | intent |
|---|---|---|
| `experimental` | `warning` | yellow - API may break, no proof of correctness |
| `beta` | `info` | blue - API mostly stable, well-tested internally, not yet production-validated |
| `stable` | `success` | green - API frozen, semver guarantees, production-tested at scale |

Current rule of thumb (production-readiness, not just test count):

- **experimental**: low/no test coverage, untested failure modes, API still in motion. Use in side projects, expect churn.
- **beta**: tests cover the surface area meaningfully, API design has settled, but the package has not faced real production load. **Pre-1.0 default for any package shipped.**
- **stable**: API frozen with semver guarantees, production-tested at scale, community-validated. **Post-1.0 only.** No package can be `stable` while the project itself is on `0.x`.

Update a page's status by editing its frontmatter - no other changes needed.

## Package documentation template

Use this structure when creating a new package page under `content/1.docs/3.packages/`. Based on the most consistent existing pages: `3.jwt.md`, `11.messaging/1.index.md`, `7.swagger.md`.

```markdown
---
title: <Package Name>
description: <one sentence, 10–18 words, what it does and for whom>
status: stable | beta | experimental
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
- Always specify language in fenced code blocks.
- Prose before and after every code block - never bare code.
- Prefer Nuxt Content callouts (`::note`, `::tip`, `::warning`, `::caution`) over blockquotes for security-critical and best-practice notes.

## Available MDC components

From `@nuxt/ui` - callable in `.md` files via MDC syntax:

```markdown
::note
General information.
::

::tip
A best-practice suggestion.
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

Other available: `::callout`, `::badge`, `::accordion`, `::card`, `::card-group`. All come from `@nuxt/ui`'s Prose layer - no component registration needed.

## Running the site

```sh
cd apps/website
bun install           # once
bun run dev           # dev server with HMR
bun run build         # static build (Nitro prerender)
bun run generate      # same as build for this project
bun run typecheck     # vue-tsc
```

## Checklist: adding a new package

1. Create `content/1.docs/3.packages/<N.name>.md` following the template above. Pick the next free `N.` prefix.
2. Set `status:` in frontmatter based on current test coverage.
3. Add a row for the new package to `content/1.docs/3.packages/1.index.md` under the appropriate category.
4. Add a row to the package table in `content/1.docs/1.getting-started/1.index.md`.
5. If you introduced a **new frontmatter field** that must appear in the sidebar, extend the field list in `app/app.vue`:
   ```ts
   queryCollectionNavigation('docs', ['status', 'yourNewField'])
   ```
6. `bun run dev` and visually verify: header badge, sidebar badge, correct section in the index.

## Key files (quick reference)

| File | Purpose |
|---|---|
| `app/app.vue` | Root; builds navigation from `queryCollectionNavigation('docs', ['status'])`, provides it via `provide('navigation')`. Mount search. |
| `app/layouts/docs.vue` | Doc shell; `inject`s navigation, runs `expandActiveBranch` (which also maps `status → badge`), renders sidebar. |
| `app/pages/docs/[...slug].vue` | Renders one doc page; `UPageHeader` with status badge slot + `ContentRenderer`. |
| `content.config.ts` | Zod schemas for `index` and `docs` collections. |
| `app/utils/status.ts` | `statusColor()` helper, auto-imported. |
| `nuxt.config.ts` | Modules, SEO defaults, prerender routes. |

## Documentation follow-ups

Known gaps and structural issues deferred from the status-rollout work. High-priority items should land in the next docs PR.

### High-priority (next PR)

- **D1 - Unify auth recipes.** `2.auth/2.jwt.md`, `3.local.md`, `4.oauth2.md` all follow a Problem/Solution recipe pattern but with inconsistent section names. Target order: `Problem → Solution → Wire it up → Variations → Security notes → See also`. In `oauth2.md` rename `## The provider` → `## Solution`. In `local.md` move `## Why not bcrypt?` under `## Security notes`.

### Medium / nice-to-have

- **Split `drizzle.md` (368 lines)** into a base page (setup, schemas, basic queries) and an advanced page (type registry, migrations, multi-DB).
- **Extract the optimized/native adapter description** shared by `node-server.md` and `uws-server.md` into a single page; link from both.
- **Centralize the `HttpException` table** in `core-concepts/9.exceptions.md`; replace duplicates in controllers/guards/auth docs with links.
- **Replace security-critical blockquotes with `::warning` / `::caution`** callouts (argon2 choice, JWT algorithm whitelist, OAuth state/CSRF).
