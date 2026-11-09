/* ==========================================================================
   gestures.js — turns per-frame hand measurements into DYNAMIC gestures.
   Pure math / signal processing, no learning:
     • One-Euro filter (adaptive low-pass) for a jitter-free cursor
     • Majority vote over a sliding window for stable poses
     • Kinematics on a time-stamped trajectory buffer:
         swipe  : displacement + speed + straightness inside a 320 ms window
         wave   : count of x-direction reversals with amplitude gate
         circle : winding number (sum of unwrapped polar angle around centroid)
                  + radius coefficient-of-variation gate
         twist  : unwrapped angle delta of palm->fingertips vector
         push   : log-ratio of palm radius vs. adaptive baseline (depth proxy)
   ========================================================================== */

class LowPass { constructor() { this.y = null; } f(x, a) { this.y = this.y === null ? x : a * x + (1 - a) * this.y; return this.y; } reset() { this.y = null; } }

export class OneEuro {
  constructor(minCutoff = 1.0, beta = 0.004, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = new LowPass(); this.dx = new LowPass(); this.t = null; this.prev = null;
  }
  alpha(cut, dt) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
  filter(v, t) {
    if (this.t === null) { this.t = t; this.prev = v; return this.x.f(v, 1); }
    const dt = Math.max(1e-3, (t - this.t) / 1000); this.t = t;
    const d = (v - this.prev) / dt; this.prev = v;
    const ed = this.dx.f(d, this.alpha(this.dCutoff, dt));
    const cut = this.minCutoff + this.beta * Math.abs(ed);
    return this.x.f(v, this.alpha(cut, dt));
  }
  reset() { this.x.reset(); this.dx.reset(); this.t = null; }
}

export const POSE = { NONE: 'none', FIST: 'fist', POINT: 'point', VICTORY: 'victory', THREE: 'three', OPEN: 'open' };
const poseOf = f => f <= 0 ? POSE.FIST : f === 1 ? POSE.POINT : f === 2 ? POSE.VICTORY : f === 3 ? POSE.THREE : POSE.OPEN;

export class GestureEngine {
  constructor() {
    this.handlers = {};
    // Stricter filtering: lower cutoff for dead-still stability, controlled beta to prevent explosive jumps
    this.fx = new OneEuro(0.4, 0.002); this.fy = new OneEuro(0.4, 0.002);
    this.poseBuf = [];
    this.pose = POSE.NONE;
    this.prevPose = POSE.NONE;
    this.poseSince = 0;
    this.present = false;
    this.presentFrames = 0;
    this.lost = 0;
    this.hist = [];                 // {t, x, y, r, pose}
    this.cursorHist = [];           // {t, x, y}
    this.cursor = { x: innerWidth / 2, y: innerHeight / 2 };
    this.grabbing = false;
    this.grabOffset = { x: 0, y: 0 };
    this.cool = {};
    this.lastTilt = null;
    this.rBase = null;
    this.zoomActive = false;
    // Expanded active region so hand movements are calmer across the entire screen
    this.region = { x0: 0.10, x1: 0.90, y0: 0.08, y1: 0.82 };
    this.stats = { swipe: 0, grab: 0, wave: 0, circle: 0, twist: 0, push: 0, three: 0, point: 0, dwell: 0, frames: 0, handFrames: 0 };
    this.mode = 'default';          // app may set 'editor'
  }

  on(name, fn) { (this.handlers[name] ||= []).push(fn); }
  emit(name, data = {}) { (this.handlers[name] || []).forEach(fn => fn(data)); }
  cooldown(k, ms, t) { if ((this.cool[k] || 0) > t) return false; this.cool[k] = t + ms; return true; }

  _mapToScreen(nx, ny) {
    const R = this.region;
    const u = Math.min(1, Math.max(0, (nx - R.x0) / (R.x1 - R.x0)));
    const v = Math.min(1, Math.max(0, (ny - R.y0) / (R.y1 - R.y0)));
    return { x: u * innerWidth, y: v * innerHeight };
  }

