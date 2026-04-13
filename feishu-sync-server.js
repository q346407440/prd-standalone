import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseListPrefix } from './src/features/prd/editor/prd-list-utils.js';
import {
  expandParagraphBlocksOnBlankLines,
  normalizeLegacyBlocks,
} from './src/features/prd/editor/prd-block-operations.js';
import { parsePrd } from './src/features/prd/editor/prd-parser.js';

const FEISHU_AUTH_STATUS_API = '/__prd__/feishu/auth/status';
const FEISHU_AUTH_START_API = '/__prd__/feishu/auth/start';
const FEISHU_AUTH_CALLBACK_API = '/__prd__/feishu/auth/callback';
const FEISHU_AUTH_LOGOUT_API = '/__prd__/feishu/auth/logout';
const FEISHU_SYNC_START_API = '/__prd__/feishu/sync/start';
const FEISHU_SYNC_JOB_API_PREFIX = '/__prd__/feishu/sync/jobs/';

const FEISHU_AUTHORIZE_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
const FEISHU_USER_INFO_URL = 'https://open.feishu.cn/open-apis/authen/v1/user_info';
const FEISHU_DOCX_BASE_URL = 'https://open.feishu.cn/open-apis/docx/v1';
const FEISHU_WIKI_BASE_URL = 'https://open.feishu.cn/open-apis/wiki/v2';
const FEISHU_BOARD_BASE_URL = 'https://open.feishu.cn/open-apis/board/v1';
const FEISHU_DRIVE_UPLOAD_URL = 'https://open.feishu.cn/open-apis/drive/v1/medias/upload_all';

const FEISHU_OAUTH_SCOPES = [
  'offline_access',
  'contact:user.base:readonly',
  'docx:document',
  'wiki:wiki:readonly',
  'board:whiteboard:node:create',
  'board:whiteboard:node:read',
  'docs:document.media:upload',
];

const BLOCK_TYPE_TEXT = 2;
const BLOCK_TYPE_BULLET = 12;
const BLOCK_TYPE_ORDERED = 13;
const BLOCK_TYPE_CODE = 14;
const BLOCK_TYPE_DIVIDER = 22;
const BLOCK_TYPE_IMAGE = 27;
const BLOCK_TYPE_TABLE = 31;
const BLOCK_TYPE_TABLE_CELL = 32;
const BLOCK_TYPE_BOARD = 43;

const IMAGE_WIDTH_DEFAULT = 560;
const TABLE_PAGE_WIDTH_WIDER = 1020;
const BOARD_WIDTH_DEFAULT = 760;
const BOARD_HEIGHT_DEFAULT = 420;
const BOARD_HEIGHT_MINDMAP = 520;
const EMPTY_TEXT_PLACEHOLDER = ' ';

const MAX_LINEAR_BLOCKS_PER_REQUEST = 50;
const JOB_TTL_MS = 1000 * 60 * 60 * 6;
const AUTH_STATE_TTL_MS = 1000 * 60 * 10;
const ACCESS_TOKEN_SKEW_MS = 1000 * 60;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRateLimiter(ratePerSecond) {
  let tail = Promise.resolve();
  let nextSlotAt = 0;
  const intervalMs = Math.ceil(1000 / ratePerSecond);

  return function schedule(task) {
    const runner = async () => {
      const now = Date.now();
      const waitMs = Math.max(0, nextSlotAt - now);
      nextSlotAt = Math.max(nextSlotAt, now) + intervalMs;
      if (waitMs > 0) await sleep(waitMs);
      return task();
    };
    const result = tail.then(runner, runner);
    tail = result.catch(() => {});
    return result;
  };
}

function createServerState({ rootDir, publicDir }) {
  const localDir = path.join(rootDir, '.local');
  return {
    rootDir,
    publicDir,
    localDir,
    authFilePath: path.join(localDir, 'feishu-auth.json'),
    imageCacheFilePath: path.join(localDir, 'feishu-image-cache.json'),
    pendingAuthStates: new Map(),
    jobs: new Map(),
    docxLimiter: createRateLimiter(3),
    boardLimiter: createRateLimiter(5),
    uploadLimiter: createRateLimiter(5),
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function removeFileIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    return;
  }
}

function buildFeishuConfig() {
  const appId = process.env.FEISHU_APP_ID || '';
  const appSecret = process.env.FEISHU_APP_SECRET || '';
  const baseUrl = (process.env.FEISHU_BASE_URL || 'http://127.0.0.1:6001').replace(/\/+$/, '');
  const redirectUri = process.env.FEISHU_REDIRECT_URI || `${baseUrl}${FEISHU_AUTH_CALLBACK_API}`;
  return {
    appId,
    appSecret,
    baseUrl,
    redirectUri,
    scopes: FEISHU_OAUTH_SCOPES,
    configured: Boolean(appId && appSecret && redirectUri),
  };
}

function loadStoredAuth(state) {
  return readJsonFile(state.authFilePath, null);
}

function saveStoredAuth(state, auth) {
  writeJsonFile(state.authFilePath, auth);
}

function clearStoredAuth(state) {
  removeFileIfExists(state.authFilePath);
}

function buildAuthStatusPayload(config, auth) {
  return {
    configured: config.configured,
    redirectUri: config.redirectUri,
    requiredEnv: ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_BASE_URL'],
    scope: config.scopes,
    authenticated: Boolean(auth?.accessToken),
    user: auth?.user || null,
    tokenInfo: auth
      ? {
          expiresAt: auth.expiresAt || null,
          refreshExpiresAt: auth.refreshExpiresAt || null,
          scope: auth.scope || [],
        }
      : null,
  };
}

function cleanupPendingStates(state) {
  const now = Date.now();
  for (const [key, createdAt] of state.pendingAuthStates.entries()) {
    if (now - createdAt > AUTH_STATE_TTL_MS) state.pendingAuthStates.delete(key);
  }
}

