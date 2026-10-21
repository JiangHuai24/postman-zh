# Postman 简体中文汉化 · postman-zh

把 **Postman 桌面版**的界面变成简体中文。Postman 官方没有中文语言选项（只内置 en-US 与 ja），本项目在运行时把官方语言包替换成中文译文。

> 非官方项目，与 Postman, Inc. 无关联。仓库不含 Postman 的任何源码或二进制，仅供个人本地学习使用。

## 它怎么工作

Postman 桌面版的主界面**不是打包在本地**的，而是加载远程页面 desktop.postman.com，界面文案全部来自远程语言包：

```
_ar-assets/locale-asset-manifest-<版本>.json
_ar-assets/locales/en-US/<命名空间>-<hash>.json
```

主窗口的 webPreferences 是 contextIsolation=false + nodeIntegration=true，所以 preload 脚本与页面共享同一个 JS 上下文，并且**先于**页面脚本执行。本项目把一小段运行时钩子追加进 app.asar 里的 preload_desktop.js，钩子包裹 fetch / XMLHttpRequest，拦住 en-US 语言包响应，把对应词条换成中文再交还给页面。

- 改的是**响应体**，因此走网络还是走 Service Worker 缓存都同样生效；
- 每拿到一个语言包就替换一次，界面切换、懒加载的模块都会跟着变中文。

## 使用

```bash
# 1. 完全退出 Postman
# 2. 构建运行时钩子（把 src/locales 合并进 dist/pm-chinese-runtime.js）
node scripts/build.mjs

# 3. 注入（自动查找安装目录与版本，自动备份原始 app.asar）
node scripts/inject.mjs

# 4. 重新打开 Postman，界面即为中文
```

卸载汉化：

```bash
node scripts/inject.mjs --restore
```

### 注意

- **Postman 自动更新后汉化会失效**：升级会生成新的版本目录（app-<版本>），不含补丁。重新跑一次 inject.mjs 即可。
- 注入前会备份为 app.asar.orig-backup；每次注入都从这份原始备份出发，所以重复执行是幂等的。
- 需要先退出 Postman，否则文件被占用无法写入。
- 若在 Electron 相关环境（如某些 IDE、工具链）里启动，注意环境变量 ELECTRON_RUN_AS_NODE：为 1 时 Postman 会以纯 Node 模式启动并立即退出，表现为打不开。

## 两层汉化

| 层 | 覆盖对象 | 做法 |
| --- | --- | --- |
| 语言包层 | 官方 en-US 语言包里的 20448 条词条 | 拦截 fetch/XHR 响应替换 |
| DOM 兜底层 | 硬编码 / 服务端下发的文案（侧栏面板名 COLLECTIONS/SPECS、按钮 Upgrade/Connect、New Collection 等） | MutationObserver 整串精确匹配替换，跳过输入框与代码编辑器 |

DOM 词典在 src/dom-zh.json，可自行增补。

两条防误伤规则：

1. 跳过 input/textarea/code/pre、contenteditable 与 CodeMirror/Monaco 子树；
2. 短词（`Headers`、`Body`、`Docs` 等）在词典里加 `@btn:` 前缀，表示**只在按钮/标签页上下文替换**，避免误伤响应正文里出现的同名文本。

覆盖范围包含付费引导弹窗（升级套餐、价格、权益清单等）——这些文案由服务端下发，不在语言包里。

## 目录结构

```
postman-zh/
├── scripts/
│   ├── build.mjs     # 合并 src/locales/*.json → dist/pm-chinese-runtime.js
│   └── inject.mjs    # 备份 / 解包 / 注入 / 重打包 app.asar，含 --restore
├── src/
│   ├── pm-chinese.js # 运行时钩子源码（语言包层 + DOM 兜底层）
│   ├── dom-zh.json   # DOM 兜底词典（硬编码文案）
│   └── locales/      # 178 个命名空间的中文词条，一个模块一个文件
└── dist/
    └── pm-chinese-runtime.js  # 构建产物（钩子 + 内联词库）
```

## 词库

| 项 | 数值 |
| --- | --- |
| 命名空间 | 178 |
| 词条 | 20448 |
| 与 Postman 12.33.1 的 en-US 键覆盖率 | 100%（键对齐） |

词条按命名空间拆分，可直接编辑 src/locales/<命名空间>.json 后重新 build + inject。

## 技术要点（重打包 asar）

Electron 的 asar 头是 Chromium pickle：

```
[uint32 = 4][uint32 = jsonLen + 8][uint32 = jsonLen + 4][uint32 = jsonLen][JSON 原文]
```

**没有额外填充**。改完 preload_desktop.js 后必须为每个条目重算 offset / size / integrity（SHA256），否则 Electron 会直接拒绝启动（表现为进程瞬间退出、无任何日志）。

## 引用与致谢

- src/locales/ 的中文译文参考了社区项目 hlmd/postman-chinese-injector（MIT），并针对 Postman 12.33.1 的英文原文做了补译与校对。

## License

MIT
