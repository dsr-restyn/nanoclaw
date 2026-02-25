# Custom R1 Creations — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a NanoClaw skill that scaffolds custom R1 Creation dashboards, each with its own agent group, auto-discovered by the HTTP channel on startup.

**Architecture:** A scaffolding script copies a template directory to `static/{name}/`, creates a `creation.json` manifest, and sets up a per-Creation agent group. The HTTP channel scans for `creation.json` files on startup, registers `@fastify/static` mounts and auto-creates groups. The `/pair` page renders a QR code per Creation. The skill engine applies the `http.ts` modifications via three-way merge.

**Tech Stack:** TypeScript (Node.js), Fastify, vanilla JS (R1 WebView), NanoClaw skill engine (`apply-skill.ts`)

**Design doc:** `docs/plans/2026-02-24-custom-r1-creations-design.md`

---

## Context for Implementer

### How NanoClaw skills work

Skills live in `.claude/skills/add-{name}/` and are applied via `npx tsx scripts/apply-skill.ts .claude/skills/add-{name}`. The apply script:
- Copies files from `add/` into the project
- Three-way merges files in `modify/` using `.nanoclaw/base/` as the merge base
- Records the skill in `.nanoclaw/state.yaml`

Each skill has:
- `manifest.yaml` — metadata, file lists, dependencies
- `SKILL.md` — user-facing install guide (frontmatter with `name:` and `description:`)
- `add/` — new files to add to the project
- `modify/` — full copies of modified files + `.intent.md` explaining the changes

### Key conventions
- `modify/` files must be **complete copies** of the target file as it should look after the skill is applied. The skill engine does a three-way merge (base/ours/theirs).
- Intent files (`.intent.md`) explain what changed so a human can resolve merge conflicts.
- The `.nanoclaw/base/` directory contains the current post-skills state of all source files. When writing `modify/` files, start from the base version.

### How HTTP groups work
- Groups are registered via `registerGroup(jid, group)` in `src/index.ts`
- HTTP group JIDs use the format `http:{uuid}`
- The `POST /groups` endpoint creates groups dynamically
- For auto-created Creation groups, we'll use a deterministic JID format: `http:creation:{slug}`

### R1 Creation QR format
The QR code encodes a JSON object:
```json
{
  "title": "Name",
  "url": "https://host/slug/?token=TOKEN",
  "description": "Description",
  "iconUrl": "",
  "themeColor": "#00ff00"
}
```

---

## Task 1: Creation Template — index.html

**Files:**
- Create: `.claude/skills/add-custom-creations/add/static/_creation-template/index.html`

This is the boilerplate HTML for new Creations. Much simpler than the main Creation — just a header and a single `<div id="app">` content area with scroll support.

**Step 1: Create the directory structure**

```bash
mkdir -p .claude/skills/add-custom-creations/add/static/_creation-template/css
mkdir -p .claude/skills/add-custom-creations/add/static/_creation-template/js
```

**Step 2: Write index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=240, height=282, initial-scale=1.0, user-scalable=no">
  <title>Creation</title>
  <link rel="stylesheet" href="css/styles.css">
</head>
<body>
  <div class="view active">
    <div class="header">
      <span class="title" id="title">LOADING...</span>
      <span id="status-dot" class="dot dot-gray"></span>
    </div>
    <div id="app" class="scroll-area"></div>
    <div class="footer">
      <button id="btn-refresh" class="btn-primary">[ REFRESH ]</button>
    </div>
  </div>
  <script src="js/api.js"></script>
  <script src="js/hardware.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
