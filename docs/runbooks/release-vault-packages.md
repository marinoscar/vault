# Runbook: release the `@marinoscar/vault-*` packages

Use this to publish `@marinoscar/vault-contract`, `-db`, `-api` and `-web` (publish order: contract, db, api, web) to public npm, to understand what the release workflow did, or to roll a release back. The workflows release the packages whose folders are present (`node scripts/vault-packages/list-packages.mjs` prints them; all four since E12.3). The layout and checks of the packages are in [../PACKAGES.md](../PACKAGES.md), and how a consumer installs them in [../PACKAGES.md#installing-from-npm](../PACKAGES.md#installing-from-npm). The workflows are `.github/workflows/vault-packages.yml` (checks on every change), `.github/workflows/vault-release.yml` (release) and `.github/workflows/vault-packages-smoke.yml` (clean-install smoke test of the tarballs on pull requests, of npm after a release and weekly).

## How a release works

The packages are one Changesets `fixed` group (the glob `@marinoscar/vault-*`) in **pre mode** on the `next` tag, so they always share one version and every release is `0.1.0-next.N` on the `next` dist-tag.

1. A pull request that changes a package carries a changeset (`npx changeset`). The `Changeset status` job of `vault-packages.yml` fails it otherwise. `vault-packages.yml` also builds the packages, runs `check:package-pack` (what npm would publish against the manifest: the allow-list, every `exports` target, the `vault-contract` stubs, the `vault-db` schema and migrations, no leaked path or real-looking card number; [../PACKAGES.md](../PACKAGES.md#ci)), runs `test:package-scripts`, smoke-imports the entry points and runs `check:package-docs` (the README standard). `vault-packages-smoke.yml` packs the packages and installs the tarballs with their peers in an empty folder outside the workspace (`npm run smoke:packages -- --pack`). Typecheck and tests stay in the `Packages` job of `ci.yml`.
2. After the change merges to `main`, the **version** job opens (or updates) the pull request `vault-release/version`: `changeset version` bumps the versions, writes the changelogs and refreshes `package-lock.json`.
3. Merging that pull request pushes to `main` with no pending changeset. The **gate** job reads the version, checks the packages share it, and asks the public registry whether each name exists and whether that version is already published. It uses no credentials, and any registry error makes it answer "not ready". The package list comes from the folders present, so the gate never waits for a package that has not been built.
4. If the repository variable `NPM_PUBLISH_ENABLED` is `true` and the gate is ready, **publish** runs in the protected environment `npm-publish`: build, `check:package-pack`, then `npm publish` of each package with provenance, then the git tag `vault-packages-v<version>`. Otherwise **publish-dry-run** builds, packs, runs `npm publish --dry-run --tag next` for each package and uploads the tarballs (`marinoscar-vault-contract-<version>.tgz` and so on) as the `vault-tarballs` artifact.

5. When **Vault release** completes successfully on `main`, `vault-packages-smoke.yml` installs the packages from npm at `next` in an empty folder (`npm run smoke:packages -- --registry`) and checks CJS, ESM, `vault-db --help` and the types. It runs weekly too. While the names are not on npm it **skips** with a notice (`result=skipped` in the step summary); if only some packages are on npm at `next` it fails, because a release stopped half way.

Any push to `main` that touches a package, the scripts or `.changeset/` and carries no pending changeset reaches the gate, so a normal merge exercises the dry run until publishing is switched on.

No npm token exists anywhere: `publish` authenticates with OIDC trusted publishing (`id-token: write`) and `NPM_CONFIG_PROVENANCE=true` signs the packages so consumers can run `npm audit signatures`. The workflow installs npm 11.5.1 or later, which trusted publishing needs. It never passes `--tag latest`: the dist-tag comes from `.changeset/pre.json`, and the job refuses a missing or `latest` tag.

## Running the dry run by hand

Run **Vault release** from the Actions tab on any branch (`workflow_dispatch`). Off `main` the gate always selects the dry run, whatever `NPM_PUBLISH_ENABLED` says, and the version job does not push a branch. The result is the `vault-tarballs` artifact and a summary of what the gate decided. Locally the same steps are:

```bash
npm ci
npm run build:packages
npm run check:package-pack
npm run check:package-docs
npm run test:package-scripts
npm run smoke:packages -- --pack     # clean install of the tarballs, outside the workspace
for p in $(node scripts/vault-packages/list-packages.mjs); do
  npm publish -w "@marinoscar/vault-$p" --access public --tag next --dry-run --provenance=false
done
```

The `prepack` script copies the repository `LICENSE` into each package; the copy is git-ignored.

## Owner prerequisites (once)

Publishing stays off until the owner does these steps. Until then every release is a dry run.

Check where you stand first: `npm view @marinoscar/vault-contract name` answers `E404` until step 1 is done.

1. **Bootstrap the package names on npm.** A trusted publisher can only be attached to a package that exists. From a laptop logged in to npm (`npm login`; `npm whoami` prints the owner of the `@marinoscar` scope), publish a placeholder of each package once (from a scratch directory, with `"version": "0.0.0-bootstrap"`; never from a build you intend to release). npm asks for a one-time password when the account has two-factor authentication; pass it with `--otp <code>` or answer the prompt:

   ```bash
   cd "$(mktemp -d)"
   for p in contract db api web; do
     mkdir "vault-$p" && cd "vault-$p"
     printf '{"name":"@marinoscar/vault-%s","version":"0.0.0-bootstrap","description":"Name reservation. Install @marinoscar/vault-%s@next.","license":"MIT"}\n' "$p" "$p" > package.json
     npm publish --access public --tag bootstrap
     npm deprecate "@marinoscar/vault-$p@0.0.0-bootstrap" "Name reservation, not a release: install @marinoscar/vault-$p@next"
     cd ..
   done
   for p in contract db api web; do npm view "@marinoscar/vault-$p" dist-tags; done
   ```

   A pre-release version cannot be published without `--tag`, and the `bootstrap` tag keeps the placeholder off `next`. npm still gives a new package a `latest` tag, so `latest` points at the placeholder too: the deprecation makes a bare `npm install @marinoscar/vault-<pkg>` say so. The `dist-tags` line of each should read `{ latest: '0.0.0-bootstrap', bootstrap: '0.0.0-bootstrap' }`. Bootstrap all four at once, so the gate (which needs every name present) is ready.
2. **Attach the trusted publisher to each package** (npmjs.com, the package page, Settings, "Trusted Publisher", choose GitHub Actions). The fields, the same for all four packages:

   | Field | Value |
   |---|---|
   | Organization or user | `marinoscar` |
   | Repository | `vault` |
   | Workflow filename | `vault-release.yml` (the file name only, not the path) |
   | Environment name | `npm-publish` |

   Then, on the same Settings page, set "Publishing access" to **Require two-factor authentication and disallow tokens**: trusted publishing keeps working and no token can publish. Never create an npm automation or granular token for this repository.
3. **Create the GitHub environment** `npm-publish` (Settings, Environments) before the first publish: a required reviewer, and deployment branches limited to `main`. No secrets. (A job that names a missing environment creates it without protection, so create it first.)
4. **Set the repository variable** `NPM_PUBLISH_ENABLED` to `true` (Settings, Secrets and variables, Actions, Variables). Leave it unset or `false` to keep the dry run. It is a variable, not a secret: the gate reads `vars.NPM_PUBLISH_ENABLED`.
5. Allow GitHub Actions to create pull requests (Settings, Actions, General, Workflow permissions) so the version job can open `vault-release/version`. Pull requests opened with the default token do not trigger other workflows; to run CI on the version pull request, close and reopen it, or push an empty commit to the branch.

Then release (below): if no changeset is pending and the current version is not on npm, run **Vault release** from the Actions tab on `main`; the gate now selects **Publish to npm**.

## Releasing

1. Merge the pull request that carries the changeset. Wait for **Vault release / Version pull request** to open `vault-release/version`.
2. Review the version pull request: the `package.json` versions equal, a `CHANGELOG.md` per package, the lockfile diff limited to the workspace entries, `.changeset/pre.json` listing the consumed changeset.
3. Merge it. Watch **Release gate** (its summary shows the packages, the version, the variable and the registry state), then **Publish to npm** (approve the environment when asked) or **Publish dry run**.
4. Verify:

   ```bash
   for p in contract db api web; do npm view "@marinoscar/vault-$p" dist-tags; done
   for p in contract db api web; do npm view "@marinoscar/vault-$p@next" version dist.attestations.url; done
   # In an empty project:
   npm init -y && npm install @marinoscar/vault-contract@next zod@^4.4.3 && npm audit signatures
   ```

   Every package's `next` is the same version, each has an attestation URL, and `npm audit signatures` reports verified registry signatures and attestations. The package page on npmjs.com shows "Provenance" with the commit and the workflow run. The git tag `vault-packages-v<version>` exists. **Vault packages smoke / Smoke install (npm registry)** ran after the release and passed (its summary names the versions it installed); if it did not run, start it from the Actions tab (mode `registry`). Keep that run's log, the `dist-tags` output and the publish run as the release evidence.

To inspect a dry run, download the `vault-tarballs` artifact and `tar -tzf` each tarball: only `dist/`, `README.md`, `CHANGELOG.md`, `LICENSE` and `package.json` (plus `bin/`, `schema/`, `migrations/` and the index lists for `vault-db`). To install them the way a consumer would, unpack the artifact into a folder and run `npm run smoke:packages -- --tarballs <folder>`.

To release after fixing the prerequisites without a new change, run **Vault release** from the Actions tab on `main`; the gate re-evaluates the current version.

## When something goes wrong

| Symptom | Cause and fix |
|---|---|
| The release always dry-runs | `NPM_PUBLISH_ENABLED` is not `true`, the run is not on `main`, the gate summary says a name does not exist (bootstrap missing), or the registry answered an error. Fix the cause and re-run the workflow. |
| Gate warns "N of M packages are already published" | A previous publish stopped half way. Re-run **Vault release** on `main`: the publish job skips the packages already at that version and publishes the rest. |
| Gate fails: "fixed group is out of step" | The `package.json` versions differ. Revert the offending commit; never edit a version by hand. |
| `npm publish` fails with `ENEEDAUTH` or an OIDC error | The trusted publisher is missing or mismatched (workflow filename, environment, repository), or npm is older than 11.5.1. Check step 2 above. |
| `check:package-pack` fails | The tarball differs from the manifest or the allow-list: a missing `dist/` or `exports` target (run `npm run build:packages`), a `files` entry dropped, a stray `src/`, `.env`, source map, test or fixture, an unexported media file, a missing `vault-db` migration, a leaked absolute path, or a card number that is not a published test number (replace it with one). The message names the file. |
| Smoke install (tarballs) fails | A packed package does not install or load the way a consumer would load it: an `exports` subpath that does not resolve, a CommonJS or ESM load error, a declaration that does not typecheck under `node16` or `bundler`, or a peer range npm cannot satisfy. Reproduce with `npm run build:packages && npm run smoke:packages -- --pack --work /tmp/vault-smoke --keep` and inspect the folder. |
| Smoke install (npm registry) is skipped | No package is on npm at `next` yet: the owner prerequisites are not done, or the first publish has not run. Expected until then. |
| Smoke install (npm registry) fails with "only N of M packages" | A publish stopped half way; re-run **Vault release** on `main` (see the gate row above), then re-run the smoke workflow. |
| `check:package-docs` fails | A README lacks a required section, the `Status:` line, an entry point or a link target. The message names the file and rule; the standard is in [../PACKAGES.md](../PACKAGES.md). |
| The version pull request has no CI | Expected with the default token; see prerequisite 5. |

## Rolling back

**Before the version pull request merges:** close it. Nothing was published.

**After a publish:** never `npm unpublish` a version a consumer may have installed. Deprecate it and release a fixed version:

```bash
for p in contract db api web; do
  npm deprecate "@marinoscar/vault-$p@<version>" "<reason>; use <next version>"
done
```

Then fix forward: a new changeset, a new version pull request, a new release. To stop publishing at once, set `NPM_PUBLISH_ENABLED` to `false`; releases fall back to the dry run.

**Reverting the pipeline:** revert the pull request that introduced it. Nothing is published until the owner sets `NPM_PUBLISH_ENABLED=true`.

## Leaving pre mode

Pre mode ends when the packages are ready for a stable `latest` release (a decision for the owner, after the apps consume the packages in production).

1. In a pull request run `npx changeset pre exit`, which sets `"mode": "exit"` in `.changeset/pre.json`; add a changeset (`major` or `minor` as agreed).
2. Merge it, then merge the version pull request that follows: the versions become stable and that `changeset version` run deletes `.changeset/pre.json`.
3. The publish job publishes without `--tag` once `pre.json` is gone, which npm treats as `latest`. Check that `latest` is what you want, then merge. Remove the `bootstrap` dist-tags if you like (`npm dist-tag rm @marinoscar/vault-<pkg> bootstrap`).
4. To go back to pre-releases later, `npx changeset pre enter next` and merge the result.

## Links

- [PACKAGES.md](../PACKAGES.md): layout, build and test, CI, versioning
- `.github/workflows/vault-release.yml`, `.github/workflows/vault-packages.yml`, `.github/workflows/vault-packages-smoke.yml`, `scripts/vault-packages/` (`check-package-pack.mjs` with `tarball-rules.mjs`, `smoke-install.mjs`, their tests in `test/`)
