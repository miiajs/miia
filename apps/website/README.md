# MiiaJS website

The landing page, the documentation, the blog and the benchmarks page of [miiajs.com](https://miiajs.com). Built with Nuxt 4, Nuxt Content and Nuxt UI.

## Development

The site is a workspace of the monorepo, so dependencies come from the root. The scripts run Nuxt on Bun, not Node (`bun --bun`, see [CLAUDE.md](./CLAUDE.md)).

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
- `content/1.docs/` - the documentation, one Markdown file per page; the number in a file or folder name orders the sidebar and is dropped from the URL; in a folder with 10 or more entries it has two digits (`01.index.md`), because the sidebar sorts names as text
- `content/2.blog/` - the blog posts; a `<slug>.draft.md` file is a draft, shown only by `bun run dev` and kept out of git
- `app/pages/index.vue` - the landing page
- `app/pages/benchmarks.vue` and `app/data/benchmarks/` - the benchmarks page and its numbers
- `app/pages/docs/[...slug].vue` and `app/layouts/docs.vue` - how a doc page renders
- `app/pages/blog/` - the post list and a post

See [CLAUDE.md](./CLAUDE.md) for the frontmatter schema, the navigation setup, the page template for a new package, the brand colors and the blog.