function cleanupJobs(state) {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [jobId, job] of state.jobs.entries()) {
    if (new Date(job.updatedAt).getTime() < cutoff) state.jobs.delete(jobId);
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

function decodePathname(url) {
  return decodeURIComponent(String(url || '').split('?')[0]);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function requestFeishuJson(url, options = {}, { retries = 3, retryDelayMs = 500 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const error = new Error(payload?.msg || payload?.message || `HTTP ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        if (retryable && attempt < retries - 1) {
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }
        throw error;
      }
      if (payload && typeof payload.code === 'number' && payload.code !== 0) {
        const retryable = payload.code === 99991400 || payload.code === 1254290;
        const error = new Error(payload.msg || `Feishu error ${payload.code}`);
        error.code = payload.code;
        error.payload = payload;
        if (retryable && attempt < retries - 1) {
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }
        // eslint-disable-next-line no-console
        console.error('[feishu-api-error]', url, 'code:', payload.code, 'msg:', payload.msg, JSON.stringify(payload).slice(0, 800));
        // 把详细错误写到日志文件，便于调试
        try {
          const logEntry = `${nowIso()} [feishu-api-error] url=${url} code=${payload.code} msg=${payload.msg}\n${JSON.stringify(payload)}\n\n`;
          fs.appendFileSync(path.join(process.cwd(), '.local', 'feishu-error.log'), logEntry, 'utf-8');
        } catch { /* ignore log write errors */ }
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
    }
  }
  throw lastError || new Error('飞书请求失败');
}

async function requestFeishuForm(url, form, accessToken, { retries = 3, retryDelayMs = 500 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const error = new Error(payload?.msg || payload?.message || `HTTP ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        if (retryable && attempt < retries - 1) {
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }
        throw error;
      }
      if (payload && typeof payload.code === 'number' && payload.code !== 0) {
        const retryable = payload.code === 99991400 || payload.code === 1254290;
        const error = new Error(payload.msg || `Feishu error ${payload.code}`);
        error.code = payload.code;
        error.payload = payload;
        if (retryable && attempt < retries - 1) {
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
    }
  }
  throw lastError || new Error('飞书上传失败');
}

async function exchangeOAuthToken(config, body) {
  return requestFeishuJson(FEISHU_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
}

async function fetchFeishuUserInfo(accessToken) {
  try {
    const payload = await requestFeishuJson(FEISHU_USER_INFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = payload.data || {};
    return {
      openId: data.open_id || '',
      unionId: data.union_id || '',
      userId: data.user_id || '',
      name: data.name || data.en_name || '飞书用户',
      avatarUrl: data.avatar_url || '',
      email: data.email || '',
    };
  } catch {
    return null;
  }
}

function toIsoFromNowSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function persistTokenGrant(state, config, tokenPayload) {
  // authen/v2/oauth/token 响应字段直接在顶层，无 .data 包裹
  const data = tokenPayload.data ?? tokenPayload;
  const accessToken = data.access_token;
  if (!accessToken) throw new Error('授权返回中缺少 access_token');
  const user = await fetchFeishuUserInfo(accessToken);
  const auth = {
    accessToken,
    refreshToken: data.refresh_token || '',
    expiresAt: toIsoFromNowSeconds(data.expires_in),
    refreshExpiresAt: toIsoFromNowSeconds(data.refresh_token_expires_in),
    scope: String(data.scope || '').split(/\s+/).filter(Boolean),
    tokenType: data.token_type || 'Bearer',
    user,
    updatedAt: nowIso(),
    appId: config.appId,
  };
  saveStoredAuth(state, auth);
  return auth;
}

async function ensureValidAccessToken(state, config) {
  if (!config.configured) throw new Error('飞书环境变量未配置');
  const auth = loadStoredAuth(state);
  if (!auth?.accessToken) throw new Error('请先完成飞书授权');
  if (auth.expiresAt) {
    const expiresAtMs = new Date(auth.expiresAt).getTime();
    if (Number.isFinite(expiresAtMs) && expiresAtMs - ACCESS_TOKEN_SKEW_MS > Date.now()) {
      return auth;
    }
  }
  if (!auth.refreshToken) throw new Error('飞书授权已过期，请重新授权');
  const tokenPayload = await exchangeOAuthToken(config, {
    grant_type: 'refresh_token',
    client_id: config.appId,
    client_secret: config.appSecret,
    refresh_token: auth.refreshToken,
  });
  return persistTokenGrant(state, config, tokenPayload);
}

function createJob(state, payload) {
  cleanupJobs(state);
  const job = {
    id: crypto.randomUUID(),
    status: 'queued',
    percent: 0,
    phase: 'queued',
    message: '等待开始',
    error: '',
    result: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    payload,
  };
  state.jobs.set(job.id, job);
  return job;
}

function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: nowIso() });
}

function sanitizeFileName(name, fallback) {
  const cleaned = String(name || '')
    .trim()
    .replace(/[^\x20-\x7E]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

async function resolveImageSourceBuffer(src, state) {
  if (!src) throw new Error('图片路径为空');
  if (/^data:/i.test(src)) {
    const match = src.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) throw new Error('不支持的 data URL');
    return {
      buffer: Buffer.from(match[2], 'base64'),
      fileName: `image-${Date.now()}.png`,
      mimeType: match[1],
    };
  }
  if (/^https?:\/\//i.test(src)) {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`下载远程图片失败：${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const url = new URL(src);
    return {
      buffer: Buffer.from(arrayBuffer),
      fileName: sanitizeFileName(path.basename(url.pathname), `remote-${Date.now()}.png`),
      mimeType: response.headers.get('content-type') || 'application/octet-stream',
    };
  }
  const relative = src.startsWith('/') ? src.slice(1) : src;
  const absolutePath = path.join(state.publicDir, relative);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`本地图片不存在：${src}`);
  }
  return {
    buffer: fs.readFileSync(absolutePath),
    fileName: sanitizeFileName(path.basename(absolutePath), `local-${Date.now()}.png`),
    mimeType: detectMimeType(absolutePath),
  };
}

// ─── 增量同步：签名 & diff ─────────────────────────────────────────────────

function blockSignature(block) {
  return crypto.createHash('md5')
    .update(`${block?.type || ''}:${JSON.stringify(block?.content ?? null)}`)
    .digest('hex');
}

function computeBlockSignatures(blocks) {
  return (blocks || []).map(blockSignature);
}

/**
 * 头尾匹配 diff：找出 oldSigs → newSigs 之间的差异区间。
 * 返回 { headMatch, tailMatch, oldRange: [start, end), newRange: [start, end) }
 * 如果 oldRange 长度为 0 且 newRange 长度为 0，则完全相同。
 */
function diffSignatures(oldSigs, newSigs) {
  let headMatch = 0;
  const minLen = Math.min(oldSigs.length, newSigs.length);
  while (headMatch < minLen && oldSigs[headMatch] === newSigs[headMatch]) {
    headMatch += 1;
  }
  let tailMatch = 0;
  while (
    tailMatch < minLen - headMatch
    && oldSigs[oldSigs.length - 1 - tailMatch] === newSigs[newSigs.length - 1 - tailMatch]
  ) {
    tailMatch += 1;
  }
  return {
    headMatch,
    tailMatch,
    oldStart: headMatch,
    oldEnd: oldSigs.length - tailMatch,
    newStart: headMatch,
    newEnd: newSigs.length - tailMatch,
  };
}

// ─── 增量同步：快照持久化 ──────────────────────────────────────────────────

function snapshotFilePath(state) {
  return path.join(state.localDir, 'feishu-sync-snapshot.json');
}

function loadSnapshot(state, documentId) {
  const data = readJsonFile(snapshotFilePath(state), null);
  if (!data || data.documentId !== documentId) return null;
  if (!Array.isArray(data.signatures) || !Array.isArray(data.feishuRootBlockIds)) return null;
  return data;
}

function saveSnapshot(state, snapshot) {
  writeJsonFile(snapshotFilePath(state), snapshot);
}

/**
 * 回读飞书文档当前根子块 block_id 列表（合并分页）
 */
async function fetchRootBlockIds(state, accessToken, documentId) {
  const allIds = [];
  let pageToken = '';
  do {
    const data = await docxGetChildren(state, accessToken, documentId, documentId, pageToken);
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      allIds.push(item.block_id);
    }
    pageToken = data.has_more ? (data.page_token || '') : '';
  } while (pageToken);
  return allIds;
}

/** 统计 PRD 中出现的图片引用次数（含表格内重复），用于同步进度加权 */
function countAllImageReferences(blocks) {
  let n = 0;
  for (const block of blocks || []) {
    if (block?.type === 'paragraph' && block?.content?.type === 'image' && block.content.src) {
      n += 1;
    }
    if (block?.type !== 'table') continue;
    for (const row of block?.content?.rows || []) {
      for (const cell of row || []) {
        for (const element of cell?.elements || []) {
          if (element?.type === 'image' && element.src) n += 1;
        }
      }
    }
  }
  return n;
}

/** 同步工作量单位：每个根层 block 计 1，每张图片再计 1（与写入时 upload 次数一致） */
function computeTotalWorkUnits(blocks) {
  const arr = blocks || [];
  return arr.length + countAllImageReferences(arr);
}

/**
 * 将 markdown inline 格式解析为飞书 text_run elements 数组。
 * 支持：**bold**、*italic*、~~strikethrough~~、`inline_code`、[link](url)
 */
