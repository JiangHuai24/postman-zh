// 当 github.com:443 不可达时，改用 Git Data API（api.github.com）推送整棵树。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [,, repoFull, branch = 'main', messageFile] = process.argv;
const message = fs.readFileSync(messageFile, 'utf8');
const cred = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
const token = /^password=(.*)$/m.exec(cred)?.[1];
if (!token) { console.error('无凭据'); process.exit(1); }

const API = 'https://api.github.com';
async function api(pathname, opts = {}) {
  const res = await fetch(API + pathname, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'postman-zh',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(pathname + ' -> ' + res.status + ' ' + JSON.stringify(json).slice(0, 300));
  return json;
}

// 收集工作区文件（跳过 .git）
const files = [];
function walk(dir, rel = '') {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules' || name === 'scratch') continue;
    const full = path.join(dir, name);
    const r = rel ? rel + '/' + name : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, r); else files.push({ full, rel: r });
  }
}
walk(process.cwd());
console.log('files', files.length);

// 1) 上传 blob
const blobs = [];
let done = 0;
for (const f of files) {
  const content = fs.readFileSync(f.full).toString('base64');
  const j = await api('/repos/' + repoFull + '/git/blobs', { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) });
  blobs.push({ path: f.rel, sha: j.sha, mode: '100644', type: 'blob' });
  done++;
  if (done % 20 === 0) console.log('blobs', done + '/' + files.length);
}

// 2) 建 tree
const tree = await api('/repos/' + repoFull + '/git/trees', { method: 'POST', body: JSON.stringify({ tree: blobs }) });
console.log('tree', tree.sha);

// 3) 父提交（若分支已存在）
let parents = [];
try {
  const ref = await api('/repos/' + repoFull + '/git/ref/heads/' + branch);
  parents = [ref.object.sha];
  console.log('existing head', ref.object.sha);
} catch (e) { console.log('no existing branch（首次推送）'); }

// 4) 建 commit
const commit = await api('/repos/' + repoFull + '/git/commits', {
  method: 'POST',
  body: JSON.stringify({ message, tree: tree.sha, parents }),
});
console.log('commit', commit.sha);

// 5) 更新或创建 ref
if (parents.length) {
  await api('/repos/' + repoFull + '/git/refs/heads/' + branch, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
} else {
  await api('/repos/' + repoFull + '/git/refs', { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/' + branch, sha: commit.sha }) });
}
console.log('PUSHED ' + commit.sha);

// 6) 校验
const check = await api('/repos/' + repoFull + '/git/ref/heads/' + branch);
console.log('REMOTE ' + check.object.sha);
console.log('MATCH ' + (check.object.sha === commit.sha));
