/* ==========================================================================
   input.js — hands-only input layer.
   • Swallows EVERY real (trusted) mouse / keyboard / wheel / touch event.
   • Draws a virtual cursor driven by the gesture engine.
   • Hit-testing with magnetic snapping, dwell-to-click, grab-to-click/drag.
   ========================================================================== */

const BLOCK = ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel', 'mousewheel',
  'keydown', 'keyup', 'keypress', 'pointerdown', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'dragstart', 'selectstart'];

export function lockOutMouseAndKeyboard() {
  for (const ev of BLOCK) {
    window.addEventListener(ev, e => {
      if (!e.isTrusted) return;           // our own synthetic clicks pass through
      e.preventDefault(); e.stopImmediatePropagation();
    }, { capture: true, passive: false });
  }
  document.documentElement.classList.add('no-pointer');
}

const CLICKABLE = 'button, [data-hit], a[href], .hit';

export class HandCursor {
  constructor(engine) {
    this.engine = engine;
    this.el = document.getElementById('cursor');
    this.ring = this.el.querySelector('.cur-progress');
    this.label = this.el.querySelector('.cur-label');
    this.C = 2 * Math.PI * 22;
    this.ring.style.strokeDasharray = this.C;
    this.ring.style.strokeDashoffset = this.C;
    this.x = innerWidth / 2; this.y = innerHeight / 2;
    this.target = null;
    this.dwell = { el: null, t0: 0, x: 0, y: 0, done: false };
    this.dwellMs = 750; // Faster trigger (750ms instead of 1100ms)
    this.rects = []; this.rectsAt = 0;
    this.dragHandler = null;      // app sets: {start(x,y,el) -> bool, move, end}
    this.dragging = false;
    this.visible = false;

    engine.on('move', e => this.move(e.x, e.y));
    engine.on('grabstart', e => this.grab(e.x, e.y));
    engine.on('grabmove', e => { if (this.dragging) this.dragHandler?.move(e.x, e.y); });
    engine.on('grabend', e => { if (this.dragging) { this.dragging = false; this.dragHandler?.end(e.x, e.y); } this.el.classList.remove('grab'); });
    engine.on('found', () => { this.visible = true; this.el.classList.add('on'); });
    engine.on('lost', () => { this.visible = false; this.el.classList.remove('on'); this.setHover(null); this.resetDwell(); });
    engine.on('pose', e => { this.el.dataset.pose = e.pose; this.label.textContent = POSE_LABEL[e.pose] || ''; });
  }

  _refreshRects(t) {
    if (t - this.rectsAt < 350) return;
    this.rectsAt = t;
    this.rects = [];
    for (const el of document.querySelectorAll(CLICKABLE)) {
      if (el.closest('.page:not(.active)') || el.closest('[hidden]') || el.disabled) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.bottom > 0 && r.top < innerHeight) this.rects.push({ el, r });
    }
  }

  findTarget(x, y) {
    const hit = document.elementFromPoint(x, y);
    const direct = hit?.closest(CLICKABLE + ', [data-drag]');
    if (direct && !direct.disabled) return direct;
    // magnetic snapping: nearest clickable within 55px (generous radius for relaxed aiming)
    this._refreshRects(performance.now());
    let best = null, bd = 55;
    for (const { el, r } of this.rects) {
      const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = el; }
    }
    return best;
  }

  setHover(el) {
    if (el === this.target) return;
    this.target?.classList.remove('g-hover');
    this.target = el;
    el?.classList.add('g-hover');
    this.el.classList.toggle('over', !!el && !el.matches('[data-drag]'));
  }

  resetDwell() { this.dwell = { el: null, t0: 0, x: 0, y: 0, done: false }; this.ring.style.strokeDashoffset = this.C; }

  move(x, y) {
    this.x = x; this.y = y;
    this.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    const t = performance.now();
    if (this.dragging) return;
    const el = this.findTarget(x, y);
    this.setHover(el);
    this.hoverHandler?.(x, y, el);
    // ---- dwell to click (only on real buttons, not the 3-D canvas) ----
    const can = el && !el.matches('[data-drag], [data-nodwell]') && this.engine.pose !== 'fist';
    const D = this.dwell;
    if (!can) { if (D.el) this.resetDwell(); return; }
    if (D.el !== el || Math.hypot(x - D.x, y - D.y) > 65) {
      if (D.el === el && D.done && Math.hypot(x - D.x, y - D.y) <= 85) return;   // must leave to re-arm
      this.dwell = { el, t0: t, x, y, done: false };
      this.ring.style.strokeDashoffset = this.C;
      return;
    }
    if (D.done) return;
    const p = Math.min(1, (t - D.t0) / this.dwellMs);
    this.ring.style.strokeDashoffset = this.C * (1 - p);
    if (p >= 1) {
      D.done = true;
      this.engine.stats.dwell++;
      this.click(el);
      this.ring.style.strokeDashoffset = this.C;
    }
  }

  grab(x, y) {
    this.el.classList.add('grab');
    const el = this.findTarget(x, y);
    if (el?.matches('[data-drag]') && this.dragHandler?.start(x, y, el)) { this.dragging = true; return; }
    if (el && !el.matches('[data-drag]')) this.click(el);
    this.resetDwell(); this.dwell.el = el; this.dwell.done = true; this.dwell.x = x; this.dwell.y = y;
  }

  click(el) {
    el.classList.remove('g-click'); void el.offsetWidth; el.classList.add('g-click');
    this.el.classList.remove('pulse'); void this.el.offsetWidth; this.el.classList.add('pulse');
    el.click();
    this.rectsAt = 0;
  }
}

export const POSE_LABEL = { none: '', fist: '✊ grab', point: '☝ point', victory: '✌ twist', three: '🤟 hold', open: '✋ open' };