function parseMarkdownToElements(markdown) {
  const text = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/^>\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return [{ text_run: { content: EMPTY_TEXT_PLACEHOLDER } }];

  const elements = [];
  // tokenize: **bold**, ~~strike~~, `code`, [text](url), *italic*, plain
  const pattern = /(\*\*(?:[^*]|\*(?!\*))+\*\*|~~[^~]+~~|`[^`]+`|\[[^\]]+]\([^)]+\)|\*(?:[^*])+\*)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index > lastIndex) {
      elements.push({ text_run: { content: text.slice(lastIndex, match.index) } });
    }
    const raw = match[0];
    if (raw.startsWith('**') && raw.endsWith('**')) {
      const inner = raw.slice(2, -2);
      if (inner) {
        elements.push({
          text_run: {
            content: inner,
            text_element_style: { bold: true },
          },
        });
      }
    } else if (raw.startsWith('~~') && raw.endsWith('~~')) {
      const inner = raw.slice(2, -2);
      if (inner) {
        elements.push({
          text_run: {
            content: inner,
            text_element_style: { strikethrough: true },
          },
        });
      }
    } else if (raw.startsWith('`') && raw.endsWith('`')) {
      const inner = raw.slice(1, -1);
      if (inner) {
        elements.push({
          text_run: {
            content: inner,
            text_element_style: { inline_code: true },
          },
        });
      }
    } else if (raw.startsWith('[')) {
      const linkMatch = raw.match(/^\[([^\]]+)]\(([^)]+)\)$/);
      if (linkMatch) {
        elements.push({
          text_run: {
            content: linkMatch[1],
            text_element_style: { link: { url: encodeURI(linkMatch[2]) } },
          },
        });
      } else {
        elements.push({ text_run: { content: raw } });
      }
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      const inner = raw.slice(1, -1);
      if (inner) {
        elements.push({
          text_run: {
            content: inner,
            text_element_style: { italic: true },
          },
        });
      }
    }
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) {
    elements.push({ text_run: { content: text.slice(lastIndex) } });
  }

  return elements.length ? elements : [{ text_run: { content: EMPTY_TEXT_PLACEHOLDER } }];
}

function buildTextEntity(markdown) {
  return { elements: parseMarkdownToElements(markdown) };
}

function buildTextBlock(blockType, markdown) {
  const key = getBlockDataKey(blockType);
  return {
    block_type: blockType,
    [key]: buildTextEntity(markdown),
  };
}

function getBlockDataKey(blockType) {
  if (blockType >= 3 && blockType <= 11) return `heading${blockType - 2}`;
  if (blockType === BLOCK_TYPE_BULLET) return 'bullet';
  if (blockType === BLOCK_TYPE_ORDERED) return 'ordered';
  if (blockType === BLOCK_TYPE_CODE) return 'code';
  if (blockType === BLOCK_TYPE_TEXT) return 'text';
  throw new Error(`未知文本块类型：${blockType}`);
}

function convertMarkdownToDocxBlocks(markdown, preferredType = BLOCK_TYPE_TEXT) {
  // 只做 trimEnd，保留行首缩进空格（列表子级缩进依赖此空格）
  const normalized = String(markdown || '').replace(/\r\n/g, '\n').trimEnd();
  if (!normalized.trim()) return [buildTextBlock(preferredType, '')];
  const isHeading = preferredType >= 3 && preferredType <= 11;
  if (isHeading) return [buildTextBlock(preferredType, normalized.trim())];

  const lines = normalized.split('\n').map((line) => line.replace(/\s+$/g, ''));
  const nonEmpty = lines.filter((line) => line.trim());
  const isListOnly = nonEmpty.length > 0 && nonEmpty.every((line) => parseListPrefix(line));
  if (isListOnly) {
    return nonEmpty.map((line) => convertLineToBlock(line));
  }
  const hasList = nonEmpty.some((line) => parseListPrefix(line));
  const isMultiLine = nonEmpty.length > 1;
  if (hasList || isMultiLine) {
    return nonEmpty.map((line) => convertLineToBlock(line));
  }
  return [buildTextBlock(preferredType, normalized.trimEnd())];
}

function convertLineToBlock(line) {
  const parsed = parseListPrefix(line);
  if (parsed) {
    const isBullet = /^[-*+]$/.test(parsed.marker);
    const blockType = isBullet ? BLOCK_TYPE_BULLET : BLOCK_TYPE_ORDERED;
    const block = buildTextBlock(blockType, parsed.body || '');
    const indentLevel = parsed.indent ? Math.floor(parsed.indent.length / 2) : 0;
    if (indentLevel > 0) block._indentLevel = indentLevel;
    return block;
  }
  return buildTextBlock(BLOCK_TYPE_TEXT, line);
}

function createDocxImagePlaceholder(src) {
  return {
    block_type: BLOCK_TYPE_IMAGE,
    image: {},
    _imageSrc: src,
  };
}

function createDividerBlock() {
  return {
    block_type: BLOCK_TYPE_DIVIDER,
    divider: {},
  };
}

function inferHeadingBlockType(type) {
  const level = Number(String(type || '').slice(1));
  if (!Number.isFinite(level) || level < 1 || level > 9) return null;
  return level + 2;
}

function convertRootBlockToLinearChildren(block) {
  if (!block) return null;
  if (/^h[1-9]$/.test(block.type)) {
    const blockType = inferHeadingBlockType(block.type);
    return convertMarkdownToDocxBlocks(block?.content?.markdown || block?.content?.text || '', blockType);
  }
  if (block.type === 'paragraph') {
    if (block?.content?.type === 'image') {
      return [createDocxImagePlaceholder(block.content.src)];
    }
    return convertMarkdownToDocxBlocks(block?.content?.markdown || '', BLOCK_TYPE_TEXT);
  }
  if (block.type === 'divider') {
    return [createDividerBlock()];
  }
  return null;
}

function createTempId(prefix) {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/**
 * 把 markdown 转为飞书 descendant 节点列表。
 * 列表子级通过 children 父子关系实现缩进（docx v1 不支持 style.list.indentLevel）。
 * 返回的是**平铺**的 descriptor 数组，但 children 字段已正确指向子节点 block_id。
 */
function createDescendantTextNodes(markdown, preferredType = BLOCK_TYPE_TEXT) {
  const rawBlocks = convertMarkdownToDocxBlocks(markdown, preferredType);

  const hasIndent = rawBlocks.some((b) => b._indentLevel > 0);
  if (!hasIndent) {
    return rawBlocks.map((child) => {
      const { _indentLevel: _il, ...rest } = child;
      return { block_id: createTempId('text'), ...rest, children: [] };
    });
  }

  // 按 _indentLevel 建立父子关系：每个节点挂到最近的、indent 比自己小的节点上
  const nodes = rawBlocks.map((child) => {
    const { _indentLevel: _il, ...rest } = child;
    return { block_id: createTempId('text'), ...rest, children: [], _indentLevel: _il || 0 };
  });

  // parentStack[level] = 该层级最后一个节点的 index
  const parentStack = [];
  for (let i = 0; i < nodes.length; i++) {
    const level = nodes[i]._indentLevel;
    parentStack[level] = i;
    // 清除比当前 level 更深的 stack 条目
    for (let d = level + 1; d < parentStack.length; d++) parentStack[d] = undefined;
    if (level > 0) {
      // 找最近的更浅层级作为父节点
      for (let p = level - 1; p >= 0; p--) {
        if (parentStack[p] != null) {
          nodes[parentStack[p]].children.push(nodes[i].block_id);
          break;
        }
      }
    }
  }

  // 收集所有被引用为 child 的 block_id
  const childIds = new Set();
  for (const node of nodes) {
    for (const cid of node.children) childIds.add(cid);
  }

  // 平铺输出（飞书 descendant API 需要平铺），标记顶层节点
  return nodes.map((node) => {
    const rest = { ...node };
    delete rest._indentLevel;
    if (childIds.has(rest.block_id)) rest._isChild = true;
    return rest;
  });
}

function createCellContentNodes(cell) {
  const descriptors = [];
  const elements = Array.isArray(cell?.elements) ? cell.elements : [];
  if (!elements.length) return createDescendantTextNodes('', BLOCK_TYPE_TEXT);

  // 收集连续的 text element markdown，合并后一次性建立父子关系
  let pendingTextLines = [];
  function flushTextLines() {
    if (!pendingTextLines.length) return;
    const combined = pendingTextLines.join('\n');
    descriptors.push(...createDescendantTextNodes(combined, BLOCK_TYPE_TEXT));
    pendingTextLines = [];
  }

  for (const element of elements) {
    if (!element) continue;
    if (element.type === 'image') {
      flushTextLines();
      descriptors.push({
        block_id: createTempId('image'),
        ...createDocxImagePlaceholder(element.src),
        children: [],
      });
      continue;
    }
    if (element.type === 'mermaid' || element.type === 'mindmap') {
      flushTextLines();
      descriptors.push({
        block_id: createTempId('board'),
        _boardCode: element.code || '',
        _boardType: element.type,
        children: [],
      });
      continue;
    }
    pendingTextLines.push(element.markdown || '');
  }
  flushTextLines();
  return descriptors.length ? descriptors : createDescendantTextNodes('', BLOCK_TYPE_TEXT);
}

/** 发往飞书 descendant API 时去掉本地占位字段，避免产生空图片块且无法绑定素材 */
function stripDescendantNodeForApi(node) {
  const {
    _isChild: _ic,
    _imageSrc,
    _boardCode,
    _boardType,
    ...rest
  } = node;
  return rest;
}

/**
 * 与嵌套单元格 nodes 树一致的 DFS 顺序收集图片 src（用于与飞书侧 IMAGE block 顺序对齐）
 */
function collectNestedImageSrcsFromNodes(nodes) {
  const byId = new Map((nodes || []).map((n) => [n.block_id, n]));
  const roots = (nodes || []).filter((n) => !n._isChild);
  const out = [];
  function walk(n) {
    if (n.block_type === BLOCK_TYPE_IMAGE && n._imageSrc) out.push(n._imageSrc);
    const ch = Array.isArray(n.children) ? n.children : [];
    for (const cid of ch) {
      const child = byId.get(cid);
      if (child) walk(child);
    }
  }
  for (const r of roots) walk(r);
  return out;
}

/** 自 rootBlockId 起前序 DFS 列出块（含分页），顺序与飞书文档树一致 */
async function listDescendantBlocksPreOrder(state, accessToken, documentId, rootBlockId) {
  const out = [];
  async function walk(id) {
    let pageToken = '';
    do {
      // eslint-disable-next-line no-await-in-loop
      const data = await docxGetChildren(state, accessToken, documentId, id, pageToken);
      const items = Array.isArray(data.items) ? data.items : [];
      for (const item of items) {
        out.push(item);
        // eslint-disable-next-line no-await-in-loop
        await walk(item.block_id);
      }
      pageToken = data.has_more ? (data.page_token || '') : '';
    } while (pageToken);
  }
  await walk(rootBlockId);
  return out;
}

async function uploadNestedCellImagesAfterDescendant(state, accessToken, documentId, cellId, nodes, addWorkUnits) {
  const srcs = collectNestedImageSrcsFromNodes(nodes);
  if (!srcs.length) return;
  const flat = await listDescendantBlocksPreOrder(state, accessToken, documentId, cellId);
  const imageBlocks = flat.filter((b) => b.block_type === BLOCK_TYPE_IMAGE);
  if (imageBlocks.length !== srcs.length) {
    throw new Error(`嵌套单元格图片数量不一致：飞书 ${imageBlocks.length}，本地 ${srcs.length}`);
  }
  for (let i = 0; i < srcs.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await uploadAndBindImage(state, accessToken, documentId, imageBlocks[i].block_id, srcs[i]);
    addWorkUnits?.(1, '上传表格内图片');
  }
}

/**
 * Markmap 大綱 → 飛書 plantuml mindmap：必須去掉行內 `#`，並保證單根（與 PRD2MD feishu-api-plugin 一致）。
 */
function convertMarkmapBodyToFeishuMindmap(body) {
  const lines = String(body || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((line) => line.trim());
  if (!lines.length) return '  空白思维导图';

  let minH = null;
  let hasHeading = false;
  for (const line of lines) {
    const hm = line.match(/^(\s*)(#{1,6})\s+(.+)$/);
    if (hm) {
      hasHeading = true;
      const lv = hm[2].length;
      minH = minH === null ? lv : Math.min(minH, lv);
    }
  }

  const hasList = lines.some(
    (line) => /^(\s*)[-*+]\s+/.test(line) || /^(\s*)\d+\.\s+/.test(line),
  );
  const needSynthRoot = (minH !== null && minH > 1) || (!hasHeading && hasList);

  const out = [];
  if (needSynthRoot) {
    out.push('  PRD');
  }

  let lastHeadingDepth = needSynthRoot && !hasHeading ? 1 : needSynthRoot ? 2 : 1;

  for (const line of lines) {
    const hm = line.match(/^(\s*)(#{1,6})\s+(.+)$/);
    if (hm) {
      const hlv = hm[2].length;
      const title = hm[3].trim();
      const depth = needSynthRoot ? hlv - minH + 2 : hlv;
      lastHeadingDepth = depth;
      out.push(`${'  '.repeat(depth)}${title}`);
      continue;
    }
    const lm = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (lm) {
      const indentLen = lm[1].replace(/\t/g, '  ').length;
      const listDepth = Math.floor(indentLen / 2) + 1;
      const depth = lastHeadingDepth + listDepth;
      out.push(`${'  '.repeat(depth)}${lm[3].trim()}`);
      continue;
    }
    const pl = line.match(/^(\s*)(.+)$/);
    if (pl && pl[2].trim()) {
      const text = pl[2].trim();
      if (/^#+\s/.test(text)) continue;
      out.push(`${'  '.repeat(lastHeadingDepth + 1)}${text}`);
    }
  }
  return out.join('\n');
}

function normalizeMindmapToMermaid(code) {
  const normalized = String(code || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return 'mindmap\n  空白思维导图';
  let body = normalized;
  if (/^\s*mindmap\b/i.test(body)) {
    body = body.replace(/^\s*mindmap\s*/i, '').trim();
  }
  const converted = convertMarkmapBodyToFeishuMindmap(body);
  return `mindmap\n${converted}`;
}

function inferMermaidDiagramType(code, fallback = 0) {
  const trimmed = String(code || '').trim();
  if (/^mindmap\b/i.test(trimmed)) return 1;
  if (/^sequenceDiagram\b/i.test(trimmed)) return 2;
  if (/^classDiagram\b/i.test(trimmed)) return 4;
  if (/^erDiagram\b/i.test(trimmed)) return 5;
  if (/^(graph|flowchart)\b/i.test(trimmed)) return 6;
  if (/^stateDiagram/i.test(trimmed) || /^journey\b/i.test(trimmed)) return 3;
  return fallback;
}

function createBoardBlock(height) {
  return {
    block_type: BLOCK_TYPE_BOARD,
    board: {
      align: 1,
      width: BOARD_WIDTH_DEFAULT,
      height,
    },
  };
}

function parseFeishuDocUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('请输入合法的飞书文档链接');
  }
  const match = url.pathname.match(/\/(docx|wiki)\/([A-Za-z0-9]+)/);
  if (!match) {
    throw new Error('暂只支持 docx / wiki 链接');
  }
  return {
    kind: match[1],
    token: match[2],
  };
}

async function getWikiNode(accessToken, wikiToken) {
  const url = `${FEISHU_WIKI_BASE_URL}/spaces/get_node?token=${encodeURIComponent(wikiToken)}`;
  const payload = await requestFeishuJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return payload.data?.node || null;
}

async function getDocumentInfo(accessToken, documentId) {
  const url = `${FEISHU_DOCX_BASE_URL}/documents/${encodeURIComponent(documentId)}`;
  const payload = await requestFeishuJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return payload.data?.document || payload.data || null;
}

async function resolveDocumentFromUrl(accessToken, docUrl) {
  const parsed = parseFeishuDocUrl(docUrl);
  if (parsed.kind === 'docx') {
    const document = await getDocumentInfo(accessToken, parsed.token);
    return {
      documentId: parsed.token,
      document,
      sourceType: 'docx',
    };
  }
  const node = await getWikiNode(accessToken, parsed.token);
  const documentId = node?.obj_token;
  if (!documentId) throw new Error('当前 wiki 链接未解析出文档 ID');
  const document = await getDocumentInfo(accessToken, documentId);
  return {
    documentId,
    document,
    sourceType: 'wiki',
    wikiToken: parsed.token,
  };
}

async function docxGetChildren(state, accessToken, documentId, blockId, pageToken = '') {
  const url = new URL(`${FEISHU_DOCX_BASE_URL}/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(blockId)}/children`);
  url.searchParams.set('page_size', '500');
  if (pageToken) url.searchParams.set('page_token', pageToken);
  const payload = await state.docxLimiter(() => requestFeishuJson(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  }));
  return payload.data || {};
}

async function docxBatchDelete(state, accessToken, documentId, blockId, startIndex, endIndex) {
  const url = new URL(`${FEISHU_DOCX_BASE_URL}/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(blockId)}/children/batch_delete`);
  url.searchParams.set('document_revision_id', '-1');
  url.searchParams.set('client_token', crypto.randomUUID());
  return state.docxLimiter(() => requestFeishuJson(url.toString(), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      start_index: startIndex,
      end_index: endIndex,
    }),
  }));
}

async function docxCreateChildren(state, accessToken, documentId, parentBlockId, children, insertIndex) {
  const url = new URL(`${FEISHU_DOCX_BASE_URL}/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/children`);
  url.searchParams.set('document_revision_id', '-1');
  url.searchParams.set('client_token', crypto.randomUUID());
  const bodyObj = { children };
  if (insertIndex != null && insertIndex >= 0) bodyObj.index = insertIndex;
  const payload = await state.docxLimiter(() => requestFeishuJson(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(bodyObj),
  }));
  return payload.data || {};
}

async function docxBatchUpdate(state, accessToken, documentId, requests) {
  if (!requests.length) return {};
  const url = new URL(`${FEISHU_DOCX_BASE_URL}/documents/${encodeURIComponent(documentId)}/blocks/batch_update`);
  url.searchParams.set('document_revision_id', '-1');
  url.searchParams.set('client_token', crypto.randomUUID());
  const payload = await state.docxLimiter(() => requestFeishuJson(url.toString(), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ requests }),
  }));
  return payload.data || {};
}

