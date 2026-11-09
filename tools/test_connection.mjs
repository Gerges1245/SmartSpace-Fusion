import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const actions=[],storage=new Map();let revoked=false;
const profile={id:'1',name:'Mohamed',gender:'male',projects:[{id:6},{id:7}]};
const token='opaque-session-token-from-the-server';
class Socket{
 static OPEN=1;readyState=0;authenticated=false;
 constructor(){queueMicrotask(()=>{this.readyState=1;this.onopen?.()})}
 send(raw){
  const p=JSON.parse(raw);actions.push(p.action);let ok=true,data={},error_code;
  if(p.action==='select'){this.authenticated=true;revoked=false;data={...profile,session_token:token}}
  else if(p.action==='resume_session'){ok=p.token===token&&!revoked;if(ok){this.authenticated=true;data=profile}else error_code='SESSION_INVALID'}
  else if(p.action==='sign_out'){revoked=true;this.authenticated=false;data={signed_out:true}}
  else if(!this.authenticated||revoked){ok=false;error_code='SESSION_INVALID'}
  else if(p.action==='workspace')data=profile;
  else data={saved:true};
  queueMicrotask(()=>this.onmessage({data:JSON.stringify({request_id:p.request_id,ok,data,error:'Session unavailable',error_code})}));
 }
 close(){this.readyState=3;this.authenticated=false;this.onclose?.()}
}
function context(){
 const opened=[],events={};let scans=0,refreshes=0;
 const c=vm.createContext({WebSocket:Socket,location:{host:'127.0.0.1:8766'},setTimeout,clearTimeout,console,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
  state:{page:'connect',user:null},users:{},applyAppearance(){},render(){},stopBluetoothDetection(){},startBluetoothDetection(){scans++},showRooms(){},
  modal(){throw Error('Unexpected error modal')},escapeText:String,
  document:{querySelector(){return {textContent:''}},addEventListener(){},body:{classList:{remove(){}}}},
  window:{addEventListener(name,fn){events[name]=fn},async openStudio(id){opened.push(id);c.state.page='studio'},
   async studioRefreshAssets(send){if(c.state.page==='studio'){await send('open_project',{project_id:7});refreshes++}},studioCanSwitch:()=>true,studioDispose(){},studioCaptureState(){}}});
 vm.runInContext(fs.readFileSync(new URL('../frontend/connection.js',import.meta.url),'utf8'),c);
 return {c,run:code=>vm.runInContext(code,c),opened,events,scans:()=>scans,refreshes:()=>refreshes};
}
const first=context();
await first.run("request('select',{address:'AA:BB:CC:11:22:01'})");
assert.equal(storage.get('smartspace-session'),token);
first.run("state.user='1';state.page='studio';socket.readyState=3");
const result=await first.run("request('save_layout',{project_id:7,revision:1,objects:[]})");
assert.equal(result.saved,true);
assert.deepEqual(actions.slice(-3),['resume_session','open_project','save_layout']);
assert.equal(actions.includes('scan'),false,'Reconnection must not scan Bluetooth again');
assert.equal(first.refreshes(),1);
storage.set('smartspace-project-1','7');
const reload=context();await reload.run('initialize()');
assert.deepEqual(reload.opened,[7],'Refresh must reopen the exact remembered room');
assert.equal(reload.c.state.user,'1');assert.equal(reload.scans(),0);
await reload.run('signOut()');
assert.equal(storage.has('smartspace-session'),false);assert.equal(storage.has('smartspace-signed-out'),false);
assert.equal(reload.c.state.user,null);assert.equal(reload.scans(),1,'Sign out immediately resumes searching');
const signedOut=context();await signedOut.run('initialize()');
assert.equal(signedOut.scans(),1,'Search automatically without requiring a sign-in button');
await signedOut.run('initialize({signIn:true})');assert.equal(signedOut.scans(),2);
first.run('clearSession()');reload.run('clearSession()');signedOut.run('clearSession()');
console.log('Persistent sign-in, no-scan reconnection, exact-room refresh, logout and automatic Bluetooth search passed.');

reload.run("setProfile({id:'1',name:'Mohamed',theme:'dark',projects:[]})");assert.equal(reload.c.state.theme,'dark');
reload.run("setProfile({id:'2',name:'Hanady',theme:'light',projects:[]})");assert.equal(reload.c.state.theme,'light');
reload.run("setProfile({id:'1',name:'Mohamed',theme:'dark',projects:[]})");assert.equal(reload.c.state.theme,'dark');
assert.equal(storage.get('smartspace-theme-1'),'dark');assert.equal(storage.get('smartspace-theme-2'),'light');
console.log('Account switching restores each server theme with separate local caches.');

const stopped=context();await stopped.run("request('select',{address:'AA:BB:CC:11:22:01'})");stopped.run("setProfile({...sessionProfile,projects:[]});state.page='studio';socket.close()");
assert.equal(stopped.c.state.user,null);assert.equal(stopped.scans(),1,'Server shutdown immediately starts the search/reconnect loop');assert.equal(storage.has('smartspace-session'),false);assert.equal(storage.has('smartspace-signed-out'),false);
console.log('Server connection closure signs out immediately and removes the local session.');
