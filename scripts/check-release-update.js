#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import process from 'node:process';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeReleaseInfo(pkg, release) {
  const summary = Array.isArray(release?.summary)
    ? release.summary.map((item) => String(item).trim()).filter(Boolean)
    : [];

  return {
    version: String(release?.version || pkg?.version || 'unknown').trim() || 'unknown',
    date: typeof release?.date === 'string' ? release.date.trim() : '',
    forceUpdate: Boolean(release?.forceUpdate),
    summary,
    message: typeof release?.message === 'string' ? release.message.trim() : '',
  };
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: projectDir,
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    code: result.status ?? -1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function readRemoteJson(ref, relativePath) {
  const result = runGit(['show', `${ref}:${relativePath}`]);
  if (!result.ok) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function getTrackedDirtyStatus() {
  const result = runGit(['status', '--porcelain', '--untracked-files=no']);
  if (!result.ok) return false;
  return result.stdout.trim().length > 0;
}

function parseAheadBehind(raw) {
  const [left = '0', right = '0'] = raw.trim().split(/\s+/);
  const localAhead = Number.parseInt(left, 10);
  const remoteAhead = Number.parseInt(right, 10);
  return {
    localAhead: Number.isFinite(localAhead) ? localAhead : 0,
    remoteAhead: Number.isFinite(remoteAhead) ? remoteAhead : 0,
  };
}

const localPkg = readJsonFile(path.join(projectDir, 'package.json'));
const localRelease = readJsonFile(path.join(projectDir, 'release-info.json'));

const payload = {
  status: 'unknown',
  projectDir,
  local: normalizeReleaseInfo(localPkg, localRelease),
  remote: null,
  git: {
    enabled: false,
    upstream: '',
    remoteName: '',
    localAhead: 0,
    remoteAhead: 0,
    dirtyTracked: false,
    canPromptUpdate: false,
    canAutoUpdate: false,
  },
};

const gitRepo = runGit(['rev-parse', '--is-inside-work-tree']);
if (!gitRepo.ok || gitRepo.stdout.trim() !== 'true') {
  payload.status = 'not-git';
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const upstreamRes = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
if (!upstreamRes.ok) {
  payload.status = 'no-upstream';
  payload.git.enabled = true;
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const upstream = upstreamRes.stdout.trim();
const remoteName = upstream.includes('/') ? upstream.split('/')[0] : 'origin';

payload.git.enabled = true;
payload.git.upstream = upstream;
payload.git.remoteName = remoteName;
payload.git.dirtyTracked = getTrackedDirtyStatus();

const fetchRes = runGit(['fetch', '--quiet', remoteName]);
if (!fetchRes.ok) {
  payload.status = 'fetch-failed';
  payload.git.fetchError = (fetchRes.stderr || fetchRes.stdout).trim();
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const countsRes = runGit(['rev-list', '--left-right', '--count', `HEAD...${upstream}`]);
if (!countsRes.ok) {
  payload.status = 'compare-failed';
  payload.git.compareError = (countsRes.stderr || countsRes.stdout).trim();
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const { localAhead, remoteAhead } = parseAheadBehind(countsRes.stdout);
payload.git.localAhead = localAhead;
payload.git.remoteAhead = remoteAhead;
payload.git.canPromptUpdate = localAhead === 0 && remoteAhead > 0;
payload.git.canAutoUpdate = payload.git.canPromptUpdate && !payload.git.dirtyTracked;

const remotePkg = readRemoteJson(upstream, 'package.json');
const remoteRelease = readRemoteJson(upstream, 'release-info.json');
payload.remote = normalizeReleaseInfo(remotePkg, remoteRelease);

if (localAhead === 0 && remoteAhead === 0) {
  payload.status = 'up-to-date';
} else if (localAhead === 0 && remoteAhead > 0) {
  payload.status = 'remote-ahead';
} else if (localAhead > 0 && remoteAhead === 0) {
  payload.status = 'local-ahead';
} else {
  payload.status = 'diverged';
}

console.log(JSON.stringify(payload, null, 2));
