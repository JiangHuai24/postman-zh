import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [,, repoFull, branch, messageFile] = process.argv;
const message = fs.readFileSync(messageFile, 'utf8');
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
const files = [];
(function walk(dir, rel = '') {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const full = path.join(dir, name);
    const r = rel ? rel + '/' + name : name;
    if (fs.statSync(full).isDirectory()) walk(full, r); else files.push({ full, rel: r });
  }
})(process.cwd());
console.log('files', files.length);
const blobs = [];
for (const f of files) {
  const content = fs.readFileSync(f.full).toString('base64');
  const j = await api('/repos/' + repoFull + '/git/blobs', { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) });
  blobs.push({ path: f.rel, sha: j.sha, mode: '100644', type: 'blob' });
}
const tree = await api('/repos/' + repoFull + '/git/trees', { method: 'POST', body: JSON.stringify({ tree: blobs }) });
const ref = await api('/repos/' + repoFull + '/git/ref/heads/' + branch);
const commit = await api('/repos/' + repoFull + '/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }) });
await api('/repos/' + repoFull + '/git/refs/heads/' + branch, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
const check = await api('/repos/' + repoFull + '/git/ref/heads/' + branch);
console.log('commit', commit.sha);
console.log('REMOTE ' + check.object.sha);
console.log('MATCH ' + (check.object.sha === commit.sha));
