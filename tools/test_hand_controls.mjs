import assert from 'node:assert/strict';
import {HandControls,handPose,isPhoneSign,mapHandPoint,smoothHandPoint} from '../frontend/hand-controls.js';
globalThis.innerWidth=1000;globalThis.innerHeight=800;
const element=()=>({style:{},dataset:{},classList:{add(){},remove(){}},querySelector:()=>({style:{}}),remove(){}});
let hit=()=>null;
globalThis.document={addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],elementFromPoint:(x,y)=>hit(x,y),createElement:element,body:{append(){},appendChild(el){el.parentNode=this}}};
const hand=(pose,id='Left',x=.3)=>({id,cx:x,cy:.5,palmX:x,palmY:.5,indexExtended:['point','victory','open'].includes(pose),middleExtended:['victory','open','ok'].includes(pose),ringExtended:['open','ok'].includes(pose),pinkyExtended:['open','ok','phone'].includes(pose),thumbExtended:['open','pinch','phone','thumb'].includes(pose),isPinching:pose==='ok'||pose==='pinch'});
const button=(command,left,right)=>({dataset:{command},isConnected:true,disabled:false,classList:{add(){},remove(){}},closest(selector){return selector.startsWith('button,')?this:null},getBoundingClientRect(){return {left,right,top:350,bottom:550}}});
function fixture(){
 hit=()=>null;const calls={select:[],begin:[],move:[],click:[],command:[],view:[],reanchor:[],rotate:[]};let selectedId=null,dragId=null,busy=false;
 const api={getState:()=>({busy,selectedId,handDraggingId:dragId}),hitTest:x=>x<500?1:2,
 select:id=>{selectedId=id;calls.select.push(id)},beginHandDrag(id,x,y){selectedId=id;dragId=id;calls.begin.push(id);return true},beginHandRotate(id,x,y){selectedId=id;dragId=id;calls.rotate.push(id);return true},moveHandDrag:(x,y)=>calls.move.push([x,y]),reanchorHandDrag:(x,y)=>calls.reanchor.push([x,y]),endHandDrag(){dragId=null},dispatch:cmd=>{calls.command.push(cmd);if(cmd==='delete')selectedId=null},gestureView:data=>calls.view.push(data)};
 const c=new HandControls({api:()=>api,click(x,y,target){calls.click.push(target?.dataset.command);return true},element:element()});
 return {c,calls,api,frame:(t,...hands)=>c.update({present:!!hands.length,hands},t),drag:()=>dragId,setBusy:value=>busy=value};
}

