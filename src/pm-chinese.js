/* Postman 简体中文界面 —— 运行时语言包注入钩子
 * 原理：Postman 主窗口 contextIsolation=false、nodeIntegration=true，
 *      preload 与页面共享同一 main world 且先于页面脚本执行。
 *      这里包裹 window.fetch / XMLHttpRequest，拦截 en-US 语言包响应，
 *      把中文译文合并回去再交给页面。
 */
(function () {
  'use strict';
  if (window.__PM_ZH_I18N__) return;
  window.__PM_ZH_I18N__ = { version: '0.1.0', hits: 0, misses: 0, errors: [] };

  var DATA = __PM_ZH_DATA__;

  var HASH_RE = /-[0-9a-f]{16}$/;
  var LOCALE_RE = /\/locales\/(en-US|en)\/([^/?#]+)\.json(?:[?#]|$)/i;

  function namespaceOf(url) {
    var m = LOCALE_RE.exec(url);
    if (!m) return null;
    return m[2].replace(HASH_RE, '');
  }

  function translate(ns, payload) {
    var dict = DATA[ns];
    if (!dict) { window.__PM_ZH_I18N__.misses++; return payload; }
    var hits = 0, misses = 0;
    function walk(node, path) {
      if (typeof node === 'string') {
        var t = dict[path];
        if (t !== undefined) { hits++; return t; }
        misses++;
        return node;
      }
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) node[i] = walk(node[i], path);
        return node;
      }
      if (node && typeof node === 'object') {
        for (var k in node) if (Object.prototype.hasOwnProperty.call(node, k)) {
          node[k] = walk(node[k], path ? path + '.' + k : k);
        }
        return node;
      }
      return node;
    }
    var out = walk(payload, '');
    window.__PM_ZH_I18N__.hits += hits;
    window.__PM_ZH_I18N__.misses += misses;
    return out;
  }

  // ---- fetch ----
  if (typeof window.fetch === 'function') {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var p = origFetch.apply(this, arguments);
      var ns = namespaceOf(url);
      if (!ns) return p;
      return p.then(function (res) {
        if (!res || !res.ok) return res;
        return res.clone().json().then(function (json) {
          var body = JSON.stringify(translate(ns, json));
          return new Response(body, {
            status: res.status,
            statusText: res.statusText,
            headers: { 'Content-Type': 'application/json' }
          });
        }).catch(function (e) {
          window.__PM_ZH_I18N__.errors.push('fetch:' + ns + ':' + e);
          return res;
        });
      });
    };
  }

  // ---- XMLHttpRequest ----
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var open = XHR.prototype.open;
    var send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      try { this.__pmZhNs = namespaceOf(String(url)); } catch (e) { this.__pmZhNs = null; }
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      var self = this;
      if (self.__pmZhNs) {
        self.addEventListener('readystatechange', function () {
          if (self.readyState !== 4 || self.__pmZhDone) return;
          self.__pmZhDone = true;
          try {
            if (self.responseType === 'json' && self.response && typeof self.response === 'object') {
              translate(self.__pmZhNs, self.response);
            } else if ((!self.responseType || self.responseType === 'text') && typeof self.responseText === 'string') {
              var json = JSON.parse(self.responseText);
              var txt = JSON.stringify(translate(self.__pmZhNs, json));
              Object.defineProperty(self, 'responseText', { value: txt, configurable: true });
              Object.defineProperty(self, 'response', { value: txt, configurable: true });
            }
          } catch (e) { window.__PM_ZH_I18N__.errors.push('xhr:' + self.__pmZhNs + ':' + e); }
        });
      }
      return send.apply(this, arguments);
    };
  }

  // ---- 硬编码 / 服务端下发文案的 DOM 兜底 ----
  // 只做「整串精确匹配」，跳过输入框与代码编辑器，避免改到用户输入。
  var DOM_DICT = __PM_ZH_DOM__;

  function shouldSkip(node) {
    for (var el = node.parentElement; el; el = el.parentElement) {
      if (el.isContentEditable) return true;
      var tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'CODE' || tag === 'PRE') return true;
      var cls = typeof el.className === 'string' ? el.className : '';
      if (cls && (/cm-editor|CodeMirror|monaco-editor|ace_editor|ProseMirror/.test(cls))) return true;
      // 响应/预览/代码展示区一律不动，避免影响返回内容的阅读与复制
      if (cls && (/response|json-viewer|code-viewer|preview|response-body|renderer/i.test(cls))) return true;
    }
    return false;
  }

  // 短词（Headers/Body/Docs 等）只在按钮/标签页上下文里替换，
  // 避免误伤响应正文或用户数据里出现的同名文本。
  function inButtonContext(node) {
    var el = node.parentElement, depth = 0;
    while (el && depth++ < 6) {
      var tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'A') return true;
      var role = el.getAttribute && el.getAttribute('role');
      if (role === 'button' || role === 'tab' || role === 'menuitem') return true;
      el = el.parentElement;
    }
    return false;
  }

  function lookup(trimmed) {
    var hit = DOM_DICT[trimmed];
    if (hit !== undefined) return { text: hit, btnOnly: false };
    hit = DOM_DICT['@btn:' + trimmed];
    if (hit !== undefined) return { text: hit, btnOnly: true };
    return null;
  }

  function translateNode(node) {
    var raw = node.nodeValue;
    if (!raw) return;
    var trimmed = raw.trim();
    if (!trimmed || trimmed.length > 80) return;
    var found = lookup(trimmed);
    if (!found || found.text === trimmed) return;
    if (found.btnOnly && !inButtonContext(node)) return;
    if (shouldSkip(node)) return;
    node.nodeValue = raw.replace(trimmed, found.text);
    window.__PM_ZH_I18N__.domHits = (window.__PM_ZH_I18N__.domHits || 0) + 1;
  }

  function translateAttrs(el) {
    if (!el || el.nodeType !== 1) return;
    var keys = ['aria-label', 'title', 'placeholder', 'alt'];
    for (var i = 0; i < keys.length; i++) {
      var v = el.getAttribute(keys[i]);
      if (!v) continue;
      var found = lookup(v.trim());
      if (found && found.text !== v.trim()) {
        el.setAttribute(keys[i], found.text);
        window.__PM_ZH_I18N__.domHits = (window.__PM_ZH_I18N__.domHits || 0) + 1;
      }
    }
  }

  function scan(root) {
    if (!root) return;
    try {
      if (root.nodeType === 3) translateNode(root);
      else if (root.nodeType === 1) {
        translateAttrs(root);
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        var n; while ((n = walker.nextNode())) translateNode(n);
      }
    } catch (e) { window.__PM_ZH_I18N__.errors.push('dom:' + e); }
  }

  function startDomLayer() {
    if (!Object.keys(DOM_DICT).length) return;
    scan(document.body);
    var obs = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'childList') {
          for (var j = 0; j < r.addedNodes.length; j++) scan(r.addedNodes[j]);
        } else if (r.type === 'characterData') {
          scan(r.target);
        } else if (r.type === 'attributes' && r.attributeName) {
          translateAttrs(r.target);
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder', 'alt'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDomLayer);
  } else {
    startDomLayer();
  }

})();
