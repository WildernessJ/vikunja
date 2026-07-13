---
name: desktop-build
description: Rebuild and reinstall the Vikunja macOS desktop app (Electron wrapper) to pick up frontend changes. Triggers on "rebuild the mac app", "update the desktop app", "rebuild vikunja desktop", "the dock app is out of date".
---

# Rebuild the macOS Desktop App

The desktop app in `desktop/` is a thin Electron wrapper around a **frozen snapshot** of the frontend bundle. It carries no data and does not run the backend — it's a browser pointed at whatever Vikunja API URL you configure. Because the frontend is baked in at build time, the installed `.app` only picks up frontend changes when you rebuild and reinstall. Backend/server changes reach it live (it's just an API client).

Run this when the frontend has changed and the dock app should catch up.

## Prerequisites (verify, don't assume)

- **`desktop/build/icon.icns` exists** — the mac target points at it. Without it electron-builder falls back to the generic Electron icon. Check: `ls desktop/build/icon.icns`. If missing, convert `desktop/build/icon.png` with `iconutil`/`sips` before building.
- Build is **arm64 by default** on this machine (Apple Silicon). It signs ad-hoc with the local "Apple Development" cert and is **not notarized** — that's expected for local use.

## Build

Run from `desktop/`:

```bash
cd desktop

# 1. Build the frontend and copy dist/ into desktop/frontend/
pnpm run build:frontend

# 2. Trigger the "enter Vikunja URL" prompt on first run.
#    macOS sed REQUIRES the '' arg after -i (GNU sed does not) — omitting it errors or corrupts the file.
sed -i '' 's/\/api\/v1//g' frontend/index.html

# 3. Package the macOS app → desktop/dist/
pnpm install
pnpm run dist
```

Artifacts land in `desktop/dist/`:
- `Vikunja Desktop-<version>.dmg` — the installer
- `Vikunja Desktop-<version>.zip`
- `mac-arm64/Vikunja Desktop.app` — raw bundle

`<version>` comes from `version` in `desktop/package.json`. Bump it there if you want the filename to change; the build works regardless.

## Install

```bash
open "desktop/dist/Vikunja Desktop-<version>.dmg"
```

1. Drag **Vikunja Desktop** into **Applications** (dragging is what makes it a standalone app; running from the mounted DMG vanishes on eject).
2. **First launch: right-click → Open** (double-click is blocked by Gatekeeper because it isn't notarized). Only needed once.
3. Dock icon → Options → **Keep in Dock**. The pin now points at the real app — survives reboots, no terminal.

Reinstalling over an existing copy: quit the running app first, then replace it in `/Applications`.

## Notes

- `desktop/dist/` is gitignored build output — safe to delete anytime; the installed copy in `/Applications` is self-contained and independent of the repo and any Claude session.
- The app prompts for an API URL on first run and does **not** start the Go backend. If it points at a local dev API, that server must be running separately (see the `dev` skill).
- Running `electron .` / `pnpm start` from `desktop/` is **dev mode**, not an install: it shows the generic "Electron" dock icon and dies when its terminal closes. Use the packaged `.app` for anything persistent.
