import assert from 'node:assert/strict';
import {ByeByeTheme,wavePalm} from '../frontend/bye-bye-theme.js';
const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
globalThis.document={addEventListener(){},removeEventListener(){},querySelector:()=>null};
const flush=()=>new Promise(setImmediate);
const hand=(x=.5,open=true)=>({id:'hand-0',indexExtended:open,middleExtended:open,ringExtended:open,pinkyExtended:open,landmarks:Array.from({length:21},()=>({x:1-x,y:.5,z:0}))});
assert.deepEqual(wavePalm(hand(.3)),[.30000000000000004,.5,0]);
{const tilted=hand(.5);tilted.landmarks[0]={x:.5,y:.6,z:0};tilted.landmarks[9]={x:.6,y:.5,z:0};assert.ok(Math.abs(wavePalm(tilted,1)[2]-Math.atan2(-.1,.1))<1e-9,'roll is the wrist->middle MCP angle used by the video training');}
let t=0,toggles=0,requests=0;
const fetchFn=async path=>({ok:true,json:async()=>path==='/wave/status'?{ready:true}:{toggle:(requests++,true)}});
const client=new ByeByeTheme({fetchFn,now:()=>t,toggle:()=>toggles++});await flush();
for(t=0;t<=3000;t+=100)client.update([hand(.5+.15*Math.sin(t/3000*5*Math.PI))],t);await flush();
assert.equal(toggles,1);assert.equal(requests,1);
for(t=3200;t<=6500;t+=100)client.update([hand(.5+.15*Math.sin(t/3000*5*Math.PI))],t);await flush();assert.equal(toggles,1,'continuous waving must not flip the theme back');
t=7000;client.update([],t);t=7700;client.update([],t);
for(t=8000;t<=11000;t+=100)client.update([hand(.5+.15*Math.sin(t/3000*5*Math.PI))],t);await flush();assert.equal(toggles,2,'lowering the hand rearms recognition');client.stop();
console.log('Recorded palm coordinates, three-second wave windows, one toggle per wave and neutral rearm passed.');
{
 let resolveRecognition;let count=0;t=0;
 const c=new ByeByeTheme({now:()=>t,toggle:()=>count++,fetchFn:async path=>path==='/wave/status'?{ok:true,json:async()=>({ready:true})}:new Promise(resolve=>resolveRecognition=resolve)});await flush();
 for(t=0;t<=7000;t+=100)c.update([hand(.5+.15*Math.sin(t/3000*5*Math.PI))],t);
 assert.ok(c.pending,'recognition backpressure retains one request');c.stop();resolveRecognition({ok:true,json:async()=>({toggle:true})});await flush();assert.equal(count,0,'stopped camera cannot toggle from a late response');
}
{
 storage.clear();let saved=null;t=0;
 const c=new ByeByeTheme({now:()=>t,fetchFn:async(path,options)=>({ok:true,json:async()=>{
  if(path==='/wave/templates'){saved=JSON.parse(options.body);return {ready:true}}
  return {ready:false};
 }})});await flush();
 for(const label of ['Bye Bye','Other'])for(let sample=0;sample<5;sample++){
  c.startRecording(label);const start=t+2000;
  for(t=start;t<=start+3000;t+=100)c.update([hand(.5+.15*Math.sin(t/3000*5*Math.PI))],t);await flush();
 }
 assert.equal(saved.samples['Bye Bye'].length,5);assert.equal(saved.samples.Other.length,5);assert.equal(c.ready,true);
 assert.ok(storage.has('smartspace-wave-training'),'partial samples survive a page reload');c.stop();
}
console.log('Training captures five real-time samples per class, persists progress and saves to the server automatically.');

// Production callback activates the same existing theme button used by the UI.
{
 t=0;let pressed=0;document.querySelector=selector=>selector==='[data-action="theme"]'?{click(){pressed++}}:null;
 const c=new ByeByeTheme({now:()=>t,fetchFn:async path=>({ok:true,json:async()=>path==='/wave/status'?{ready:true}:{ready:true,toggle:true}})});await flush();
 for(t=0;t<=3000;t+=100)c.update([hand(.5+.15*Math.sin(t/3000*5*Math.PI))],t);await flush();assert.equal(pressed,1);c.stop();document.querySelector=()=>null;
}
console.log('Recognized Bye Bye activates the existing theme button rather than a separate theme implementation.');

// Approximately 5fps, with two missed frames, must still complete a useful wave window.
{
 t=0;let sent=0,changed=0;
 const c=new ByeByeTheme({now:()=>t,toggle:()=>changed++,fetchFn:async path=>({ok:true,json:async()=>path==='/wave/status'?{ready:true}:{ready:true,toggle:(sent++,true)}})});await flush();
 for(const time of [0,200,400,600,800,1000,1200,1400,1600,1800]){
  t=time;c.update(time===600||time===800?[]:[hand(.5+.12*Math.sin(time/1800*5*Math.PI))],t);
 }
 await flush();assert.equal(sent,1,'missed frames must not reset the rolling wave');assert.equal(changed,1);c.stop();
}
console.log('Low-frame-rate rolling recognition tolerates missed frames and activates without an uninterrupted three-second segment.');
