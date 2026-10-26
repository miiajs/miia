# MiiaJS website

The landing page, the documentation and the benchmarks page of [miiajs.com](https://miiajs.com). Built with Nuxt 4, Nuxt Content and Nuxt UI.

## Development

The site is a workspace of the monorepo, so dependencies come from the root:

```bash
bun install            # at the repository root
bun run website:dev    # http://localhost:3000
```

Or from this directory:

```bash
bun run dev
bun run build          # production build
bun run preview        # serve the production build locally
bun run typecheck
bun run lint
```

## Where things live

- `content/0.index.yml` - the copy of the landing page
- `content/1.docs/` - the documentation, one Markdown file per page; the number in a file or folder name orders the sidebar and is dropped from the URL
- `app/pages/index.vue` - the landing page
- `app/pages/benchmarks.vue` and `app/data/benchmarks/` - the benchmarks page and its numbers
- `app/pages/docs/[...slug].vue` and `app/layouts/docs.vue` - how a doc page renders

See [CLAUDE.md](./CLAUDE.md) for the frontmatter schema, the navigation setup and the page template for a new package.
