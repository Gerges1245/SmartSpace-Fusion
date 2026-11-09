import assert from 'node:assert/strict';
import {HandDetector} from '../frontend/reference/vision.js';
import {HandControls} from '../frontend/hand-controls.js';
let clicks=0;
const control={tagName:'BUTTON',isConnected:true,disabled:false,dataset:{command:'delete'},classList:{add(){},remove(){}},
 getBoundingClientRect:()=>({left:0,right:1000,top:0,bottom:800}),focus(){},click(){clicks++},
 closest(selector){return selector.startsWith('button,')||selector.startsWith('button,a,')?this:null}};
const element=()=>({style:{},dataset:{},classList:{add(){},remove(){}},querySelector:()=>({style:{}}),remove(){}});
globalThis.innerWidth=1000;globalThis.innerHeight=800;
globalThis.document={querySelector:()=>null,querySelectorAll:()=>[],elementFromPoint:()=>control,createElement:element,addEventListener(){},body:{append(){},appendChild(el){el.parentNode=this}}};
globalThis.window={addEventListener(){},Hands:class{setOptions(){}onResults(){}}};
const {clickWebsitePoint}=await import('../frontend/hand-cursor.js');
const detector=new HandDetector();
const skeleton=Array.from({length:21},()=>({x:0,y:0,z:0}));skeleton[0]={x:0,y:-1,z:0};
for(const [base,x] of [[5,0],[9,.3],[13,.6],[17,.9]]){
 skeleton[base]={x,y:0,z:0};skeleton[base+1]={x,y:.4,z:0};
 skeleton[base+2]={x:x+.1,y:.2,z:0};skeleton[base+3]={x:x+.1,y:0,z:0};
}
skeleton[7]={x:0,y:.7,z:0};skeleton[8]={x:0,y:1,z:0};
skeleton[2]={x:-.4,y:0,z:0};skeleton[3]={x:-.4,y:.2,z:0};skeleton[4]={x:-.3,y:0,z:0};
for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
 const before=clicks;
 const engine=new HandControls({api:()=>({endHandDrag(){},getState:()=>({busy:false,selectedId:null})}),click:clickWebsitePoint,element:element()});
 const landmarks=skeleton.map(({x,y,z})=>({x:.5+.1*(x*Math.cos(angle)-y*Math.sin(angle)),y:.5+.1*(x*Math.sin(angle)+y*Math.cos(angle)),z}));
 const measured={...detector.measure(landmarks),id:'A'};
 for(let t=0;t<=500;t+=50)engine.update({present:true,hands:[measured]},t);
 assert.equal(clicks,before+1,'Real landmark measurement must activate the actual button click path after holding an index');
 engine.stop();
}
const before=clicks,engine=new HandControls({api:()=>({endHandDrag(){},getState:()=>({busy:false,selectedId:null})}),click:clickWebsitePoint,element:element()});
const fist=skeleton.map((p,i)=>i===7?{x:.1,y:.2,z:0}:i===8?{x:.1,y:0,z:0}:p);
const measured={...detector.measure(fist),id:'A'};
for(let t=0;t<=1000;t+=50)engine.update({present:true,hands:[measured]},t);
assert.equal(clicks,before,'A closed index must never trigger Delete');engine.stop();
console.log('Landmarks -> pose -> dwell -> actual button click passed at four hand rotations; folded index cannot click Delete.');
