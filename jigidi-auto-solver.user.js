// ==UserScript==
// @name         Jigidi Auto Solver
// @namespace    https://github.com/WorlockM/jigidi-auto-solver
// @version      1.0.0
// @description  Legt Jigidi-puzzels automatisch: stukjes worden één voor één op hun juiste plek gesleept.
// @match        https://www.jigidi.com/solve/*
// @match        https://www.jigidi.com/*/solve/*
// @run-at       document-start
// @license      MIT
// @grant        none
// @inject-into  page
// @homepageURL  https://github.com/WorlockM/jigidi-auto-solver
// @supportURL   https://github.com/WorlockM/jigidi-auto-solver/issues
// @updateURL    https://raw.githubusercontent.com/WorlockM/jigidi-auto-solver/main/jigidi-auto-solver.user.js
// @downloadURL  https://raw.githubusercontent.com/WorlockM/jigidi-auto-solver/main/jigidi-auto-solver.user.js
// ==/UserScript==

// Core hooks: must run before Jigidi's game script (document-start).
(function () {
  const W = window;
  const S = (W.__jas = {
    n: -1,             // index of the last piece rendered on the scratch canvas
    scratch: null,     // scratch canvas Jigidi uses to cut every piece
    piece: new Map(),  // piece canvas -> piece index (row-major solution order)
    off: [],           // piece index -> [sx, sy] source-image offset used when cutting
    pos: new Map(),    // piece index -> last on-screen draw {x, y, s}
    L: [],             // captured pointer listeners
    drawTick: 0,
  });

  const oAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (t, f, o) {
    if (/^(mouse|touch|pointer)/.test(t)) S.L.push({ target: this, t, f, o });
    return oAdd.call(this, t, f, o);
  };

  const P = CanvasRenderingContext2D.prototype;
  const oPut = P.putImageData, oDraw = P.drawImage;
  P.putImageData = function (...a) {
    if (this.canvas.width > 10) { S.n++; S.scratch = this.canvas; }
    return oPut.apply(this, a);
  };
  P.drawImage = function (src, ...a) {
    const dst = this.canvas;
    if (S.n >= 0 && dst === S.scratch && src !== dst && S.off[S.n] === undefined && a.length === 2) {
      S.off[S.n] = [a[0], a[1]];            // source offset of this piece in the full image
    } else if (src === S.scratch && dst !== src && !S.piece.has(dst)) {
      S.piece.set(dst, S.n);                // this canvas now holds piece n
    } else if (dst.isConnected && S.piece.has(src)) {
      const t = this.getTransform();
      S.pos.set(S.piece.get(src), { x: t.e, y: t.f, s: t.a, tick: ++S.drawTick });
    }
    return oDraw.call(this, src, ...a);
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

  function dims() {
    const m = document.body.innerText.match(/\((\d+)\s*[×x]\s*(\d+)\)/);
    return m ? { cols: +m[1], rows: +m[2] } : null;
  }

  async function solve(opts = {}) {
    const cfg = Object.assign({ stepDelay: 12, moveSteps: 5, settle: 60, margin: 20, maxTries: 12, log: () => {} }, opts);
    const d = dims();
    const N = S.off.length;
    if (!d || N === 0 || d.cols * d.rows !== N) throw new Error(`Puzzel niet herkend (pieces=${N}, dims=${JSON.stringify(d)})`);
    const c = canvas();
    const W = c.width, H = c.height;

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
    const target = (i) => ({ x: A.x + (S.off[0][0] - S.off[i][0]) * s(), y: A.y + (S.off[0][1] - S.off[i][1]) * s() });
    const at = (i, t, tol = 3) => { const p = S.pos.get(i); return Math.hypot(p.x - t.x, p.y - t.y) < tol; };
    const parking = (avoid) => {
      for (let k = 0; k < 50; k++) {
        const p = Math.random() < 0.5
          ? { x: box.x1 + pw + Math.random() * Math.max(10, W - box.x1 - 2 * pw), y: ph + Math.random() * (H - 2 * ph) }
          : { x: pw + Math.random() * (W - 2 * pw), y: box.y1 + ph + Math.random() * Math.max(10, H - box.y1 - 2 * ph) };
        if (!avoid || Math.hypot(p.x - avoid.x, p.y - avoid.y) > 3 * pw) return p;
      }
      return { x: W - pw, y: H - ph };
    };
    const placed = new Set();

    // Move whatever we grabbed by mistake out of the way (or back, if it was the finished part).
    async function fixWrongGrab(moved, dropAt, dragFrom) {
      const wrongPlaced = moved.filter((k) => placed.has(k));
      if (wrongPlaced.length) {
        // We moved the (partial) finished puzzle: drag it straight back.
        await drag(dropAt, dragFrom, cfg);
        return;
      }
      for (const k of moved) if (at(k, target(k))) placed.add(k); // lucky snap
      if (moved.some((k) => !placed.has(k))) await drag(dropAt, parking(dragFrom), cfg);
    }

    // Phase 1: clear the target area.
    cfg.log('Doelgebied leegmaken...');
    for (let round = 0; round < 6; round++) {
      const inside = [...S.pos].filter(([, p]) => inBox(p)).map(([k]) => k);
      if (!inside.length) break;
      for (const k of inside) {
        const p = S.pos.get(k);
        if (!inBox(p)) continue;
        await drag(p, parking(), cfg);
      }
    }

    // Phase 2: place pieces in solution order.
    for (let i = 0; i < N; i++) {
      if (placed.has(i)) continue;
      let ok = false;
      for (let tr = 0; tr < cfg.maxTries && !ok; tr++) {
        const p = { ...S.pos.get(i) };
        const t = target(i);
        const moved = await drag(p, t, cfg);
        if (moved.includes(i) && at(i, t)) { ok = true; break; }
        if (moved.includes(i)) {
          // moved but not at target (snapped elsewhere?) — try again from its new spot
          continue;
        }
        await fixWrongGrab(moved, t, p);
      }
      if (ok) placed.add(i);
      cfg.log(`Stukje ${i + 1}/${N} ${ok ? 'gelegd' : 'MISLUKT'}`);
      if (cfg.onProgress) cfg.onProgress(i + 1, N, ok);
      if (cfg.stop && cfg.stop()) break;
    }
    return { placed: placed.size, total: N };
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
    box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99999;background:#1f2937;color:#fff;font:14px/1.3 system-ui,sans-serif;padding:10px 12px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.35);min-width:210px';
    box.innerHTML = '<div style="font-weight:700;margin-bottom:6px">🧩 Auto Solver</div>'
      + '<button id="jas-go" style="font:inherit;font-weight:700;padding:6px 12px;border:0;border-radius:6px;background:#22c55e;color:#000;cursor:pointer">Leg puzzel</button> '
      + '<button id="jas-stop" style="font:inherit;padding:6px 10px;border:0;border-radius:6px;background:#ef4444;color:#fff;cursor:pointer;display:none">Stop</button>'
      + '<div id="jas-st" style="margin-top:6px;opacity:.85">Wachten tot puzzel geladen is…</div>';
    document.body.appendChild(box);
    const go = box.querySelector('#jas-go'), stopB = box.querySelector('#jas-stop'), st = box.querySelector('#jas-st');
    let stop = false;
    const ready = () => S.off.length > 1 && S.pos.size === S.off.length;
    const iv = setInterval(() => { if (ready()) { st.textContent = S.off.length + ' stukjes gevonden. Klaar!'; clearInterval(iv); } }, 500);
    stopB.onclick = () => { stop = true; };
    go.onclick = async () => {
      if (!ready()) { st.textContent = 'Nog niet klaar met laden (of Bingo Solver staat aan: zet die uit).'; return; }
      stop = false; go.disabled = true; stopB.style.display = '';
      const t0 = Date.now();
      try {
        const r = await S.solve({ log: (m) => { st.textContent = m; }, stop: () => stop });
        st.textContent = r.placed + '/' + r.total + ' gelegd in ' + Math.round((Date.now() - t0) / 1000) + 's';
      } catch (e) { st.textContent = 'Fout: ' + e.message; console.error(e); }
      go.disabled = false; stopB.style.display = 'none';
    };
  }
  mount();
})();
