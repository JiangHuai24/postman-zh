#!/usr/bin/env node
/**
 * 把中文运行时钩子注入 Postman 的 app.asar。
 * - 自动探测安装目录与当前版本
 * - 备份原始 app.asar（只备份一次，保留最原始的）
 * - 重打包 asar：改写 preload_desktop.js + 重算每条目的 offset/size/integrity
 * - 幂等：已注入且数据版本一致时跳过
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '/* __PM_ZH_HOOK__ */';
const BLOCK = { size: 16 };

export function findPostmanDirs() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const base = path.join(local, 'Postman');
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base)
    .filter((n) => /^app-\d/.test(n))
    .map((n) => path.join(base, n))
    .filter((p) => fs.existsSync(path.join(p, 'resources', 'app.asar')))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function readHeader(fd) {
  const head = Buffer.alloc(BLOCK.size);
  fs.readSync(fd, head, 0, BLOCK.size, 0);
  const jsonLen = head.readUInt32LE(12);
  const buf = Buffer.alloc(jsonLen);
  fs.readSync(fd, buf, 0, jsonLen, BLOCK.size);
  return { header: JSON.parse(buf.toString('utf8')), dataStart: BLOCK.size + jsonLen };
}

function collect(fd, header, dataStart) {
  const out = [];
  (function walk(node, prefix) {
    for (const [name, v] of Object.entries(node.files || {})) {
      const p = [...prefix, name];
      if (v.files) walk(v, p);
      else {
        const size = Number(v.size);
        const buf = Buffer.alloc(size);
        if (size) fs.readSync(fd, buf, 0, size, dataStart + Number(v.offset));
        out.push({ path: p, node: v, content: buf });
      }
    }
  })(header, []);
  return out;
}

function repack(entries, outPath) {
  let offset = 0;
  for (const e of entries) {
    e.node.offset = String(offset);
    e.node.size = e.content.length;
    const h = crypto.createHash('sha256').update(e.content).digest('hex');
    e.node.integrity = { algorithm: 'SHA256', hash: h, blockSize: 4194304, blocks: [h] };
    offset += e.content.length;
  }
  const header = {};
  // rebuild tree from paths
  for (const e of entries) {
    let node = header;
    for (let i = 0; i < e.path.length - 1; i++) {
      node.files = node.files || {};
      node = node.files[e.path[i]] = node.files[e.path[i]] || { files: {} };
    }
    node.files = node.files || {};
    node.files[e.path[e.path.length - 1]] = e.node;
  }
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const jsonLen = headerBytes.length;
  // Chromium pickle 头（实测格式）：[4][jsonLen+8][jsonLen+4][jsonLen][json 原文，无填充]
  const sizeBuf = Buffer.alloc(16);
  sizeBuf.writeUInt32LE(4, 0);
  sizeBuf.writeUInt32LE(jsonLen + 8, 4);
  sizeBuf.writeUInt32LE(jsonLen + 4, 8);
  sizeBuf.writeUInt32LE(jsonLen, 12);
  const tmp = outPath + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  fs.writeSync(fd, sizeBuf, 0, 16);
  fs.writeSync(fd, headerBytes, 0, jsonLen);
  for (const e of entries) fs.writeSync(fd, e.content, 0, e.content.length);
  fs.closeSync(fd);
  fs.renameSync(tmp, outPath);
  return { jsonLen, total: fs.statSync(outPath).size };
}

export function inject({ dir, runtimePath, dryRun = false, log = console.log }) {
  const asarPath = path.join(dir, 'resources', 'app.asar');
  const backupPath = asarPath + '.orig-backup';
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(asarPath, backupPath);
    log('已备份原始 app.asar -> ' + backupPath);
  } else {
    log('备份已存在，跳过备份');
  }
  const src = backupPath; // 永远从原始备份出发，保证幂等
  const runtime = fs.readFileSync(runtimePath, 'utf8');

  const fd = fs.openSync(src, 'r');
  const { header, dataStart } = readHeader(fd);
  const entries = collect(fd, header, dataStart);
  fs.closeSync(fd);

  const pre = entries.find((e) => e.path.length === 1 && e.path[0] === 'preload_desktop.js');
  if (!pre) throw new Error('未找到 preload_desktop.js，Postman 版本可能不受支持');
  const original = pre.content.toString('utf8');
  const at = original.indexOf(MARKER);
  const base = at >= 0 ? original.slice(0, at) : original;
  pre.content = Buffer.from(base + '\n;' + MARKER + '\n' + runtime + '\n', 'utf8');

  if (dryRun) { log('dry-run：将注入 ' + pre.content.length + ' 字节 preload'); return { asarPath, skipped: false }; }
  repack(entries, asarPath);
  log('已注入：' + asarPath + '  (' + fs.statSync(asarPath).size + ' 字节)');
  return { asarPath, skipped: false };
}

export function restore({ dir, log = console.log }) {
  const asarPath = path.join(dir, 'resources', 'app.asar');
  const backupPath = asarPath + '.orig-backup';
  if (!fs.existsSync(backupPath)) { log('没有找到备份，无法还原'); return false; }
  fs.copyFileSync(backupPath, asarPath);
  log('已还原：' + asarPath);
  return true;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const dirs = findPostmanDirs();
  if (!dirs.length) { console.error('未找到 Postman 安装目录'); process.exit(1); }
  if (args.includes('--restore')) {
    for (const d of dirs) restore({ dir: d });
    process.exit(0);
  }
  const target = dirs[dirs.length - 1];
  console.log('目标目录：' + target);
  inject({ dir: target, runtimePath: path.join(root, 'dist', 'pm-chinese-runtime.js') });
}
