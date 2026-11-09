import {HandIdentityTracker} from './hand-identity.js';
/* ==========================================================================
   vision.js — MediaPipe Hands Integration + Pure Geometric Landmark Math
   ========================================================================== */

// Joint angles remain meaningful when the hand turns sideways or towards the camera.
export function fingerExtended(lm,mcp,pip,dip,tip){
 const vector=(a,b)=>[lm[a].x-lm[b].x,lm[a].y-lm[b].y,(lm[a].z??0)-(lm[b].z??0)];
 const length=(a,b)=>Math.hypot(...vector(a,b));
 const straight=(a,b,c)=>{
  const u=vector(a,b),v=vector(c,b),denominator=Math.hypot(...u)*Math.hypot(...v);
  return denominator>1e-8&&u.reduce((sum,n,i)=>sum+n*v[i],0)/denominator<-.5;
 };
 // Fingers folded at the knuckle may still have straight PIP/DIP joints.
 const tipDirection=vector(tip,mcp),baseDirection=vector(mcp,0);
 const directionLength=Math.hypot(...tipDirection)*Math.hypot(...baseDirection);
 const pointsOutward=directionLength>1e-8&&tipDirection.reduce((sum,n,i)=>sum+n*baseDirection[i],0)/directionLength>.1;
 return pointsOutward&&length(mcp,tip)>length(mcp,pip)*1.7&&straight(mcp,pip,dip)&&straight(pip,dip,tip);
}

export class HandDetector {
  constructor(w = 640, h = 480) {
    this.w = w;
    this.h = h;
    this.procMs = 0;
    this.result = { present: false, hands: [] };
    this.hands = null;
    this.isReady = false;
    this.lastLandmarks = null;
    this.allLandmarks = [];
    this.missingFrames = 0;
    this.identityTracker = new HandIdentityTracker();
    this._initMediaPipe();
  }

  _initMediaPipe() {
    if (typeof window.Hands === 'undefined') {
      console.warn('MediaPipe Hands script not loaded yet, will retry');
      setTimeout(() => this._initMediaPipe(), 300);
      return;
    }

    this.hands = new window.Hands({
      locateFile: (file) => `/assets/vendor/mediapipe-hands/${file}`
    });

    this.hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 0,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    this.hands.onResults((res) => {
      this._handleResults(res);
    });

    this.isReady = true;
  }

  async send(videoElement) {
    if (!this.hands || !this.isReady) return;
    if (this._isBusy) return; // Prevent concurrent calls which crash WASM!

    // Check if video is actually ready with valid dimensions
    if (!videoElement || videoElement.readyState < 2 || !videoElement.videoWidth) return;

    this._isBusy = true;
    const t0 = performance.now();
    try {
      await this.hands.send({ image: videoElement });
    } catch (e) {
      console.warn('MediaPipe send recovered from frame drop:', e);
      // Auto recovery: if graph crashed, mark ready to retry
      this.isReady = true;
    } finally {
      this._isBusy = false;
      this.procMs = performance.now() - t0;
    }
  }

  _handleResults(results, t = performance.now()) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      this.missingFrames++;
      // Only drop if missing for 4+ consecutive frames (prevents single-frame dropouts!)
      if (this.missingFrames > 3) {
        this.result = { present: false, hands: [] };
        this.lastLandmarks = null;
        this.allLandmarks = [];
      }
      return;
    }

    this.missingFrames = 0;
    const measured = results.multiHandLandmarks.slice(0,2).map((lm,i)=>({
      ...this.measure(lm),side:results.multiHandedness?.[i]?.score>=.85?results.multiHandedness[i].label:null
    }));
    const hands = this.identityTracker.update(measured,t);
    this.allLandmarks = results.multiHandLandmarks.slice(0, 2);
    this.lastLandmarks = this.allLandmarks[0];
    this.result = hands.length?{...hands[0], hands}:{present:false,hands:[]};
  }

  measure(lm) {

    // MediaPipe 21 landmarks:
    // 0: Wrist
    // 4: Thumb Tip, 2: Thumb MCP
    // 8: Index Tip, 6: Index PIP, 5: Index MCP
    // 12: Middle Tip, 10: Middle PIP, 9: Middle MCP
    // 16: Ring Tip, 14: Ring PIP, 13: Ring MCP
    // 20: Pinky Tip, 18: Pinky PIP, 17: Pinky MCP

    // 1. Palm center = Average of Wrist (0), Index MCP (5), Middle MCP (9), Pinky MCP (17)
    // Note: In mirrored coordinates, x is flipped (1 - x)
    const pcx = (lm[0].x + lm[5].x + lm[9].x + lm[17].x) / 4;
    const pcy = (lm[0].y + lm[5].y + lm[9].y + lm[17].y) / 4;
    const mirX = 1 - pcx;
    const mirY = pcy;

    // 2. Palm Radius / Scale (distance from wrist to middle MCP)
    const palmR = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y);

    // Geometric finger-extension and pinch measurements for the local pose rules.
    const thumbExtended = Math.hypot(lm[4].x-lm[17].x,lm[4].y-lm[17].y) > Math.hypot(lm[3].x-lm[17].x,lm[3].y-lm[17].y)*1.15;
    const indexExtended = fingerExtended(lm,5,6,7,8);
    const middleExtended = fingerExtended(lm,9,10,11,12);
    const ringExtended = fingerExtended(lm,13,14,15,16);
    const pinkyExtended = fingerExtended(lm,17,18,19,20);
    const isPinching = Math.hypot(lm[4].x-lm[8].x,lm[4].y-lm[8].y)<palmR*.45;
    const cursorX = 1 - lm[8].x;
    const cursorY = lm[8].y;
    return {
      present: true,
      palmX: mirX, palmY: mirY,
      cx: cursorX,
      cy: cursorY,
      r: palmR,
      rPx: palmR * this.w,
      indexExtended, middleExtended, ringExtended, pinkyExtended, thumbExtended, isPinching,
      landmarks: lm
    };
  }

  // Debug drawing of skeleton
  drawDebug(c, W, H) {
    c.clearRect(0, 0, W, H);
    c.strokeStyle='rgba(255,255,255,.65)';c.lineWidth=1;c.setLineDash?.([4,4]);
    c.strokeRect?.(W*.2,H*.14,W*.6,H*.64);c.setLineDash?.([]);
    if (!this.allLandmarks.length) return;
    const connections = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [5,9],[9,10],[10,11],[11,12],
      [9,13],[13,14],[14,15],[15,16],
      [13,17],[17,18],[18,19],[19,20],
      [0,17]
    ];

    for (const [handIndex,lm] of this.allLandmarks.entries()) {
    c.strokeStyle = handIndex===0?'#D9573A':'#22c7a9';
    c.lineWidth = 2.5;
    for (const [i, j] of connections) {
      c.beginPath();
      c.moveTo((1 - lm[i].x) * W, lm[i].y * H);
      c.lineTo((1 - lm[j].x) * W, lm[j].y * H);
      c.stroke();
    }

    c.fillStyle = '#fff';
    for (let k = 0; k < 21; k++) {
      c.beginPath();
      c.arc((1 - lm[k].x) * W, lm[k].y * H, k === 8 ? 5 : 3, 0, 2 * Math.PI);
      c.fill();
    }
    }
  }

  // Dummy methods to satisfy any legacy calls
  learnBackground() {}
  calibrateFromBox() { return 200; }
  boxFill() { return 1; }
}
