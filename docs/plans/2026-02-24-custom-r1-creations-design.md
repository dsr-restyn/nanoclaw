# Custom R1 Creations Skill — Design

## Summary

NanoClaw skill that lets users scaffold custom R1 Creation dashboards. Each Creation is a 240x282 WebView that communicates with its own agent group via the existing HTTP/SSE API. Depends on the R1 skill being applied.

## Decisions

- **Data source:** Agent-powered. Creation sends chat messages, agent responds with structured data.
- **Isolation:** Each Creation gets its own HTTP group (separate agent context).
- **Skill output:** Scaffolding script + template directory. No pre-built examples.
- **Discovery:** Per-Creation `creation.json` manifest. HTTP channel scans `static/` on startup.
- **Pairing:** Each Creation gets its own QR code on the `/pair` page.

## Architecture

### Scaffolding Flow

```
npx tsx scripts/create-creation.ts alpaca-dashboard
  → static/alpaca-dashboard/          (HTML/JS/CSS from template)
  → static/alpaca-dashboard/creation.json  (manifest)
  → groups/alpaca-dashboard/CLAUDE.md  (agent instructions)
```

### Runtime Flow

```
HTTP channel startup:
  → Scan static/ for creation.json files
  → Register @fastify/static mount for each at /{name}/
  → Auto-create HTTP group if not exists

/pair page:
  → Show QR code per Creation (title, URL, theme from creation.json)

R1 scans QR → WebView at /{name}/?token=DEVICE_TOKEN
  → Frontend sends message to dedicated group via POST /groups/:jid/messages
  → Agent responds with data (structured via CLAUDE.md instructions)
  → Frontend renders as dashboard
```

## Components

### creation.json (per-Creation manifest)

```json
{
  "name": "Alpaca Dashboard",
  "slug": "alpaca-dashboard",
  "group": "alpaca-dashboard",
  "description": "Portfolio positions and market data",
  "themeColor": "#00ff00"
}
```

### scripts/create-creation.ts

CLI that:
1. Takes a name argument (e.g., `alpaca-dashboard`)
2. Copies `static/_creation-template/` to `static/{name}/`
3. Writes `creation.json` with name/slug/group
4. Creates `groups/{name}/CLAUDE.md` with template agent instructions
5. Rebuilds (`npm run build`) to copy static files to dist/

### static/_creation-template/

Boilerplate with:
- `index.html` — 240x282 viewport, CRT theme, single `<div id="app">`
- `css/styles.css` — CRT green-on-black theme (shared with main Creation)
- `js/api.js` — Copied from main Creation (bearer auth, SSE, REST)
- `js/hardware.js` — Copied from main Creation (R1 scroll/click bindings)
- `js/app.js` — Skeleton with `fetchData()` / `render()` pattern and auto-refresh interval

### src/channels/http.ts modifications

- On startup: scan `static/` for `*/creation.json`
- For each: register `@fastify/static` with prefix `/{slug}/`
- For each: auto-create HTTP group if not in DB
- `/pair` page: render a QR code per Creation (not just the main one)
- Add redirect route `/{slug}` → `/{slug}/`

## Skill Structure

```
.claude/skills/add-custom-creations/
├── manifest.yaml
├── SKILL.md
├── add/
│   ├── static/_creation-template/
│   │   ├── index.html
│   │   ├── creation.json.template
│   │   ├── css/styles.css
│   │   ├── js/api.js
│   │   ├── js/hardware.js
│   │   └── js/app.js
│   └── scripts/create-creation.ts
└── modify/
    ├── src/channels/http.ts
    └── src/channels/http.ts.intent.md
```

### manifest.yaml

```yaml
skill: custom-creations
version: 1.0.0
description: "Scaffold custom R1 Creation dashboards with their own agent groups"
core_version: 0.1.0
adds:
  - static/_creation-template/index.html
  - static/_creation-template/css/styles.css
  - static/_creation-template/js/api.js
  - static/_creation-template/js/hardware.js
  - static/_creation-template/js/app.js
  - static/_creation-template/creation.json.template
  - scripts/create-creation.ts
modifies:
  - src/channels/http.ts
structured:
  npm_dependencies: {}
  env_additions: []
conflicts: []
depends:
  - rabbit-r1
test: "npm run build"
```

## Non-goals

- No pre-built example dashboards (users scaffold from template)
- No live-reload during development (users rebuild + restart)
- No per-Creation auth (all Creations share device tokens)
- No Creation deletion CLI (users delete the directory manually)