for(const p of ['point','pinch','fist','victory','open','ok','phone','thumb'])assert.equal(handPose(hand(p)),p);
assert.equal(handPose({...hand('phone'),isPinching:true}),'phone','Phone sign takes priority over fingertip proximity');
assert.equal(handPose({...hand('fist'),isPinching:true}),'fist');
function hold(f,pose,start,end,...others){for(let t=start;t<=end;t+=50)f.frame(t,hand(pose),...others)}
function grab(f){hold(f,'fist',0,500);assert.equal(f.drag(),1);assert.equal(f.api.getState().selectedId,1)}
{
 const f=fixture();hold(f,'point',0,600);assert.equal(f.drag(),null);assert.equal(f.api.getState().selectedId,null);
 hold(f,'pinch',650,1000);assert.equal(f.drag(),null);f.c.stop();
}
{
 const f=fixture();f.frame(0,hand('fist'));f.frame(499,hand('fist'));assert.equal(f.drag(),null);
 f.frame(500,hand('fist'));assert.equal(f.drag(),1);
 f.frame(550,hand('fist','Left',.35));assert.ok(f.calls.move.length>0);
 hold(f,'open',600,850);assert.equal(f.drag(),null);assert.equal(f.api.getState().selectedId,null);assert.equal(f.calls.command.length,0);f.c.stop();
}
{
 const f=fixture();grab(f);hold(f,'phone',550,1500);assert.equal(f.calls.command.length,0);
 f.frame(1550,hand('phone'));assert.deepEqual(f.calls.command,['delete']);assert.equal(f.drag(),null);
 hold(f,'phone',1600,2200);assert.deepEqual(f.calls.command,['delete']);f.c.stop();
}
{
 const f=fixture();grab(f);hold(f,'phone',550,1000);hold(f,'open',1050,1400);
 assert.equal(f.calls.command.length,0);assert.equal(f.api.getState().selectedId,null);f.c.stop();
}
{
 const f=fixture();grab(f);hold(f,'point',550,800);assert.equal(f.drag(),null);assert.equal(f.api.getState().selectedId,1);
 hold(f,'phone',850,2050);assert.deepEqual(f.calls.command,['delete'],'Phone deletes a selected piece even after drag release');f.c.stop();
}
{
 const f=fixture();grab(f);hold(f,'phone',550,1000);f.frame(1050);hold(f,'phone',1100,1600);
 assert.equal(f.calls.command.length,0,'Tracking loss restarts delete timer');f.c.stop();
}
{
 const f=fixture();grab(f);hold(f,'phone',550,1000);f.frame(1700,hand('phone'));
 assert.equal(f.calls.command.length,0,'Unobserved frames cannot complete deletion');f.c.stop();
}
{
 const f=fixture();grab(f);hold(f,'phone',550,1600,hand('phone','Right',.7));assert.equal(f.calls.command.length,0);
 hold(f,'phone',1650,2150);assert.equal(f.calls.command.length,0);hold(f,'phone',2200,2650);assert.deepEqual(f.calls.command,['delete']);f.c.stop();
}
console.log('Fist selects and drags; open palm clears selection without deleting; phone sign requires a continuous second, cancels safely and fires once.');
{
 const f=fixture(),target=button('toggle-grid',650,950);grab(f);hit=x=>x>650?target:null;
 f.frame(550,hand('fist'),hand('point','Right',.7));f.frame(1050,hand('fist'),hand('point','Right',.7));
 assert.equal(f.c.primary,'Left');assert.equal(f.drag(),1);assert.equal(f.calls.click.length,0);assert.equal(f.calls.view.length,0);f.c.stop();
}
{
 const f=fixture();grab(f);f.frame(550);f.frame(800);assert.equal(f.drag(),1);
 const moves=f.calls.move.length;f.frame(850,hand('fist','Left',.5));assert.equal(f.calls.reanchor.length,1);assert.equal(f.calls.move.length,moves);
 f.frame(900,hand('fist','Left',.51));assert.ok(f.calls.move.length>moves);
 f.frame(950);f.frame(1750);assert.equal(f.drag(),null);assert.equal(f.api.getState().selectedId,1);f.c.stop();
}
{
 const f=fixture();grab(f);f.frame(550,hand('point','Right',.7));f.frame(800,hand('point','Right',.7));assert.equal(f.drag(),1);
 f.frame(850,hand('fist'));assert.equal(f.calls.reanchor.length,1);assert.equal(f.drag(),1);f.c.stop();
}
{
 const f=fixture();hold(f,'victory',0,600);hold(f,'ok',650,1000);assert.deepEqual(f.calls.command,['undo','redo']);f.c.stop();
}
{
 const f=fixture();const target=button('rotate45',0,1000);hit=()=>target;hold(f,'point',0,500);assert.deepEqual(f.calls.click,['rotate45']);f.c.stop();
}
{
 const f=fixture();f.frame(0,hand('point','Left',.3),hand('point','Right',.7));f.frame(100,hand('point','Left',.3),hand('point','Right',.75));assert.ok(f.calls.view.some(v=>v.twist>0));f.c.stop();
}
{
 const f=fixture();f.frame(0,hand('open','Left',.3),hand('open','Right',.7));f.frame(100,hand('open','Left',.2),hand('open','Right',.8));assert.ok(f.calls.view.some(v=>v.zoomFactor>1));f.c.stop();
}
{
 const f=fixture();f.setBusy(true);hold(f,'fist',0,1000);assert.equal(f.calls.begin.length,0);
 f.api.select(1);hold(f,'phone',1050,2200);hold(f,'open',2250,2600);assert.equal(f.calls.command.length,0);assert.equal(f.api.getState().selectedId,1);f.c.stop();
}
console.log('Ownership, dropout reanchoring, camera gestures, button dwell, undo/redo and busy guards passed.');
assert.deepEqual(mapHandPoint({cx:.2,cy:.14},1000,800),{x:0,y:0});
const far=mapHandPoint({cx:.8,cy:.78},1000,800);assert.ok(Math.abs(far.x-999)<1e-8&&Math.abs(far.y-799)<1e-8);
let steady={x:500,y:400,t:0};for(let t=100;t<=600;t+=100){steady={...smoothHandPoint({x:504,y:403},steady,t),t};assert.ok(steady.x>=500&&steady.x<504)}
assert.ok(smoothHandPoint({x:800,y:400},steady,700).x>750);
console.log('Camera mapping and jitter filtering preserved.');

