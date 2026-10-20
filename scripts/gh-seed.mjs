import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const [,, repoFull, branch = 'main'] = process.argv;
const repo = repoFull;
const cred = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
const token = /^password=(.*)$/m.exec(cred)?.[1];
const API = 'https://api.github.com';
async function api(p, opts = {}) {
  const res = await fetch(API + p, { ...opts, headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'postman-zh', 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const t = await res.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!res.ok) throw new Error(p + ' -> ' + res.status + ' ' + JSON.stringify(j).slice(0, 300));
  return j;
}
// 用 Contents API 建第一个提交（空仓库只能这样起手）
const content = fs.readFileSync('README.md').toString('base64');
const j = await api('/repos/' + repo + '/contents/README.md', {
  method: 'PUT',
  body: JSON.stringify({ message: 'chore: 初始化仓库', content, branch }),
});
console.log('seed commit', j.commit.sha);
