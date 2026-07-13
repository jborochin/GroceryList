---
name: verify
description: How to run and drive this app to verify UI changes end-to-end (Expo web + Playwright MCP)
---

# Verifying GroceryList changes in the running app

## Launch

The surface is Expo web. A dev server is often **already running on port 8081**
(check `Invoke-WebRequest http://localhost:8081` — the page title is
"MealPrep Grocery"). Metro rebundles from the working tree on page load, so an
already-running server serves your uncommitted edits — no restart needed.

If nothing is on 8081:

```powershell
npx expo start --web --port 8081   # run in background; takes ~20s to be ready
```

Note: `npx expo` is non-interactive here — if the port is taken it will NOT
fall back to 8082 automatically; it exits. Probe 8081 first.

## Drive

Use the Playwright MCP tools (`mcp__plugin_playwright_playwright__browser_*`).
Navigate to `http://localhost:8081`, wait ~6s for the bundle + hydration
(page title flips from "MealPrep Grocery" to the current screen name).

- Bottom tabs are real `tab` roles: Home / Recipes / Week / List / You.
- The app hydrates real persisted data from AsyncStorage (localStorage on
  web) — the user's actual plan/pantry. **Avoid destructive probes**
  (Delete/dismiss buttons, Clear list) — dismissals persist and only
  self-heal when the plan changes. Checking items is safe (local component
  state, not persisted) but restore it before finishing.
- Accessibility snapshots of the grocery list are huge (~67 items). For
  assertions, prefer `browser_evaluate` over `document.body.innerText`
  (split lines, find section headers/items) instead of full snapshots.
- Rows are pressable `generic` nodes, not buttons; click by `text="name"`
  selector or snapshot ref.

## Gotchas

- Screenshots with a relative `filename` land in the **repo root**, not
  `.playwright-mcp/` — move them there (that dir is the dumping ground).
- Native `Share.share` opens a browser share dialog on web — don't trigger
  it via automation.
