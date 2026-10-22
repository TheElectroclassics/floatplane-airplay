// ==UserScript==
// @name         Floatplane → Reproductor nativo de macOS + AirPlay
// @namespace    https://floatplane.com/
// @version      2.0.2
// @description  Añade AirPlay y Picture-in-Picture al reproductor de Floatplane en Safari, con un modo opcional de reproductor nativo de macOS.
// @match        https://www.floatplane.com/*
// @match        https://floatplane.com/*
// @run-at       document-start
// @grant        none
// @homepageURL  https://github.com/ajmediamex/floatplane-airplay
// @updateURL    https://raw.githubusercontent.com/ajmediamex/floatplane-airplay/main/floatplane-native-airplay.user.js
// @downloadURL  https://raw.githubusercontent.com/ajmediamex/floatplane-airplay/main/floatplane-native-airplay.user.js
// ==/UserScript==

(() => {
  'use strict';

  const API = location.origin + '/api/v3';
  const LS_QUALITY = 'fpNative.quality';   // altura preferida en modo nativo (p. ej. 1080)
  const LS_MODE = 'fpNative.mode';         // 'enhance' (reproductor de Floatplane + botones) | 'native'
  const LOG = (...a) => console.log('[FP-Native]', ...a);

  // AirPlay de streams y HLS nativo solo existen en Safari.
  const canHLS = document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
  if (!canHLS) { LOG('Este navegador no reproduce HLS de forma nativa (usa Safari). Script inactivo.'); return; }

  // =====================================================================
  // 1) Ganchos tempranos (antes de que cargue el reproductor de Floatplane)
  // =====================================================================

  // a) Registrar qué blob: URLs vienen de ManagedMediaSource. Con MMS, Safari permite
  //    AirPlay si el <video> tiene una fuente HLS alternativa; con MediaSource clásico, no.
  const mmsUrls = new Set();
  try {
    const MMS = window.ManagedMediaSource;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
      const u = origCreate.apply(this, arguments);
      try { if (MMS && obj instanceof MMS) mmsUrls.add(u); } catch {}
      return u;
    };
  } catch {}

  // b) Registrar las playlists .m3u8 que pide el reproductor (URL exacta, con token y calidad actual).
  const m3u8Log = [];
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (/\.m3u8(\?|$)/i.test(e.name)) m3u8Log.push({ url: e.name, t: e.startTime });
      }
    }).observe({ type: 'resource', buffered: true });
  } catch {}

  // c) Impedir que la página desactive Picture-in-Picture.
  try {
    const proto = HTMLVideoElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'disablePictureInPicture');
    if (d && d.set) {
      Object.defineProperty(proto, 'disablePictureInPicture', {
        configurable: true, enumerable: d.enumerable,
        get() { return d.get.call(this); },
        set() { d.set.call(this, false); },
      });
    }
  } catch {}

  // =====================================================================
  // 2) Utilidades
  // =====================================================================
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  function el(tag, props = {}, kids = []) {
    const e = Object.assign(document.createElement(tag), props);
    for (const k of kids) e.append(k);
    return e;
  }

  // Iconos (SVG) para los botones del reproductor.
  const ICON_AIRPLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-3.2l-1.6-2H20V6H4v9h2.8l-1.6 2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm9 9.2 6 7.3H6l6-7.3z"/></svg>';
  const ICON_PIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v12h16V6H4zm8 5h7v6h-7v-6z"/></svg>';

  const css = document.createElement('style');
  css.textContent = `
    .fpn-host:hover .fpn-ovl:not(.fpn-sync), .fpn-ovl.fpn-vis, .fpn-ovl:focus-within, .fpn-ovl.fpn-show { opacity:1; }
    .fpn-ovl { position:absolute; bottom:10px; right:10px; z-index:2147483000; display:flex; gap:4px;
      align-items:center; opacity:0; transition:opacity .2s; font:13px -apple-system,BlinkMacSystemFont,sans-serif; }
    .fpn-ovl button { background:transparent; color:#fff; border:0; border-radius:6px; padding:0 6px; height:var(--fpn-btn,32px);
      min-width:var(--fpn-btn,32px); display:flex; align-items:center; justify-content:center; font:inherit; cursor:pointer; opacity:.9; }
    .fpn-ovl button:hover { background:rgba(255,255,255,.14); opacity:1; }
    .fpn-ovl button svg { width:22px; height:22px; fill:currentColor; display:block; }
    .fpn-tip { position:absolute; bottom:calc(100% + 6px); right:0; white-space:nowrap;
      color:#fff; background:rgba(20,22,27,.85); border-radius:8px; padding:5px 8px; }
    .fpn-tip:empty { display:none; }
    .fpn-wrap { width:100%; background:#000; position:relative; z-index:1; }
    .fpn-video { width:100%; aspect-ratio:16/9; max-height:85vh; display:block; background:#000; }
    .fpn-bar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:8px 10px;
      background:#16181d; color:#e6e6e6; font:13px -apple-system,BlinkMacSystemFont,sans-serif; }
    .fpn-bar select, .fpn-bar button { background:#2a2e36; color:#eee; border:1px solid #3a3f49;
      border-radius:6px; padding:4px 10px; font:inherit; cursor:pointer; }
    .fpn-bar button:hover { background:#353a44; }
    .fpn-bar .fpn-spacer { flex:1; }
    .fpn-bar .fpn-msg { opacity:.7; }
  `;
  (document.head || document.documentElement).appendChild(css);

  // ---------- API de Floatplane ----------
  async function api(path) {
    const r = await fetch(API + path, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${path}`);
    return r.json();
  }

  function route() {
    let m = location.pathname.match(/^\/post\/([^/?#]+)/);
    if (m) return { type: 'post', id: m[1] };
    m = location.pathname.match(/^\/channel\/([^/?#]+)\/live/);
    if (m) return { type: 'live', creator: m[1] };
    return null;
  }

  async function getEntities(r) {
    if (r.type === 'post') {
      const post = await api(`/content/post?id=${encodeURIComponent(r.id)}`);
      const items = (post.videoAttachments || [])
        .map(a => (typeof a === 'string' ? { id: a, title: '' } : { id: a.id, title: a.title || '' }));
      return { scenario: 'onDemand', poster: post.thumbnail?.path || '', items };
    }
    const creators = await api(`/creator/named?creatorURL[0]=${encodeURIComponent(r.creator)}`);
    const c = Array.isArray(creators) ? creators[0] : creators;
    const live = c?.liveStream;
    return { scenario: 'live', poster: live?.thumbnail?.path || '', items: live ? [{ id: live.id, title: live.title || 'En vivo' }] : [] };
  }

  async function getVariants(entityId, scenario) {
    const info = await api(`/delivery/info?scenario=${scenario}&entityId=${encodeURIComponent(entityId)}`);
    const out = [];
    for (const g of info.groups || []) {
      const origin = g.origins?.[0]?.url || '';
      for (const v of g.variants || []) {
        if (v.enabled === false || v.hidden) continue;
        if (v.mimeType && !/mpegurl/i.test(v.mimeType)) continue;
        const url = /^https?:\/\//.test(v.url) ? v.url : origin + v.url;
        const height = v.meta?.video?.height || parseInt(v.name, 10) || 0;
        out.push({ label: v.label || v.name || `${height}p`, height, url });
      }
    }
    out.sort((a, b) => b.height - a.height);
    return out;
  }

  function preferredIndex(variants) {
    const pref = parseInt(ls.get(LS_QUALITY, '0'), 10);
    if (!pref) return 0;
    const i = variants.findIndex(v => v.height <= pref);
    return i >= 0 ? i : variants.length - 1;
  }

  // Playlist que está usando ahora el reproductor de Floatplane (desde que se abrió esta página).
  let routeT = 0;
  function currentM3U8() {
    for (let i = m3u8Log.length - 1; i >= 0; i--) {
      if (m3u8Log[i].t >= routeT - 1000) return m3u8Log[i].url;
    }
    return null;
  }

  // ---------- localizar el reproductor original ----------
  function findPlayer() {
    let best = null, area = 0;
    for (const v of document.querySelectorAll('video:not(.fpn-video)')) {
      const r = v.getBoundingClientRect();
      if (r.width * r.height > area) { area = r.width * r.height; best = v; }
    }
    if (!best || area < 20000) return null;
    const vr = best.getBoundingClientRect();
    let host = best;
    while (host.parentElement && host.parentElement !== document.body) {
      const pr = host.parentElement.getBoundingClientRect();
      if (pr.height > vr.height * 1.25 + 80 || pr.width > vr.width * 1.05 + 20) break;
      host = host.parentElement;
    }
    return { video: best, host };
  }

  function waitForPlayer(timeout = 20000) {
    return new Promise(res => {
      const t0 = Date.now();
      (function tick() {
        const p = findPlayer();
        if (p) return res(p);
        if (Date.now() - t0 > timeout) return res(null);
        setTimeout(tick, 400);
      })();
    });
  }

  // ---------- PiP / AirPlay ----------
  function togglePiP(v) {
    try { v.disablePictureInPicture = false; v.removeAttribute('disablepictureinpicture'); } catch {}
    if (v.webkitSupportsPresentationMode && v.webkitSupportsPresentationMode('picture-in-picture')) {
      v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
    } else if (document.pictureInPictureEnabled) {
      (document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture())
        .catch(e => LOG('PiP:', e));
    }
  }

  // Si el reproductor usa ManagedMediaSource, añadir la fuente HLS alternativa que Safari usa para AirPlay.
  function ensureAltSource(v, fallbackUrl) {
    const s = v.currentSrc;
    if (!s || !mmsUrls.has(s)) return;
    const url = currentM3U8() || fallbackUrl;
    if (!url) return;
    let alt = v.querySelector('source[data-fpn-alt]');
    if (!alt) {
      alt = document.createElement('source');
      alt.type = 'application/x-mpegURL';
      alt.setAttribute('data-fpn-alt', '');
      alt.src = url;
      v.appendChild(alt);
    } else if (alt.getAttribute('src') !== url) {
      alt.src = url;
    }
    if (v.disableRemotePlayback) v.disableRemotePlayback = false;
  }

  // ¿Puede Safari mandar este <video> por AirPlay tal como está?
  function canAirPlayDirect(v) {
    const s = v.currentSrc || v.src;
    if (!s || v.disableRemotePlayback) return false;
    if (!s.startsWith('blob:')) return true;                       // HLS/MP4 directo
    return mmsUrls.has(s) && !!v.querySelector('source[data-fpn-alt]'); // MMS + alternativa HLS
  }

  // =====================================================================
  // 3) Estado y montaje
  // =====================================================================
  let session = 0;
  let current = null;

  function silence(v) { try { v.pause(); v.muted = true; } catch {} }

  function cleanup() {
    if (!current) return;
    const c = current;
    current = null;
    if (c.timer) clearInterval(c.timer);
    c.ovl?.remove();
    if (c.place) {
      c.host.removeEventListener('mouseenter', c.place);
      c.host.removeEventListener('mousemove', c.syncVis);
      window.removeEventListener('resize', c.place);
      c.visObs.disconnect();
    }
    if (c.swap) c.swap.restore(false);
    if (c.wrap) { try { c.wrap.querySelector('video')?.pause(); } catch {} c.wrap.remove(); }
    if (c.origVideo && c.onOrigPlay) {
      c.origVideo.removeEventListener('play', c.onOrigPlay, true);
      try { c.origVideo.muted = c.prevMuted; } catch {}
    }
    if (c.host) c.host.style.display = '';
  }

  // Construye el reproductor nativo (<video> de Safari con barra propia).
  function buildNative({ data, variants, initialUrl, startTime, autoplay, backLabel, onBack, isCurrent }) {
    const video = el('video', { className: 'fpn-video', controls: true, playsInline: true, preload: 'metadata', poster: data?.poster || '' });
    video.setAttribute('x-webkit-airplay', 'allow');
    video.setAttribute('playsinline', '');

    const attSel = el('select', { title: 'Video del post' });
    const items = data?.items || [];
    items.forEach((it, i) => attSel.append(el('option', { value: it.id, textContent: it.title || `Video ${i + 1}` })));
    attSel.style.display = items.length > 1 ? '' : 'none';

    const qSel = el('select', { title: 'Calidad' });
    const msg = el('span', { className: 'fpn-msg' });

    const airBtn = el('button', { textContent: 'AirPlay', title: 'Elegir dispositivo AirPlay' });
    airBtn.onclick = () => video.webkitShowPlaybackTargetPicker?.();
    const pipBtn = el('button', { textContent: 'PiP', title: 'Picture in Picture' });
    pipBtn.onclick = () => togglePiP(video);
    const backBtn = el('button', { textContent: backLabel });
    backBtn.onclick = onBack;

    const bar = el('div', { className: 'fpn-bar' }, [attSel, qSel, airBtn, pipBtn, msg, el('span', { className: 'fpn-spacer' }), backBtn]);
    const wrap = el('div', { className: 'fpn-wrap' }, [video, bar]);

    let list = variants || [];

    function setSource(url, t, play) {
      video.src = url;
      if (play) video.play().catch(() => {});
      video.addEventListener('loadedmetadata', () => {
        if (t > 0 && isFinite(video.duration)) video.currentTime = Math.min(t, video.duration - 1);
      }, { once: true });
    }

    function fillQualities(selectedUrl) {
      qSel.innerHTML = '';
      if (!list.length) {
        qSel.append(el('option', { value: -1, textContent: 'Calidad actual' }));
        return;
      }
      list.forEach((v, i) => qSel.append(el('option', { value: i, textContent: v.label })));
      const match = selectedUrl ? list.findIndex(v => v.url.split('?')[0] === selectedUrl.split('?')[0]) : -1;
      qSel.value = match >= 0 ? match : preferredIndex(list);
    }

    async function loadEntity(entityId) {
      msg.textContent = 'Cargando…';
      try { list = await getVariants(entityId, data.scenario); }
      catch (e) { msg.textContent = 'Error al obtener el stream (¿sesión iniciada / suscripción activa?)'; LOG(e); return; }
      if (!isCurrent()) return;
      if (!list.length) { msg.textContent = 'No hay variantes HLS disponibles'; return; }
      fillQualities(null);
      msg.textContent = '';
      setSource(list[+qSel.value].url, 0, false);
    }

    qSel.onchange = () => {
      const v = list[+qSel.value];
      if (!v) return;
      ls.set(LS_QUALITY, String(v.height));
      setSource(v.url, video.currentTime, !video.paused);
    };
    attSel.onchange = () => loadEntity(attSel.value);
    video.addEventListener('error', () => { msg.textContent = 'Error de reproducción; prueba otra calidad o recarga.'; });

    if (initialUrl) {
      fillQualities(initialUrl);
      setSource(initialUrl, startTime || 0, autoplay);
    } else if (items.length) {
      loadEntity(items[0].id);
    }

    return { wrap, video };
  }

  // ---------- Modo "enhance": reproductor de Floatplane + botones AirPlay / PiP ----------
  function mountEnhance(my, r, player) {
    const { host } = player;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.classList.add('fpn-host');

    const tip = el('span', { className: 'fpn-tip' });
    const airBtn = el('button', { innerHTML: ICON_AIRPLAY, title: 'Enviar a un dispositivo AirPlay', ariaLabel: 'AirPlay' });
    const pipBtn = el('button', { innerHTML: ICON_PIP, title: 'Picture in Picture', ariaLabel: 'Picture in Picture' });
    const natBtn = el('button', { textContent: 'Nativo', title: 'Usar siempre el reproductor nativo de macOS' });
    const ovl = el('div', { className: 'fpn-ovl' }, [tip, airBtn, pipBtn, natBtn]);
    // Evitar que el clic en nuestros botones pause/reproduzca el reproductor de Floatplane.
    for (const ev of ['click', 'dblclick', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      ovl.addEventListener(ev, e => e.stopPropagation());
    }
    host.appendChild(ovl);

    const ctx = { data: null, variants: null };
    const c = { kind: 'enhance', host, ovl, video: player.video, timer: null, swap: null };
    current = c;
    const isCurrent = () => my === session;

    let tipTimer;
    const flash = text => {
      tip.textContent = text; ovl.classList.add('fpn-show');
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => { tip.textContent = ''; ovl.classList.remove('fpn-show'); }, 3500);
    };

    // Precargar las URLs de la API para el modo de respaldo de AirPlay.
    (async () => {
      try {
        ctx.data = await getEntities(r);
        if (ctx.data.items.length) ctx.variants = await getVariants(ctx.data.items[0].id, ctx.data.scenario);
      } catch (e) { LOG('API:', e); }
    })();

    const fallbackUrl = () => (ctx.variants?.length ? ctx.variants[preferredIndex(ctx.variants)].url : null);

    // Colocar los botones en la fila de controles del reproductor de Floatplane (play, volumen… CC,
    // ajustes, pantalla completa), justo a la izquierda del grupo de la derecha, y mostrarlos y
    // ocultarlos junto con esos controles. Las clases de Floatplane llevan hash, así que la barra
    // se localiza por sus botones: los que están en la franja inferior del reproductor.
    let barBtn = null;  // botón de referencia de la barra (el de más a la derecha)
    const isShown = e => {
      for (; e && e !== host.parentElement; e = e.parentElement) {
        const st = getComputedStyle(e);
        if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.1) return false;
      }
      return true;
    };
    const syncVis = () => {
      if (!barBtn || !barBtn.isConnected) return;
      ovl.classList.toggle('fpn-vis', isShown(barBtn));
    };
    const place = () => {
      const hr = host.getBoundingClientRect();
      if (!hr.height) return;
      const btns = [];
      for (const b of host.querySelectorAll('button, [role="button"]')) {
        if (ovl.contains(b)) continue;
        const r = b.getBoundingClientRect();
        if (r.width < 14 || r.height < 14 || r.width > 90 || r.height > 90) continue;
        const cy = r.top + r.height / 2;
        if (cy < hr.bottom - 100 || cy > hr.bottom) continue;
        btns.push({ b, r, cy });
      }
      if (!btns.length) {
        barBtn = null;
        ovl.classList.remove('fpn-sync');
        ovl.style.bottom = '10px'; ovl.style.right = '10px';
        return;
      }
      const ref = btns.reduce((a, x) => (x.r.right > a.r.right ? x : a));
      barBtn = ref.b;
      ovl.classList.add('fpn-sync');
      // Mismo tamaño que los botones de Floatplane.
      ovl.style.setProperty('--fpn-btn', Math.round(ref.r.height) + 'px');
      ovl.style.bottom = Math.max(0, hr.bottom - ref.cy - ovl.offsetHeight / 2) + 'px';
      // A la izquierda del grupo de botones de la derecha (en la misma fila que el de referencia).
      const midX = hr.left + hr.width / 2;
      const group = btns.filter(x => x.r.left > midX && Math.abs(x.cy - ref.cy) < 12);
      const leftEdge = Math.min(...group.map(x => x.r.left));
      ovl.style.right = Math.max(0, hr.right - leftEdge + 8) + 'px';
      syncVis();
    };
    // La barra aparece/desaparece cambiando clases o estilos: seguirla al momento.
    let visRaf = 0;
    const visObs = new MutationObserver(() => {
      if (visRaf) return;
      visRaf = requestAnimationFrame(() => { visRaf = 0; syncVis(); });
    });
    visObs.observe(host, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    host.addEventListener('mouseenter', place);
    host.addEventListener('mousemove', syncVis);
    window.addEventListener('resize', place);
    c.place = place;
    c.syncVis = syncVis;
    c.visObs = visObs;

    const tick = () => {
      if (!isCurrent()) return;
      if (!host.isConnected) { mount(); return; }       // la página volvió a renderizar el reproductor
      if (!ovl.isConnected) host.appendChild(ovl);
      const v = host.querySelector('video:not(.fpn-video)') || c.video;
      c.video = v;
      try { v.disablePictureInPicture = false; v.removeAttribute('disablepictureinpicture'); } catch {}
      ensureAltSource(v, fallbackUrl());
      place();
    };
    c.timer = setInterval(tick, 1000);
    tick();

    pipBtn.onclick = () => togglePiP(c.video);
    natBtn.onclick = () => { ls.set(LS_MODE, 'native'); mount(); };

    airBtn.onclick = () => {
      const v = c.video;
      ensureAltSource(v, fallbackUrl());
      if (canAirPlayDirect(v)) { v.webkitShowPlaybackTargetPicker(); return; }

      // Respaldo: el reproductor de Floatplane usa MediaSource clásico (no compatible con AirPlay).
      // Se cambia temporalmente al <video> nativo en el mismo punto y se abre el selector de AirPlay.
      const url = currentM3U8() || fallbackUrl();
      if (!url) { flash('Preparando el stream… pulsa AirPlay de nuevo'); return; }

      const prevMuted = v.muted;
      const startTime = ctx.data?.scenario === 'live' || r.type === 'live' ? 0 : v.currentTime;
      silence(v);
      const onOrigPlay = () => silence(v);
      v.addEventListener('play', onOrigPlay, true);

      const native = buildNative({
        data: ctx.data, variants: ctx.variants, initialUrl: url, startTime, autoplay: true,
        backLabel: 'Volver al reproductor de Floatplane',
        onBack: () => c.swap?.restore(true),
        isCurrent,
      });
      host.style.display = 'none';
      host.before(native.wrap);
      native.video.webkitShowPlaybackTargetPicker?.();  // debe ir en el mismo clic

      c.swap = {
        restore(resume) {
          const t = native.video.currentTime;
          try { native.video.pause(); } catch {}
          native.wrap.remove();
          v.removeEventListener('play', onOrigPlay, true);
          host.style.display = '';
          try { v.muted = prevMuted; } catch {}
          if (resume && startTime > 0 && t > 0) { try { v.currentTime = t; } catch {} }
          c.swap = null;
        },
      };
    };
  }

  // ---------- Modo "native": reproductor nativo de macOS en lugar del de Floatplane ----------
  async function mountNative(my, r, player) {
    const { host, video: origVideo } = player;
    let data;
    try { data = await getEntities(r); }
    catch (e) { LOG('No se pudo leer el post/stream:', e); return mountEnhance(my, r, player); }
    if (my !== session) return;
    if (!data.items.length) return mountEnhance(my, r, player);

    const prevMuted = origVideo.muted;
    silence(origVideo);
    const onOrigPlay = () => silence(origVideo);
    origVideo.addEventListener('play', onOrigPlay, true);

    const native = buildNative({
      data, variants: null, initialUrl: null,
      backLabel: 'Reproductor de Floatplane',
      onBack: () => { ls.set(LS_MODE, 'enhance'); mount(); },
      isCurrent: () => my === session,
    });
    host.style.display = 'none';
    host.before(native.wrap);
    current = { kind: 'native', host, wrap: native.wrap, origVideo, onOrigPlay, prevMuted };
  }

  async function mount() {
    const my = ++session;
    cleanup();
    const r = route();
    if (!r) return;
    const player = await waitForPlayer();
    if (my !== session || !player) return;
    if (ls.get(LS_MODE, 'enhance') === 'native') return mountNative(my, r, player);
    return mountEnhance(my, r, player);
  }

  // ---------- navegación SPA ----------
  let lastHref = location.href;
  function onNav() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    routeT = performance.now();
    mount();
  }
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function (...args) { const res = orig.apply(this, args); setTimeout(onNav, 0); return res; };
  }
  window.addEventListener('popstate', onNav);
  setInterval(onNav, 1000);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
