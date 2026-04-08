#!/usr/bin/env node
/**
 * 检查用户级 Cursor MCP 配置：是否存在任一 server 的 args 中含字符串 chrome-devtools-mcp@latest。
 * 判定依据为包名版本串，而非 MCP 在 JSON 中的显示名称（key）。
 * 若不存在则写入 ~/.cursor/mcp.json 中的 mcpServers.chrome-devtools。
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const TARGET_ARG = 'chrome-devtools-mcp@latest';
const SERVER_KEY = 'chrome-devtools';

const canonicalServer = {
  command: 'npx',
  args: ['-y', TARGET_ARG],
  disabled: false,
};

function argsList(def) {
  const { args } = def || {};
  if (Array.isArray(args)) return args.map((a) => String(a).trim());
  if (typeof args === 'string') return [args.trim()];
  return [];
}

function hasChromeDevtoolsMcpLatest(servers) {
  if (!servers || typeof servers !== 'object') return false;
  for (const def of Object.values(servers)) {
    if (argsList(def).some((a) => a === TARGET_ARG)) return true;
  }
  return false;
}

const cursorDir = path.join(os.homedir(), '.cursor');
const mcpPath = path.join(cursorDir, 'mcp.json');

let data = {};
if (fs.existsSync(mcpPath)) {
  try {
    const raw = fs.readFileSync(mcpPath, 'utf8');
    data = JSON.parse(raw);
  } catch (e) {
    console.warn(`[mcp] 无法解析 ${mcpPath}，跳过自动配置：${e.message}`);
    process.exit(0);
  }
}

if (!data.mcpServers || typeof data.mcpServers !== 'object') {
  data.mcpServers = {};
}

if (hasChromeDevtoolsMcpLatest(data.mcpServers)) {
  console.log(`[check] Cursor MCP 已配置 ${TARGET_ARG}（按 args 检测）✓`);
  process.exit(0);
}

data.mcpServers[SERVER_KEY] = { ...canonicalServer };

try {
  fs.mkdirSync(cursorDir, { recursive: true });
  fs.writeFileSync(mcpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`[setup] 已写入 ${mcpPath}`);
  console.log(`        已添加 mcpServers.${SERVER_KEY} → npx -y ${TARGET_ARG}`);
  console.log('        请在 Cursor → Settings → Tools & MCP 中确认该 MCP 已启用，必要时重启 Cursor。');
} catch (e) {
  console.warn(`[mcp] 无法写入 ${mcpPath}：${e.message}`);
}

process.exit(0);
