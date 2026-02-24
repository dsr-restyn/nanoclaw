#!/usr/bin/env npx tsx
/**
 * Create an HTTP device token for NanoClaw's HTTP channel.
 *
 * Usage: npx tsx scripts/create-token.ts [label]
 *
 * The token is printed once and cannot be retrieved later.
 */
import { initDatabase, createHttpToken } from '../src/db.js';

const label = process.argv[2] || 'device';
initDatabase();
const token = createHttpToken(label);
console.log(`\nToken created (label: ${label}):\n\n  ${token}\n\nSave this — it cannot be shown again.\n`);
