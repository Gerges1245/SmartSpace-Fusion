import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const classes=new Set();
const element={innerHTML:'',onclick:null};
const context=vm.createContext({console,window:{},localStorage:{getItem(){return null},setItem(){}},
  document:{querySelector(){return element},addEventListener(){},
    documentElement:{style:{}},body:{classList:{toggle(name,on){on?classes.add(name):classes.delete(name)},contains(name){return classes.has(name)}}}}});
vm.runInContext(fs.readFileSync(new URL('../frontend/app.js',import.meta.url),'utf8'),context);
const run=code=>vm.runInContext(code,context);
assert.ok(!element.innerHTML.includes('dashboard'));
run("users['1']={id:'1',name:'Nour',gender:'female',projects:[]};state.user='1';applyAppearance()");
assert.ok(classes.has('feminine'));
run("state.theme='dark';applyAppearance()");
assert.ok(classes.has('dark'));
assert.equal(run('document.documentElement.style.colorScheme'),'dark');
run("users['2']={id:'2',name:'Adam',gender:'male',projects:[]};state.user='2';applyAppearance()");
assert.ok(!classes.has('feminine'));
assert.ok(classes.has('dark'),'Switching identity must retain the chosen dark mode');
assert.equal(run("escapeText('<img onerror=1>')"),'&lt;img onerror=1&gt;');

// Render the very first frame after reload, before any network/session response.
const cached=new Map([
 ['smartspace-session','opaque-token'],['smartspace-user','2'],
 ['smartspace-shell',JSON.stringify({user:{id:'2',name:'Hanady',gender:'female'},project:{id:9,name:'Rose bedroom'}})],
 ['smartspace-room-preview-2',JSON.stringify({projectId:9,image:'data:image/jpeg;base64,/9j/AA=='})]
]);
const restoredElement={innerHTML:'',onclick:null},restoredClasses=new Set();
const restoredContext=vm.createContext({console,window:{},localStorage:{getItem:key=>cached.get(key)||null,setItem:(key,value)=>cached.set(key,value)},
 document:{title:'',querySelector(){return restoredElement},addEventListener(){},documentElement:{style:{}},
 body:{classList:{add(name){restoredClasses.add(name)},toggle(name,on){on?restoredClasses.add(name):restoredClasses.delete(name)},contains(name){return restoredClasses.has(name)}}}}});
vm.runInContext(fs.readFileSync(new URL('../frontend/app.js',import.meta.url),'utf8'),restoredContext);
assert.ok(restoredElement.innerHTML.includes('studio-layout'));
assert.ok(restoredElement.innerHTML.includes('Rose bedroom'));
assert.ok(restoredElement.innerHTML.includes('restore-room-preview'));
assert.ok(!restoredElement.innerHTML.includes('class="entry"'));
assert.ok(!restoredElement.innerHTML.includes('Finding your device'));
assert.ok(!restoredElement.innerHTML.includes('bluetooth-status'));
assert.ok(restoredClasses.has('feminine'));
assert.ok(restoredClasses.has('studio-open'));
console.log('First reload frame restores the themed editor and last room preview without rendering the Bluetooth landing page.');

function luminance(hex){const c=hex.replace('#','').match(/../g).map(v=>parseInt(v,16)/255)
  .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]}
function contrast(a,b){const v=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (v[0]+.05)/(v[1]+.05)}
for(const file of ['themes.css','feminine-theme.css','fusion.css']){
  const css=fs.readFileSync(new URL('../frontend/'+file,import.meta.url),'utf8');
  for(const match of css.matchAll(/([^{}]+)\{([^{}]*--bg:[^{}]+)\}/g)){
    const tokens=Object.fromEntries([...match[2].matchAll(/--([a-z-]+):(#[a-f0-9]{6})/g)].map(m=>[m[1],m[2]]));
    for(const [fg,bg] of [['ink','panel'],['muted','panel'],['muted','bg'],['accent','panel'],['on-accent','accent']]){
      assert.ok(contrast(tokens[fg],tokens[bg])>=4.5,`${file} ${match[1]}: ${fg}/${bg} needs 4.5:1`);
    }
  }
}
console.log('Direct studio entry, automatic female identity, dark-mode retention, escaping and four palette contrast checks passed.');

run("state.signedOut=true;state.user=null;state.page='connect';render()");
assert.ok(element.innerHTML.includes('Searching for nearby devices...'));
assert.ok(!element.innerHTML.includes('Automatic sign-in is paused.'));
assert.ok(!element.innerHTML.includes('Sign in with Bluetooth'));
console.log('Entry always shows automatic Bluetooth search without a paused sign-in button.');