async function docxPatchBlock(state, accessToken, documentId, blockId, patchBody) {
  const url = new URL(`${FEISHU_DOCX_BASE_URL}/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(blockId)}`);
  url.searchParams.set('document_revision_id', '-1');
  const payload = await state.docxLimiter(() => requestFeishuJson(url.toString(), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(patchBody),
  }));
  return payload.data || {};
}

/**
 * 分步创建表格：
 * 1. children/create 创建空 table（飞书自动生成 table_cell block_id）
 * 2. 逐个 cell 调用 children/create 填充内容（图片用三步法）
 * @param {((delta: number, message?: string) => void) | undefined} addWorkUnits - 每完成一张图 +1，表格块本身结束时 +1
 */
async function docxCreateTable(state, accessToken, documentId, block, insertIndex, addWorkUnits) {
  const headers = Array.isArray(block?.content?.headers) ? block.content.headers : [];
  const rows = Array.isArray(block?.content?.rows) ? block.content.rows : [];
  const rowCount = rows.length + 1;
  const columnCount = Math.max(headers.length, rows[0]?.length || 0);
  if (rowCount <= 0 || columnCount <= 0) {
    throw new Error('表格缺少列定义，无法同步');
  }

  const colWidth = Math.floor(TABLE_PAGE_WIDTH_WIDER / columnCount);
  const columnWidthArray = Array.from({ length: columnCount }, () => colWidth);
  const tableResult = await docxCreateChildren(state, accessToken, documentId, documentId, [{
    block_type: BLOCK_TYPE_TABLE,
    table: {
      property: {
        row_size: rowCount,
        column_size: columnCount,
        column_width: columnWidthArray,
        header_row: true,
      },
    },
  }], insertIndex);

  const tableBlock = (tableResult.children || []).find((item) => item.block_type === BLOCK_TYPE_TABLE);
  const cellIds = Array.isArray(tableBlock?.children) ? tableBlock.children : [];

  if (cellIds.length !== rowCount * columnCount) {
    throw new Error(`表格单元格数量不匹配：期望 ${rowCount * columnCount}，实际 ${cellIds.length}`);
  }

  const allCellContents = [];
  for (const header of headers) {
    allCellContents.push(createDescendantTextNodes(String(header || ''), BLOCK_TYPE_TEXT));
  }
  for (const row of rows) {
    for (let colIndex = 0; colIndex < columnCount; colIndex += 1) {
      const cellData = row?.[colIndex];
      allCellContents.push(createCellContentNodes({ elements: cellData?.elements || [] }));
    }
  }

  // 一次回读所有 cell 拿到每个 cell 自带的空 text block id
  const cellChildrenData = await docxGetChildren(state, accessToken, documentId, tableBlock.block_id);
  const cellItems = Array.isArray(cellChildrenData.items) ? cellChildrenData.items : [];
  const emptyBlockIdByCell = new Map();
  for (const item of cellItems) {
    if (item.block_type === BLOCK_TYPE_TABLE_CELL && Array.isArray(item.children) && item.children.length > 0) {
      emptyBlockIdByCell.set(item.block_id, item.children[0]);
    }
  }

  // 辅助：判断 cell 内容是否包含嵌套列表（有 children 的节点）
  function hasNestedChildren(nodes) {
    return nodes.some((n) => Array.isArray(n.children) && n.children.length > 0);
  }

  // 辅助：从节点列表中提取干净的 schema（去除内部标记）
  function toCleanSchema(node) {
    const rest = { ...node };
    delete rest.block_id;
    delete rest.children;
    delete rest._isChild;
    return rest;
  }

  // 分类：哪些 cell 的第一个内容块是纯文本（可以 batch_update 改写），哪些需要额外处理
  const batchUpdateRequests = [];
  const cellsNeedExtraWork = [];

  for (let i = 0; i < cellIds.length; i += 1) {
    const cellId = cellIds[i];
    const cellChildren = allCellContents[i] || createDescendantTextNodes('', BLOCK_TYPE_TEXT);
    if (!cellChildren.length) continue;

    const nested = hasNestedChildren(cellChildren);
    const emptyBlockId = emptyBlockIdByCell.get(cellId);

    if (nested) {
      // 含嵌套列表：必须用 descendant API，无法 batch_update 首块
      cellsNeedExtraWork.push({ cellId, nodes: cellChildren, deleteFirst: true, nested: true });
    } else {
      const blockSchemas = cellChildren.map(toCleanSchema);
      const firstSchema = blockSchemas[0];
      const restSchemas = blockSchemas.slice(1);
      const firstIsText = firstSchema.block_type === BLOCK_TYPE_TEXT && !firstSchema._imageSrc && !firstSchema._boardCode;

      if (firstIsText && emptyBlockId) {
        const textData = firstSchema.text || {};
        batchUpdateRequests.push({
          block_id: emptyBlockId,
          update_text_elements: {
            elements: textData.elements || [{ text_run: { content: ' ' } }],
          },
        });
        if (restSchemas.length > 0) {
          cellsNeedExtraWork.push({ cellId, schemas: restSchemas, deleteFirst: false });
        }
      } else {
        cellsNeedExtraWork.push({ cellId, schemas: blockSchemas, deleteFirst: true });
      }
    }
  }

  // 一次 batch_update 改写所有纯文本 header/简单 cell（最多 200 个）
  for (let idx = 0; idx < batchUpdateRequests.length; idx += 200) {
    const slice = batchUpdateRequests.slice(idx, idx + 200);
    await docxBatchUpdate(state, accessToken, documentId, slice);
  }

  // 处理需要额外工作的 cell
  for (const work of cellsNeedExtraWork) {
    const { cellId, deleteFirst } = work;

    if (work.nested) {
      // 嵌套列表：用 descendant API 一次性创建带父子关系的块树
      const { nodes } = work;
      const topLevelIds = nodes.filter((n) => !n._isChild).map((n) => n.block_id);
      const descendants = nodes.map((n) => stripDescendantNodeForApi(n));
      await docxCreateDescendants(state, accessToken, documentId, cellId, {
        children_id: topLevelIds,
        descendants,
      });
      // descendant 写入的图片块默认为空壳，必须再 upload + replace_image（与非嵌套路径一致）
      await uploadNestedCellImagesAfterDescendant(state, accessToken, documentId, cellId, nodes, addWorkUnits);
      if (deleteFirst) {
        // 删除飞书自动创建的空 text block（它在 index 0）
        await docxBatchDelete(state, accessToken, documentId, cellId, 0, 1);
      }
      continue;
    }

    // 非嵌套：沿用原逻辑（children/create 平铺）
    const { schemas } = work;
    let batch = [];

    async function flushCellBatch() {
      if (!batch.length) return;
      for (let bIdx = 0; bIdx < batch.length; bIdx += MAX_LINEAR_BLOCKS_PER_REQUEST) {
        // eslint-disable-next-line no-await-in-loop
        await docxCreateChildren(state, accessToken, documentId, cellId, batch.slice(bIdx, bIdx + MAX_LINEAR_BLOCKS_PER_REQUEST));
      }
      batch = [];
    }

    for (const schema of schemas) {
      if (schema._boardCode != null) {
        await flushCellBatch();
        await createBoardFromCode(state, accessToken, documentId, schema._boardCode, schema._boardType || 'mermaid', undefined, cellId);
      } else if (schema.block_type === BLOCK_TYPE_IMAGE && schema._imageSrc) {
        await flushCellBatch();
        await createAndUploadImage(
          state, accessToken, documentId, cellId, schema._imageSrc, undefined,
          () => addWorkUnits?.(1, '上传表格内图片'),
        );
      } else {
        const { _imageSrc: _s, _boardCode: _bc, _boardType: _bt, ...cleanSchema } = schema;
        batch.push(cleanSchema);
      }
    }
    await flushCellBatch();
    if (deleteFirst) {
      await docxBatchDelete(state, accessToken, documentId, cellId, 0, 1);
    }
  }

  addWorkUnits?.(1, '同步表格');
  return tableBlock;
}

