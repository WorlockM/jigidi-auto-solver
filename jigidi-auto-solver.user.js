// ==UserScript==
// @name         Jigidi Auto Solver
// @namespace    https://github.com/WorlockM/jigidi-auto-solver
// @version      1.4.3
// @description  Solves Jigidi puzzles automatically: pieces are dragged into place one by one.
// @match        https://www.jigidi.com/solve/*
// @match        https://www.jigidi.com/*/solve/*
// @match        https://www.jigidi.com/solve.php*
// @run-at       document-start
// @license      MIT
// @grant        none
// @inject-into  page
// @homepageURL  https://github.com/WorlockM/jigidi-auto-solver
// @supportURL   https://github.com/WorlockM/jigidi-auto-solver/issues
// ==/UserScript==

// Core hooks: must run before Jigidi's game script (document-start).
(function () {
  const W = window;
  const S = (W.__jas = {
    n: -1,             // index of the last piece cut
    scratch: null,     // canvas of the last cut: Jigidi's scratch canvas, or the piece's own canvas
    piece: new Map(),  // piece canvas -> piece index (row-major solution order)
    off: [],           // piece index -> [sx, sy] source-image offset used when cutting
    org: [],           // piece index -> point in its own canvas that `off` is measured from (own-canvas cuts)
    pos: new Map(),    // piece index -> last on-screen draw {x, y, s}
    L: [],             // captured pointer listeners
    drawTick: 0,
  });

  const oAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (t, f, o) {
    if (/^(mouse|touch|pointer)/.test(t)) S.L.push({ target: this, t, f, o });
    return oAdd.call(this, t, f, o);
  };
  // Forget listeners the game removes, so we never call stale handlers.
  const oRem = EventTarget.prototype.removeEventListener;
  const cap = (o) => (o && typeof o === 'object' ? !!o.capture : !!o);
  EventTarget.prototype.removeEventListener = function (t, f, o) {
    S.L = S.L.filter((l) => !(l.target === this && l.t === t && l.f === f && cap(l.o) === cap(o)));
    return oRem.call(this, t, f, o);
  };

  // While solving, keep the user's real mouse/touch input away from the game (the panel stays usable).
  // Registered first on window in the capture phase, so it runs before any of Jigidi's listeners.
  const block = (e) => {
    if (S.busy && e.isTrusted && !(e.target.closest && e.target.closest('#jas-panel'))) e.stopImmediatePropagation();
  };
  for (const t of ['mousedown', 'mousemove', 'mouseup', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
    'touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel']) oAdd.call(W, t, block, true);

  // Diagnostics for bug reports: a tally of canvas calls plus the first few in order, so
  // __jas.report() can show how Jigidi cuts and draws its pieces in this browser.
  const D = (S.diag = { calls: {}, pre: [], seq: [], board: [], ctx: {}, clicks: 0, err: '' });
  const ids = new WeakMap();
  let nextId = 0;
  const role = (o) => {
    if (!o || typeof o !== 'object') return typeof o;
    const r = o === S.scratch ? 'scratch'
      : o instanceof HTMLCanvasElement ? (o.isConnected ? 'board' : 'canvas')
      : (o.constructor && o.constructor.name) || 'object';
    return S.piece.has(o) ? r + '*' : r;    // * = registered as a piece canvas
  };
  const tag = (o) => {
    if (!o || typeof o !== 'object') return String(o);
    if (!ids.has(o)) ids.set(o, ++nextId);
    return `${role(o)}#${ids.get(o)}(${o.naturalWidth || o.width}x${o.naturalHeight || o.height})`;
  };
  const num = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : typeof v);
  // Count every call; keep the last few lines before the first cut and the first ones after it.
  const note = (call, line) => {
    try {
      const k = call();
      D.calls[k] = (D.calls[k] || 0) + 1;
      if (S.n < 0) { D.pre.push(line()); if (D.pre.length > 8) D.pre.shift(); }
      else if (D.seq.length < 40) D.seq.push(line());
    } catch (e) { D.err = String(e); }
  };
  for (const C of [W.HTMLCanvasElement, W.OffscreenCanvas]) {
    if (!C) continue;
    const oCtx = C.prototype.getContext;
    C.prototype.getContext = function (type, ...a) {
      D.ctx[C.name + ' ' + type] = (D.ctx[C.name + ' ' + type] || 0) + 1;
      return oCtx.call(this, type, ...a);
    };
  }

  // Jigidi cuts pieces in one of two ways. Either it reuses a scratch canvas (putImageData, then the
  // image, then a copy onto the piece's canvas), or it draws the image straight onto the piece's own
  // canvas and only then calls putImageData on it. For the second way, remember the first image drawn
  // on each canvas since the last cut, with the transform it was drawn under.
  const drawnOn = new WeakMap();

  const P = CanvasRenderingContext2D.prototype;
  const oPut = P.putImageData, oDraw = P.drawImage, oGet = P.getImageData;
  const put = function (...a) {
    const c = this.canvas, r = role(c);
    if (c.width > 10) {
      const d = drawnOn.get(c);
      if (c !== S.scratch && d && d.n === S.n) {   // the image is already on this canvas: it is the piece
        S.off[S.n + 1] = d.off; S.org[S.n + 1] = d.org; S.piece.set(c, S.n + 1);
      }
      S.n++; S.scratch = c;
    }
    note(() => `put ${r} ${a.length}`, () => `put ${tag(c)} ${a.map(num).join(',')}`);
    return oPut.apply(this, a);
  };
  P.getImageData = function (...a) {
    note(() => `get ${role(this.canvas)}`, () => `get ${tag(this.canvas)} ${a.map(num).join(',')}`);
    return oGet.apply(this, a);
  };
  const draw = function (src, ...a) {
    const dst = this.canvas;
    note(() => `draw ${role(src)} > ${role(dst)} ${a.length}`,
      () => `draw ${tag(src)} > ${tag(dst)} ${a.map(num).join(',')}`
        + (this.globalCompositeOperation === 'source-over' ? '' : ' ' + this.globalCompositeOperation));
    if (dst.isConnected && S.n >= 0 && D.board.length < 6) {
      try {
        const t = this.getTransform();
        D.board.push(`draw ${tag(src)} > ${tag(dst)} ${a.map(num).join(',')} t=${[t.a, t.b, t.c, t.d, t.e, t.f].map(num).join(',')}`);
      } catch (e) { D.err = String(e); }
    }
    if (a.length === 2 && src !== dst && src !== S.scratch && !dst.isConnected && !S.piece.has(src)) {
      const d = drawnOn.get(dst);
      if (!d || d.n !== S.n) {
        const t = this.getTransform();
        drawnOn.set(dst, { n: S.n, off: [t.a * a[0] + t.c * a[1], t.b * a[0] + t.d * a[1]], org: [t.e, t.f] });
      }
    }
    if (S.n >= 0 && dst === S.scratch && src !== dst && S.off[S.n] === undefined && a.length === 2) {
      S.off[S.n] = [a[0], a[1]];            // source offset of this piece in the full image
    } else if (src === S.scratch && dst !== src && !S.piece.has(src) && !S.piece.has(dst)) {
      S.piece.set(dst, S.n);                // this canvas now holds piece n
    } else if (dst.isConnected && S.piece.has(src)) {
      const i = S.piece.get(src), t = this.getTransform(), o = S.org[i];
      if (o && a.length <= 4) {
        // Own-canvas pieces differ in size, so follow the cutting origin rather than the canvas corner.
        // Jigidi puts it in the middle of the piece's cell, which also makes it a safe point to grab.
        const k = a.length === 4 ? a[2] / src.width : 1, u = a[0] + o[0] * k, v = a[1] + o[1] * k;
        S.pos.set(i, { x: t.a * u + t.c * v + t.e, y: t.b * u + t.d * v + t.f, s: t.a * k, tick: ++S.drawTick });
      } else {
        S.pos.set(i, { x: t.e, y: t.f, s: t.a, tick: ++S.drawTick });
      }
    }
    return oDraw.call(this, src, ...a);
  };
  P.putImageData = put;
  P.drawImage = draw;

  // One block of text to paste into a bug report: copy(__jas.report()) in the console.
  S.report = () => {
    const btn = document.getElementById('jas-go');
    let hit = 'missing';
    if (btn) {
      const r = btn.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      hit = e === btn ? 'clickable' : 'covered by ' + (e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') : 'nothing');
    }
    let mgr = '?';
    try { mgr = `${GM_info.scriptHandler} ${GM_info.version}, script ${GM_info.script.version}`; } catch (e) {}
    return [
      `${mgr} | ${navigator.userAgent}`,
      `dpr ${W.devicePixelRatio} | window ${W.innerWidth}x${W.innerHeight} | ${location.pathname}`,
      `cut ${S.n + 1} | offsets ${S.off.length} | piece canvases ${S.piece.size} | drawn ${S.pos.size}`
        + ` | listeners ${S.L.length} | clicks ${D.clicks} | button ${hit}`,
      `hooks ${P.putImageData === put ? 'ok' : 'replaced'}/${P.drawImage === draw ? 'ok' : 'replaced'}`
        + ` | contexts ${JSON.stringify(D.ctx)}${D.err ? ' | error ' + D.err : ''}`,
      `canvases ${[...document.querySelectorAll('canvas')].map(tag).join(' ')}`,
      'calls:', ...Object.entries(D.calls).sort((x, y) => y[1] - x[1]).slice(0, 20).map(([k, v]) => `  ${v}x ${k}`),
      'before first cut:', ...D.pre.map((l) => '  ' + l),
      'from first cut:', ...D.seq.map((l) => '  ' + l),
      'first board draws:', ...D.board.map((l) => '  ' + l),
    ].join('\n');
  };
})();

