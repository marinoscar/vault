# Runbook: release the `@marinoscar/vault-*` packages

Use this to publish `@marinoscar/vault-contract`, `-db`, `-api` and `-web` (publish order: contract, db, api, web) to public npm, to understand what the release workflow did, or to roll a release back. `vault-api` and `vault-web` are built in E12.2 and E12.3; until their folders exist the workflow releases the packages that are present (`node scripts/vault-packages/list-packages.mjs` prints them). The layout and checks of the packages are in [../PACKAGES.md](../PACKAGES.md). The workflows are `.github/workflows/vault-packages.yml` (checks on every change) and `.github/workflows/vault-release.yml` (release).

## How a release works

The packages are one Changesets `fixed` group (the glob `@marinoscar/vault-*`) in **pre mode** on the `next` tag, so they always share one version and every release is `0.1.0-next.N` on the `next` dist-tag.

1. A pull request that changes a package carries a changeset (`npx changeset`). The `Changeset status` job of `vault-packages.yml` fails it otherwise. `vault-packages.yml` also builds the packages, runs `check:package-pack` (what npm would publish against the manifest), smoke-imports the entry points and runs `check:package-docs` (the README standard). Typecheck and tests stay in the `Packages` job of `ci.yml`.
2. After the change merges to `main`, the **version** job opens (or updates) the pull request `vault-release/version`: `changeset version` bumps the versions, writes the changelogs and refreshes `package-lock.json`.
3. Merging that pull request pushes to `main` with no pending changeset. The **gate** job reads the version, checks the packages share it, and asks the public registry whether each name exists and whether that version is already published. It uses no credentials, and any registry error makes it answer "not ready". The package list comes from the folders present, so the gate never waits for a package that has not been built.
4. If the repository variable `NPM_PUBLISH_ENABLED` is `true` and the gate is ready, **publish** runs in the protected environment `npm-publish`: build, `check:package-pack`, then `npm publish` of each package with provenance, then the git tag `vault-packages-v<version>`. Otherwise **publish-dry-run** builds, packs, runs `npm publish --dry-run --tag next` for each package and uploads the tarballs (`marinoscar-vault-contract-<version>.tgz` and so on) as the `vault-tarballs` artifact.

Any push to `main` that touches a package, the scripts or `.changeset/` and carries no pending changeset reaches the gate, so a normal merge exercises the dry run until publishing is switched on.

No npm token exists anywhere: `publish` authenticates with OIDC trusted publishing (`id-token: write`) and `NPM_CONFIG_PROVENANCE=true` signs the packages so consumers can run `npm audit signatures`. The workflow installs npm 11.5.1 or later, which trusted publishing needs. It never passes `--tag latest`: the dist-tag comes from `.changeset/pre.json`, and the job refuses a missing or `latest` tag.

## Running the dry run by hand

Run **Vault release** from the Actions tab on any branch (`workflow_dispatch`). Off `main` the gate always selects the dry run, whatever `NPM_PUBLISH_ENABLED` says, and the version job does not push a branch. The result is the `vault-tarballs` artifact and a summary of what the gate decided. Locally the same steps are:

```bash
npm ci
npm run build:packages
npm run check:package-pack
npm run check:package-docs
for p in $(node scripts/vault-packages/list-packages.mjs); do
  npm publish -w "@marinoscar/vault-$p" --access public --tag next --dry-run --provenance=false
done
```

The `prepack` script copies the repository `LICENSE` into each package; the copy is git-ignored.

## Owner prerequisites (once)

Publishing stays off until the owner does these steps. Until then every release is a dry run.

1. **Bootstrap the package names on npm.** A trusted publisher can only be attached to a package that exists. From a laptop logged in to npm as the owner of the `@marinoscar` scope, publish a placeholder of each package once (from a scratch directory, with `"version": "0.0.0-bootstrap"`; never from a build you intend to release):

   ```bash
   cd "$(mktemp -d)"
   for p in contract db api web; do
     mkdir "vault-$p" && cd "vault-$p"
     printf '{"name":"@marinoscar/vault-%s","version":"0.0.0-bootstrap","description":"Name reservation.","license":"MIT"}\n' "$p" > package.json
     npm publish --access public --tag bootstrap
     cd ..
   done
   ```

   The `bootstrap` tag keeps the placeholder off `latest` and `next`. Bootstrap `api` and `web` too, even before they are built, so the gate is ready the day they join.
2. **Attach the trusted publisher to each package** (npmjs.com, package Settings, Trusted Publisher, GitHub Actions): organization/user `marinoscar`, repository `vault`, workflow filename `vault-release.yml`, environment `npm-publish`.
3. **Create the GitHub environment** `npm-publish` (Settings, Environments): a required reviewer, and deployment branches limited to `main`. No secrets.
4. **Set the repository variable** `NPM_PUBLISH_ENABLED` to `true` (Settings, Secrets and variables, Actions, Variables). Leave it unset or `false` to keep the dry run.
5. Allow GitHub Actions to create pull requests (Settings, Actions, General, Workflow permissions) so the version job can open `vault-release/version`. Pull requests opened with the default token do not trigger other workflows; to run CI on the version pull request, close and reopen it, or push an empty commit to the branch.

## Releasing

1. Merge the pull request that carries the changeset. Wait for **Vault release / Version pull request** to open `vault-release/version`.
2. Review the version pull request: the `package.json` versions equal, a `CHANGELOG.md` per package, the lockfile diff limited to the workspace entries, `.changeset/pre.json` listing the consumed changeset.
3. Merge it. Watch **Release gate** (its summary shows the packages, the version, the variable and the registry state), then **Publish to npm** (approve the environment when asked) or **Publish dry run**.
4. Verify:

   ```bash
   for p in contract db api web; do npm view "@marinoscar/vault-$p@next" version dist.tarball; done
   npm audit signatures        # in a project that installed them
   ```

   Every published package reports the same version. The git tag `vault-packages-v<version>` exists.

To inspect a dry run, download the `vault-tarballs` artifact and `tar -tzf` each tarball: only `dist/`, `README.md`, `CHANGELOG.md`, `LICENSE` and `package.json` (plus `bin/`, `schema/`, `migrations/` and the index lists for `vault-db`).

To release after fixing the prerequisites without a new change, run **Vault release** from the Actions tab on `main`; the gate re-evaluates the current version.

## When something goes wrong

| Symptom | Cause and fix |
|---|---|
| The release always dry-runs | `NPM_PUBLISH_ENABLED` is not `true`, the run is not on `main`, the gate summary says a name does not exist (bootstrap missing), or the registry answered an error. Fix the cause and re-run the workflow. |
| Gate warns "N of M packages are already published" | A previous publish stopped half way. Re-run **Vault release** on `main`: the publish job skips the packages already at that version and publishes the rest. |
| Gate fails: "fixed group is out of step" | The `package.json` versions differ. Revert the offending commit; never edit a version by hand. |
| `npm publish` fails with `ENEEDAUTH` or an OIDC error | The trusted publisher is missing or mismatched (workflow filename, environment, repository), or npm is older than 11.5.1. Check step 2 above. |
| `check:package-pack` fails | The tarball differs from the manifest: a missing `dist/` (run `npm run build:packages`), a `files` entry dropped, or a stray `src/` or `.env`. The message names the file. |
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
- `.github/workflows/vault-release.yml`, `.github/workflows/vault-packages.yml`, `scripts/vault-packages/`