// Small intentional movements must not be swallowed by the old seven-pixel dead zone.
const slow=smoothHandPoint({x:505,y:400},{x:500,y:400,t:0},33);assert.ok(slow.x>500&&slow.x<505);
{
 const f=fixture();grab(f);const moves=f.calls.move.length;
 f.frame(550,{...hand('fist','Left',.55),palmX:.3});
 assert.equal(f.calls.move.length,moves+1);assert.equal(f.calls.move.at(-1)[0],f.calls.move[0][0],'Curled fingertip changes must not move the furniture');f.c.stop();
}
{
 const f=fixture();grab(f);hold(f,'phone',550,1000);
 f.frame(1050,hand('fist'));f.frame(1100,hand('phone'));
 hold(f,'phone',1150,1600);assert.equal(f.calls.command.length,0);
 f.frame(1650,hand('phone'));assert.deepEqual(f.calls.command,['delete'],'Brief recognition flicker pauses instead of resetting deletion');f.c.stop();
}
{
 const f=fixture();grab(f);hold(f,'phone',550,1000);
 const target=button('rotate45',0,1000);hit=()=>target;
 hold(f,'phone',1050,1550);assert.deepEqual(f.calls.command,['delete'],'Deletion survives hovering a sidebar button');assert.equal(f.calls.click.length,0);f.c.stop();
}
{
 const f=fixture();grab(f);const moves=f.calls.move.length;
 f.frame(550,hand('point'));assert.equal(f.drag(),1,'One noisy pointing frame must not release a held piece');
 f.frame(600,hand('fist','Left',.4));f.frame(800,hand('fist','Left',.4));assert.equal(f.calls.reanchor.length,1);assert.equal(f.calls.move.length,moves,'Resuming movement reanchors rather than jumping');f.c.stop();
}
const phoneLandmarks=Array.from({length:21},()=>({x:0,y:0,z:0}));
for(const [id,x,y] of [[0,0,0],[2,-.5,.5],[3,-1,.5],[4,-1.5,.5],[5,-.25,1],[6,-.25,1.5],[8,-.25,.8],[9,0,1],[10,0,1.5],[12,0,.8],[13,.25,1],[14,.25,1.5],[16,.25,.8],[17,.5,1],[18,.5,1.5],[20,.5,2]])phoneLandmarks[id]={x,y,z:0};
for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
 const landmarks=phoneLandmarks.map(({x,y,z})=>({x:.5+.1*(x*Math.cos(angle)-y*Math.sin(angle)),y:.5+.1*(x*Math.sin(angle)+y*Math.cos(angle)),z}));
 assert.equal(handPose({...hand('fist'),landmarks}),'phone','Phone geometry is independent of image rotation and radial finger flags');
}
assert.equal(isPhoneSign({...hand('fist'),landmarks:phoneLandmarks.map((p,i)=>i===20?{x:.5,y:.8,z:0}:p)}),false,'Folded pinky must not count as phone');
console.log('Palm-based dragging, small smooth movements, noisy-pose recovery, tolerant deletion and rotated phone-sign geometry passed.');

