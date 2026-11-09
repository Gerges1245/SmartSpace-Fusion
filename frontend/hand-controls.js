import {ButtonDwell,repeatsWhilePointing} from './button-dwell.js';
export function isPhoneSign(h){
 const lm=h.landmarks;
 if(!lm||lm.length<21)return h.thumbExtended&&h.pinkyExtended&&!h.indexExtended&&!h.middleExtended&&!h.ringExtended;
 const distance=(a,b)=>Math.hypot(lm[a].x-lm[b].x,lm[a].y-lm[b].y,(lm[a].z??0)-(lm[b].z??0));
 const bend=(a,b,c)=>{
  const u=[lm[a].x-lm[b].x,lm[a].y-lm[b].y,(lm[a].z??0)-(lm[b].z??0)];
  const v=[lm[c].x-lm[b].x,lm[c].y-lm[b].y,(lm[c].z??0)-(lm[b].z??0)];
  return u.reduce((sum,n,i)=>sum+n*v[i],0)/(Math.hypot(...u)*Math.hypot(...v)||1);
 };
 const palm=distance(0,9);if(palm<1e-6)return false;
 const curled=[[5,6,8],[9,10,12],[13,14,16]].every(([a,b,c])=>bend(a,b,c)>-.65);
 const pinky=bend(17,18,20)<-.65&&distance(17,20)>distance(17,18)*1.1;
 const thumb=(h.thumbExtended||bend(2,3,4)<-.5)&&distance(4,5)>palm*.35;
 return curled&&pinky&&thumb&&distance(4,20)>palm*.65;
}
export function handPose(h){
 const {indexExtended:i,middleExtended:m,ringExtended:r,pinkyExtended:p}=h;
 if(isPhoneSign(h))return 'phone';
 if(h.isPinching&&m&&r&&p)return 'ok';
 // A closed fist can also bring the thumb and index tips close together.
 if(!i&&!m&&!r&&!p&&!h.thumbExtended)return 'fist';
 if(i&&!m&&!r&&!p)return 'point';
 if(h.thumbExtended&&!i&&!m&&!r&&!p&&!h.isPinching)return 'thumb';
 if(h.isPinching)return 'pinch';
 if(i&&m&&r&&p)return h.thumbExtended?'open':'four';
 if(i&&m&&r&&!p)return 'three';
 if(i&&m&&!r&&!p)return 'victory';
 if(i&&!m&&!r&&!p)return 'point';
 if(!i&&!m&&!r&&!p)return 'fist';
 return 'none';
}

export function mapHandPoint(hand,width,height){
 return {x:Math.max(0,Math.min(1,(hand.cx-.2)/.6))*(width-1),y:Math.max(0,Math.min(1,(hand.cy-.14)/.64))*(height-1)};
}
export function smoothHandPoint(raw,previous,t,{deadzone=1.5,slow=75,medium=40,fast=22}={}){
 if(!previous)return raw;
 const distance=Math.hypot(raw.x-previous.x,raw.y-previous.y);
 if(distance<=deadzone)return {x:previous.x,y:previous.y};
 const dt=Math.max(8,Math.min(150,t-(previous.t??t-33)));
 const alpha=1-Math.exp(-dt/(distance>70?fast:distance>12?medium:slow));
 const gain=alpha*(distance-deadzone)/distance;
 return {x:previous.x+(raw.x-previous.x)*gain,y:previous.y+(raw.y-previous.y)*gain};
}

function findHandControl(x,y,previous){
 const direct=document.elementFromPoint(x,y)?.closest('button,a[href],input,select,summary');
 // A directly hit neighbour always wins over the old button's edge tolerance.
 if(direct&&direct!==previous)return direct;
 if(previous?.isConnected&&previous.getBoundingClientRect){
  const r=previous.getBoundingClientRect();
  if(x>=r.left-8&&x<=r.right+8&&y>=r.top-8&&y<=r.bottom+8)return previous;
 }
 return direct||null;
}

