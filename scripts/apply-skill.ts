import { applySkill } from '../skills-engine/apply.js';
import { initNanoclawDir } from '../skills-engine/init.js';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: tsx scripts/apply-skill.ts [--init | <skill-dir>]');
  process.exit(1);
}

if (arg === '--init') {
  initNanoclawDir();
  console.log('Skills system initialized (.nanoclaw/base/ snapshot created)');
  process.exit(0);
}

const result = await applySkill(arg);
console.log(JSON.stringify(result, null, 2));

if (!result.success) {
  process.exit(1);
}
