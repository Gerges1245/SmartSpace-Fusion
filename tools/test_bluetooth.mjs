import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

let scans=0,selected=[],opened=[],scheduled=[];
let accounts=[];
const context=vm.createContext({state:{user:null},detectedDevice:null,
  document:{querySelector(){return null}},window:{addEventListener(){},async openStudio(id){opened.push(id)}},
  setTimeout(fn,ms){scheduled.push({fn,ms});return scheduled.length},clearTimeout(){},
  setProfile(profile){context.state.user=profile.id},
  async request(action,data){
    if(action==='scan'){scans++;return {accounts,devices:[]}}
    if(action==='select'){selected.push(data.address);return {id:'2',gender:'female',projects:[{id:8}]}}
    throw new Error('Unexpected request '+action);
  }});
vm.runInContext(fs.readFileSync(new URL('../frontend/bluetooth-control.js',import.meta.url),'utf8'),context);
const run=code=>vm.runInContext(code,context);
await run('scanBluetooth()');
assert.equal(scans,1);assert.equal(scheduled[0].ms,500);assert.equal(selected.length,0);
accounts=[{id:'2',name:'Nour',address:'AA:BB:CC:11:22:33'}];
await scheduled[0].fn();
assert.deepEqual(selected,['AA:BB:CC:11:22:33']);assert.deepEqual(opened,[8]);
assert.equal(context.state.user,'2');
await run('scanBluetooth()');
assert.equal(scans,2,'An active workspace must not be switched by another scan');
console.log('Automatic retry, immediate matched-device entry, last-room opening and stable active workspace passed.');

// Restarting the search during an in-flight request must not strand the retry loop.
let finishScan;
context.state.user=null;scheduled=[];
context.request=()=>new Promise(resolve=>{finishScan=resolve});
run('startBluetoothDetection()');run('startBluetoothDetection()');
assert.equal(scheduled.length,1);
finishScan({accounts:[],devices:[]});await new Promise(setImmediate);
let restarted=0;context.request=async()=>{restarted++;return {accounts:[],devices:[]}};
await scheduled[0].fn();await new Promise(setImmediate);
assert.equal(restarted,1,'An interrupted search must retry automatically');
console.log('Restarting an in-flight scan preserves automatic retries.');
