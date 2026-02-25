---
name: add-custom-creations
description: Scaffold custom R1 Creation dashboards with their own agent groups. Each Creation gets a 240x282 WebView and a dedicated agent. Depends on R1 support being present.
---

# Custom R1 Creations

Scaffold custom dashboards for the Rabbit R1. Each Creation gets its own 240x282 WebView
and a dedicated agent group. The HTTP channel auto-discovers Creations on startup.

Depends on the R1 skill (`rabbit-r1`) being applied first.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `custom-creations` is in `applied_skills`, skip to Phase 3.

### Verify build

```bash
npm run build
```

Fix any errors before continuing.

## Phase 2: Apply Code Changes

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-custom-creations
```

This deterministically:
- Adds `static/_creation-template/` (HTML/JS/CSS template)
- Adds `scripts/create-creation.ts` (scaffolding CLI)
- Three-way merges Creation discovery into `src/channels/http.ts`

If the apply reports merge conflicts, read the intent file:
- `modify/src/channels/http.ts.intent.md` — Creation discovery, mounts, QR codes

### Validate

```bash
npm run build
```

Build must be clean before proceeding.

## Phase 3: Create a Custom Creation

Scaffold a new Creation:

```bash
npx tsx scripts/create-creation.ts my-dashboard "My custom dashboard"
```

This creates:
- `static/my-dashboard/` — HTML/JS/CSS from template
- `static/my-dashboard/creation.json` — manifest
- `groups/my-dashboard/CLAUDE.md` — agent instructions

Customize:
1. Edit `groups/my-dashboard/CLAUDE.md` — tell the agent what data to return
2. Edit `static/my-dashboard/js/app.js` — customize the `render()` function
3. Rebuild and restart:

```bash
npm run build
systemctl --user restart nanoclaw    # Linux
# or: launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

## Phase 4: Pair

Open the pairing page: `https://YOUR_URL/pair?token=YOUR_TOKEN`

Each custom Creation gets its own QR code. Scan with your R1 via Settings > Add Creation.

## Phase 5: Done

Tell the user:

> Custom Creations support enabled.
>
> Create new dashboards anytime with:
> `npx tsx scripts/create-creation.ts <slug> [description]`
>
> Each Creation auto-discovers on restart and gets its own QR code on the pair page.