assert.equal(handPose({...hand('point'),isPinching:true}),'point','An extended index remains a pointing gesture when the thumb is nearby');
{
 const f=fixture(),left=button('left',100,170),right=button('right',171,250);
 hit=x=>x>=171?right:left;
 f.frame(0,hand('point','Left',.3));assert.equal(f.c.hoverControl,left);
 f.frame(200,hand('point','Left',.307));assert.equal(f.c.hoverControl,right,'A neighbouring button wins even within the old button edge margin');
 f.frame(500,hand('point','Left',.307));assert.deepEqual(f.calls.click,[],'The old button cannot complete its dwell after leaving');
 f.frame(700,hand('point','Left',.307));assert.deepEqual(f.calls.click,['right']);f.c.stop();
}
{
 const f=fixture(),target=button('confirm',0,1000);hit=()=>target;
 f.frame(0,hand('point'));f.frame(400,hand('point'));f.frame(500,hand('fist'));
 assert.equal(f.calls.click.length,0,'Point-pose grace may not activate a button after the index folds');
 f.frame(550,hand('point'));assert.equal(f.calls.click.length,0);
 f.frame(650,hand('point'));assert.deepEqual(f.calls.click,['confirm']);f.c.stop();
}
{
 const f=fixture();grab(f);
 f.frame(550,{...hand('point','Left',.32),palmX:.7});const x=f.c.tracks.get('Left').x;
 assert.ok(x>166&&x<250,'Pointing uses the fingertip immediately, even during drag handoff');
 f.frame(600,{...hand('point','Left',.33),palmX:.1});assert.ok(f.c.tracks.get('Left').x>x&&f.c.tracks.get('Left').x<300);
 f.c.stop();
}
{
 const previous={x:200,y:100,t:0},raw={x:220,y:100};
 const finger=smoothHandPoint(raw,previous,33,{deadzone:.75,slow:55,medium:28,fast:16});
 const drag=smoothHandPoint(raw,previous,33);assert.ok(finger.x>drag.x&&finger.x<raw.x,'Finger pointing is more responsive without overshooting');
}
console.log('Adjacent button transitions, folded-index click prevention, fingertip handoff and low-latency pointer filtering passed.');

{
 const f=fixture(),target=button('toggle-grid',0,1000);hit=()=>target;
 hold(f,'point',0,500);assert.deepEqual(f.calls.click,['toggle-grid']);
 hold(f,'fist',550,800);hold(f,'point',850,1350);
 assert.deepEqual(f.calls.click,['toggle-grid','toggle-grid'],'Fold and point clicks the same button twice without moving away');
 hold(f,'open',1400,1650);hold(f,'point',1700,2200);
 assert.deepEqual(f.calls.click,['toggle-grid','toggle-grid','toggle-grid']);f.c.stop();
}
console.log('Three successive hand clicks on the same button work without leaving it.');

{
 const f=fixture(),target=button('scroll',0,300);target.dataset={handScroll:'1'};hit=()=>target;
 hold(f,'point',0,1550);assert.equal(f.calls.click.length,4,'Scroll repeats continuously while the same hand points at it');
 hit=()=>null;for(let t=1600;t<=2200;t+=50)f.frame(t,hand('point','Left',.7));assert.equal(f.calls.click.length,4,'Scrolling stops on leaving the button');f.c.stop();
}
console.log('Holding an index over Scroll Down repeats without leaving or folding, and stops when the pointer leaves.');

for(const direction of ['rotate:1','rotate:-1']){
 const f=fixture(),target=button(direction,0,300);hit=()=>target;
 hold(f,'point',0,1200);assert.deepEqual(f.calls.click,[direction,direction,direction],'Both rotation directions repeat while pointing');
 hit=()=>null;for(let t=1250;t<=1800;t+=50)f.frame(t,hand('point','Left',.7));assert.equal(f.calls.click.length,3);f.c.stop();
}
console.log('Both rotation buttons repeat while pointing and stop when the hand leaves.');

{
 const f=fixture();grab(f);hold(f,'thumb',550,800);
 assert.deepEqual(f.calls.rotate,[1]);assert.equal(f.c.rotating,true);assert.equal(f.calls.command.length,0,'Thumb rotation must not issue Undo');
 const moves=f.calls.move.length;f.frame(850,hand('thumb','Left',.35));assert.ok(f.calls.move.length>moves);
 hold(f,'open',900,1150);assert.equal(f.drag(),null);assert.equal(f.api.getState().selectedId,null);
 hold(f,'victory',1200,1550);assert.deepEqual(f.calls.command,['undo'],'V remains Undo after rotating');f.c.stop();
}
{
 const f=fixture();hold(f,'thumb',0,500);assert.equal(f.calls.rotate.length,0,'Thumb cannot rotate without a selected piece');f.c.stop();
}
{
 const f=fixture();grab(f);hold(f,'thumb',550,800);hold(f,'fist',850,1100);
 assert.equal(f.c.rotating,false);assert.equal(f.calls.begin.length,2,'Returning to a fist switches back to moving');f.c.stop();
}
console.log('Thumb-up rotation, open-palm finish, returning to translation and unchanged V Undo passed.');
