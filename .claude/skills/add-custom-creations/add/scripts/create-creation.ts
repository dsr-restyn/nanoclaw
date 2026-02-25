#!/usr/bin/env npx tsx
/**
 * Scaffold a new R1 Creation from the template.
 *
 * Usage: npx tsx scripts/create-creation.ts <slug> [description]
 *
 * Examples:
 *   npx tsx scripts/create-creation.ts alpaca-dashboard
 *   npx tsx scripts/create-creation.ts weather-widget "Live weather data"
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const TEMPLATE_DIR = path.join(ROOT, 'static', '_creation-template');

function die(msg: string): never {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

/** Validate slug: lowercase letters, numbers, hyphens; min 3 chars. */
function validateSlug(slug: string): void {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    die(
      `Invalid slug "${slug}". Use only lowercase letters, numbers, and hyphens.`,
    );
  }
  if (slug.length < 3) {
    die(`Slug must be at least 3 characters (got "${slug}").`);
  }
  if (slug.startsWith('-') || slug.endsWith('-')) {
    die(`Slug must not start or end with a hyphen.`);
  }
}

/** Convert "alpaca-dashboard" to "Alpaca Dashboard". */
function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Recursively copy a directory, skipping files that match `skip`.
 * Creates parent directories as needed.
 */
function copyDir(
  src: string,
  dest: string,
  skip: (name: string) => boolean,
): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, skip);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const slug = process.argv[2];
  const description = process.argv[3] || 'Custom R1 Creation';

  if (!slug) {
    die('Usage: npx tsx scripts/create-creation.ts <slug> [description]');
  }

  validateSlug(slug);

  // Paths
  const staticDir = path.join(ROOT, 'static', slug);
  const groupDir = path.join(ROOT, 'groups', slug);

  // Guard against overwriting
  if (fs.existsSync(staticDir)) {
    die(`static/${slug}/ already exists. Pick a different slug.`);
  }
  if (fs.existsSync(groupDir)) {
    die(`groups/${slug}/ already exists. Pick a different slug.`);
  }

  // Verify template exists
  if (!fs.existsSync(TEMPLATE_DIR)) {
    die(
      `Template directory not found at ${TEMPLATE_DIR}. Run the skill setup first.`,
    );
  }

  const name = titleCase(slug);

  // 1. Copy template (skip the .template manifest)
  copyDir(TEMPLATE_DIR, staticDir, (f) => f === 'creation.json.template');

  // 2. Write creation.json manifest
  const manifest = {
    name,
    slug,
    group: slug,
    description,
    themeColor: '#00ff00',
  };
  fs.writeFileSync(
    path.join(staticDir, 'creation.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );

  // 3. Create group CLAUDE.md
  fs.mkdirSync(groupDir, { recursive: true });
  const claudeMd = `# ${name}

You power the **${name}** R1 Creation — a 240x282 WebView dashboard.

## Behavior

- When you receive "refresh", respond with the current data for the dashboard.
- Keep every response under 500 characters.
- Use abbreviated formats; do NOT use markdown.
- On errors, reply with: ERR: <brief description>
`;
  fs.writeFileSync(path.join(groupDir, 'CLAUDE.md'), claudeMd);

  // 4. Summary
  console.log(`
Creation scaffolded successfully!

  static/${slug}/          — front-end files (HTML, CSS, JS)
  static/${slug}/creation.json — manifest
  groups/${slug}/CLAUDE.md     — agent instructions

Next steps:
  1. Edit groups/${slug}/CLAUDE.md to tell the agent what data to return
  2. Edit static/${slug}/js/app.js to customize the dashboard render
  3. Rebuild: npm run build
  4. Restart NanoClaw (the HTTP channel auto-discovers new Creations)
`);
}

main();
