import assert from 'node:assert/strict';
import {ButtonDwell,controlKey,repeatsWhilePointing} from '../frontend/button-dwell.js';
const button=(command='rotate45')=>({dataset:{command},getBoundingClientRect:()=>({left:100,right:220,top:100,bottom:150})});
const dwell=new ButtonDwell();let target=button();
const tick=(t,opts={})=>dwell.update({target,hand:'A',x:150,y:125,t,...opts});
assert.equal(tick(0).activate,false);assert.equal(tick(250).progress,.5);
target=button();assert.equal(tick(500).activate,true,'DOM rebuild must not reset the semantic target');
assert.equal(tick(1500).activate,false,'remaining over a button never repeats');
tick(1600,{target:null,x:400});tick(1810,{target:null,x:400});target=button();tick(1900);assert.equal(tick(2400).activate,true,'leave for 200ms to rearm');
dwell.reset();tick(0);tick(200);tick(250,{enabled:false});assert.equal(tick(400).activate,false);assert.equal(tick(700).activate,true,'disabled frames pause instead of resetting progress');
dwell.reset();tick(0);tick(200);tick(250,{target:null});tick(350);assert.equal(tick(650).activate,true,'brief misses pause instead of restarting');
dwell.reset();tick(0);tick(200);tick(250,{pointing:false});tick(350,{pointing:false});assert.equal(tick(350,{pointing:false}).activate,false);tick(400);assert.equal(tick(700).activate,true,'uncertain pose cannot click but retains prior progress');
dwell.reset();tick(0);tick(400);assert.equal(tick(500,{hand:'B'}).activate,false,'another hand cannot finish the first hand dwell');
dwell.reset();tick(0);tick(200,{target:null});tick(500,{target:null});assert.equal(dwell.state,null,'long absence discards progress');
assert.equal(controlKey({dataset:{handScroll:'1',bound:'true'}}),controlKey({dataset:{handScroll:'1'}}));
console.log('Stable semantic targets, one click per visit, deliberate rearm, save/pose/miss pauses, identity isolation and expiry passed.');

dwell.reset();tick(0);tick(200);tick(250,{pointing:false});
assert.equal(tick(1000).progress,0,'A long pause must expire even without intermediate camera frames');
assert.equal(tick(1500).activate,true);
console.log('Sparse camera frames cannot revive expired dwell progress.');

dwell.reset();tick(0);assert.equal(tick(500).activate,true);
for(const start of [600,1400]){
 tick(start,{pointing:false,released:true});tick(start+200,{pointing:false,released:true});
 assert.equal(dwell.latch,null,'Folding the same hand rearms without leaving the button');
 assert.equal(tick(start+250).activate,false);assert.equal(tick(start+750).activate,true);
}
tick(2300,{pointing:false});tick(2600,{pointing:false});assert.equal(tick(2700).activate,false,'Uncertain pose alone cannot rearm');
tick(2800,{pointing:false,released:true,hand:'B'});tick(3100,{pointing:false,released:true,hand:'B'});assert.equal(tick(3200).activate,false,'Other hand cannot rearm this hand click');
console.log('Repeated same-button clicks rearm with a deliberate fold; uncertain poses and other hands cannot rearm.');

for(const data of [{handScroll:'1'},{handDialogScroll:'-1'},{nudge:'x:1'},{adjust:'scale:1'},{command:'rotate45'},{command:'view:in'}])assert.equal(repeatsWhilePointing({dataset:data}),true);
for(const command of ['delete','sign-out','toggle-grid','panel:library'])assert.equal(repeatsWhilePointing({dataset:{command}}),false);
dwell.reset();tick(0,{repeat:true});assert.equal(tick(500,{repeat:true}).activate,true);
assert.equal(tick(800,{repeat:true}).activate,false);assert.equal(tick(850,{repeat:true}).activate,true);
assert.equal(tick(1200,{repeat:true}).activate,true,'Holding repeats without leaving or folding');
assert.equal(tick(1250,{repeat:true,pointing:false}).activate,false);
assert.equal(tick(1400,{repeat:true}).activate,false,'Uncertain poses pause repetition');
assert.equal(tick(1500,{repeat:true,enabled:false}).activate,false);
assert.equal(tick(1600,{repeat:true}).activate,false,'Disabled controls cannot accumulate repeat time');
assert.equal(tick(1650,{repeat:true,hand:'B'}).activate,false);assert.equal(tick(2000,{repeat:true,hand:'B'}).activate,false,'A different hand cannot repeat a latched click');
console.log('Held scroll and adjustment buttons repeat every 350ms; disabled controls, uncertain poses and hand changes do not repeat.');
