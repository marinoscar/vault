# Changesets

This folder holds the pending release notes of the `@marinoscar/vault-*`
packages (`vault-contract`, `vault-db`, and `vault-api` and `vault-web` once
they exist), which are one `fixed` group in [`config.json`](config.json) (the
glob `@marinoscar/vault-*`): they always share one version.
The standard, the checks and the release procedure are in
[`docs/PACKAGES.md`](../docs/PACKAGES.md) and
[`docs/runbooks/release-vault-packages.md`](../docs/runbooks/release-vault-packages.md).

The applications (`api`, `web`, `cli`) and `@app/shared` are listed under
`ignore` in `config.json`: they are versioned by their own rules, never through
a changeset.

- Run `npx changeset` in any pull request that changes a `packages/vault-*`
  package, pick the package(s) and the bump, and write one line of release
  notes for a reader of the changelog. Commit the generated
  `.changeset/<name>.md` with the change. `npx changeset status --since=origin/main`
  (CI) fails a pull request that changes a package without one.
- `npx changeset --empty` records that a change has no release impact.
- `pre.json` means the packages are in pre-release mode: releases are
  `x.y.z-next.N` on the `next` dist-tag. Do not edit or delete it by hand.
- The maintainer does not run `changeset version`: once changesets reach
  `main`, `vault-release.yml` opens the `vault-release/version` pull request that
  applies them, and merging it publishes.