async function docxCreateDescendants(state, accessToken, documentId, parentBlockId, requestBody) {
  const url = new URL(`${FEISHU_DOCX_BASE_URL}/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/descendant`);
  url.searchParams.set('document_revision_id', '-1');
  url.searchParams.set('client_token', crypto.randomUUID());
  const bodyToSend = { index: -1, ...requestBody };
  // 调试：把请求 body 写到文件
  try {
    fs.writeFileSync(path.join(process.cwd(), '.local', 'feishu-last-descendants-req.json'), JSON.stringify(bodyToSend, null, 2), 'utf-8');
  } catch { /* ignore */ }
  const payload = await state.docxLimiter(() => requestFeishuJson(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(bodyToSend),
  }));
  return payload.data || {};
}

/**
 * 三步法创建并上传图片到已有 Image Block：
 * 用 imageBlockId 作为 parent_node 上传素材，然后 patch 绑定 token
 */
async function uploadAndBindImage(state, accessToken, documentId, imageBlockId, src) {
  const resolved = await resolveImageSourceBuffer(src, state);

  const form = new FormData();
  form.set('file_name', resolved.fileName);
  form.set('parent_type', 'docx_image');
  form.set('parent_node', imageBlockId);
  form.set('size', String(resolved.buffer.byteLength));
  form.set('extra', JSON.stringify({ drive_route_token: documentId }));
  form.set('file', new Blob([resolved.buffer], { type: resolved.mimeType }), resolved.fileName);
  const payload = await state.uploadLimiter(() => requestFeishuForm(FEISHU_DRIVE_UPLOAD_URL, form, accessToken));
  const fileToken = payload.data?.file_token;
  if (!fileToken) throw new Error(`图片上传失败：${src}`);

  await docxPatchBlock(state, accessToken, documentId, imageBlockId, {
    replace_image: { token: fileToken },
  });
  return fileToken;
}

