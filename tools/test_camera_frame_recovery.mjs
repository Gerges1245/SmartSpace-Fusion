import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const callbacks=[];let updates=0,fail=true,time=0,warnings=0;
const button={dataset:{},setAttribute(){}};
const video={paused:false,ended:false,readyState:2,videoWidth:640,videoHeight:480,play:async()=>{},requestVideoFrameCallback(fn){callbacks.push(fn);return callbacks.length},cancelVideoFrameCallback(){}};
const stream={getTracks:()=>[{stop(){}}],getVideoTracks:()=>[{addEventListener(){}}]};
const elements={'#hand-video':video,'#hand-camera-toggle':button,'#hand-camera-status':{textContent:''},'#hand-camera-preview':{hidden:true}};
const context=vm.createContext({console:{warn(){warnings++}},navigator:{mediaDevices:{getUserMedia:async()=>stream}},
 document:{querySelector:s=>elements[s]||null,addEventListener(){}},window:{Hands:class{},addEventListener(){}},
 performance:{now:()=>time+=100},cancelAnimationFrame(){},
 HandDetector:class{constructor(){this.result={present:true,hands:[]};this.procMs=20;this.hands={close(){}}}async send(){}},
 HandControls:class{constructor(){this.pose='point'}update(){updates++;if(fail){fail=false;throw Error('temporary UI failure')}}stop(){}},
 ByeByeTheme:class{update(){}stop(){}},openHandKeyboard(){},gestureGuideMarkup(){},gestureShortcutsMarkup(){}});
const source=fs.readFileSync(new URL('../frontend/hand-cursor.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
vm.runInContext(source,context);await vm.runInContext('start()',context);assert.equal(callbacks.length,1);
await callbacks.shift()();assert.equal(warnings,1);assert.equal(callbacks.length,1,'A throwing frame must schedule the next frame');
for(let i=0;i<20;i++){await callbacks.shift()();assert.equal(callbacks.length,1,'Frame recovery must not multiply or stop the loop')}
assert.ok(updates>=21);vm.runInContext('stopHandCursor()',context);
console.log('A transient hand-frame exception recovers and processes 20 further frames without freezing or duplicate loops.');