```

**Step 3: Commit**

```bash
git add .claude/skills/add-custom-creations/add/static/_creation-template/index.html
git commit -m "feat(creations): add template index.html"
```

---

## Task 2: Creation Template — CSS

**Files:**
- Create: `.claude/skills/add-custom-creations/add/static/_creation-template/css/styles.css`

Copy the existing CRT theme from `static/creation/css/styles.css` but stripped down to just the essentials a dashboard needs: reset, body, CRT effects, view/header/footer, scroll-area, status dots, buttons, and a few dashboard-specific utility classes. Remove chat, palette, monitor, voice, activity feed, and other main-Creation-specific styles.

**Step 1: Write styles.css**

Include these sections from the main Creation CSS (copy verbatim):
- Reset (`* { margin: 0; ... }`)
- `html, body` (240x282, background, color, font)
- CRT scanline overlay (`body::after`)
- Screen vignette (`body::before`)
- `.view` and `.view.active`
- `.header`, `.title`, `.btn-back`
- `.dot`, `.dot-green`, `.dot-yellow`, `.dot-gray`, `.dot-red`
- `.scroll-area` and scrollbar hiding
- `.footer`, `.btn-primary`, `.btn-primary:active`
- `.hidden`
- `.empty-state`

Add one new class for dashboard data rows:
```css
/* Dashboard data rows */
.data-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 8px;
  font-size: 11px;
  border-bottom: 1px solid #0a3a0a;
}

.data-row .label {
  color: #0a6e0a;
}

.data-row .value {
  color: #33ff33;
  text-shadow: 0 0 4px rgba(51, 255, 51, 0.3);
}
```

**Step 2: Commit**

```bash
git add .claude/skills/add-custom-creations/add/static/_creation-template/css/styles.css
git commit -m "feat(creations): add template CSS (stripped CRT theme)"
```

---

## Task 3: Creation Template — api.js

**Files:**
- Create: `.claude/skills/add-custom-creations/add/static/_creation-template/js/api.js`

This is a simplified version of the main Creation's `api.js`. Custom Creations communicate with their own dedicated group, so the API client only needs: init from URL, send a message, get messages, and SSE streaming. No session listing, no monitor, no commands.

**Step 1: Write api.js**

```javascript
/**
 * NanoClaw API client for custom Creations.
 * Communicates with a single dedicated group via the HTTP channel.
 *
 * Auth: device token from URL (?token=...).
 * Group: auto-created by the HTTP channel on startup.
 */
