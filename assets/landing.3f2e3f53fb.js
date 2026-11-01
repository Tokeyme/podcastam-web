// Landing pages of podcast.amapps.app (tool/web_landing.py): one player for the whole page, the
// hand-over into the web app, and the visit count. Everything on the page reads without this file.
(function () {
  'use strict';

  // ---- Counting: the same GoatCounter site and the same rules as the web app
  // (lib/services/web_stats.dart, web_stats_beacon.dart): never on local hosts, under a test
  // driver, in a frame, while prerendering, or with skipgc set. Only the KIND of page is sent
  // (top | podcast | episode | genre), never a show's or an episode's name: the privacy notice
  // promises no content in the count. A referrer from this site itself is left out for the same
  // reason (the pages also send only their origin onward: <meta name="referrer">).
  var COUNT = 'https://podcastam.goatcounter.com/count';
  var KIND = document.body.getAttribute('data-kind') || 'page';
  var counted = {};
  function mayCount() {
    try {
      if (location.protocol === 'file:') return false;
      if (/(^localhost$|\.localhost$|^127\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\.|^0\.0\.0\.0$|^\[::1?\]$)/
        .test(location.hostname)) return false;
      if (navigator.webdriver) return false;
      if (document.prerendering) return false;
      if (window.top !== window.self) return false;
    } catch (e) { return false; }
    try {
      if (localStorage.getItem('skipgc') === 't') return false;
    } catch (e) { /* storage blocked: counted, as in the app */ }
    return true;
  }
  function count(kind, path, title, event) {
    if (counted[kind] || !mayCount()) return;
    counted[kind] = true;
    var q = {p: path, t: title, s: String(screen.width || 0), b: '0',
      rnd: Math.floor(Math.random() * 1e9).toString(36)};
    if (event) q.e = 'true';
    else if (document.referrer && document.referrer.indexOf(location.origin + '/') !== 0 &&
      document.referrer !== location.origin) q.r = document.referrer;
    var url = COUNT + '?' + Object.keys(q).map(function (k) {
      return k + '=' + encodeURIComponent(q[k]);
    }).join('&');
    try { if (navigator.sendBeacon && navigator.sendBeacon(url)) return; } catch (e) { /* below */ }
    new Image().src = url;
  }
  function countVisit() { count('visit', '/landing/' + KIND, 'Podcasts AM landing: ' + KIND, false); }
  if (document.visibilityState === 'visible' && !document.prerendering) countVisit();
  else {
    var onShown = function () {
      if (document.visibilityState !== 'visible' || document.prerendering) return;
      document.removeEventListener('visibilitychange', onShown);
      document.removeEventListener('prerenderingchange', onShown);
      countVisit();
    };
    document.addEventListener('visibilitychange', onShown);
    document.addEventListener('prerenderingchange', onShown);
  }

  // ---- Hand-over into the web app. The app restores the place a reader left (podcast page,
  // player) from these keys at start (lib/services/last_location.dart); shared_preferences on the
  // web keeps each value JSON-encoded under "flutter.<key>". test/web_landing_handoff_test.dart
  // pins the format against the app's own reader.
  function put(key, value) { localStorage.setItem('flutter.' + key, JSON.stringify(value)); }
  function handOver(data) {
    if (data.podcast) {
      put('last.podcast', JSON.stringify(data.podcast));
      put('last.podcastCountry', data.country || 'us');
    }
    if (data.episode && data.podcast) {
      put('last.playEpisode', JSON.stringify(data.episode));
      put('last.playPodcast', JSON.stringify(data.podcast));
      put('last.playerOpen', true);
    } else if (data.podcast) {
      // Only the show: an earlier visit's open player would otherwise cover it at start.
      put('last.playerOpen', false);
    }
  }
  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[data-handoff]');
    if (!link) return;
    try { handOver(JSON.parse(link.getAttribute('data-handoff'))); } catch (err) {
      // Storage blocked or full: the app still opens, on its start page.
    }
  });

  // ---- The player: one audio element for every play button on the page.
  var bar = document.getElementById('player');
  if (!bar) return;
  var audio = new Audio();
  audio.preload = 'none';
  var art = bar.querySelector('.p-art');
  var title = bar.querySelector('.p-title');
  var show = bar.querySelector('.p-show');
  var toggle = bar.querySelector('.play');
  var seek = bar.querySelector('.p-seek');
  var time = bar.querySelector('.p-time');
  var error = bar.querySelector('.p-error');
  var open = bar.querySelector('.p-open');
  var current = null;
  var seeking = false;
  var failed = false;

  function fmt(s) {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }
  function duration() {
    if (isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return current ? Number(current.getAttribute('data-dur')) || 0 : 0;
  }
  function paint() {
    var playing = !audio.paused && !audio.ended && !failed;
    Array.prototype.forEach.call(document.querySelectorAll('[data-src]'), function (b) {
      var on = playing && current && b.getAttribute('data-src') === current.getAttribute('data-src');
      b.classList.toggle('playing', !!on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    toggle.classList.toggle('playing', playing);
    toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }
  function tick() {
    if (seeking) return;  // while the slider is dragged, it shows where it will go
    var d = duration();
    seek.value = d ? Math.round(audio.currentTime / d * 1000) : 0;
    time.textContent = fmt(audio.currentTime) + ' / ' + fmt(d);
    // Not every second while the slider has focus: a screen reader would read each one out.
    if (document.activeElement !== seek) {
      seek.setAttribute('aria-valuetext', fmt(audio.currentTime) + ' of ' + fmt(d));
    }
  }
  // The bar is fixed to the bottom: keep its height free below the page, so it never covers the
  // end of the page or the button that was just pressed.
  function reserve() {
    var h = bar.hidden ? 0 : bar.offsetHeight;
    document.documentElement.style.setProperty('--bar-h', h + 'px');
  }
  if (window.ResizeObserver) new ResizeObserver(reserve).observe(bar);
  function load(btn) {
    current = btn;
    failed = false;
    error.textContent = '';
    audio.src = btn.getAttribute('data-src');
    title.textContent = btn.getAttribute('data-title') || '';
    show.textContent = btn.getAttribute('data-show') || '';
    var image = btn.getAttribute('data-art');
    if (image) art.src = image;
    var handoff = btn.getAttribute('data-open');
    if (handoff && open) {
      open.setAttribute('data-handoff', handoff);
      open.hidden = false;
    } else if (open) {
      open.removeAttribute('data-handoff');
      open.hidden = true;
    }
    bar.hidden = false;
    reserve();
    var box = btn.getBoundingClientRect();
    if (box.bottom > window.innerHeight - bar.offsetHeight) btn.scrollIntoView({block: 'center'});
    if ('mediaSession' in navigator && window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title.textContent, artist: show.textContent,
        artwork: image ? [{src: image, sizes: '600x600', type: 'image/jpeg'}] : []});
    }
    tick();
  }
  function play() {
    if (failed || audio.error) {
      // Try again from the start of loading: a dropped connection is often gone on a second go.
      var at = audio.currentTime;
      failed = false;
      error.textContent = '';
      audio.load();
      if (at) audio.currentTime = at;
    }
    var p = audio.play();
    if (p && p.catch) p.catch(function (e) { if (e && e.name !== 'AbortError') fail(); });
    count('play', '/landing/play', 'landing-play', true);
  }
  function fail() {
    failed = true;
    audio.pause();
    error.textContent = 'This episode could not be played here. Press play to try again.';
    paint();
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-src]');
    if (!btn) return;
    e.preventDefault();
    if (current && current.getAttribute('data-src') === btn.getAttribute('data-src')) {
      if (audio.paused || failed) play(); else audio.pause();
      return;
    }
    load(btn);
    play();
  });
  toggle.addEventListener('click', function () {
    if (!current) return;
    if (audio.paused || failed) play(); else audio.pause();
  });
  seek.addEventListener('input', function () {
    seeking = true;
    var at = seek.value / 1000 * duration();
    time.textContent = fmt(at) + ' / ' + fmt(duration());
    seek.setAttribute('aria-valuetext', fmt(at) + ' of ' + fmt(duration()));
  });
  seek.addEventListener('change', function () {
    var d = duration();
    if (d) audio.currentTime = seek.value / 1000 * d;
    seeking = false;
  });
  ['play', 'pause', 'ended', 'playing'].forEach(function (ev) { audio.addEventListener(ev, paint); });
  audio.addEventListener('timeupdate', tick);
  audio.addEventListener('loadedmetadata', tick);
  audio.addEventListener('error', function () { if (audio.getAttribute('src')) fail(); });
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', play);
      navigator.mediaSession.setActionHandler('pause', function () { audio.pause(); });
      navigator.mediaSession.setActionHandler('seekbackward', function () {
        audio.currentTime = Math.max(0, audio.currentTime - 15); });
      navigator.mediaSession.setActionHandler('seekforward', function () {
        audio.currentTime = Math.min(duration(), audio.currentTime + 30); });
    } catch (e) { /* older browsers */ }
  }
})();
