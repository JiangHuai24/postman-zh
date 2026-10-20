#!/usr/bin/env node
// 把 src/locales/*.json 合并进运行时钩子，产出 dist/pm-chinese-runtime.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = path.join(root, 'src', 'locales');
const hookPath = path.join(root, 'src', 'pm-chinese.js');

const data = {};
let keys = 0;
for (const file of fs.readdirSync(localesDir).filter((f) => f.endsWith('.json')).sort()) {
  const ns = file.replace(/\.json$/, '');
  const dict = JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf8'));
  data[ns] = dict;
  keys += Object.keys(dict).length;
}

const hook = fs.readFileSync(hookPath, 'utf8');
if (!hook.includes('__PM_ZH_DATA__')) throw new Error('hook missing __PM_ZH_DATA__ placeholder');

const runtime = hook.replace('__PM_ZH_DATA__', () => JSON.stringify(data));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'pm-chinese-runtime.js'), runtime);
console.log(`built dist/pm-chinese-runtime.js  namespaces=${Object.keys(data).length}  keys=${keys}  size=${(runtime.length / 1024).toFixed(0)}KB`);