/**
 * 在指定 parentBlockId 下创建图片并上传（三步法一体化）。
 * 返回创建的 Image Block 信息。
 */
async function createAndUploadImage(state, accessToken, documentId, parentBlockId, src, insertIndex, onUploaded) {
  const imgResult = await docxCreateChildren(state, accessToken, documentId, parentBlockId, [{ block_type: BLOCK_TYPE_IMAGE, image: {} }], insertIndex);
  const imgBlock = (imgResult.children || []).find((c) => c.block_type === BLOCK_TYPE_IMAGE);
  if (!imgBlock) throw new Error(`创建 Image Block 失败：${src}`);
  await uploadAndBindImage(state, accessToken, documentId, imgBlock.block_id, src);
  onUploaded?.();
  return imgBlock;
}

/**
 * 在指定父块下创建画板并注入 Mermaid / Mindmap 代码。
 * parentBlockId 缺省时挂到文档根层（documentId）；传入 cellId 时可挂入表格单元格。
 * insertIndex 仅对根层生效（单元格内追加不传 index）。
 */
async function createBoardFromCode(state, accessToken, documentId, code, type, insertIndex, parentBlockId) {
  const actualParentId = parentBlockId ?? documentId;
  const createResult = await docxCreateChildren(
    state, accessToken, documentId, actualParentId,
    [createBoardBlock(type === 'mindmap' ? BOARD_HEIGHT_MINDMAP : BOARD_HEIGHT_DEFAULT)],
    parentBlockId == null ? insertIndex : undefined,
  );
  const boardBlock = (createResult.children || []).find((item) => item.block_type === BLOCK_TYPE_BOARD);
  const whiteboardId = boardBlock?.board?.token || boardBlock?.token;
  if (!whiteboardId) throw new Error('创建飞书画板成功，但未拿到 whiteboard_id');

  const mermaidCode = type === 'mindmap' ? normalizeMindmapToMermaid(code) : String(code || '');
  const diagramType = type === 'mindmap' ? 1 : inferMermaidDiagramType(mermaidCode, 0);
  const url = `${FEISHU_BOARD_BASE_URL}/whiteboards/${encodeURIComponent(whiteboardId)}/nodes/plantuml`;
  await state.boardLimiter(() => requestFeishuJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      plant_uml_code: mermaidCode,
      syntax_type: 2,
      style_type: 1,
      diagram_type: diagramType,
    }),
  }));
  return boardBlock?.block_id;
}

async function clearDocumentRootChildren(state, accessToken, documentId) {
  while (true) {
    const data = await docxGetChildren(state, accessToken, documentId, documentId);
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) return;
    await docxBatchDelete(state, accessToken, documentId, documentId, 0, items.length);
  }
}

/**
 * 将 PRD blocks 写入飞书文档。
 * @param {number|undefined} startInsertIndex - 在飞书文档中插入的起始 index（增量模式），undefined 时追加到末尾
 * @param {((delta: number, message?: string) => void) | undefined} addWorkUnits - 每完成一张图 +1，每完成一个根层 block +1（与 computeTotalWorkUnits 一致）
 * @returns {string[]} 创建成功后的飞书 root block_id 数组（与 prdBlocks 一一对应）
 */
