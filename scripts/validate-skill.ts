/**
 * Validate a skill package against the clean git HEAD base.
 *
 * Checks:
 * 1. modify/ files are based on HEAD (diff only contains skill's changes)
 * 2. add/ files don't import modules missing from HEAD and not in add/ list
 * 3. Applying the skill to a fresh clone builds (npx tsc --noEmit)
 *
 * Usage: npx tsx scripts/validate-skill.ts <skill-dir>
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { parse } from 'yaml';

interface SkillManifest {
  skill: string;
  version: string;
  adds: string[];
  modifies: string[];
  depends: string[];
  structured?: {
    npm_dependencies?: Record<string, string>;
  };
  test?: string;
}

const skillDir = process.argv[2];
if (!skillDir) {
  console.error('Usage: npx tsx scripts/validate-skill.ts <skill-dir>');
  process.exit(1);
}

const projectRoot = process.cwd();
const manifestPath = path.join(skillDir, 'manifest.yaml');
if (!fs.existsSync(manifestPath)) {
  console.error(`Manifest not found: ${manifestPath}`);
  process.exit(1);
}

const manifest: SkillManifest = parse(fs.readFileSync(manifestPath, 'utf-8'));
console.log(`Validating skill: ${manifest.skill} v${manifest.version}\n`);

let hasErrors = false;

// --- Check 1: modify/ files are based on clean HEAD ---
console.log('== Check 1: modify/ files based on HEAD ==');

for (const relPath of manifest.modifies) {
  const modifyPath = path.join(skillDir, 'modify', relPath);
  if (!fs.existsSync(modifyPath)) {
    console.error(`  FAIL: ${relPath} — modify file missing`);
    hasErrors = true;
    continue;
  }

  // Get the HEAD version
  let headContent: string;
  try {
    headContent = execFileSync('git', ['show', `HEAD:${relPath}`], { encoding: 'utf-8' });
  } catch {
    console.log(`  SKIP: ${relPath} — not in HEAD (new file via dependency?)`);
    continue;
  }

  const modifyContent = fs.readFileSync(modifyPath, 'utf-8');

  // Use diff to show what changed
  const tmpHead = path.join(os.tmpdir(), `validate-head-${path.basename(relPath)}`);
  const tmpModify = path.join(os.tmpdir(), `validate-modify-${path.basename(relPath)}`);
  fs.writeFileSync(tmpHead, headContent);
  fs.writeFileSync(tmpModify, modifyContent);

  try {
    execFileSync('diff', ['-u', tmpHead, tmpModify], { encoding: 'utf-8' });
    console.log(`  OK: ${relPath} — identical to HEAD (no changes?)`);
  } catch (err: any) {
    const diff = err.stdout as string;
    const addedLines = diff.split('\n').filter((l: string) => l.startsWith('+') && !l.startsWith('+++'));
    const removedLines = diff.split('\n').filter((l: string) => l.startsWith('-') && !l.startsWith('---'));

    if (removedLines.length > 0) {
      const intentPath = path.join(skillDir, 'modify', `${relPath}.intent.md`);
      const hasIntent = fs.existsSync(intentPath);
      console.log(`  INFO: ${relPath} — ${addedLines.length} added, ${removedLines.length} removed${hasIntent ? ' (intent file exists)' : ' (NO intent file!)'}`);
      if (!hasIntent) {
        hasErrors = true;
        console.error(`    WARN: No intent file to document removed lines`);
      }
    } else {
      console.log(`  OK: ${relPath} — ${addedLines.length} lines added (additive only)`);
    }
  }

  fs.unlinkSync(tmpHead);
  fs.unlinkSync(tmpModify);
}

// --- Check 2: add/ files don't import missing modules ---
console.log('\n== Check 2: add/ file imports ==');

const headFiles = new Set<string>();
try {
  const gitFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf-8' });
  for (const f of gitFiles.trim().split('\n')) {
    headFiles.add(f);
  }
} catch {
  console.error('  FAIL: Could not list HEAD files');
  hasErrors = true;
}

const skillAdds = new Set(manifest.adds);

for (const relPath of manifest.adds) {
  const addPath = path.join(skillDir, 'add', relPath);
  if (!fs.existsSync(addPath)) {
    console.error(`  FAIL: ${relPath} — add file missing`);
    hasErrors = true;
    continue;
  }

  if (!relPath.endsWith('.ts') && !relPath.endsWith('.tsx')) continue;

  const content = fs.readFileSync(addPath, 'utf-8');
  const importMatches = content.matchAll(/from\s+['"](\.[^'"]+)['"]/g);
  let fileOk = true;

  for (const match of importMatches) {
    const importPath = match[1];
    const fileDir = path.dirname(relPath);
    let resolved = path.normalize(path.join(fileDir, importPath));
    resolved = resolved.replace(/\.js$/, '.ts');

    if (!headFiles.has(resolved) && !skillAdds.has(resolved)) {
      const asIndex = `${resolved.replace(/\.ts$/, '')}/index.ts`;
      if (!headFiles.has(asIndex) && !skillAdds.has(asIndex)) {
        console.error(`  FAIL: ${relPath} imports '${match[1]}' → ${resolved} (not in HEAD or add/ list)`);
        hasErrors = true;
        fileOk = false;
      }
    }
  }

  if (fileOk) {
    console.log(`  OK: ${relPath} — all imports resolve`);
  }
}

// --- Check 3: Build test in temp clone ---
console.log('\n== Check 3: Build test (fresh clone + skill) ==');

const tmpDir = path.join(os.tmpdir(), `validate-skill-${manifest.skill}-${Date.now()}`);

try {
  execFileSync('git', ['clone', '--quiet', projectRoot, tmpDir], { stdio: 'pipe' });

  execFileSync('npm', ['install', '--silent'], {
    cwd: tmpDir,
    stdio: 'pipe',
    timeout: 60_000,
  });

  // Install skill's npm dependencies
  if (manifest.structured?.npm_dependencies) {
    const deps = Object.entries(manifest.structured.npm_dependencies)
      .map(([name, version]) => `${name}@${version}`);
    if (deps.length > 0) {
      execFileSync('npm', ['install', '--silent', ...deps], {
        cwd: tmpDir,
        stdio: 'pipe',
        timeout: 60_000,
      });
    }
  }

  // Copy add/ files
  for (const relPath of manifest.adds) {
    const src = path.join(skillDir, 'add', relPath);
    const dest = path.join(tmpDir, relPath);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  // Copy modify/ files (direct overwrite — simulates skill as only one applied)
  for (const relPath of manifest.modifies) {
    const src = path.join(skillDir, 'modify', relPath);
    const dest = path.join(tmpDir, relPath);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  // Type-check
  execFileSync('npx', ['tsc', '--noEmit'], {
    cwd: tmpDir,
    encoding: 'utf-8',
    timeout: 120_000,
    stdio: 'pipe',
  });
  console.log('  OK: Build passes');
} catch (err: any) {
  const output = err.stdout || err.stderr || err.message;
  console.error(`  FAIL: Build errors:\n${output}`);
  hasErrors = true;
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* best effort */ }
}

// --- Summary ---
console.log('\n' + '='.repeat(40));
if (hasErrors) {
  console.error(`VALIDATION FAILED for ${manifest.skill}`);
  process.exit(1);
} else {
  console.log(`VALIDATION PASSED for ${manifest.skill}`);
}
