// Match in camera space, before pointer coordinates are clamped to screen edges.
// Missing hands retain their identity briefly instead of donating it to the other hand.
export class HandIdentityTracker {
 constructor({retentionMs=900}={}){this.retentionMs=retentionMs;this.tracks=new Map()}
 update(hands,t){
  for(const [id,track] of this.tracks)if(t-track.t>this.retentionMs)this.tracks.delete(id);
  const tracks=[...this.tracks.values()];
  const cost=(hand,track)=>{
   const age=Math.max(0,t-track.t)/1000,horizon=Math.min(age,.15);
   const px=track.x+track.vx*horizon,py=track.y+track.vy*horizon;
   const distance=Math.hypot(hand.palmX-track.x,hand.palmY-track.y);
   if(distance>Math.min(.34,.16+age*.7))return Infinity;
   const predicted=Math.hypot(hand.palmX-px,hand.palmY-py);
   const labelPenalty=hand.side&&track.side&&hand.side!==track.side?.04:0;
   return predicted*.8+distance*.2+labelPenalty;
  };
  let best={score:Infinity,assignment:[]};
  const assign=(index,used,assignment,score)=>{
   if(index===hands.length){if(score<best.score)best={score,assignment:[...assignment]};return}
   for(const track of tracks){
    if(used.has(track.id))continue;const distance=cost(hands[index],track);if(!Number.isFinite(distance))continue;
    used.add(track.id);assignment.push(track);assign(index+1,used,assignment,score+distance);assignment.pop();used.delete(track.id);
   }
   assignment.push(null);assign(index+1,used,assignment,score+1);assignment.pop();
  };
  assign(0,new Set(),[],0);
  const reserved=new Set(this.tracks.keys()),output=[];
  hands.forEach((hand,i)=>{
   const previous=best.assignment[i];
   const id=previous?.id||['hand-0','hand-1'].find(id=>!reserved.has(id));
   if(!id)return;reserved.add(id);
   const dt=previous?Math.max(.016,(t-previous.t)/1000):1;
   const velocity=(axis)=>previous?Math.max(-1.5,Math.min(1.5,(hand[axis==='x'?'palmX':'palmY']-previous[axis])/dt))*.65+previous[axis==='x'?'vx':'vy']*.35:0;
   this.tracks.set(id,{id,x:hand.palmX,y:hand.palmY,vx:velocity('x'),vy:velocity('y'),t,side:previous?.side||hand.side});
   output.push({...hand,id});
  });
  return output;
 }
}
