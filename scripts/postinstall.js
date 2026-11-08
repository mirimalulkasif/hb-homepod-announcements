#!/usr/bin/env node
'use strict';

/**
 * Install a private pyatv venv under vendor/ so atvremote is always on a path
 * the Homebridge process can see — no system-wide pip/symlink required.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const vendor = path.join(root, 'vendor');
const venv = path.join(vendor, 'pyatv');
const atvremote = path.join(
  venv,
  process.platform === 'win32' ? 'Scripts/atvremote.exe' : 'bin/atvremote',
);

function log(message) {
  console.log(`[homebridge-homepod-announcements] ${message}`);
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    encoding: 'utf8',
    ...opts,
  });
  return result.status === 0;
}

function findPython() {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) {
      return candidate;
    }
  }
  return null;
}

if (process.env.HB_ANNOUNCE_SKIP_PYATV === '1') {
  log('Skipping pyatv vendor install (HB_ANNOUNCE_SKIP_PYATV=1)');
  process.exit(0);
}

if (fs.existsSync(atvremote)) {
  log(`pyatv already present: ${atvremote}`);
  process.exit(0);
}

const python = findPython();
if (!python) {
  log('WARNING: python3 not found — install python3 so AirPlay playback can be set up, or install homebridge-homepod-radio.');
  process.exit(0);
}

fs.mkdirSync(vendor, { recursive: true });
log(`Creating pyatv venv at ${venv}`);
if (!run(python, ['-m', 'venv', venv])) {
  log('WARNING: could not create venv. Try: sudo apt install python3-venv');
  process.exit(0);
}

const pip = path.join(venv, process.platform === 'win32' ? 'Scripts/pip.exe' : 'bin/pip');
log('Installing pyatv into vendor venv…');
if (!run(pip, ['install', '--upgrade', 'pip', 'pyatv'])) {
  log('WARNING: pyatv install failed. Playback may need homebridge-homepod-radio instead.');
  process.exit(0);
}

if (fs.existsSync(atvremote)) {
  log(`Ready: ${atvremote}`);
} else {
  log('WARNING: atvremote missing after install');
}
