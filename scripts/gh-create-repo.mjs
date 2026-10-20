// 用 GCM 缓存的凭据创建仓库（不落盘 token）
import { execFileSync } from 'node:child_process';
const name = process.argv[2];
const desc = process.argv[3] || '';
const cred = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
const pass = /^password=(.*)$/m.exec(cred)?.[1];
const user = /^username=(.*)$/m.exec(cred)?.[1];
if (!pass) { console.error('没有缓存凭据'); process.exit(1); }
const res = await fetch('https://api.github.com/user/repos', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + pass, Accept: 'application/vnd.github+json', 'User-Agent': 'postman-zh', 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, description: desc, private: false, has_issues: true, has_wiki: false }),
});
const j = await res.json();
console.log(res.status, JSON.stringify({ full_name: j.full_name, html_url: j.html_url, message: j.message }));