  update(hand, t) {
    this.stats.frames++;
    if (!hand.present) {
      this.lost++;
      if (this.lost >= 5) { // Tolerant dropout (5 frames ~ 160ms) prevents abrupt cuts
        if (this.grabbing) { this.grabbing = false; this.emit('grabend', { ...this.cursor }); }
        this.present = false; this.presentFrames = 0;
        this.pose = POSE.NONE; this.poseBuf.length = 0; this.hist.length = 0;
        this.rBase = null; this.lastTilt = null;
        this.fx.reset(); this.fy.reset();
        this.emit('lost');
        this.emit('pose', { pose: POSE.NONE });
      }
      return;
    }
    this.stats.handFrames++;
    this.lost = 0;
    if (!this.present) { this.present = true; this.emit('found'); }
    this.presentFrames++;

    // ---------- pose determination ----------
    // If pinching or fist, treat as FIST (grab)
    let determinedPose;
    if (hand.isPinching) {
      determinedPose = POSE.FIST;
    } else {
      determinedPose = poseOf(hand.fingers);
    }

    this.poseBuf.push(determinedPose); if (this.poseBuf.length > 4) this.poseBuf.shift();
    const poseCounts = {};
    for (const p of this.poseBuf) poseCounts[p] = (poseCounts[p] || 0) + 1;
    let newPose = this.pose;
    for (const [p, c] of Object.entries(poseCounts)) {
      if (c >= 3) { newPose = p; break; }
    }

    if (newPose !== this.pose) {
      this.prevPose = this.pose; this.pose = newPose; this.poseSince = t;
      this.emit('pose', { pose: newPose, prev: this.prevPose });
      this._onPoseChange(newPose, this.prevPose, t);
    }

    // ---------- cursor (palm centre -> screen, One-Euro filtered + speed dampening) ----------
    const raw = this._mapToScreen(hand.cx, hand.cy);
    let x = this.fx.filter(raw.x, t), y = this.fy.filter(raw.y, t);
    if (this.grabbing) { x += this.grabOffset.x; y += this.grabOffset.y; }

    // Max delta speed clamp per frame to prevent wild jumps
    if (this.cursor && this.presentFrames > 1) {
      const maxDelta = 42; // max pixels per frame step
      const cdx = x - this.cursor.x;
      const cdy = y - this.cursor.y;
      const dist = Math.hypot(cdx, cdy);
      if (dist > maxDelta) {
        const factor = maxDelta / dist;
        x = this.cursor.x + cdx * factor;
        y = this.cursor.y + cdy * factor;
      }
    }

    x = Math.min(innerWidth - 1, Math.max(0, x)); y = Math.min(innerHeight - 1, Math.max(0, y));
    this.cursor = { x, y };
    this.cursorHist.push({ t, x, y }); while (this.cursorHist.length && t - this.cursorHist[0].t > 600) this.cursorHist.shift();
    this.emit('move', { x, y, pose: this.pose, grabbing: this.grabbing });
    if (this.grabbing) this.emit('grabmove', { x, y });

    // ---------- trajectory buffer (normalised camera coords) ----------
    this.hist.push({ t, x: hand.cx, y: hand.cy, r: hand.r, pose: this.pose, f: hand.fingers });
    while (this.hist.length && t - this.hist[0].t > 2000) this.hist.shift();

    this._swipe(t);
    this._wave(t);
    this._circle(t);
    this._twist(hand, t);
    this._push(hand, t);
    this._three(t);
  }

  _cursorAt(t) {
    // where the cursor was ~ms ago (kills the jump produced while the hand closes)
    for (let k = this.cursorHist.length - 1; k >= 0; k--) if (this.cursorHist[k].t <= t) return this.cursorHist[k];
    return this.cursorHist[0] || this.cursor;
  }

  _onPoseChange(pose, prev, t) {
    if (pose === POSE.FIST && prev !== POSE.NONE && this.presentFrames > 6 && !this.grabbing && (this.cool.noGrab || 0) < t) {
      const p = this._cursorAt(t - 160);
      this.grabbing = true;
      this.grabOffset = { x: p.x - this.cursor.x, y: p.y - this.cursor.y };
      this.cursor = { x: p.x, y: p.y };
      this.stats.grab++;
      this.emit('grabstart', { x: p.x, y: p.y });
    } else if (prev === POSE.FIST && this.grabbing) {
      this.grabbing = false;
      this.grabOffset = { x: 0, y: 0 };
      this.emit('grabend', { ...this.cursor });
    }
    if (pose === POSE.POINT) this.stats.point++;
  }

  _window(t, ms) { const out = []; for (const h of this.hist) if (t - h.t <= ms) out.push(h); return out; }

