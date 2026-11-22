#!/usr/bin/env node
'use strict';
/**
 * SnowyChat — entry point tunggal.
 *
 *   node index.js          → production: install dependency + build otomatis bila perlu, lalu start
 *   node index.js --dev    → development (HMR), install otomatis bila perlu
 *
 * Opsi:
 *   --no-auto | SNOWY_AUTO_SETUP=0   matikan install/build otomatis
 *   --rebuild | FORCE_BUILD=1        paksa build ulang
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = __dirname;
process.chdir(ROOT);

const args = new Set(process.argv.slice(2));
const dev = args.has('--dev');
const auto = !args.has('--no-auto') && process.env.SNOWY_AUTO_SETUP !== '0';
const forceBuild = args.has('--rebuild') || process.env.FORCE_BUILD === '1';

const log = (msg) => console.log(`❄️  [setup] ${msg}`);
const die = (msg) => {
  console.error(`❌ [setup] ${msg}`);
  process.exit(1);
};

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) die(`Node.js >= 22 diperlukan (mineflayer terbaru mensyaratkannya). Versi sekarang: ${process.versions.node}`);

const exists = (p) => fs.existsSync(path.join(ROOT, p));
const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};

function newestMtime(dir) {
  let newest = 0;
  const skip = new Set(['node_modules', '.next', '.git', 'logs']);
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, mtime(full));
    }
  };
  try {
    walk(dir);
  } catch {
    /* folder tidak ada */
  }
  return newest;
}

function run(cmd, cmdArgs) {
  const npm = process.platform === 'win32' && cmd === 'npm' ? 'npm.cmd' : cmd;
  const r = spawnSync(npm, cmdArgs, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', env: process.env });
  if (r.error) die(`Gagal menjalankan "${cmd} ${cmdArgs.join(' ')}": ${r.error.message}`);
  if (r.status !== 0) die(`"${cmd} ${cmdArgs.join(' ')}" gagal (exit ${r.status})`);
}

function ensureInstalled() {
  // Build butuh devDependencies (tailwind, typescript), jadi di production pun ikut dipasang
  // bila build akan dijalankan. Cek keduanya.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const needDev = dev || needsBuild();
  const names = [...Object.keys(pkg.dependencies || {}), ...(needDev ? Object.keys(pkg.devDependencies || {}) : [])];
  const missing = names.filter((n) => !exists(path.join('node_modules', n, 'package.json')));
  if (!missing.length) return;
  if (!auto) die(`Dependency belum terpasang (${missing.slice(0, 5).join(', ')}…). Jalankan: npm install`);
  log(`Memasang dependency (${missing.length} paket belum ada)…`);
  // Selalu sertakan devDependencies: NODE_ENV=production akan melewatinya dan membuat build gagal.
  const env = { ...process.env };
  delete env.NODE_ENV;
  const useCi = exists('package-lock.json');
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [useCi ? 'ci' : 'install', '--include=dev', '--no-audit', '--no-fund'], {
    cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', env,
  });
  if (r.status !== 0 && useCi) {
    log('npm ci gagal (lockfile tidak sinkron?), mencoba npm install…');
    run('npm', ['install', '--include=dev', '--no-audit', '--no-fund']);
  } else if (r.status !== 0) {
    die('npm install gagal');
  }
}

function needsBuild() {
  if (dev) return false;
  if (forceBuild) return true;
  const stamp = mtime(path.join(ROOT, '.next', 'BUILD_ID'));
  if (!stamp) return true;
  const sources = Math.max(
    newestMtime(path.join(ROOT, 'src')),
    newestMtime(path.join(ROOT, 'public')),
    mtime(path.join(ROOT, 'package.json')),
    mtime(path.join(ROOT, 'next.config.mjs')),
    mtime(path.join(ROOT, 'postcss.config.mjs')),
  );
  return sources > stamp;
}

ensureInstalled();

if (needsBuild()) {
  if (!auto) die('Build belum ada / sudah usang. Jalankan: npm run build');
  log('Build Next.js (production)…');
  const env = { ...process.env };
  delete env.NODE_ENV;
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', env });
  if (r.status !== 0) die('Build gagal — lihat error di atas.');
  log('Build selesai.');
}

import('./server.mjs').catch((e) => {
  console.error('❌ Gagal menjalankan server:', e);
  process.exit(1);
});
