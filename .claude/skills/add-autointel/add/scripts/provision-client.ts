#!/usr/bin/env npx tsx
/**
 * Provision a new autoIntel client as a NanoClaw group.
 *
 * Usage: npx tsx scripts/provision-client.ts <slug> <company-name> <primary-email> [cc-email...]
 */
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);

if (args.length < 3) {
  console.error(
    `Usage: npx tsx scripts/provision-client.ts <slug> <company-name> <primary-email> [cc-email...]\n` +
    `\n` +
    `  slug           Lowercase alphanumeric + hyphens (e.g. acme-corp)\n` +
    `  company-name   Display name for the company\n` +
    `  primary-email  Primary contact email\n` +
    `  cc-email       Additional contact emails (optional, space-separated)\n`
  );
  process.exit(1);
}

const [slug, companyName, primaryEmail, ...ccEmails] = args;

// Validate slug: lowercase alphanumeric and hyphens only
const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
if (!slugPattern.test(slug)) {
  console.error(
    `Error: Invalid slug "${slug}". Must be lowercase alphanumeric with hyphens only (e.g. acme-corp).`
  );
  process.exit(1);
}

const groupDir = path.resolve(import.meta.dirname!, '..', 'groups', slug);
const clientDir = path.join(groupDir, 'client');
const historyDir = path.join(clientDir, 'history');
const configPath = path.join(clientDir, 'config.yaml');

// Check if group already exists
if (fs.existsSync(groupDir)) {
  console.error(`Error: Group "${slug}" already exists at ${groupDir}`);
  process.exit(1);
}

// Build contacts block
const contactLines = [`  - email: ${primaryEmail}\n    role: primary`];
for (const cc of ccEmails) {
  contactLines.push(`  - email: ${cc}\n    role: cc`);
}

const timestamp = new Date().toISOString();

const configYaml = `# ${companyName} — autoIntel Client Configuration
# Created: ${timestamp}

company:
  name: ${companyName}
  industry: ""
  website: ""
  description: ""

competitors: []

contacts:
${contactLines.join('\n')}

focus_areas:
  - pricing
  - product_changes
  - hiring
  - sentiment
  - news

report_cadence:
  frequency: weekly
  day: monday
  time: "09:00"

budget:
  max_research_rounds: 15
  max_followups_per_week: 10
`;

// Create directories
fs.mkdirSync(historyDir, { recursive: true });

// Write config
fs.writeFileSync(configPath, configYaml, 'utf-8');

console.log(`\nProvisioned autoIntel client: ${companyName} (${slug})\n`);
console.log(`  Config:  ${configPath}`);
console.log(`  History: ${historyDir}\n`);
console.log(`Next steps:`);
console.log(`  1. Edit ${configPath} — fill in industry, website, description, and competitors`);
console.log(`  2. Register the group in NanoClaw (add to groups config or CLAUDE.md)`);
console.log(`  3. Create a scheduled task for report generation based on report_cadence\n`);
