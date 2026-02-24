---
name: setup-r1
description: One-command NanoClaw setup for Rabbit R1. Chains base setup, HTTP channel, and R1 support. Use when user wants to set up NanoClaw specifically for R1 (no WhatsApp needed). Triggers on "setup r1", "install for rabbit", "r1 setup".
---

# NanoClaw Setup for Rabbit R1

Sets up NanoClaw with HTTP channel and R1 support (Creation frontend, voice, QR pairing).
No WhatsApp needed — the HTTP channel is the only channel.

## Phase 1: Base Setup

Run the `/setup` skill. When it asks about WhatsApp authentication, **skip it** —
tell the setup that WhatsApp is not needed. Set `WHATSAPP_ENABLED=false`.

If the setup skill asks about channels or messaging platforms, select HTTP-only.

Once base setup completes and `npm run build` passes, continue.

## Phase 2: Initialize Skills System

Snapshot the clean state so the skills engine can do three-way merges:

```bash
npx tsx scripts/apply-skill.ts --init
```

This creates `.nanoclaw/base/` with copies of all current source files.

## Phase 3: Apply HTTP Channel

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-http-channel
```

This adds the HTTP/SSE channel with REST API and Bearer token auth. It:
- Adds `src/channels/http.ts`
- Merges token management into `src/db.ts`
- Merges channel config into `src/config.ts`
- Merges HTTP channel registration into `src/index.ts`
- Installs `fastify` and `@fastify/cors` npm dependencies

If the apply reports merge conflicts, read the intent files in
`.claude/skills/add-http-channel/modify/` for guidance.

Verify:

```bash
npm run build
```

## Phase 4: Apply R1 Support

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-rabbit-r1
```

This adds R1-specific features on top of the HTTP channel. It:
- Adds `src/channels/http/voice.ts` and `voice-protocol.ts`
- Adds `static/creation/` (R1 WebView frontend)
- Merges voice/static/pairing support into `src/channels/http.ts`
- Merges voice config into `src/config.ts`
- Installs `@fastify/static`, `@fastify/websocket`, `qrcode` npm dependencies

If the apply reports merge conflicts, read the intent files in
`.claude/skills/add-rabbit-r1/modify/` for guidance.

Update the build script in `package.json` to copy static files:

```json
"build": "tsc && cp -r static dist/"
```

Verify:

```bash
npm run build
ls dist/static/creation/index.html
```

Build must be clean and static files must exist in `dist/`.

## Phase 5: Apply Tool Events (optional)

This adds "Agent is using Bash..." progress indicators to the Creation activity
feed. It requires a container rebuild, so skip if you want faster setup.

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-tool-events
```

If applied, rebuild the container:

```bash
./container/build.sh
```

If skipped, no container rebuild is needed — the base container from Phase 1 works.

Verify:

```bash
npm run build
```

## Phase 6: Create Device Token

Create an initial device token for the R1:

```bash
npx tsx scripts/create-token.ts r1-device
```

Show the user the printed token and remind them to save it — it cannot be retrieved later.

Create additional tokens anytime with `npx tsx scripts/create-token.ts <label>`.

## Phase 7: Configure Environment

Create or update `.env` (or the environment config for your deployment):

```bash
HTTP_CHANNEL_ENABLED=true
HTTP_PORT=4080
WHATSAPP_ENABLED=false
VOICE_ENABLED=true
```

## Phase 8: HTTPS Setup

The R1 requires HTTPS for Creation WebViews and WSS for voice. Ask the user
how they want to expose NanoClaw using `AskUserQuestion`:

> **How should NanoClaw be exposed to your R1?**
>
> 1. **Cloudflare Tunnel (Recommended)** — No domain or open ports needed. Free.
> 2. **Domain + reverse proxy** — You have a domain and a VPS (Caddy, nginx, etc.)
> 3. **Other tunnel** (ngrok, Tailscale Funnel, etc.)
> 4. **Skip for now** — I'll test locally first

### Option 1: Cloudflare Tunnel

Install `cloudflared` if not present:

```bash
# Debian/Ubuntu
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb && sudo dpkg -i /tmp/cloudflared.deb

# macOS
brew install cloudflared

# Or see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

Authenticate (one-time):
```bash
cloudflared tunnel login
```

Create a named tunnel:
```bash
cloudflared tunnel create nanoclaw
```

This prints a tunnel ID and creates a credentials file. Note both.

Create the config file at `~/.cloudflared/config.yml`:

```yaml
tunnel: TUNNEL_ID
credentials-file: /home/USER/.cloudflared/TUNNEL_ID.json

ingress:
  - service: http://localhost:4080
```

Replace `TUNNEL_ID` and the credentials path with the actual values from the previous step.

Route a hostname to the tunnel. The user can either:
- **Use a Cloudflare-managed domain** they already have:
  ```bash
  cloudflared tunnel route dns nanoclaw r1.example.com
  ```
- **Use a free `trycloudflare.com` subdomain** (no domain needed, but the URL changes on restart):
  ```bash
  cloudflared tunnel --url http://localhost:4080
  ```
  This prints a URL like `https://random-words.trycloudflare.com`. Use this as the public URL.

For a persistent setup with a named tunnel, start it:
```bash
cloudflared tunnel run nanoclaw
```

Optionally install as a system service so it starts on boot:
```bash
sudo cloudflared service install
```

Record the public HTTPS URL (e.g. `https://r1.example.com` or the trycloudflare URL).

### Option 2: Domain + Reverse Proxy

The user has their own domain pointing at their server. Recommend **Caddy** for automatic
HTTPS:

```bash
# Install Caddy (Debian/Ubuntu)
sudo apt install -y caddy

# Or see https://caddyserver.com/docs/install
```

Create `/etc/caddy/Caddyfile`:

```
r1.example.com {
    reverse_proxy localhost:4080
}
```

```bash
sudo systemctl restart caddy
```

Caddy automatically provisions a Let's Encrypt certificate. Record the public URL.

### Option 3: Other Tunnel

Ask the user which tunnel service they're using and help them set it up to forward
to `localhost:4080`. The end result is an HTTPS URL. Record it.

### Option 4: Skip

Tell the user they can test locally at `http://localhost:4080` but pairing a physical
R1 will need HTTPS. They can run this phase later.

## Phase 9: Start & Verify

Start NanoClaw:

```bash
npm start
```

Do NOT attempt to test the API with curl — JSON body parsing over the Bash tool is unreliable. Instead, tell the user to open the pairing page directly.

## Phase 10: Done

Tell the user:

> NanoClaw is set up for R1.
>
> **Pair your R1:**
> Open the admin pairing page on your computer or phone:
> `https://YOUR_PUBLIC_URL/pair?token=YOUR_TOKEN`
> (Or `http://localhost:4080/pair?token=YOUR_TOKEN` for local testing.)
>
> It shows two QR codes — scan them with your R1:
> - **Creation QR** — installs the WebView UI on the R1
> - **Voice QR** — pairs push-to-talk (if VOICE_ENABLED=true)
>
> **Your device token:** `YOUR_TOKEN` — save it, it's only shown once.
> Create more tokens anytime with: `npx tsx scripts/create-token.ts <label>`
>
> **Health check:** `curl https://YOUR_PUBLIC_URL/health`