async function writeBlocksToDocument(state, accessToken, documentId, blocks, addWorkUnits, startInsertIndex) {
  const report = typeof addWorkUnits === 'function' ? addWorkUnits : () => {};
  let linearBatch = [];
  /** 当前 linearBatch 中尚未 flush 的根层 PRD block 个数 */
  let linearBatchBlockCount = 0;
  let currentInsertIndex = startInsertIndex;
  const createdBlockIds = [];

  function advanceIndex(count) {
    if (currentInsertIndex != null) currentInsertIndex += count;
  }

  async function flushLinearBatch() {
    if (!linearBatch.length) return;
    const blocksToCount = linearBatchBlockCount;
    linearBatchBlockCount = 0;
    let nonImageBatch = [];
    async function flushNonImage() {
      if (!nonImageBatch.length) return;
      for (let idx = 0; idx < nonImageBatch.length; idx += MAX_LINEAR_BLOCKS_PER_REQUEST) {
        const slice = nonImageBatch.slice(idx, idx + MAX_LINEAR_BLOCKS_PER_REQUEST);
        const result = await docxCreateChildren(state, accessToken, documentId, documentId, slice, currentInsertIndex);
        const ids = (result.children || []).map((c) => c.block_id).filter(Boolean);
        createdBlockIds.push(...ids);
        advanceIndex(ids.length);
      }
      nonImageBatch = [];
    }
    for (const block of linearBatch) {
      if (block.block_type === BLOCK_TYPE_IMAGE && block._imageSrc) {
        await flushNonImage();
        const imgBlock = await createAndUploadImage(
          state, accessToken, documentId, documentId, block._imageSrc, currentInsertIndex,
          () => report(1, '上传图片'),
        );
        if (imgBlock?.block_id) {
          createdBlockIds.push(imgBlock.block_id);
          advanceIndex(1);
        }
      } else {
        nonImageBatch.push(block);
      }
    }
    await flushNonImage();
    linearBatch = [];
    if (blocksToCount > 0) {
      report(blocksToCount, blocksToCount > 1 ? `已写入 ${blocksToCount} 个内容块` : '已写入内容');
    }
  }

  for (const block of blocks || []) {
    const linearChildren = convertRootBlockToLinearChildren(block);
    if (linearChildren) {
      linearBatch.push(...linearChildren);
      linearBatchBlockCount += 1;
      continue;
    }

    await flushLinearBatch();

    if (block?.type === 'table') {
      const tableBlock = await docxCreateTable(state, accessToken, documentId, block, currentInsertIndex, report);
      const tableBlockId = tableBlock?.block_id;
      if (tableBlockId) {
        createdBlockIds.push(tableBlockId);
        advanceIndex(1);
      }
      continue;
    }

    if (block?.type === 'mermaid') {
      const bid = await createBoardFromCode(state, accessToken, documentId, block?.content?.code || '', 'mermaid', currentInsertIndex);
      if (bid) {
        createdBlockIds.push(bid);
        advanceIndex(1);
      }
      report(1, '同步 Mermaid');
      continue;
    }

    if (block?.type === 'mindmap') {
      const bid = await createBoardFromCode(state, accessToken, documentId, block?.content?.code || '', 'mindmap', currentInsertIndex);
      if (bid) {
        createdBlockIds.push(bid);
        advanceIndex(1);
      }
      report(1, '同步思维导图');
      continue;
    }

    throw new Error(`暂不支持的 PRD block 类型：${block?.type || 'unknown'}`);
  }

  await flushLinearBatch();
  return createdBlockIds;
}

async function runSyncJob(state, job) {
  const config = buildFeishuConfig();
  const auth = await ensureValidAccessToken(state, config);
  const accessToken = auth.accessToken;
  const { docUrl, blocks, sourceSlug, sourceTitle } = job.payload;
  const resolved = await resolveDocumentFromUrl(accessToken, docUrl);

  updateJob(job, {
    status: 'running',
    phase: 'validating',
    percent: 5,
    message: `已连接目标文档：${resolved.document?.title || resolved.documentId}`,
  });

  const newSignatures = computeBlockSignatures(blocks);
  const snapshot = loadSnapshot(state, resolved.documentId);

  let syncMode = 'full';
  let diff = null;

  if (snapshot && Array.isArray(snapshot.signatures)) {
    updateJob(job, {
      phase: 'diffing',
      percent: 8,
      message: '正在对比本地快照差异',
    });

    diff = diffSignatures(snapshot.signatures, newSignatures);
    const hasLocalChanges = diff.oldStart < diff.oldEnd || diff.newStart < diff.newEnd;

    updateJob(job, {
      phase: 'verifying-snapshot',
      percent: 12,
      message: '正在回读飞书文档校验快照',
    });
    const liveBlockIds = await fetchRootBlockIds(state, accessToken, resolved.documentId);
    const snapshotIds = snapshot.feishuRootBlockIds || [];
    const feishuUnchanged = liveBlockIds.length === snapshotIds.length
      && liveBlockIds.every((id, i) => id === snapshotIds[i]);

    if (!hasLocalChanges && feishuUnchanged) {
      updateJob(job, {
        status: 'succeeded',
        phase: 'completed',
        percent: 100,
        message: '无变更，跳过同步',
        result: {
          documentId: resolved.documentId,
          documentTitle: resolved.document?.title || '',
          sourceSlug,
          sourceTitle,
          blockCount: 0,
          targetUrl: docUrl,
          incremental: true,
          changedBlocks: 0,
        },
      });
      return;
    }

    if (!hasLocalChanges && !feishuUnchanged) {
      syncMode = 'full';
      diff = null;
    } else if (feishuUnchanged) {
      syncMode = 'incremental';
    } else {
      syncMode = 'full';
      diff = null;
    }
  }

  if (syncMode === 'full') {
    updateJob(job, {
      phase: 'clearing-document',
      percent: 15,
      message: '正在清空目标文档旧内容（全量同步）',
    });
    await clearDocumentRootChildren(state, accessToken, resolved.documentId);

    updateJob(job, {
      phase: 'writing-blocks',
      percent: 20,
      message: '正在写入 PRD 块（含图片即时上传）',
    });
    const totalWU = computeTotalWorkUnits(blocks);
    let doneWU = 0;
    function addWorkUnits(delta, message) {
      doneWU += delta;
      const percent = totalWU ? 20 + Math.round((doneWU / totalWU) * 75) : 95;
      updateJob(job, {
        phase: 'writing-blocks',
        percent: Math.min(95, percent),
        message: message || '正在写入内容',
      });
    }
    const createdIds = await writeBlocksToDocument(state, accessToken, resolved.documentId, blocks, addWorkUnits);

    saveSnapshot(state, {
      documentId: resolved.documentId,
      docUrl,
      signatures: newSignatures,
      feishuRootBlockIds: createdIds,
      syncedAt: nowIso(),
    });

    updateJob(job, {
      status: 'succeeded',
      phase: 'completed',
      percent: 100,
      message: '全量同步完成',
      result: {
        documentId: resolved.documentId,
        documentTitle: resolved.document?.title || '',
        sourceSlug,
        sourceTitle,
        blockCount: Array.isArray(blocks) ? blocks.length : 0,
        targetUrl: docUrl,
        incremental: false,
      },
    });
    return;
  }

  // ─── 增量同步 ──────────────────────────────────────────────
  const oldIds = snapshot.feishuRootBlockIds;
  const deleteCount = diff.oldEnd - diff.oldStart;
  const insertBlocks = blocks.slice(diff.newStart, diff.newEnd);
  const changedCount = Math.max(deleteCount, insertBlocks.length);

  updateJob(job, {
    phase: 'incremental-delete',
    percent: 20,
    message: `增量同步：删除 ${deleteCount} 个旧块`,
  });

  // 从高 index 向低 index 删除，避免 index 偏移
  if (deleteCount > 0) {
    await docxBatchDelete(state, accessToken, resolved.documentId, resolved.documentId, diff.oldStart, diff.oldEnd);
  }

  updateJob(job, {
    phase: 'incremental-insert',
    percent: 35,
    message: `增量同步：插入 ${insertBlocks.length} 个新块`,
  });

  let insertedIds = [];
  if (insertBlocks.length > 0) {
    const insTotal = computeTotalWorkUnits(insertBlocks);
    let insDone = 0;
    function addInsertWorkUnits(delta, message) {
      insDone += delta;
      const percent = insTotal ? 35 + Math.round((insDone / insTotal) * 60) : 95;
      updateJob(job, {
        phase: 'incremental-insert',
        percent: Math.min(95, percent),
        message: message || '增量写入',
      });
    }
    insertedIds = await writeBlocksToDocument(
      state, accessToken, resolved.documentId, insertBlocks,
      addInsertWorkUnits,
      diff.oldStart,
    );
  }

  // 重建完整的 feishuRootBlockIds：头部不变 + 新插入的 + 尾部不变
  const newFeishuBlockIds = [
    ...oldIds.slice(0, diff.oldStart),
    ...insertedIds,
    ...oldIds.slice(diff.oldEnd),
  ];

  saveSnapshot(state, {
    documentId: resolved.documentId,
    docUrl,
    signatures: newSignatures,
    feishuRootBlockIds: newFeishuBlockIds,
    syncedAt: nowIso(),
  });

  updateJob(job, {
    status: 'succeeded',
    phase: 'completed',
    percent: 100,
    message: `增量同步完成（变更 ${changedCount} 个块）`,
    result: {
      documentId: resolved.documentId,
      documentTitle: resolved.document?.title || '',
      sourceSlug,
      sourceTitle,
      blockCount: insertBlocks.length,
      targetUrl: docUrl,
      incremental: true,
      changedBlocks: changedCount,
    },
  });
}