const CreationAPI = (() => {
  let _serverUrl = "";
  let _token = "";
  let _groupJid = "";

  function _headers() {
    return {
      "Authorization": `Bearer ${_token}`,
      "Content-Type": "application/json",
    };
  }

  async function _fetch(path, opts = {}) {
    const resp = await fetch(`${_serverUrl}${path}`, {
      headers: _headers(),
      ...opts,
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`${resp.status}: ${body}`);
    }
    return resp.json();
  }

  /**
   * Initialize from URL.
   * Expects ?token=DEVICE_TOKEN&group=GROUP_JID
   */
  function init() {
    const params = new URLSearchParams(window.location.search);
    _token = params.get("token") || "";
    _groupJid = params.get("group") || "";
    _serverUrl = window.location.origin;

    if (!_token) return { ok: false, reason: "no ?token= in URL" };
    if (!_groupJid) return { ok: false, reason: "no ?group= in URL" };
    return { ok: true };
  }

  /** Send a message to the Creation's dedicated group. */
  async function sendMessage(message) {
    const jid = encodeURIComponent(_groupJid);
    return _fetch(`/groups/${jid}/messages`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  }

  /** Fetch message history from the Creation's group. */
  async function fetchMessages(since) {
    const jid = encodeURIComponent(_groupJid);
    const params = since ? `?since=${encodeURIComponent(since)}` : "";
    return _fetch(`/groups/${jid}/messages${params}`);
  }

  /** Connect to SSE stream for the Creation's group. */
  function stream(onEvent) {
    const jid = encodeURIComponent(_groupJid);
    const url = `${_serverUrl}/groups/${jid}/stream?token=${_token}`;
    const es = new EventSource(url);

    es.addEventListener("text", (e) => onEvent(JSON.parse(e.data)));
    es.addEventListener("tool", (e) => onEvent(JSON.parse(e.data)));
    es.addEventListener("status", (e) => onEvent(JSON.parse(e.data)));
    es.addEventListener("result", (e) => onEvent(JSON.parse(e.data)));
    es.addEventListener("ping", () => {});

    return es;
  }

  return {
    init,
    sendMessage,
    fetchMessages,
    stream,
    get groupJid() { return _groupJid; },
    get connected() { return !!_token && !!_groupJid; },
  };
})();
```

**Step 2: Commit**

```bash
git add .claude/skills/add-custom-creations/add/static/_creation-template/js/api.js
git commit -m "feat(creations): add template api.js (simplified API client)"
```

---

## Task 4: Creation Template — hardware.js

**Files:**
- Create: `.claude/skills/add-custom-creations/add/static/_creation-template/js/hardware.js`

**Step 1: Write hardware.js**

Copy `static/creation/js/hardware.js` verbatim. It's already small and generic — R1 scroll/click bindings with keyboard fallbacks.

**Step 2: Commit**

```bash
git add .claude/skills/add-custom-creations/add/static/_creation-template/js/hardware.js
git commit -m "feat(creations): add template hardware.js"
```

---

## Task 5: Creation Template — app.js

**Files:**
- Create: `.claude/skills/add-custom-creations/add/static/_creation-template/js/app.js`

This is the skeleton dashboard logic. It initializes the API, sends a "refresh" message to the agent, and renders the response. Users customize `render()` for their dashboard.

**Step 1: Write app.js**

```javascript
/**
 * Custom Creation — app skeleton.
 *
 * Edit fetchData() and render() to build your dashboard.
 * The agent in groups/{slug}/CLAUDE.md controls what data is returned.
 */
(() => {
  const app = document.getElementById("app");
  const title = document.getElementById("title");
  const statusDot = document.getElementById("status-dot");

  // How often to auto-refresh (ms). Set to 0 to disable.
  const REFRESH_INTERVAL = 30000;
  let refreshTimer = null;

  // -- Helpers --

  function setStatus(state) {
    const map = {
      ok: "dot-green",
      working: "dot-yellow",
      error: "dot-red",
      idle: "dot-gray",
    };
    statusDot.className = "dot " + (map[state] || "dot-gray");
  }

  // -- Rendering --
  //
  // Customize this function to display your dashboard data.
  // The `text` parameter is the agent's response string.
  //
  // Tip: Have your agent return JSON, then parse it here:
  //   const data = JSON.parse(text);
  //
  function render(text) {
    app.replaceChildren();
    const pre = document.createElement("div");
    pre.style.padding = "8px";
    pre.style.fontSize = "11px";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.wordBreak = "break-word";
    pre.textContent = text;
    app.appendChild(pre);
  }

  // -- Data Fetching --
  //
  // Sends a message to the agent and waits for the response.
  // Customize the prompt to request the data you need.
  //
  const PROMPT = "refresh";

  async function fetchData() {
    setStatus("working");
    try {
      await CreationAPI.sendMessage(PROMPT);
    } catch (err) {
      setStatus("error");
      render("ERR: " + err.message);
    }
  }

  // -- SSE Event Handler --

  function handleEvent(event) {
    switch (event.type) {
      case "text":
        render(event.content);
        setStatus("ok");
        break;
      case "status":
        if (event.state === "working") setStatus("working");
        if (event.state === "waiting") setStatus("ok");
        break;
      case "result":
        if (event.summary) render(event.summary);
        setStatus("ok");
        break;
    }
  }

  // -- Hardware Bindings --

  Hardware.bind("scrollUp", () => { app.scrollTop -= 40; });
  Hardware.bind("scrollDown", () => { app.scrollTop += 40; });
  Hardware.bind("sideClick", () => { fetchData(); });

  // -- Init --

  document.getElementById("btn-refresh").addEventListener("click", fetchData);

  const result = CreationAPI.init();
  if (!result.ok) {
    setStatus("error");
    render("ERR: " + result.reason);
    return;
  }

  // Set title from URL path slug
  const slug = window.location.pathname.split("/").filter(Boolean)[0] || "creation";
  title.textContent = slug.toUpperCase().replace(/-/g, " ");

  // Connect SSE stream
  CreationAPI.stream(handleEvent);

  // Initial data fetch
  fetchData();

  // Auto-refresh
  if (REFRESH_INTERVAL > 0) {
    refreshTimer = setInterval(fetchData, REFRESH_INTERVAL);
  }
})();
```

**Step 2: Commit**

```bash
git add .claude/skills/add-custom-creations/add/static/_creation-template/js/app.js
git commit -m "feat(creations): add template app.js (dashboard skeleton)"
```

---

## Task 6: Creation Template — creation.json.template

**Files:**
- Create: `.claude/skills/add-custom-creations/add/static/_creation-template/creation.json.template`

This is a template file that `create-creation.ts` copies and fills in. It uses `__PLACEHOLDER__` markers.

**Step 1: Write creation.json.template**

```json
{
  "name": "__NAME__",
  "slug": "__SLUG__",
  "group": "__SLUG__",
  "description": "__DESCRIPTION__",
  "themeColor": "#00ff00"
}
```

**Step 2: Commit**

```bash
git add .claude/skills/add-custom-creations/add/static/_creation-template/creation.json.template
git commit -m "feat(creations): add creation.json template"
```

---

## Task 7: Scaffolding Script — create-creation.ts

**Files:**
- Create: `.claude/skills/add-custom-creations/add/scripts/create-creation.ts`

CLI script that scaffolds a new Creation directory from the template.

**Step 1: Write create-creation.ts**

```typescript
#!/usr/bin/env npx tsx
/**
 * Scaffold a new custom R1 Creation.
 *
 * Usage: npx tsx scripts/create-creation.ts <slug> [description]
 *
 * Creates:
 *   static/{slug}/          — HTML/JS/CSS from template
 *   static/{slug}/creation.json — manifest
 *   groups/{slug}/CLAUDE.md — agent instructions
 */
import fs from 'fs';
import path from 'path';

const slug = process.argv[2];
const description = process.argv[3] || 'Custom R1 Creation';

if (!slug) {
  console.error('Usage: npx tsx scripts/create-creation.ts <slug> [description]');
  console.error('Example: npx tsx scripts/create-creation.ts alpaca-dashboard "Portfolio positions"');
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) || slug.length < 3) {
  console.error(`Invalid slug: "${slug}". Use lowercase letters, numbers, and hyphens (min 3 chars).`);
  process.exit(1);
}

