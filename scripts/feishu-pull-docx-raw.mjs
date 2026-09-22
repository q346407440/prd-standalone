/**
 * 使用本地 .env.local + .local/feishu-auth.json（PRD 站「连接飞书」OAuth）
 * 将 docx / wiki 链接对应的文档正文拉取为纯文本（docx raw_content API）。
 *
 * 用法：
 *   node scripts/feishu-pull-docx-raw.mjs "https://my.feishu.cn/wiki/TOKEN"
 *   node scripts/feishu-pull-docx-raw.mjs "https://xxx.feishu.cn/docx/ID"
 *
 * 可选第二个参数为输出文件路径，默认打印到 stdout。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
const FEISHU_WIKI_BASE = 'https://open.feishu.cn/open-apis/wiki/v2';
const FEISHU_DOCX_BASE = 'https://open.feishu.cn/open-apis/docx/v1';

const ACCESS_TOKEN_SKEW_MS = 60_000;

function loadEnvLocal() {
  const p = path.join(ROOT, '.env.local');
  const env = {};
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

function readJson(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function toIsoFromNowSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function requestFeishuJson(url, options = {}) {
  const r = await fetch(url, options);
  const payload = await r.json();
  if (payload.code !== 0) {
    const err = new Error(payload.msg || `Feishu error ${payload.code}`);
    err.code = payload.code;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function parseDocUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('非法 URL');
  }
  const match = url.pathname.match(/\/(docx|wiki)\/([A-Za-z0-9]+)/);
  if (!match) throw new Error('暂只支持路径中含 /docx/ 或 /wiki/ 的飞书链接');
  return { kind: match[1], token: match[2] };
}

async function exchangeRefresh(config, refreshToken) {
  return requestFeishuJson(FEISHU_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: config.appId,
      client_secret: config.appSecret,
      refresh_token: refreshToken,
    }),
  });
}

async function ensureAccessToken(config, authPath) {
  let auth = readJson(authPath);
  if (!auth?.accessToken) {
    throw new Error(`缺少用户 access_token：请先在 PRD 编辑器里「连接飞书」完成授权（写入 ${authPath}）`);
  }
  if (auth.expiresAt) {
    const exp = new Date(auth.expiresAt).getTime();
    if (Number.isFinite(exp) && exp - ACCESS_TOKEN_SKEW_MS > Date.now()) {
      return auth.accessToken;
    }
  }
  if (!auth.refreshToken) throw new Error('access_token 已过期且无 refresh_token，请重新在编辑器里连接飞书');
  const tokenPayload = await exchangeRefresh(config, auth.refreshToken);
  const data = tokenPayload.data ?? tokenPayload;
  const next = {
    ...auth,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || auth.refreshToken,
    expiresAt: toIsoFromNowSeconds(data.expires_in),
    refreshExpiresAt: toIsoFromNowSeconds(data.refresh_token_expires_in),
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  fs.writeFileSync(authPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next.accessToken;
}

async function getWikiNode(accessToken, wikiToken) {
  const url = `${FEISHU_WIKI_BASE}/spaces/get_node?token=${encodeURIComponent(wikiToken)}`;
  const payload = await requestFeishuJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return payload.data?.node || null;
}

async function resolveDocumentId(accessToken, parsed) {
  if (parsed.kind === 'docx') return parsed.token;
  const node = await getWikiNode(accessToken, parsed.token);
  const documentId = node?.obj_token;
  if (!documentId) throw new Error('wiki get_node 未返回 obj_token，请确认应用具备 wiki:wiki:readonly 且账号有文档权限');
  return documentId;
}

async function fetchRawContent(accessToken, documentId) {
  const url = `${FEISHU_DOCX_BASE}/documents/${encodeURIComponent(documentId)}/raw_content`;
  const payload = await requestFeishuJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return payload.data?.content ?? '';
}

async function main() {
  const docUrl = process.argv[2];
  const outPath = process.argv[3];
  if (!docUrl) {
    console.error('用法: node scripts/feishu-pull-docx-raw.mjs <飞书 docx/wiki URL> [输出文件]');
    process.exit(1);
  }

  const env = loadEnvLocal();
  const appId = env.FEISHU_APP_ID || '';
  const appSecret = env.FEISHU_APP_SECRET || '';
  if (!appId || !appSecret) {
    throw new Error('.env.local 中需配置 FEISHU_APP_ID / FEISHU_APP_SECRET（用于刷新用户 token）');
  }

  const authPath = path.join(ROOT, '.local', 'feishu-auth.json');
  const accessToken = await ensureAccessToken({ appId, appSecret }, authPath);
  const parsed = parseDocUrl(docUrl);
  const documentId = await resolveDocumentId(accessToken, parsed);
  const titleNote = `[document_id=${documentId} source=${parsed.kind}]\n\n`;
  const body = await fetchRawContent(accessToken, documentId);
  const text = titleNote + body;

  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(ROOT, outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(ROOT, outPath), text, 'utf8');
    console.error(`已写入 ${path.resolve(ROOT, outPath)} ，约 ${text.length} 字符`);
  } else {
    process.stdout.write(text);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