// Solver: uses the data collected by core.js (window.__jas).
(function () {
  const S = window.__jas;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const canvas = () => [...document.querySelectorAll('canvas')].find((c) => c.isConnected && c.width > 200);

  function trusted(type, x, y, buttons, target) {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons, view: window });
    return new Proxy(e, {
      get(t, k) {
        if (k === 'isTrusted') return true;
        if (k === 'target' || k === 'currentTarget' || k === 'srcElement') return target;
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }
  const handler = (type, pred) => S.L.filter((l) => l.t === type && pred(l.target)).map((l) => l);
  const call = (type, x, y, buttons, pred) => {
    const c = canvas();
    for (const l of handler(type, pred)) l.f.call(l.target, trusted(type, x, y, buttons, c));
  };

  // Convert canvas-pixel coordinates (as drawn) to client coordinates.
  function toClient(p) {
    const c = canvas(), r = c.getBoundingClientRect();
    return { x: r.left + (p.x * r.width) / c.width, y: r.top + (p.y * r.height) / c.height };
  }

  async function dragClient(a, b, cfg) {
    const isC = (t) => t === canvas();
    call('mousemove', a.x, a.y, 0, (t) => t === document);
    await sleep(cfg.stepDelay);
    call('mousedown', a.x, a.y, 1, isC);
    const n = cfg.moveSteps;
    for (let i = 1; i <= n; i++) {
      await sleep(cfg.stepDelay);
      call('mousemove', a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n, 1, (t) => t === document);
    }
    await sleep(cfg.stepDelay);
    call('mouseup', b.x, b.y, 0, (t) => t === window);
    await sleep(cfg.settle);
  }

  const snap = () => new Map([...S.pos].map(([k, v]) => [k, { x: v.x, y: v.y }]));
  const movedSince = (b) => [...S.pos].filter(([k, v]) => { const o = b.get(k); return !o || Math.abs(o.x - v.x) + Math.abs(o.y - v.y) > 0.5; }).map(([k]) => k);

  // Drag using canvas-pixel coords; returns list of piece indices that moved.
  async function drag(from, to, cfg) {
    const b = snap();
    await dragClient(toClient(from), toClient(to), cfg);
    return movedSince(b);
  }

  async function zoom(dir, ms) {
    const id = dir < 0 ? 'game-zoom-out' : 'game-zoom-in';
    const l = S.L.find((l) => l.t === 'mousedown' && l.target.id === id);
    if (!l) return false;
    l.f.call(l.target, trusted('mousedown', 0, 0, 1, l.target));
    await sleep(ms);
    call('mouseup', 0, 0, 0, (t) => t === window);
    await sleep(600);
    return true;
  }

  // Find the "(cols × rows)" label. The page may show several (comments, other puzzles),
  // so prefer the one that matches the number of pieces we actually saw being cut.
  function dims(N) {
    const found = [];
    const add = (txt) => { for (const m of txt.matchAll(/\((\d+)\s*[×x]\s*(\d+)\)/g)) found.push({ cols: +m[1], rows: +m[2] }); };
    // Small elements first (labels), then the whole page as a fallback. The label may be
    // split over several nodes, so match on each element's combined text.
    for (const el of document.body.querySelectorAll('*')) {
      if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
      const t = el.textContent;
      if (t.length <= 60) add(t);
    }
    add(document.body.innerText || '');
    return found.find((d) => d.cols * d.rows === N) || found[0] || null;
  }

  async function solve(opts = {}) {
    const cfg = Object.assign({ stepDelay: 12, moveSteps: 5, settle: 60, margin: 20, maxTries: 12, passes: 2, log: () => {} }, opts);
    const N = S.off.length;
    const d = dims(N);
    if (!d || N === 0 || d.cols * d.rows !== N) throw new Error(`Puzzle not recognized (pieces=${N}, dims=${JSON.stringify(d)})`);
    if (d.cols < 2 || d.rows < 2) throw new Error(`Puzzle too small (${d.cols}×${d.rows})`);
    if (S.pos.size !== N) throw new Error(`Pieces not drawn yet (${S.pos.size}/${N})`);
    const c = canvas();
    if (!c) throw new Error('Game board not found');
    const W = c.width, H = c.height;
    const stopped = () => !!(cfg.stop && cfg.stop());

    // Step sizes in source pixels
    const stepX = Math.abs(S.off[1][0] - S.off[0][0]);
    const stepY = Math.abs(S.off[d.cols][1] - S.off[0][1]);

    // Zoom out until the finished puzzle takes at most ~60% of the board area.
    for (let k = 0; k < 20; k++) {
      const s = S.pos.get(0).s;
      if (d.cols * stepX * s * d.rows * stepY * s < 0.5 * W * H && d.cols * stepX * s < 0.75 * W) break;
      if (!(await zoom(-1, 60))) break;
    }
    const s = () => S.pos.get(0).s;
    const pw = stepX * s(), ph = stepY * s();
    const cw = d.cols * pw, ch = d.rows * ph;

    // Finished puzzle goes top-left; everything else is "parking".
    const box = { x0: cfg.margin, y0: cfg.margin + 50, x1: cfg.margin + cw + pw, y1: cfg.margin + 50 + ch + ph };
    const A = { x: box.x0 + pw, y: box.y0 + ph }; // target for piece 0
    const inBox = (p) => p.x > box.x0 - pw * 0.6 && p.x < box.x1 + pw * 0.6 && p.y > box.y0 - ph * 0.6 && p.y < box.y1 + ph * 0.6;
    // Jigidi only cares how pieces sit relative to each other, so once one piece is down we
    // measure from that anchor. The assembly may drift (a wrong grab dragged back a little off,
    // or the completion animation) without any of it counting as misplaced.
    let anchor = null;
    const target = (i) => {
      const a = anchor, base = a === null ? A : S.pos.get(a), o = S.off[a === null ? 0 : a];
      return { x: base.x + (o[0] - S.off[i][0]) * s(), y: base.y + (o[1] - S.off[i][1]) * s() };
    };
    const at = (i, t, tol = 3) => { const p = S.pos.get(i); return Math.hypot(p.x - t.x, p.y - t.y) < tol; };
    // Is piece i sitting exactly one step from piece j, the way the solution says it should?
    const relOK = (i, j, tol) => {
      const pi = S.pos.get(i), pj = S.pos.get(j), sc = s();
      return Math.hypot(pi.x - (pj.x + (S.off[j][0] - S.off[i][0]) * sc),
        pi.y - (pj.y + (S.off[j][1] - S.off[i][1]) * sc)) < tol;
    };
    const nbrs = (i) => {
      const r = [];
      if (i % d.cols) r.push(i - 1);
      if ((i + 1) % d.cols) r.push(i + 1);
      if (i >= d.cols) r.push(i - d.cols);
      if (i + d.cols < N) r.push(i + d.cols);
      return r;
    };
    // A piece already sitting right (it snapped along with a neighbour) must never be dragged:
    // a zero-length drag moves nothing, which the retry loop would read as a wrong grab.
    // Judge against a placed neighbour when there is one: measuring across the whole board
    // multiplies any rounding in the zoom scale, which is what disqualifies far corner pieces.
    const done = (i) => {
      if (anchor === null) return false;
      if (i === anchor) return true;
      const ns = nbrs(i).filter((j) => placed.has(j));
      if (ns.length) return ns.some((j) => relOK(i, j, 3));
      const far = Math.hypot((S.off[anchor][0] - S.off[i][0]) * s(), (S.off[anchor][1] - S.off[i][1]) * s());
      return relOK(i, anchor, Math.max(3, 0.01 * far));
    };
    // Pick a parking spot outside the target box, preferably one no other piece is lying on.
    // Falls back to the least crowded candidate when the board is full.
    const parking = (avoid, exclude = []) => {
      let best = null, bestGap = -1;
      for (let k = 0; k < 60; k++) {
        const p = Math.random() < 0.5
          ? { x: box.x1 + pw + Math.random() * Math.max(10, W - box.x1 - 2 * pw), y: ph + Math.random() * (H - 2 * ph) }
          : { x: pw + Math.random() * (W - 2 * pw), y: box.y1 + ph + Math.random() * Math.max(10, H - box.y1 - 2 * ph) };
        if (avoid && Math.hypot(p.x - avoid.x, p.y - avoid.y) <= 3 * pw) continue;
        let gap = Infinity;
        for (const [i, q] of S.pos) {
          if (exclude.includes(i)) continue;
          gap = Math.min(gap, Math.max(Math.abs(p.x - q.x) / pw, Math.abs(p.y - q.y) / ph));
        }
        if (gap > 0.9) return p;                  // nothing overlaps this spot
        if (gap > bestGap) { bestGap = gap; best = p; }
      }
      return best || { x: W - pw, y: H - ph };
    };
    const placed = new Set();
    const markPlaced = (i) => { placed.add(i); if (anchor === null) anchor = i; };

    // Move whatever we grabbed by mistake out of the way (or back, if it was the finished part).
    async function fixWrongGrab(moved, dropAt, dragFrom) {
      const wrongPlaced = moved.filter((k) => placed.has(k));
      if (wrongPlaced.length) {
        // We moved the (partial) finished puzzle: drag it straight back.
        await drag(dropAt, dragFrom, cfg);
        return;
      }
      for (const k of moved) if (done(k)) markPlaced(k); // lucky snap
      if (moved.some((k) => !placed.has(k))) await drag(dropAt, parking(dragFrom, moved), cfg);
    }

    // Phase 1: clear the target area.
    cfg.log('Clearing target area...');
    for (let round = 0; round < 6; round++) {
      const inside = [...S.pos].filter(([, p]) => inBox(p)).map(([k]) => k);
      if (!inside.length) break;
      for (const k of inside) {
        if (stopped()) return { placed: 0, total: N, stopped: true };
        const p = S.pos.get(k);
        if (!inBox(p)) continue;
        await drag(p, parking(undefined, [k]), cfg);
      }
    }

    // Phase 2: place pieces in solution order. Pieces that fail get another go in a later
    // pass, when the board is emptier and wrong grabs are less likely.
    for (let pass = 0; pass < cfg.passes; pass++) {
      const todo = [...Array(N).keys()].filter((i) => !placed.has(i));
      if (!todo.length) break;
      if (pass > 0) cfg.log(`Retrying ${todo.length} failed piece${todo.length > 1 ? 's' : ''}...`);
      for (const i of todo) {
        if (stopped()) return { placed: placed.size, total: N, stopped: true };
        let ok = done(i), skipped = ok;
        for (let tr = 0; tr < cfg.maxTries && !ok; tr++) {
          const p = { ...S.pos.get(i) };
          const t = target(i);
          const moved = await drag(p, t, cfg);
          if (at(i, target(i)) || done(i)) { ok = true; break; }
          if (moved.some((k) => placed.has(k))) {
            // We dragged the assembly itself. Put it straight back, or every retry walks the
            // finished puzzle further across the board until it leaves the screen.
            await drag(t, p, cfg);
            // Pieces only move together when Jigidi has joined them, so if i came along it is
            // already correctly attached, whatever our own measurement says.
            if (moved.includes(i)) { ok = true; break; }
            continue;
          }
          if (moved.includes(i)) {
            // moved but not at target (snapped elsewhere?) — try again from its new spot
            continue;
          }
          await fixWrongGrab(moved, t, p);
          if (done(i)) { ok = true; }       // a neighbour's move snapped it into place
        }
        if (ok) markPlaced(i);
        cfg.log(`Piece ${i + 1}/${N} ${ok ? (skipped ? 'already placed' : 'placed') : 'FAILED'}`);
        if (cfg.onProgress) cfg.onProgress(i + 1, N, ok);
      }
    }
    // Final tally: pieces can snap into place late (or shift with the completion animation),
    // so count what is actually correct rather than what we saw happen.
    // Twice: a piece can only be judged once one of its neighbours counts as placed.
    for (let k = 0; k < 2; k++) for (let i = 0; i < N; i++) if (done(i)) placed.add(i);
    return { placed: placed.size, total: N, stopped: false };
  }

  S.solve = solve;
  S.zoom = zoom;
})();


// UI: floating panel
(function () {
  const S = window.__jas;
  function mount() {
    if (!document.body) return setTimeout(mount, 200);
    const box = document.createElement('div');
    box.id = 'jas-panel';
    box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99999;background:#1f2937;color:#fff;font:14px/1.3 system-ui,sans-serif;padding:10px 12px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.35);min-width:210px';
    box.innerHTML = '<div style="font-weight:700;margin-bottom:6px">🧩 Auto Solver</div>'
      + '<button id="jas-go" style="font:inherit;font-weight:700;padding:6px 12px;border:0;border-radius:6px;background:#22c55e;color:#000;cursor:pointer">Solve puzzle</button> '
      + '<button id="jas-stop" style="font:inherit;padding:6px 10px;border:0;border-radius:6px;background:#ef4444;color:#fff;cursor:pointer;display:none">Stop</button>'
      + '<div id="jas-st" style="margin-top:6px;opacity:.85">Waiting for the puzzle to load…</div>';
    document.body.appendChild(box);
    const go = box.querySelector('#jas-go'), stopB = box.querySelector('#jas-stop'), st = box.querySelector('#jas-st');
    let stop = false;
    const ready = () => S.off.length > 1 && S.pos.size === S.off.length;
    const opened = Date.now();
    const iv = setInterval(() => {
      if (ready()) { st.textContent = S.off.length + ' pieces found. Ready!'; clearInterval(iv); }
      // Pieces were cut long ago but never recognised: point the user at the bug report.
      else if (S.n >= 0 && Date.now() - opened > 30000 && !S.diag.clicks) st.textContent = 'Pieces not recognised. Please report the output of copy(__jas.report()) from the console (F12).';
    }, 500);
    stopB.onclick = () => { stop = true; };
    go.onclick = async () => {
      S.diag.clicks++;
      if (!ready()) { st.textContent = 'Still loading (or Bingo Solver is active: turn it off).'; return; }
      stop = false; go.style.display = 'none'; stopB.style.display = ''; S.busy = true;
      const t0 = Date.now();
      try {
        const r = await S.solve({ log: (m) => { st.textContent = m; }, stop: () => stop });
        st.textContent = r.placed + '/' + r.total + ' placed in ' + Math.round((Date.now() - t0) / 1000) + 's' + (r.stopped ? ' (stopped)' : '');
      } catch (e) { st.textContent = 'Error: ' + e.message; console.error(e); }
      S.busy = false; go.style.display = ''; stopB.style.display = 'none';
    };
  }
  mount();
})();