const projectRoot = process.cwd();
const templateDir = path.join(projectRoot, 'static', '_creation-template');
const targetDir = path.join(projectRoot, 'static', slug);
const groupDir = path.join(projectRoot, 'groups', slug);

if (fs.existsSync(targetDir)) {
  console.error(`Creation already exists: static/${slug}/`);
  process.exit(1);
}

if (!fs.existsSync(templateDir)) {
  console.error('Template directory not found: static/_creation-template/');
  console.error('Make sure the custom-creations skill is applied.');
  process.exit(1);
}

// Copy template to target
function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else if (entry.name === 'creation.json.template') {
      // Skip — we write creation.json separately
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

console.log(`Creating creation: ${slug}`);

// 1. Copy template files
copyDir(templateDir, targetDir);
console.log(`  + static/${slug}/`);

// 2. Write creation.json from template
const name = slug
  .split('-')
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(' ');
const manifest = {
  name,
  slug,
  group: slug,
  description,
  themeColor: '#00ff00',
};
fs.writeFileSync(
  path.join(targetDir, 'creation.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(`  + static/${slug}/creation.json`);

// 3. Create agent group with CLAUDE.md
fs.mkdirSync(groupDir, { recursive: true });
fs.writeFileSync(
  path.join(groupDir, 'CLAUDE.md'),
  `# ${name}\n\nThis agent powers the "${name}" R1 Creation dashboard.\n\n` +
  `## Your Role\n\nYou receive messages from the Creation frontend (a 240x282 WebView on the Rabbit R1).\n` +
  `When you receive "refresh", respond with the current data for the dashboard.\n\n` +
  `## Response Format\n\nKeep responses concise — the R1 screen is small (240x282 pixels, ~12px monospace font).\n` +
  `Aim for under 500 characters. The frontend renders your response as plain text by default.\n` +
  `For structured data, return JSON and have the frontend parse it.\n\n` +
  `## Example\n\nUser: refresh\nYou: Portfolio: $12,345.67 (+2.3%)\\nTop: AAPL $195.20, NVDA $890.50\n\n` +
  `## Guidelines\n\n- Respond quickly\n- Use abbreviated formats (k, M, %) to save space\n` +
  `- No markdown formatting — the frontend renders plain text\n- If an error occurs, say so briefly: "ERR: API unreachable"\n`,
);
console.log(`  + groups/${slug}/CLAUDE.md`);

console.log(`\nDone! Next steps:`);
console.log(`  1. Edit groups/${slug}/CLAUDE.md with your agent instructions`);
console.log(`  2. Edit static/${slug}/js/app.js to customize the dashboard`);
console.log(`  3. Rebuild: npm run build`);
console.log(`  4. Restart NanoClaw to pick up the new Creation`);
```

**Step 2: Commit**

```bash
git add .claude/skills/add-custom-creations/add/scripts/create-creation.ts
git commit -m "feat(creations): add scaffolding script create-creation.ts"
```

---

## Task 8: Modify http.ts — Creation Discovery and Static Mounts

This is the core runtime change. The HTTP channel needs to:
1. Scan `static/` for `*/creation.json` files on startup
2. Register a `@fastify/static` mount per Creation at `/{slug}/`
3. Auto-create an HTTP group per Creation if it doesn't exist
4. Serve multiple QR codes on the `/pair` page (one per Creation)
5. Add a `/{slug}` → `/{slug}/` redirect per Creation

**Files:**
- Create: `.claude/skills/add-custom-creations/modify/src/channels/http.ts`
- Create: `.claude/skills/add-custom-creations/modify/src/channels/http.ts.intent.md`

**Step 1: Read the current base version of http.ts**

Read `.nanoclaw/base/src/channels/http.ts` — this is the merge base the skill engine uses.

**Step 2: Write the modified http.ts**

Start from `.nanoclaw/base/src/channels/http.ts`. Apply these targeted changes:

**2a. Add fs imports** (top of file, add to existing imports):

After the existing `import { resolve } from 'path';` line, add:

```typescript
import { readFileSync, readdirSync, existsSync } from 'fs';
```

**2b. Add CreationManifest interface** (after the `GroupEvent` interface):

```typescript
interface CreationManifest {
  name: string;
  slug: string;
  group: string;
  description: string;
  themeColor: string;
}
```

**2c. Add discoverCreations function** (after `requireAuth` function):

```typescript
/**
 * Scan static/ for custom Creations.
 * Each subdirectory containing a creation.json is a Creation.
 */
function discoverCreations(staticRoot: string): CreationManifest[] {
  const creations: CreationManifest[] = [];
  if (!existsSync(staticRoot)) return creations;

  for (const entry of readdirSync(staticRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_') || entry.name === 'creation') continue;
    const manifestPath = resolve(staticRoot, entry.name, 'creation.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest: CreationManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifest.slug && manifest.name) {
        creations.push(manifest);
      }
    } catch {
      // Skip malformed manifests
    }
  }
  return creations;
}
```

**2d. Add field to HttpChannel class** (after `private bus = new EventEmitter();`):

```typescript
  private creations: CreationManifest[] = [];
```

**2e. In connect()** — after the existing `@fastify/static` registration for `/creation/` and before `this.setupRoutes();`:

```typescript
    // Discover and mount custom Creations
    const staticBase = resolve(__dirname, '..', 'static');
    this.creations = discoverCreations(staticBase);
    for (const creation of this.creations) {
      const creationRoot = resolve(staticBase, creation.slug);
      await this.server.register(fastifyStatic, {
        root: creationRoot,
        prefix: `/${creation.slug}/`,
        decorateReply: false,
      });
      logger.info({ slug: creation.slug, name: creation.name }, 'Custom Creation mounted');
    }
```

**2f. In connect()** — after `logger.info({ port: this.opts.port }, 'HTTP channel listening');`:

```typescript
    // Auto-register groups for custom Creations
    for (const creation of this.creations) {
      const jid = `http:creation:${creation.slug}`;
      const groups = this.opts.registeredGroups();
      if (!groups[jid]) {
        this.opts.registerGroup(jid, {
          name: creation.name,
          folder: creation.slug,
          trigger: '',
          added_at: new Date().toISOString(),
          requiresTrigger: false,
        });
        this.opts.onChatMetadata(jid, new Date().toISOString(), creation.name, 'http', false);
      }
    }
```

**2g. In setupRoutes()** — after the `GET /creation` redirect route, add:

```typescript
    // Custom Creation redirects (trailing slash required by @fastify/static)
    for (const creation of this.creations) {
      const slug = creation.slug;
      server.get(`/${slug}`, async (_request, reply) => {
        return reply.redirect(`/${slug}/`);
      });
    }
```

**2h. In setupRoutes()** — add a new QR route before the `GET /pair` route:

```typescript
    // GET /pair/creation/:slug/qr — per-Creation install QR
    server.get<{ Params: { slug: string } }>(
      '/pair/creation/:slug/qr',
      { preHandler: requireAuth },
      async (request, reply) => {
        const creation = this.creations.find(c => c.slug === request.params.slug);
        if (!creation) return reply.code(404).send({ error: 'Creation not found' });

        const host = request.headers.host || `localhost:${this.opts.port}`;
        const proto = request.headers['x-forwarded-proto'] || 'http';
        const token = extractToken(request)!;
        const jid = `http:creation:${creation.slug}`;
        const creationUrl = `${proto}://${host}/${creation.slug}/?token=${token}&group=${encodeURIComponent(jid)}`;
        const png = await qrToBuffer(JSON.stringify({
          title: creation.name,
          url: creationUrl,
          description: creation.description,
          iconUrl: '',
          themeColor: creation.themeColor || '#00ff00',
        }));
        reply.type('image/png').send(png);
      },
    );
```

**2i. In the `GET /pair` HTML** — after the main Creation section `</div>` and before the voice section, insert custom Creation sections. The HTML template string should include:

```
${this.creations.map((c, i) => `
  <div class="section">
    <h2>${i + 2}. ${esc(c.name)}</h2>
    <img src="/pair/creation/${c.slug}/qr?token=${token}" alt="${esc(c.name)} QR" width="300" height="300">
    <div class="note">${esc(c.description)}</div>
  </div>
`).join('')}
```

Where `esc` is a simple function to escape HTML (add to the route handler):
```typescript
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
```

Also update the voice section numbering to account for custom Creations:
```
<h2>${2 + this.creations.length}. Voice (PTT)</h2>
```

**Step 3: Write the complete modified file**

Write the full file to `.claude/skills/add-custom-creations/modify/src/channels/http.ts` incorporating all changes above into the base version.

**Step 4: Write the intent file**

Create `.claude/skills/add-custom-creations/modify/src/channels/http.ts.intent.md`:

```markdown
# Intent: src/channels/http.ts modifications

## What changed
Added custom Creation auto-discovery, static file mounting, group auto-creation,
and per-Creation QR codes on the pair page.

## Key sections

### Imports
- Added: `readFileSync`, `readdirSync`, `existsSync` from `fs`

### New types
- `CreationManifest` interface (name, slug, group, description, themeColor)

### New functions
- `discoverCreations(staticRoot)` — scans static/ for */creation.json files
- Skips directories starting with `_` and the main `creation` directory

### HttpChannel class
- New field: `private creations: CreationManifest[]`

### connect() method
- After main Creation @fastify/static mount: discover + mount custom Creations
- After listen: auto-register HTTP groups for each custom Creation
- Creation group JIDs use format: `http:creation:{slug}`

### setupRoutes() method
- After `GET /creation` redirect: per-Creation `/{slug}` -> `/{slug}/` redirects
- New route: `GET /pair/creation/:slug/qr` — per-Creation QR code
- Modified `GET /pair` page: shows QR codes for each custom Creation
- Voice section numbering adjusted for custom Creation count

## Invariants
- Main Creation at /creation/ is unaffected
- All existing routes unchanged
- Existing QR endpoints unchanged (install and voice)
- Custom Creation groups use deterministic JIDs: http:creation:{slug}
- requireAuth middleware on all authenticated routes

## Must-keep
- All existing imports, routes, and logic
- The requireAuth middleware on all authenticated routes
- The SSE keepalive and client tracking
- Voice WebSocket endpoints
```

**Step 5: Commit**

```bash
git add .claude/skills/add-custom-creations/modify/
git commit -m "feat(creations): add http.ts modifications for Creation discovery"
```

---

## Task 9: Skill Manifest and SKILL.md

**Files:**
- Create: `.claude/skills/add-custom-creations/manifest.yaml`
- Create: `.claude/skills/add-custom-creations/SKILL.md`

**Step 1: Write manifest.yaml**

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

**Step 2: Write SKILL.md**

````markdown
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
````

**Step 3: Commit**

```bash
git add .claude/skills/add-custom-creations/manifest.yaml .claude/skills/add-custom-creations/SKILL.md
git commit -m "feat(creations): add skill manifest and SKILL.md"
```

---

## Task 10: Test — Apply Skill, Build, Verify

**Step 1: Verify clean build before applying**

```bash
npm run build
```

Must pass.

**Step 2: Apply the skill**

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-custom-creations
```

Verify it reports success, no merge conflicts.

**Step 3: Build**

```bash
npm run build
```

Must pass with no TypeScript errors.

**Step 4: Verify files are in dist/**

```bash
ls dist/static/_creation-template/index.html
ls dist/static/_creation-template/js/app.js
ls dist/static/_creation-template/css/styles.css
```

**Step 5: Test the scaffolding script**

```bash
npx tsx scripts/create-creation.ts test-dashboard "Test dashboard"
```

Verify it creates:
```bash
ls static/test-dashboard/index.html
ls static/test-dashboard/creation.json
ls static/test-dashboard/js/app.js
ls groups/test-dashboard/CLAUDE.md
cat static/test-dashboard/creation.json
```

Expected: creation.json with `"slug": "test-dashboard"`, `"name": "Test Dashboard"`.

**Step 6: Rebuild to include the test Creation**

```bash
npm run build
ls dist/static/test-dashboard/index.html
```

**Step 7: Clean up test Creation**

```bash
rm -rf static/test-dashboard groups/test-dashboard
npm run build
```

**Step 8: Revert applied skill changes**

Restore source files from base (skill was tested, now revert so only the skill definition is committed):

```bash
cp .nanoclaw/base/src/channels/http.ts src/channels/http.ts
```

Remove the applied skill entry from `.nanoclaw/state.yaml` (edit out the `custom-creations` entry).

Remove added files that the skill engine copied:
```bash
rm -rf static/_creation-template scripts/create-creation.ts
```

**Step 9: Verify build is still clean after revert**

```bash
npm run build
```

**Step 10: Commit the skill definition**

```bash
git add .claude/skills/add-custom-creations/
git commit -m "feat(skills): add custom R1 Creations skill"
```
