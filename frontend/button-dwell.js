// Button dwell is independent of furniture dragging, shortcuts and inspector rebuilds.
export function controlKey(target){
 if(!target)return null;
 if(target.id)return 'id:'+target.id;
 const data=Object.entries(target.dataset||{}).filter(([key])=>!['bound','active'].includes(key)).sort(([a],[b])=>a.localeCompare(b));
 if(data.length)return JSON.stringify(data);
 return target.tagName&&target.textContent?'text:'+target.tagName+':'+target.textContent.trim():target;
}
export function repeatsWhilePointing(target){
 const data=target?.dataset;if(!data)return false;
 if(data.handScroll!==undefined||data.handDialogScroll!==undefined||data.nudge!==undefined||data.adjust!==undefined)return true;
 return /^(move:|rotate:|scale:|view:|room:)/.test(data.command||'')||data.command==='rotate45';
}
export class ButtonDwell {
 constructor({holdMs=500,graceMs=240,leaveMs=200,repeatMs=350}={}){this.holdMs=holdMs;this.graceMs=graceMs;this.leaveMs=leaveMs;this.repeatMs=repeatMs;this.state=null;this.latch=null}
 reset(){this.state=null;this.latch=null}
 update({target,hand,x,y,pointing=true,enabled=true,released=false,repeat=false,t}){
  const key=controlKey(target),rect=target?.getBoundingClientRect?.();
  if(this.latch){
   // Explicitly folding the index rearms the same button without leaving its bounds.
   // Missing tracking, disabled controls and another hand must not rearm it.
   if(released&&hand===this.latch.hand){
    this.latch.releasedAt??=t;
    if(t-this.latch.releasedAt>=this.leaveMs){this.latch=null;this.state=null}
   }else this.latch.releasedAt=null;
  }
  if(this.latch){
   const r=this.latch.rect,inside=r&&x>=r.left-14&&x<=r.right+14&&y>=r.top-14&&y<=r.bottom+14;
   if(key===this.latch.key||inside)this.latch.leftAt=null;
   else{this.latch.leftAt??=t;if(t-this.latch.leftAt>=this.leaveMs){if(this.state?.key===this.latch.key)this.state=null;this.latch=null}}
  }
  const valid=!!target&&pointing&&enabled;
  if(!valid){
   if(this.state){
    this.state.last=t;this.state.pausedAt??=t;
    if(t-this.state.pausedAt>this.graceMs)this.state=null;
   }
   return {progress:this.state?this.state.elapsed/this.holdMs:0,activate:false,active:!!this.state};
  }
  if(!this.state||this.state.key!==key||this.state.hand!==hand||(this.state.pausedAt!==null&&t-this.state.pausedAt>this.graceMs)){this.state={key,hand,elapsed:0,last:t,pausedAt:null};return {progress:0,activate:false,active:true}}
  const state=this.state;
  // The interval following a missed/disabled frame does not count as time on target.
  if(state.pausedAt===null)state.elapsed+=Math.max(0,t-state.last);
  state.last=t;state.pausedAt=null;
  if(this.latch?.key===key){
   if(repeat&&this.latch.hand===hand){
    if(state.elapsed>=this.repeatMs){state.elapsed=0;return {progress:0,activate:true,active:true}}
    return {progress:state.elapsed/this.repeatMs,activate:false,active:true};
   }
   state.elapsed=0;return {progress:0,activate:false,active:true};
  }
  if(state.elapsed<this.holdMs)return {progress:Math.min(1,state.elapsed/this.holdMs),activate:false,active:true};
  this.latch={key,hand,rect,leftAt:null,releasedAt:null};state.elapsed=0;
  return {progress:0,activate:true,active:true};
 }
 retry(){this.latch=null;if(this.state)this.state.elapsed=0}
}
