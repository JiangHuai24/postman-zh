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
})();
