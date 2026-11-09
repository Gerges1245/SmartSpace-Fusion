import assert from 'node:assert/strict';
import {HandIdentityTracker} from '../frontend/reference/hand-identity.js';
const h=(name,x,y=.5)=>({name,palmX:x,palmY:y});
const ids=hands=>Object.fromEntries(hands.map(h=>[h.name,h.id]));
const tracker=new HandIdentityTracker();
const first=ids(tracker.update([h('A',.04),h('B',.96)],0));
assert.notEqual(first.A,first.B);
assert.equal(ids(tracker.update([h('B',.94)],50)).B,first.B);
assert.equal(ids(tracker.update([h('B',.93)],100)).B,first.B);
const returned=ids(tracker.update([h('B',.92),h('A',.02)],150));assert.deepEqual(returned,first,'edge re-entry cannot swap identities');
tracker.update([],200);tracker.update([],250);
assert.deepEqual(ids(tracker.update([h('B',.9),h('A',.03)],400)),first,'complete brief occlusion preserves both identities regardless of array order');
const crossing=new HandIdentityTracker();const original=ids(crossing.update([h('A',.3),h('B',.7)],0));
for(const [t,a,b] of [[50,.37,.63],[100,.44,.56],[150,.49,.51],[200,.54,.46],[250,.6,.4]]){
 const actual=ids(crossing.update([h('B',b),h('A',a)],t));assert.deepEqual(actual,original,'predicted motion must retain IDs through a crossing');
}
const guarded=new HandIdentityTracker();const start=ids(guarded.update([h('A',.1),h('B',.9)],0));
assert.equal(guarded.update([h('unknown',.5)],30).length,0,'an implausible jump must not steal an existing ID');
assert.equal(ids(guarded.update([h('B',.88)],100)).B,start.B);
console.log('Edge dropout/re-entry, full brief occlusion, reversed detection order, crossing trajectories and implausible-jump guards passed.');