// One active pointer handles selection, dragging and button dwell.
export class HandControls {
 constructor({api,click,element=null}){
  this.api=api;this.click=click;this.tracks=new Map();this.owner=null;this.dwell=null;this.pair=null;this.extraCursors=new Map();this.hoverControl=null;this.buttonDwell=new ButtonDwell();
  this.stats={frames:0};this.pose='none';this.lastSeen=0;
  this.el=element||document.createElement('div');this.el.id='cursor';this.el.classList.add('hand-cursor');
  this.el.innerHTML='<div class="cur-dot"></div><svg viewBox="0 0 48 48"><circle class="cur-bg" cx="24" cy="24" r="22"/><circle class="cur-progress" cx="24" cy="24" r="22"/></svg><div class="cur-label"></div>';
  if(!element)document.body.append(this.el);
  this.ring=this.el.querySelector('.cur-progress');this.C=2*Math.PI*22;this.ring.style.strokeDasharray=this.C;this.progress(0);

  // Return cursors to document.body whenever any modal dialog closes
  document.addEventListener('close',e=>{
   if(e.target?.tagName==='DIALOG'){
    if(this.el.parentNode!==document.body)document.body.appendChild(this.el);
    for(const [_,extra] of this.extraCursors){
     if(extra.parentNode!==document.body)document.body.appendChild(extra);
    }
   }
  },true);
 }
 progress(p){this.ring.style.strokeDashoffset=this.C*(1-p)}
 release(){this.api()?.endHandDrag(false);this.owner=null;this.rotating=false;this.dragPaused=false;this.trackingLost=false;this.deleteHold=null;this.dwell=null;this.progress(0)}
 clearExtraCursors(){for(const el of this.extraCursors.values())el.remove();this.extraCursors.clear()}
 drawCursors(active,primary){
  const modal=document.querySelector('dialog[open]');
  const targetParent=modal||document.body;
  if(this.el.parentNode!==targetParent){
   targetParent.appendChild(this.el);
  }
  for(const hand of active){
   let el=this.el;
   if(hand.id!==primary.id){
    el=this.extraCursors.get(hand.id);
    if(!el){
     el=document.createElement('div');
     el.className='hand-cursor';
     el.innerHTML='<div class="cur-dot"></div><svg viewBox="0 0 48 48"><circle class="cur-bg" cx="24" cy="24" r="22"/></svg><div class="cur-label"></div>';
     targetParent.appendChild(el);
     this.extraCursors.set(hand.id,el);
    }else if(el.parentNode!==targetParent){
     targetParent.appendChild(el);
    }
   }
   el.dataset.hand=hand.id;el.dataset.slot=el===this.el?'1':'2';el.dataset.pose=hand.pose;
   el.classList.add('on');el.style.transform=`translate3d(${hand.x}px,${hand.y}px,0)`;
   if(el!==this.el)el.querySelector('.cur-label').textContent='Hand 2';
  }
  for(const [id,el] of this.extraCursors)if(id===primary.id||!active.some(h=>h.id===id)){el.remove();this.extraCursors.delete(id)}
 }
 stop(){this.hoverControl?.classList?.remove('g-hover');this.buttonDwell.reset();this.release();this.pair=null;this.tracks.clear();this.clearExtraCursors();this.el.remove()}
 update(result,t){
  this.stats.frames++;
  const hands=result.present?(result.hands||[result]):[];
  if(!hands.length){this.deleteHold=null;if(!this.owner)this.tracks.clear();this.buttonDwell.update({target:null,hand:this.primary,x:-10000,y:-10000,pointing:false,enabled:false,t});this.clearExtraCursors();this.dwell=null;this.pair=null;this.progress(0);this.trackingLost=!!this.owner;if(t-this.lastSeen>800){this.release();this.pose='none';this.tracks.clear();this.el.classList.remove('on')}return}
  if(this.owner&&t-(this.tracks.get(this.owner)?.t??t)>800)this.release();
  this.lastSeen=t;
  if(this.owner&&!hands.some(h=>(h.id||'primary')===this.owner)){
   const last=this.tracks.get(this.owner)?.t??this.lastSeen;
   this.trackingLost=true;this.deleteHold=null;this.progress(0);
   if(t-last<=800)return;
   this.release();
  }
  const api=this.api(),blocked=!!document.querySelector('dialog[open]')||api?.getState().busy;
  const active=[];
  for(const h of hands){
   const id=h.id||'primary',old=this.trackingLost?null:this.tracks.get(id),measuredPose=handPose(h);
   const uncertainSince=measuredPose!=='point'?(old?.uncertainSince??t):null;
   const measuredSince=old?.measuredPose===measuredPose?old.measuredSince:t;
   const pose=measuredPose!=='point'&&old?.pose==='point'&&t-uncertainSince<160?'point':measuredPose;
   // The palm stays stable when fingers curl; preserve the cursor at the transition.
   const palm=pose!=='point'&&(!!this.owner||pose==='fist'||pose==='phone'||pose==='thumb');
   const raw=mapHandPoint(palm?{cx:h.palmX??h.cx,cy:h.palmY??h.cy}:h,innerWidth,innerHeight);
   const offsetX=palm?(old?.palm?old.offsetX:old?old.x-raw.x:0):0;
   const offsetY=palm?(old?.palm?old.offsetY:old?old.y-raw.y:0):0;
   raw.x+=offsetX;raw.y+=offsetY;
   const point=smoothHandPoint(raw,old,t,pose==='point'?{deadzone:.75,slow:55,medium:28,fast:16}:undefined);
   const track={id,pose,palm,offsetX,offsetY,since:old?.pose===pose?old.since:measuredSince,measuredPose,measuredSince,fired:old?.pose===pose?old.fired:false,...point,t,uncertainSince,px:h.cx,py:h.cy,zx:h.palmX??h.cx,zy:h.palmY??h.cy};
   this.tracks.set(id,track);active.push(track);
  }
  for(const id of this.tracks.keys())if(!active.some(h=>h.id===id))this.tracks.delete(id);
  const interfaceHands=active.filter(h=>h.pose==='point'&&findHandControl(h.x,h.y,h.id===this.primary?this.hoverControl:null));
  const uiHand=active.find(h=>h.id===this.buttonDwell.state?.hand&&h.pose==='point');
  const dwellingHand=uiHand||!this.owner&&!this.dwell?.done&&this.dwell&&active.find(h=>h.id===this.dwell.hand&&h.pose==='point');
  const interfaceHand=dwellingHand||interfaceHands.find(h=>h.id===this.primary)||interfaceHands[0];
  // Keep the holding hand in charge until it explicitly releases the piece.
  const primary=active.find(h=>h.id===this.owner)||interfaceHand||active.find(h=>h.id===this.primary)||active.find(h=>h.pose==='point')||active[0];this.primary=primary.id;
  this.drawCursors(active,primary);this.pose=primary.pose;this.el.dataset.pose=this.pose;
  if(this.owner&&!active.some(h=>h.id===this.owner)){this.release();return}
  if(this.owner&&primary.pose==='none'&&t-primary.since>=200){this.release();return}
  if(blocked){this.release();this.pair=null}
  const selectedId=api?.getState().selectedId;
  const phoneValid=!blocked&&selectedId&&active.length===1&&primary.measuredPose==='phone';
  if(phoneValid){
   const previous=this.deleteHold;
   if(previous?.hand!==primary.id||previous.id!==selectedId||t-previous.lastValid>180)
    this.deleteHold={hand:primary.id,id:selectedId,elapsed:0,last:t,lastValid:t,valid:true};
   else{
    if(previous.valid)previous.elapsed+=Math.min(200,Math.max(0,t-previous.last));
    previous.last=t;previous.lastValid=t;previous.valid=true;
   }
  }else if(this.deleteHold){
   const keep=!blocked&&selectedId===this.deleteHold.id&&primary.id===this.deleteHold.hand&&active.length===1&&
    !['open','victory','ok','three','four'].includes(primary.measuredPose)&&t-this.deleteHold.lastValid<=180;
   if(keep){this.deleteHold.valid=false;this.deleteHold.last=t}else this.deleteHold=null;
  }
  if(!blocked&&primary.pose==='open'&&t-primary.since>=250&&selectedId){
   this.release();api.select(null);primary.fired=true;return;
  }
  if(this.owner&&this.trackingLost){
   this.trackingLost=false;api?.reanchorHandDrag(primary.x,primary.y);this.progress(0);return;
  }
  // Furniture deletion takes priority over UI hover; changing fingers must not cancel it.
  if(this.deleteHold){
   this.dragPaused=true;this.dwell=null;this.pair=null;
   const progress=Math.min(1,this.deleteHold.elapsed/1000);this.progress(progress);
   this.el.querySelector('.cur-label').textContent=phoneValid?'Hold phone sign to delete; open palm to cancel':'Keep phone sign visible';
   if(phoneValid&&progress===1&&!primary.fired){this.release();api.dispatch('delete');primary.fired=true}
   return;
  }
  const hit=document.elementFromPoint(primary.x,primary.y);
  const overInterface=!!findHandControl(primary.x,primary.y,this.hoverControl)||!!hit?.closest('button,a[href],input,select,summary,.studio-side,.edit-toolbar,.hand-view-tools,.camera-rail,.studio-toolbar,header,.selection-bar,.workspace-bottom');
  if(this.owner&&overInterface){
   if(primary.pose==='point'&&t-primary.since>=250)this.release();
   else{this.dragPaused=true;this.progress(0);return}
  }
  const button=findHandControl(primary.x,primary.y,this.hoverControl),modal=document.querySelector('dialog[open]');
  const buttonEnabled=button&&!button.disabled&&!button.closest('[hidden],[aria-disabled="true"]')&&(!modal||modal.contains(button));
  const repeat=repeatsWhilePointing(button);
  const ui=this.buttonDwell.update({repeat,target:button,hand:primary.id,x:primary.x,y:primary.y,pointing:primary.measuredPose==='point',released:['fist','open'].includes(primary.measuredPose),enabled:!!buttonEnabled,t});
  if(button||ui.active){
   if(button&&button!==this.hoverControl){this.hoverControl?.classList?.remove('g-hover');button.classList?.add('g-hover')}
   this.hoverControl=button||this.hoverControl;this.dwell=null;this.pair=null;this.progress(ui.progress);
   if(button&&primary.pose==='point'&&this.owner)this.release();
   if(ui.activate){const r=button.getBoundingClientRect?.();const ok=this.click(r?Math.max(r.left+2,Math.min(r.right-2,primary.x)):primary.x,r?Math.max(r.top+2,Math.min(r.bottom-2,primary.y)):primary.y,button);if(ok===false)this.buttonDwell.retry()}
   this.el.querySelector('.cur-label').textContent=!buttonEnabled?(api?.getState().busy?'Hand 1 - loading, please wait':button?.dataset?.command==='delete'?'Hand 1 - select a piece first':'Hand 1 - button disabled'):primary.pose!=='point'?'Hand 1 - point to click':this.buttonDwell.latch?(repeat?'Hand 1 - keep pointing to repeat':'Hand 1 - fold index, then point to click again'):'Hand 1 - hold to click';
   this.el.classList.add('over');return;
  }
  this.hoverControl?.classList?.remove('g-hover');this.hoverControl=null;this.el.classList.remove('over');
  const pairMode=!blocked&&!overInterface&&!this.owner&&active.length===2&&active.every(h=>h.pose==='open'||h.pose==='four')?'zoom':!blocked&&!overInterface&&!this.owner&&active.length===2&&active.every(h=>h.pose==='point')?'orbit':null;
  if(pairMode){
   if(this.owner)this.release();this.dwell=null;this.progress(0);
   const sorted=[...active].sort((a,b)=>a.id.localeCompare(b.id)),[a,b]=sorted;
   const d=pairMode==='zoom'?Math.hypot(b.zx-a.zx,b.zy-a.zy):Math.hypot(b.px-a.px,b.py-a.py),key=pairMode+sorted.map(h=>h.id).join(':');
   if(this.pair?.key===key){
    if(pairMode==='zoom'&&this.pair.d>.08&&d>.08){const alpha=1-Math.exp(-Math.min(100,t-this.pair.t)/70);this.pair.smooth+=(d-this.pair.smooth)*alpha;const delta=Math.log(this.pair.smooth/this.pair.applied);if(Math.abs(delta)>.006){const factor=Math.exp(Math.max(-.06,Math.min(.06,delta)));api?.gestureView({zoomFactor:factor,zoom:Math.sign(delta)});this.pair.applied*=factor}}
    if(pairMode==='orbit'){
     const pair=this.pair;if(!pair.mover){const da=Math.hypot(a.px-pair.origins[a.id].x,a.py-pair.origins[a.id].y),db=Math.hypot(b.px-pair.origins[b.id].x,b.py-pair.origins[b.id].y);if(Math.max(da,db)>.012)pair.mover=da>db?a.id:b.id}
     const moving=sorted.find(h=>h.id===pair.mover);if(moving){const previous=pair.previous[moving.id];api?.gestureView({twist:(moving.px-previous.x)*30,tilt:(moving.py-previous.y)*12})}
    }
    this.pair.d=d;this.pair.t=t;this.pair.lastValid=t;this.pair.previous=Object.fromEntries(sorted.map(h=>[h.id,{x:h.px,y:h.py}]));
   }else{const positions=Object.fromEntries(sorted.map(h=>[h.id,{x:h.px,y:h.py}]));this.pair={key,d,smooth:d,applied:d,t,lastValid:t,origins:positions,previous:positions,mover:null}}
   this.el.querySelector('.cur-label').textContent=pairMode==='orbit'?'Rotate: move either index finger':'Zoom: move hands apart / together';return;
  }
  this.el.querySelector('.cur-label').textContent='Hand 1';
  if(this.pair){if(t-this.pair.lastValid<180){this.dwell=null;return}this.pair=null;this.dwell=null;return}
  if(!blocked&&selectedId&&primary.pose==='thumb'&&t-primary.since>=250&&!this.rotating){
   if(api.beginHandRotate?.(selectedId,primary.x,primary.y)){this.owner=primary.id;this.rotating=true;this.dragPaused=false;this.dwell=null;this.pair=null;this.progress(0)}
   return;
  }
  if(!blocked){for(const h of active){
   if((this.owner&&h.id!==this.owner)||h.fired||t-h.since<250)continue;
   if((h.pose==='three'||h.pose==='four')&&t-h.since>=650){this.release();api?.dispatch(h.pose==='three'?'panel:library':'panel:objects');h.fired=true;return}
   if(h.pose==='victory'||h.pose==='ok'){this.release();api?.dispatch(h.pose==='victory'?'undo':'redo');h.fired=true;return}
  }}
  if(this.owner){
   if(primary.pose!=='phone')this.progress(0);
   if((this.rotating&&primary.pose==='thumb')||(!this.rotating&&primary.pose==='fist')){
    if(this.dragPaused){api?.reanchorHandDrag(primary.x,primary.y);this.dragPaused=false}
    else api?.moveHandDrag(primary.x,primary.y);
   }else{
    if(this.rotating&&primary.pose==='fist'&&t-primary.since>=250){if(api.beginHandDrag(selectedId,primary.x,primary.y)){this.rotating=false;this.dragPaused=false}return}
    this.dragPaused=true;
    if(primary.pose==='point'&&t-primary.since>=250){this.release();return}
   }
   return;
  }
  if(primary.pose!=='fist'){this.dwell=null;this.progress(0);return}
  const {x,y}=primary,id=!blocked?api?.hitTest(x,y):null,key=id?`object:${id}`:null;
  if(!key){const d=this.dwell;if(d&&d.hand===primary.id&&t-(d.lastValid??d.t)<180&&Math.hypot(x-d.x,y-d.y)<Math.max(44,Math.min(innerWidth,innerHeight)*.07)){d.t+=t-(d.lastFrame??t);d.lastFrame=t;return}this.dwell=null;this.progress(0);return}
  if(this.dwell?.key!==key||this.dwell.hand!==primary.id||Math.hypot(x-this.dwell.x,y-this.dwell.y)>Math.max(44,Math.min(innerWidth,innerHeight)*.07)){this.dwell={key,hand:primary.id,x,y,t,lastValid:t,lastFrame:t,done:false};this.progress(0);return}
  this.dwell.lastValid=t;this.dwell.lastFrame=t;if(this.dwell.done)return;
  const progress=Math.min(1,(t-this.dwell.t)/500);this.progress(progress);
  if(progress===1){this.dwell.done=true;this.progress(0);if(id&&api.beginHandDrag(id,x,y))this.owner=primary.id}
 }
}
