---
name: publish-testflight
description: Build the iOS app with EAS and submit it to TestFlight. Use when the user asks to publish, ship, release, or push a build to TestFlight/App Store Connect/the App Store.
---

# Publish to TestFlight

EAS builds from git state, not the working tree — uncommitted changes to
build-relevant files won't be in the binary. Auth (`jborochin`) and Apple
submit credentials (`ascAppId` in `eas.json`) are already on file; this has
run non-interactively before, so don't expect prompts.

## 1. Pre-flight checks

```bash
npm run typecheck
npm test
```

Both must be clean. Don't build on top of a red suite.

## 2. Reconcile git state

```bash
git status --short
```

If there are uncommitted changes, sort them:

- **Build-relevant** (must be committed or the build won't reflect them):
  `app.json`, `eas.json`, `package.json`/`package-lock.json`, anything under
  `src/`, `scripts/`, `supabase/` — i.e. app code, native config, deps.
- **Local tooling noise** (safe to leave uncommitted): `.claude/settings.local.json`,
  `.mcp.json`, `skills-lock.json` — editor/session config, not part of the app.

Stage and commit only the build-relevant files with a message describing
*why*, not just what. Don't `git add -A` — hand-pick files so tooling noise
doesn't ride along. If unsure whether something affects the binary, ask
rather than guess.

Confirm HEAD is actually ahead of the last shipped build before proceeding:

```bash
npx eas-cli@latest build:list --platform ios --limit 1 --non-interactive
git log --oneline <last-build-commit>..HEAD
```

If there's nothing new, say so and stop — don't burn a build queue slot.

## 3. Build

```bash
npx eas-cli@latest build --platform ios --profile production --non-interactive
```

Run this in the background (`run_in_background: true` on Bash) — it takes
roughly 5-10 minutes based on this project's build history. Don't poll the
output file; you'll get a completion notification. If you need an interim
status check, use `eas-cli build:list --platform ios --limit 1` instead of
re-reading the background log.

`eas.json`'s production profile has `autoIncrement: true` and
`appVersionSource: remote`, so the build number bumps itself — no manual
version editing needed.

If the build fails, read the failure summary from the CLI output first (it
usually names the failing phase) before pulling full logs from the printed
`expo.dev/.../builds/<id>` URL.

## 4. Submit to TestFlight

Once the build finishes successfully:

```bash
npx eas-cli@latest submit --platform ios --latest --non-interactive
```

`--latest` picks up the build just produced — no need to look up its ID.
This also runs several minutes; background it the same way.

## 5. Report back

Tell the user: build number, version, the `expo.dev` build URL, and that it's
processing in App Store Connect (Apple's TestFlight processing typically
takes an additional few minutes to ~an hour after submission before it's
installable — this skill's job ends at successful submission, not at
tester-visible).

## Gotchas learned the hard way

- **Static `EXPO_PUBLIC_*` env access only.** Metro inlines
  `process.env.EXPO_PUBLIC_X` only when written as that exact literal
  expression. A dynamic/bracketed lookup (`process.env[key]`) defeats the
  inlining and ships a build with empty config — silently, since nothing
  throws. If touching `src/lib/supabase.ts` or adding new `EXPO_PUBLIC_*`
  vars, keep the literal form.
- **`usesNonExemptEncryption: false`** in `app.json`'s `ios.config` skips
  Apple's export-compliance question on every submit. If it's ever removed,
  submission will need `--non-interactive` to fail loudly rather than hang,
  or you'll need to answer the compliance prompt manually.
- Adding a native dependency (e.g. `expo-updates`) changes the fingerprint —
  expected, not a bug; it just means the new build can't share an OTA update
  channel with older ones.
