# Releasing MiiaJS

All `@miiajs/*` packages use fixed versioning via [Changesets](https://github.com/changesets/changesets): every published package always ships at the same version.

## Prerequisites

- npm account with publish permissions for the `@miiajs` scope
- `npm login` performed on the machine
- `GITHUB_TOKEN` in `.env.local` at repo root (already gitignored). Required by `@changesets/changelog-github` during `changeset:version` to fetch PR and author metadata. [Create a PAT with `read:user` + `repo:status` scopes](https://github.com/settings/tokens/new?scopes=read:user,repo:status&description=miia-changesets), then:
  ```sh
  echo 'GITHUB_TOKEN=ghp_xxx' >> .env.local
  ```
  Bun auto-loads `.env.local` for every `bun run` invocation.
- Clean working tree on `main`, all CI green
- `bun install` run from repo root (lockfile in sync)

## Release workflow

Run this from a clean `main` branch with all intended changesets merged.

### 1. Preview

```sh
bun run changeset:status
```

Shows which packages would bump, to which versions, and from which changesets.

### 2. Apply changesets

```sh
bun run changeset:version
```

Bumps `version` in every `@miiajs/*` `package.json`, writes `CHANGELOG.md` in each package, deletes spent `.changeset/*.md` files, regenerates `bun.lock`.

Review the diff:

```sh
git diff
```

Expected: 14 `@miiajs/*` packages bumped to the same new version, CHANGELOGs written, `.changeset/` cleaned, root `package.json` and `examples/*/package.json` untouched.

### 3. Build

```sh
bun run build
```

Must succeed before publishing - `changeset publish` uploads whatever is in `dist/` for each package.

### 4. Commit

```sh
git add -A
git commit -m "chore: release"
```

### 5. Publish

```sh
bun run release
```

`changeset publish` validates `npm login` has access to the `@miiajs` scope, publishes each package with `publishConfig.access: public`, and creates per-package git tags (e.g., `@miiajs/core@0.1.0`, 14 total).

Use Step 1 (`bun run changeset:status`) as the preview - `changeset publish` has no `--dry-run` flag, so publishing is the publish.

### 6. Tag and push

Add a parent tag and push everything:

```sh
VERSION=$(node -p "require('./packages/core/package.json').version")
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push --follow-tags
```

The parent tag `v{version}` is used by GitHub Releases and human-friendly history navigation; per-package tags were created by `changeset publish` in step 5.

### 7. GitHub Release

Open the parent tag on GitHub and create a release:

- Title: `v{version}`
- Body: combined notes from the CHANGELOG bumps, or link to each package's `CHANGELOG.md`.

## Recovering from mistakes

- **After `changeset:version` but before commit.** Revert with `git restore . && git checkout HEAD -- .changeset/` to get the changeset files back.
- **After commit but before `git push`.** `git reset --hard HEAD~1` drops the release commit. Per-package tags created by `changeset publish` exist only locally if you have not run it yet.
- **After `changeset publish` but before `git push`.** Packages are in npm already, but the repo state is out of sync. Finish the push - do not roll back, because `npm unpublish` is severely restricted.
- **After `git push`.** Live. npm allows `npm unpublish` within 72 hours only for packages with no dependents - practically unusable for a framework. Ship a patch release with the fix instead.
