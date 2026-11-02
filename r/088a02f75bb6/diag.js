// Hidden diagnosis for one browser at a time (?diag in the address, then it
// stays on for the tab). Loaded by index.html only then; ordinary visitors
// never fetch this file.
//
// Why (02.11.2026): on Andreas' iPhone 7 (iOS 15.8, the last Safari 15) no
// episode plays and no show can be followed, while every current browser
// works. No other test browser runs this build's WebKit with WebAssembly, so
// the phone itself has to say what goes wrong: this panel shows, on the page,
// what a desktop browser would show in its console — errors, failed requests,
// the drift worker's replies, every play() and how it ended — plus the browser
// features the database and the player depend on. "Copy" puts it all on the
// clipboard.
//
// Written for old engines on purpose: no syntax or API newer than Safari 14,
// and every hook in its own try, so the panel cannot be what breaks the app.
(function () {
  'use strict';
  var start = Date.now();
  var lines = [];
  var panel = null, body = null, small = false;
  var lastTouch = 0;

  function t() { return ((Date.now() - start) / 1000).toFixed(2) + 's'; }
  function str(x) {
    try {
      if (x instanceof Error) return x.name + ': ' + x.message + (x.stack ? ' | ' + String(x.stack).split('\n').slice(0, 4).join(' < ') : '');
      if (x && typeof x === 'object' && 'message' in x && 'name' in x) return x.name + ': ' + x.message;
      if (typeof x === 'string') return x;
      return JSON.stringify(x);
    } catch (e) { return String(x); }
  }
  function cut(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }
  function shortUrl(u) {
    try {
      var a = new URL(String(u), location.href);
      var p = a.pathname.length > 40 ? '…' + a.pathname.slice(-40) : a.pathname;
      return (a.host === location.host ? '' : a.host) + p;
    } catch (e) { return cut(u, 60); }
  }
  function log(kind, text) {
    lines.push(t() + ' ' + kind + ' ' + cut(text, 600));
    if (lines.length > 600) lines.splice(0, 100);
    draw();
  }
  window.__podcastamDiag = log;

  // --- the panel -----------------------------------------------------------
  // Not scrollable (touches go through), so it shows the newest lines; "Copy"
  // takes all of them.
  function draw() {
    if (!body) return;
    body.textContent = small ? lines.slice(-2).join('\n') : lines.slice(-60).join('\n');
    body.scrollTop = body.scrollHeight;
  }
  function button(label, onClick) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:12px system-ui;margin-left:6px;padding:4px 8px;border-radius:6px;border:1px solid #888;background:#333;color:#fff';
    b.addEventListener('click', function (e) { e.stopPropagation(); onClick(b); });
    return b;
  }
  function copy(b) {
    var text = 'Podcasts AM diag\n' + lines.join('\n');
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { ta.setSelectionRange(0, text.length); } catch (e) {}
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      b.textContent = ok ? 'Kopiert' : 'Kopieren ging nicht';
    }
    try {
      navigator.clipboard.writeText(text).then(function () { b.textContent = 'Kopiert'; }, fallback);
    } catch (e) { fallback(); }
  }
  // The panel lets every touch through to the app beneath (pointer-events:
  // none), so the app's top bar — Back, Follow — stays usable; only its own
  // buttons, in a row under the text, take touches.
  function mount() {
    if (panel || !document.body) return;
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;background:rgba(0,0,0,.72);' +
      'color:#b8f5b8;font:10px/1.35 ui-monospace,Menlo,monospace;padding:4px 6px;border-bottom:2px solid #d0bcff;' +
      'padding-top:max(4px, env(safe-area-inset-top));pointer-events:none';
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;color:#fff;font:bold 12px system-ui;margin-top:4px;pointer-events:auto';
    var title = document.createElement('span');
    title.textContent = 'Diagnose';
    title.style.flex = '1';
    head.appendChild(title);
    head.appendChild(button('Kopieren', copy));
    head.appendChild(button('Klein', function (b) {
      small = !small;
      b.textContent = small ? 'Groß' : 'Klein';
      body.style.maxHeight = small ? '2.8em' : '40vh';
      draw();
    }));
    head.appendChild(button('Aus', function () {
      try { sessionStorage.removeItem('podcastam.diag'); } catch (e) {}
      panel.remove(); panel = body = null;
    }));
    body = document.createElement('pre');
    body.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-all;max-height:40vh;overflow:hidden';
    panel.appendChild(body);
    panel.appendChild(head);
    document.body.appendChild(panel);
    draw();
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  // --- console, errors, rejections ----------------------------------------
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    try {
      var orig = console[level];
      console[level] = function () {
        try { log(level.toUpperCase(), Array.prototype.map.call(arguments, str).join(' ')); } catch (e) {}
        return orig.apply(console, arguments);
      };
    } catch (e) {}
  });
  window.addEventListener('error', function (e) {
    var tgt = e.target;
    if (tgt && tgt !== window && (tgt.src || tgt.href)) {
      log('LOADFAIL', (tgt.tagName || '') + ' ' + shortUrl(tgt.src || tgt.href));
    } else {
      log('ERROR', (e.message || '') + ' @' + shortUrl(e.filename || '') + ':' + e.lineno + ':' + e.colno +
        (e.error ? ' | ' + str(e.error) : ''));
    }
  }, true);
  window.addEventListener('unhandledrejection', function (e) { log('REJECT', str(e.reason)); });

  // --- taps: how long before a play() the finger left the glass --------------
  ['touchend', 'pointerup', 'click'].forEach(function (type) {
    document.addEventListener(type, function () { lastTouch = Date.now(); }, true);
  });

  // --- workers: the drift worker's creation, errors and first replies -------
  function wrapWorker(name) {
    try {
      var Orig = window[name];
      if (!Orig) return;
      var Wrapped = function (url, opts) {
        var w = new Orig(url, opts);
        log(name, 'new ' + shortUrl(url));
        var target = name === 'SharedWorker' ? w.port : w;
        var seen = 0;
        try {
          w.addEventListener('error', function (e) {
            log(name + ' ERROR', shortUrl(url) + ' ' + (e.message || '(no message)') +
              (e.filename ? ' @' + shortUrl(e.filename) + ':' + e.lineno : ''));
          });
          target.addEventListener('message', function (e) {
            if (seen++ < 6) log(name + ' MSG', cut(str(e.data), 220));
          });
          target.addEventListener('messageerror', function () { log(name + ' MSGERROR', shortUrl(url)); });
        } catch (e) {}
        return w;
      };
      Wrapped.prototype = Orig.prototype;
      window[name] = Wrapped;
    } catch (e) { log('DIAG', 'wrap ' + name + ' failed ' + str(e)); }
  }
  wrapWorker('Worker');
  wrapWorker('SharedWorker');

  // --- network: failures and error statuses -------------------------------
  try {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      return origFetch.apply(this, arguments).then(function (r) {
        if (!r.ok) log('FETCH', r.status + ' ' + shortUrl(url));
        return r;
      }, function (err) {
        log('FETCH FAIL', shortUrl(url) + ' ' + str(err));
        throw err;
      });
    };
  } catch (e) {}
  try {
    var xo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      var x = this;
      try {
        x.addEventListener('loadend', function () {
          if (x.status === 0 || x.status >= 400) log('XHR', (x.status || 'FAIL') + ' ' + method + ' ' + shortUrl(url));
        });
      } catch (e) {}
      return xo.apply(this, arguments);
    };
  } catch (e) {}

  // --- media: every element, every play(), how it ended --------------------
  var MEDIA_EVENTS = ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'pause', 'waiting', 'stalled',
    'suspend', 'abort', 'emptied', 'ended', 'error'];
  var watched = typeof WeakSet === 'function' ? new WeakSet() : null;
  var mediaCount = 0;
  function watch(el) {
    if (!el || (watched && watched.has(el))) return;
    if (watched) watched.add(el);
    var id = 'audio#' + (++mediaCount);
    el.__diagId = id;
    MEDIA_EVENTS.forEach(function (type) {
      el.addEventListener(type, function () {
        var extra = '';
        if (type === 'error' && el.error) extra = ' code=' + el.error.code + ' ' + (el.error.message || '');
        log('MEDIA', id + ' ' + type + ' t=' + (el.currentTime || 0).toFixed(1) + ' rs=' + el.readyState +
          ' ns=' + el.networkState + extra);
      });
    });
  }
  try {
    var ce = Document.prototype.createElement;
    Document.prototype.createElement = function (tag) {
      var el = ce.apply(this, arguments);
      if (typeof tag === 'string' && /^(audio|video)$/i.test(tag)) watch(el);
      return el;
    };
  } catch (e) {}
  try {
    var OrigAudio = window.Audio;
    window.Audio = function (src) { var a = src === undefined ? new OrigAudio() : new OrigAudio(src); watch(a); return a; };
    window.Audio.prototype = OrigAudio.prototype;
  } catch (e) {}
  try {
    var play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      watch(this);
      var el = this, id = el.__diagId;
      var since = lastTouch ? (Date.now() - lastTouch) + ' ms after the last tap' : 'no tap yet';
      log('PLAY', id + ' play() ' + since + ', src=' + shortUrl(el.currentSrc || el.src) + ' preload=' + el.preload +
        ' rs=' + el.readyState);
      var p = play.apply(this, arguments);
      if (p && typeof p.then === 'function') {
        p.then(function () { log('PLAY', id + ' play() resolved'); },
          function (err) { log('PLAY FAIL', id + ' ' + str(err)); });
      }
      return p;
    };
    var load = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load = function () {
      watch(this);
      log('MEDIA', this.__diagId + ' load() src=' + shortUrl(this.src));
      return load.apply(this, arguments);
    };
  } catch (e) {}

  // --- what this browser offers -------------------------------------------
  function features() {
    var f = [];
    function has(name, v) { f.push(name + '=' + (v ? 'ja' : 'NEIN')); }
    log('UA', navigator.userAgent);
    has('SharedWorker', typeof SharedWorker === 'function');
    has('Worker', typeof Worker === 'function');
    has('WebAssembly', typeof WebAssembly === 'object');
    has('indexedDB', typeof indexedDB === 'object' && indexedDB !== null);
    has('OPFS', !!(navigator.storage && navigator.storage.getDirectory));
    has('SharedArrayBuffer', typeof SharedArrayBuffer === 'function');
    has('BigInt64Array', typeof BigInt64Array === 'function');
    has('structuredClone', typeof structuredClone === 'function');
    has('AbortSignal.timeout', typeof AbortSignal === 'function' && typeof AbortSignal.timeout === 'function');
    has('locks', !!navigator.locks);
    has('mediaSession', !!navigator.mediaSession);
    has('standalone', !!navigator.standalone);
    var ls = 'NEIN';
    try { localStorage.setItem('__diag', '1'); localStorage.removeItem('__diag'); ls = 'ja'; } catch (e) { ls = 'NEIN ' + e.name; }
    f.push('localStorage=' + ls);
    log('KANN', f.join(' '));

    if (typeof WebAssembly === 'object') {
      fetch('/sqlite3.wasm').then(function (r) {
        var type = r.headers.get('content-type');
        return r.arrayBuffer().then(function (b) { return WebAssembly.compile(b).then(function () { return b.byteLength + ' B ' + type; }); });
      }).then(function (s) { log('PROBE', 'sqlite3.wasm compiles: ' + s); },
        function (e) { log('PROBE FAIL', 'sqlite3.wasm: ' + str(e)); });
    }
    try {
      var req = indexedDB.open('__diag_probe', 1);
      req.onsuccess = function () { req.result.close(); log('PROBE', 'IndexedDB opens'); try { indexedDB.deleteDatabase('__diag_probe'); } catch (e) {} };
      req.onerror = function () { log('PROBE FAIL', 'IndexedDB: ' + str(req.error)); };
    } catch (e) { log('PROBE FAIL', 'IndexedDB: ' + str(e)); }

    // OPFS the way drift tests it, but in a worker of our own and with a file
    // of our own: is the sync access handle the old (Promise) kind?
    var src = '(' + function () {
      var out = [];
      function done() { postMessage(out.join('; ')); }
      if (!(self.navigator && navigator.storage && navigator.storage.getDirectory)) { out.push('no OPFS in worker'); done(); return; }
      navigator.storage.getDirectory().then(function (root) {
        return root.getFileHandle('_diag_probe', { create: true }).then(function (fh) {
          if (!fh.createSyncAccessHandle) { out.push('no createSyncAccessHandle'); return; }
          return fh.createSyncAccessHandle().then(function (h) {
            var s = h.getSize();
            out.push('getSize=' + (s && typeof s.then === 'function' ? 'Promise (old API)' : typeof s));
            var c = h.close();
            out.push('close=' + (c && typeof c.then === 'function' ? 'Promise (old API)' : typeof c));
            return root.removeEntry('_diag_probe').then(function () { out.push('removeEntry right after close: ok'); },
              function (e) { out.push('removeEntry right after close: ' + e.name + ' ' + e.message); return c; })
              .then(function () { return root.removeEntry('_diag_probe').catch(function () {}); });
          });
        });
      }).then(done, function (e) { out.push('error ' + e.name + ' ' + e.message); done(); });
    } + ')()';
    try {
      var OrigWorker = Worker.prototype.constructor;
      var w = new OrigWorker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = function (e) { log('PROBE', 'OPFS in worker: ' + e.data); w.terminate(); };
      w.onerror = function (e) { log('PROBE FAIL', 'OPFS worker: ' + e.message); };
    } catch (e) { log('PROBE FAIL', 'OPFS worker: ' + str(e)); }
  }
  setTimeout(features, 0);

  // What the database left behind, a while after the start and on demand.
  setTimeout(function () {
    try {
      if (indexedDB.databases) {
        indexedDB.databases().then(function (dbs) {
          log('STORAGE', 'IndexedDB: ' + (dbs.map(function (d) { return d.name; }).join(', ') || '(none)'));
        });
      }
    } catch (e) {}
  }, 15000);
})();
