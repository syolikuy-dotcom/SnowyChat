#!/usr/bin/env node
// Cek / update semua dependency ke versi terbaru dari registry npm (butuh internet).
//   npm run deps:check    → tabel versi terpasang vs terbaru (+ info versi Minecraft yang didukung mineflayer)
//   npm run deps:update   → npm install <pkg>@latest untuk SEMUA dependency, lalu verifikasi (lint/typecheck/test/build)
//   npm run deps:update -- --no-verify   → lewati verifikasi
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shell = process.platform === 'win32';
const mode = process.argv[2] || 'check';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const groups = { dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} };

function latest(name) {
  const r = spawnSync(npm, ['view', name, 'version'], { encoding: 'utf8', shell });
  return r.status === 0 ? r.stdout.trim() : null;
}
function installed(name) {
  try {
    return JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')).version;
  } catch {
    return null;
  }
}

if (mode === 'check') {
  let outdated = 0;
  console.log('PACKAGE'.padEnd(28), 'RANGE'.padEnd(18), 'INSTALLED'.padEnd(12), 'LATEST');
  for (const [group, deps] of Object.entries(groups)) {
    for (const [name, range] of Object.entries(deps)) {
      const cur = installed(name);
      const lat = latest(name);
      const flag = lat && cur && cur !== lat ? '  ⬆' : '';
      if (flag) outdated++;
      console.log(name.padEnd(28), String(range).padEnd(18), String(cur ?? '-').padEnd(12), `${lat ?? '?'}${flag}`, group === 'devDependencies' ? '(dev)' : '');
    }
  }
  try {
    const mf = createRequire(import.meta.url)('mineflayer');
    const v = mf.testedVersions || mf.supportedVersions;
    if (v) console.log(`\nmineflayer mendukung Minecraft: ${v[0]} … ${v[v.length - 1]}`);
  } catch {
    /* belum terpasang */
  }
  console.log(outdated ? `\n${outdated} paket punya versi lebih baru. Jalankan: npm run deps:update` : '\nSemua dependency sudah terbaru.');
  process.exit(0);
}

if (mode === 'update') {
  for (const [group, deps] of Object.entries(groups)) {
    const names = Object.keys(deps).map((n) => `${n}@latest`);
    if (!names.length) continue;
    console.log(`\n⬆ Update ${group}: ${names.join(' ')}`);
    const r = spawnSync(npm, ['install', group === 'devDependencies' ? '--save-dev' : '--save', ...names, '--include=dev', '--no-audit', '--no-fund'], { stdio: 'inherit', shell });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  if (!process.argv.includes('--no-verify')) {
    console.log('\n✔ Verifikasi (lint, typecheck, test, build)…');
    const v = spawnSync(npm, ['run', 'verify'], { stdio: 'inherit', shell });
    process.exit(v.status ?? 1);
  }
  process.exit(0);
}

console.error('Pemakaian: node scripts/deps.mjs [check|update]');
process.exit(1);
