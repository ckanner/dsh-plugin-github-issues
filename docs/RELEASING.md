# Releasing

Maintainer notes. This file is not part of the published package.

## What a release touches

One tag does both halves of a release:

1. `release.yml` runs every CI check again (type check, unit tests, render smoke, build, bundle
   verification, package-content verification);
2. publishes the new version to npm — either through a repository `NPM_TOKEN` secret or npm trusted
   publishing (OIDC, no long-lived token);
3. creates or updates the GitHub Release `v<version>` and attaches
   `dsh-plugin-github-issues.tgz` (version-free asset name, so `releases/latest/download/...` is stable).

A tag for a version that is already on the registry does not fail: it skips the publish step and only
records/updates the GitHub Release.

## Checklist

1. Update `CHANGELOG.md` (move the new version to the top).
2. Bump `package.json` `version` (do not hand-edit the lockfile more than npm does):

   ```sh
   npm version <major|minor|patch> --no-git-tag-version
   npm install --package-lock-only
   ```

3. Run the full gate locally:

   ```sh
   npm install
   npm run check
   ```

4. Commit, then tag and push:

   ```sh
   git add -A && git commit -m "release: vX.Y.Z"
   git push origin main
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

5. Watch the release workflow. If it fails before publish, fix forward and push a new tag only after
   bumping the version — an npm version can never be reused.

## First publish (no trusted publishing configured yet)

Trusted publishing must be configured per package on npmjs.com, which needs the package to exist. For
the very first version publish locally:

```sh
npm login                     # browser/OTP flow
npm publish --access public   # runs prepare → build, then packs `files`
```

Verify with the registry, not with `npm view` immediately — the packument can take a few minutes to
propagate (npm answers `202 Accepted` for a successful publish):

```sh
curl -s https://registry.npmjs.org/dsh-plugin-github-issues | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('latest:', d['dist-tags']['latest'])
print('versions:', sorted(d['versions']))
"
```

## Trusted publishing (preferred after the package exists)

1. On npmjs.com → the package → Settings → Trusted Publisher → GitHub Actions:
   - repository: `ckanner/dsh-plugin-github-issues`
   - workflow filename: `release.yml`
   - (no environment)
2. Do not add an `NPM_TOKEN` secret. The workflow detects the missing secret and uses OIDC; the publish
   step runs with an empty npm user config so npm performs the exchange.
3. npm requires the workflow to run on a public repository and with `id-token: write` (already set).

## Token fallback

If trusted publishing is unavailable, add a granular npm token with publish rights as the repository
secret `NPM_TOKEN`. The workflow uses it only when present, and keeps the trusted-publishing path for
repositories without the secret.

## Installing a release into the Desktop profile

After a version is on npm, point the running profile at it:

```sh
dsh plugin --profile desktop add dsh-plugin-github-issues@X.Y.Z
```

and restart DSH (a profile is composed at startup).

The Desktop profile enables pnpm's supply-chain `minimumReleaseAge` policy, so a
version published minutes ago is held back: pnpm records an exclusion entry in
`~/.dsh/profiles/desktop/pnpm-workspace.yaml` and, in a non-interactive shell, the
install can look like it hangs. If that happens, check the exclusion list (pnpm
adds the new version there) and re-run the command; or pre-add
`dsh-plugin-github-issues@X.Y.Z` to `minimumReleaseAgeExclude` before installing.