function buildCallbackRedirect(baseUrl, params) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function createFeishuSyncApi({ rootDir, publicDir }) {
  const state = createServerState({ rootDir, publicDir });

  return {
    matches(pathname) {
      return pathname.startsWith('/__prd__/feishu/');
    },

    async handle(req, res) {
      cleanupPendingStates(state);
      cleanupJobs(state);
      const pathname = decodePathname(req.url);
      const config = buildFeishuConfig();

      if (pathname === FEISHU_AUTH_STATUS_API && req.method === 'GET') {
        const auth = loadStoredAuth(state);
        sendJson(res, 200, { ok: true, ...buildAuthStatusPayload(config, auth) });
        return;
      }

      if (pathname === FEISHU_AUTH_START_API && req.method === 'GET') {
        if (!config.configured) {
          sendJson(res, 400, {
            ok: false,
            error: '飞书环境变量未配置，请先提供 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_BASE_URL',
          });
          return;
        }
        const stateToken = crypto.randomUUID();
        state.pendingAuthStates.set(stateToken, Date.now());
        const authUrl = new URL(FEISHU_AUTHORIZE_URL);
        authUrl.searchParams.set('client_id', config.appId);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', config.redirectUri);
        authUrl.searchParams.set('scope', config.scopes.join(' '));
        authUrl.searchParams.set('state', stateToken);
        authUrl.searchParams.set('prompt', 'consent');
        redirect(res, authUrl.toString());
        return;
      }

      if (pathname === FEISHU_AUTH_CALLBACK_API && req.method === 'GET') {
        const url = new URL(req.url, config.baseUrl);
        const error = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        const stateToken = url.searchParams.get('state');

        if (!stateToken || !state.pendingAuthStates.has(stateToken)) {
          redirect(res, buildCallbackRedirect(config.baseUrl, {
            feishuAuth: 'error',
            feishuMessage: '授权 state 校验失败',
          }));
          return;
        }
        state.pendingAuthStates.delete(stateToken);

        if (error) {
          redirect(res, buildCallbackRedirect(config.baseUrl, {
            feishuAuth: 'error',
            feishuMessage: error === 'access_denied' ? '你已取消飞书授权' : error,
          }));
          return;
        }
        if (!code) {
          redirect(res, buildCallbackRedirect(config.baseUrl, {
            feishuAuth: 'error',
            feishuMessage: '缺少授权码 code',
          }));
          return;
        }

        try {
          const tokenPayload = await exchangeOAuthToken(config, {
            grant_type: 'authorization_code',
            client_id: config.appId,
            client_secret: config.appSecret,
            code,
            redirect_uri: config.redirectUri,
          });
          const auth = await persistTokenGrant(state, config, tokenPayload);
          redirect(res, buildCallbackRedirect(config.baseUrl, {
            feishuAuth: 'success',
            feishuUser: auth?.user?.name || '飞书用户',
          }));
        } catch (exchangeError) {
          redirect(res, buildCallbackRedirect(config.baseUrl, {
            feishuAuth: 'error',
            feishuMessage: exchangeError?.message || '飞书授权失败',
          }));
        }
        return;
      }

      if (pathname === FEISHU_AUTH_LOGOUT_API && req.method === 'POST') {
        clearStoredAuth(state);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === FEISHU_SYNC_START_API && req.method === 'POST') {
        try {
          await ensureValidAccessToken(state, config);
          const body = await readJsonBody(req);
          const docUrl = String(body?.docUrl || '').trim();
          let blocks = Array.isArray(body?.blocks) ? body.blocks : null;

          // 如果前端没传 blocks，尝试根据 slug 从本地 md 文件自动解析
          if (!blocks && body?.slug) {
            const slug = String(body.slug).replace(/[^a-z0-9_-]/gi, '');
            const pagesDir = path.join(state.rootDir, 'pages');
            const slugDir = path.join(pagesDir, slug);
            if (fs.existsSync(slugDir)) {
              const mdFiles = fs.readdirSync(slugDir).filter(f => f.endsWith('.md'));
              if (mdFiles.length > 0) {
                const mdText = fs.readFileSync(path.join(slugDir, mdFiles[0]), 'utf-8');
                blocks = expandParagraphBlocksOnBlankLines(normalizeLegacyBlocks(parsePrd(mdText)));
              }
            }
          }

          if (!docUrl) {
            sendJson(res, 400, { ok: false, error: '缺少目标飞书文档链接' });
            return;
          }
          if (!blocks) {
            sendJson(res, 400, { ok: false, error: '缺少 PRD blocks 数据（未传 blocks 且 slug 对应的 md 文件不存在）' });
            return;
          }
          const job = createJob(state, {
            docUrl,
            blocks,
            sourceSlug: String(body?.sourceSlug || ''),
            sourceTitle: String(body?.sourceTitle || ''),
          });
          void runSyncJob(state, job).catch((error) => {
            const detail = error?.payload ? ` [code=${error.code} payload=${JSON.stringify(error.payload).slice(0, 400)}]` : '';
            updateJob(job, {
              status: 'failed',
              phase: 'failed',
              percent: job.percent || 0,
              message: '同步失败',
              error: (error?.message || String(error)) + detail,
            });
          });
          sendJson(res, 200, { ok: true, jobId: job.id });
        } catch (error) {
          sendJson(res, 401, { ok: false, error: error?.message || '请先完成飞书授权' });
        }
        return;
      }

      if (pathname.startsWith(FEISHU_SYNC_JOB_API_PREFIX) && req.method === 'GET') {
        const jobId = pathname.slice(FEISHU_SYNC_JOB_API_PREFIX.length);
        const job = state.jobs.get(jobId);
        if (!job) {
          sendJson(res, 404, { ok: false, error: '同步任务不存在或已过期' });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          job: {
            id: job.id,
            status: job.status,
            phase: job.phase,
            percent: job.percent,
            message: job.message,
            error: job.error,
            result: job.result,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
          },
        });
        return;
      }

      sendJson(res, 404, { ok: false, error: '未找到飞书同步接口' });
    },
  };
}