  _swipe(t) {
    if (this.grabbing || this.mode === 'editor') return;
    const W = this._window(t, 320);
    if (W.length < 4) return;
    const a = W[0], b = W[W.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y, dt = (b.t - a.t) / 1000;
    if (dt <= 0) return;
    // straightness: path length vs. chord
    let path = 0; for (let k = 1; k < W.length; k++) path += Math.hypot(W[k].x - W[k - 1].x, W[k].y - W[k - 1].y);
    const chord = Math.hypot(dx, dy);
    const straight = chord / (path + 1e-6);
    const openStart = W.slice(0, 3).some(h => h.f >= 3);
    if (!openStart || straight < 0.8) return;
    if (Math.abs(dx) > 0.26 && Math.abs(dy) < Math.abs(dx) * 0.55 && Math.abs(dx) / dt > 0.9) {
      if (!this.cooldown('swipe', 900, t)) return;
      this.cool.noGrab = t + 450;
      this.stats.swipe++;
      this.hist.length = 0;
      this.emit('swipe', { dir: dx < 0 ? 'left' : 'right' });
    } else if (Math.abs(dy) > 0.26 && Math.abs(dx) < Math.abs(dy) * 0.55 && Math.abs(dy) / dt > 0.9) {
      if (!this.cooldown('swipe', 900, t)) return;
      this.cool.noGrab = t + 450;
      this.stats.swipe++;
      this.hist.length = 0;
      this.emit('swipe', { dir: dy < 0 ? 'up' : 'down' });
    }
  }

  _wave(t) {
    if (this.grabbing) return;
    const W = this._window(t, 1600);
    if (W.length < 10) return;
    if (W.filter(h => h.f >= 3).length < W.length * 0.5) return;
    // local extrema of x with hysteresis (amplitude gate)
    const amp = 0.045;
    let dir = 0, ext = W[0].x, reversals = 0;
    for (const h of W) {
      if (dir >= 0 && h.x > ext) ext = h.x;
      if (dir <= 0 && h.x < ext) ext = h.x;
      if (dir >= 0 && ext - h.x > amp) { if (dir === 1) reversals++; dir = -1; ext = h.x; }
      else if (dir <= 0 && h.x - ext > amp) { if (dir === -1) reversals++; dir = 1; ext = h.x; }
    }
    if (reversals >= 3 && this.cooldown('wave', 1800, t)) {
      this.cool.swipe = t + 700;
      this.stats.wave++;
      this.hist.length = 0;
      this.emit('wave');
    }
  }

  _circle(t) {
    if (this.grabbing) return;
    const W = this._window(t, 1700).filter(h => h.pose === POSE.POINT);
    if (W.length < 12) return;
    let cx = 0, cy = 0; for (const h of W) { cx += h.x; cy += h.y; } cx /= W.length; cy /= W.length;
    let sum = 0, prev = null, rs = 0, rss = 0;
    for (const h of W) {
      const a = Math.atan2(h.y - cy, h.x - cx);
      const r = Math.hypot(h.x - cx, h.y - cy); rs += r; rss += r * r;
      if (prev !== null) { let d = a - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; sum += d; }
      prev = a;
    }
    const mr = rs / W.length, cv = Math.sqrt(Math.max(0, rss / W.length - mr * mr)) / (mr + 1e-6);
    if (Math.abs(sum) > Math.PI * 1.75 && mr > 0.035 && cv < 0.45 && this.cooldown('circle', 1200, t)) {
      this.stats.circle++;
      this.hist.length = 0;
      this.emit('circle', { dir: sum > 0 ? 'cw' : 'ccw' });
    }
  }

  _twist(hand, t) {
    if (this.pose !== POSE.VICTORY || hand.tilt === null) { this.lastTilt = null; return; }
    if (this.lastTilt !== null) {
      let d = hand.tilt - this.lastTilt;
      if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) > 0.012 && Math.abs(d) < 0.6) { this.emit('twist', { d }); this.stats.twist += Math.abs(d) > 0.05 ? 1 : 0; }
    }
    this.lastTilt = hand.tilt;
    // vertical motion with V = scroll
    const n = this.hist.length;
    if (n >= 2) { const dy = this.hist[n - 1].y - this.hist[n - 2].y; if (Math.abs(dy) > 0.002) this.emit('vscroll', { dy }); }
  }

  _push(hand, t) {
    if (this.pose !== POSE.OPEN || this.grabbing) { this.rBase = null; this.zoomActive = false; return; }
    if (t - this.poseSince < 350) return;
    // only when the palm is roughly still in x/y (otherwise it's a swipe / move)
    const W = this._window(t, 200);
    if (W.length < 2) return;
    const sp = Math.hypot(W[W.length - 1].x - W[0].x, W[W.length - 1].y - W[0].y);
    if (this.rBase === null) { this.rBase = hand.r; return; }
    const lr = Math.log(hand.r / this.rBase);
    if (Math.abs(lr) > 0.16 && sp < 0.06) {
      if (!this.zoomActive) { this.zoomActive = true; this.stats.push++; }
      this.emit('zoom', { rate: lr });
    } else {
      this.zoomActive = false;
      if (Math.abs(lr) < 0.08) this.rBase += (hand.r - this.rBase) * 0.05;   // slow drift compensation
    }
  }

  _three(t) {
    if (this.pose !== POSE.THREE) { if (this._threeP) { this._threeP = 0; this.emit('threeprogress', { p: 0 }); } return; }
    const p = Math.min(1, (t - this.poseSince) / 1000);
    this._threeP = p;
    this.emit('threeprogress', { p });
    if (p >= 1 && this.cooldown('three', 2200, t)) { this.stats.three++; this.emit('three'); }
  }
}
