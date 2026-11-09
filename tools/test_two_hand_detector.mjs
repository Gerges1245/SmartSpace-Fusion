import assert from 'node:assert/strict';
import {HandDetector,fingerExtended} from '../frontend/reference/vision.js';
let options,resolveSend,sends=0;
globalThis.window={Hands:class{setOptions(o){options=o}onResults(cb){this.callback=cb}send(){sends++;return new Promise(r=>resolveSend=r)}}};
const detector=new HandDetector();assert.equal(options.maxNumHands,2);assert.equal(options.modelComplexity,0);
const palm=x=>Array.from({length:21},(_,i)=>({x:x+(i%3)*.01,y:.7-i*.01,z:0}));
const a=palm(.2),b=palm(.7);
const result=(landmarks,labels)=>detector._handleResults({multiHandLandmarks:landmarks,multiHandedness:labels.map(label=>({label}))});
result([a,b],['Left','Left']);assert.equal(detector.result.hands.length,2);
const ids=detector.result.hands.map(h=>h.id);assert.equal(new Set(ids).size,2,'identical handedness labels must not merge hands');
result([b,a],['Right','Left']);assert.deepEqual(detector.result.hands.map(h=>h.id),[ids[1],ids[0]],'identity follows palm when result order changes');
let arcs=0,lines=0;detector.drawDebug({clearRect(){},beginPath(){},moveTo(){},lineTo(){lines++},stroke(){},arc(){arcs++},fill(){}},320,240);
assert.equal(arcs,42);assert.equal(lines,42,'both skeletons must be drawn');
result([a],['Right']);assert.equal(detector.result.hands[0].id,ids[0]);
result([b,a],['Left','Left']);assert.equal(detector.result.hands[1].id,ids[0]);assert.equal(new Set(detector.result.hands.map(h=>h.id)).size,2);
for(let i=0;i<4;i++)result([],[]);assert.equal(detector.result.present,false);assert.equal(detector.allLandmarks.length,0);
const pending=detector.send({readyState:2,videoWidth:640});await detector.send({readyState:2,videoWidth:640});assert.equal(sends,1);resolveSend();await pending;
console.log('Two-hand detector configuration, duplicate labels, reordered detections, hand re-entry, both skeletons, dropout and serialized inference passed.');

const fingers=Array.from({length:21},()=>({x:0,y:0,z:0}));
fingers[0]={x:0,y:-1,z:0};
for(const [mcp,x] of [[5,0],[9,.3],[13,.6],[17,.9]]){
 fingers[mcp]={x,y:0,z:0};fingers[mcp+1]={x,y:.4,z:0};
 fingers[mcp+2]={x:x+.1,y:.2,z:0};fingers[mcp+3]={x:x+.1,y:0,z:0};
}
fingers[7]={x:0,y:.7,z:0};fingers[8]={x:0,y:1,z:0};
for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
 const lm=fingers.map(({x,y,z})=>({x:.5+.1*(x*Math.cos(angle)-y*Math.sin(angle)),y:.5+.1*(x*Math.sin(angle)+y*Math.cos(angle)),z}));
 const measured=detector.measure(lm);
 assert.equal(measured.indexExtended,true,'A sideways index must remain extended');
 assert.equal(measured.middleExtended,false);assert.equal(measured.ringExtended,false);assert.equal(measured.pinkyExtended,false);
}
const towardsCamera=fingers.map(({x,y,z})=>({x,y:z,z:y}));assert.equal(fingerExtended(towardsCamera,5,6,7,8),true);
assert.equal(fingerExtended(fingers,9,10,11,12),false);
console.log('Index recognition survives in-plane rotation and pointing towards the camera while folded fingers stay folded.');

const knuckleFold=fingers.map(p=>({...p}));
knuckleFold[9]={x:.3,y:1,z:0};knuckleFold[10]={x:.3,y:.7,z:0};knuckleFold[11]={x:.3,y:.4,z:0};knuckleFold[12]={x:.3,y:.1,z:0};
assert.equal(fingerExtended(knuckleFold,9,10,11,12),false,'Straight joints pointing back into the palm are a folded finger, not Four');
console.log('Fingers folded at the knuckle cannot be mistaken for an open four-finger hand.');
