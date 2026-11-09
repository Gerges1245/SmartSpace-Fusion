import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../frontend/vendor/three.module.min.js';
const elements=new Map(),documentClicks=[];
function element(){return {innerHTML:'',textContent:'',hidden:false,dataset:{},disabled:false,classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},querySelectorAll(){return []},focus(){}}}
const context=vm.createContext({THREE,console,mountKeyboardControls(){},state:{page:'studio'},app:element(),header:()=>'',footer:()=>'',navigate(){},request(){},escapeText:value=>String(value).replaceAll('<','&lt;'),document:{querySelector(selector){if(selector==='dialog[open]')return null;if(!elements.has(selector))elements.set(selector,element());return elements.get(selector)},querySelectorAll(){return []},addEventListener(type,fn){if(type==='click')documentClicks.push(fn)},body:element()},window:{addEventListener(){},dispatchEvent(){}},CustomEvent:class{},localStorage:{setItem(){}},cancelAnimationFrame(){},confirm:()=>true});
let source=fs.readFileSync(new URL('../frontend/studio.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
vm.runInContext(source,context);
vm.runInContext(`current={project:{id:1,name:'Room'},room:{width:5,depth:4,height:2.6},versions:[],library:[],objects:[{id:1,name:'Chair',position_x:0,position_y:0,position_z:0,rotation_x:0,rotation_y:0,rotation_z:0,scale_x:1,scale_y:1,scale_z:1,is_deleted:0}]};scene=new THREE.Scene();const furniture=new THREE.Mesh(new THREE.BoxGeometry(.5,1,.5),new THREE.MeshStandardMaterial());models.set(1,furniture);scene.add(furniture);gizmo={attach(){},detach(){},setMode(){}};selectObject(1);`,context);
function run(s){return vm.runInContext(s,context)}
assert.equal(run("dispatch('move:x:1');selected.position_x"),.25);
assert.equal(run("dispatch('undo');selected.position_x"),0);
assert.equal(run("dispatch('redo');selected.position_x"),.25);
assert.equal(run("dispatch('rotate:1');selected.rotation_y"),Math.PI/12);
assert.equal(run("dispatch('rotate:-1');selected.rotation_y"),0,'Right rotation reverses left rotation');
assert.equal(run("dispatch('rotate:2')"),false,'Invalid rotation directions are rejected');
assert.equal(run("dispatch('rotate')"),true);
assert.ok(elements.get('#inspector-content').innerHTML.includes('data-command="rotate:1"'));
assert.ok(elements.get('#inspector-content').innerHTML.includes('data-command="rotate:-1"'));
assert.equal(run("dispatch('rotate:1');selected.rotation_y"),Math.PI/12);

assert.equal(run("dispatch('scale:1');selected.scale_x"),1.1);
assert.equal(run("dispatch('delete');current.objects[0].is_deleted"),1);
assert.equal(run("dispatch('undo');current.objects[0].is_deleted"),0);
run('selectObject(1);saving=true');assert.equal(run("dispatch('move:x:1')"),false);run('saving=false');
assert.equal(run("dispatch('move:y:1')"),false);
run("activePanel='library';refreshInspector()");assert.ok(elements.get('#inspector-content').innerHTML.includes('furniture-search'));assert.ok(!elements.get('#inspector-content').innerHTML.includes('object-sheet'));
run("activePanel='objects';refreshInspector()");assert.ok(elements.get('#inspector-content').innerHTML.includes('object-sheet'));assert.ok(!elements.get('#inspector-content').innerHTML.includes('furniture-search'));
run(`const second={...current.objects[0],id:2,name:'New chair',position_x:0,position_z:0};current.objects.push(second);const next=new THREE.Mesh(new THREE.BoxGeometry(.6,1,.6),new THREE.MeshStandardMaterial());models.set(2,next);scene.add(next);if(!placeNewPiece(second))throw Error('Expected free placement');`);
assert.ok(run('new THREE.Box3().setFromObject(models.get(2)).max.x<=2.5'));
assert.ok(run('!new THREE.Box3().setFromObject(models.get(1)).intersectsBox(new THREE.Box3().setFromObject(models.get(2)))'));
assert.equal(run('window.smartspaceControls.getState().active'),true);
console.log('Editor commands, undo/redo, deletion recovery, busy guards, exclusive panels and free placement passed.');

run("camera=new THREE.PerspectiveCamera(40,1,.1,100);camera.position.set(0,1,5);controls={target:new THREE.Vector3(),minDistance:1.5,maxDistance:18,update(){camera.lookAt(this.target);camera.updateMatrixWorld()}};controls.update();renderer={domElement:{getBoundingClientRect(){return {left:0,top:0,right:400,bottom:400,width:400,height:400}}}};models.get(1).userData.objectId=1;models.get(1).position.set(0,0,0);models.get(1).updateMatrixWorld(true)");
assert.equal(run('hitTestFurniture(200,200)'),1);
assert.equal(run('hitTestFurniture(-1,200)'),null);
run(`globalThis.occludingWall=new THREE.Mesh(new THREE.BoxGeometry(4,4,.1),new THREE.MeshBasicMaterial());occludingWall.name='editable-room-shell';occludingWall.position.set(0,0,2);scene.add(occludingWall);scene.updateMatrixWorld(true)`);
assert.equal(run('hitTestFurniture(200,200)'),null,'An opaque room wall blocks furniture selection');
run('occludingWall.visible=false');assert.equal(run('hitTestFurniture(200,200)'),1,'Hidden room walls do not block selection');
run('occludingWall.visible=true;occludingWall.material.transparent=true;occludingWall.material.opacity=0');assert.equal(run('hitTestFurniture(200,200)'),1,'Invisible wall material does not block selection');
run('scene.remove(occludingWall);occludingWall.geometry.dispose();occludingWall.material.dispose()');
const beforeGrab=run('JSON.stringify(current.objects)');
assert.equal(run('beginHandDrag(1,200,200)'),true);
assert.equal(run('JSON.stringify(current.objects)'),beforeGrab,'Grabbing must not mutate furniture data');
run('endHandDrag(false)');

const radius=run('camera.position.distanceTo(controls.target)');
assert.equal(run("dispatch('view:in')"),true);
assert.ok(run('camera.position.distanceTo(controls.target)')<radius);
assert.equal(run("dispatch('view:left')"),true);
assert.equal(run("dispatch('view:invalid')"),false);
console.log('Direct furniture targeting and hand-accessible camera orbit/zoom passed.');

context.GLTFLoader=class {async loadAsync(){throw new Error('Missing model')}};
run('models.get(1).userData.placeholder=true;globalThis.failedPlaceholder=models.get(1)');
await run('loadObjectModel(current.objects[0],generation)');
assert.equal(run('models.get(1)===failedPlaceholder'),true);
assert.ok(elements.get('#studio-error').textContent.includes('placeholders'));
let finishLoad;
context.GLTFLoader=class {loadAsync(){return new Promise(resolve=>{finishLoad=resolve})}};
const hydration=run('loadObjectModel(current.objects[0],generation)');
run('current.objects=current.objects.map(o=>({...o,position_x:2}));globalThis.replacementModel=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial())');
finishLoad({scene:context.replacementModel});
await hydration;
assert.equal(run('models.get(1).position.x'),2,'Late model hydration must preserve current edits');
assert.equal(run('models.get(1).userData.placeholder'),undefined);
console.log('Missing models retain editable placeholders; late model loads preserve newer transforms.');

run("past=[];future=[];dirty=false;current.objects[0].position_x=0;current.objects[0].position_y=0;current.objects[0].position_z=0;current.objects[0].scale_x=1;current.objects[0].scale_y=1;current.objects[0].scale_z=1;applyTransform(current.objects[0],models.get(1));camera.position.set(0,1,5);controls.target.set(0,0,0);controls.update()");
assert.equal(run('beginHandDrag(1,200,200)'),true);
assert.equal(run('controls.enabled'),false);
assert.equal(run('moveHandDrag(230,200)'),true);
assert.ok(run('selected.position_x>0'),'Hand moving screen-right moves the selected piece right');
assert.equal(run('selected.position_y'),0,'Hand dragging keeps the original height');
run('moveHandDrag(399,200)');
assert.ok(run('new THREE.Box3().setFromObject(models.get(1)).max.x<=2.50001'),'Dragged furniture stays inside the room');
run('endHandDrag(true)');
assert.equal(run('selected'),null);
assert.equal(run('past.length'),1,'Continuous hand movement is one undo operation');
assert.equal(run('controls.enabled'),true);
run("dispatch('undo')");assert.equal(run('current.objects[0].position_x'),0);
run('saving=true');assert.equal(run('beginHandDrag(1,200,200)'),false);run('saving=false');
console.log('Hand-to-floor motion, room bounds, pinch release API, one-step undo and saving guards passed.');

run('dirty=false;selectObject(null)');
const initialDistance=run('camera.position.distanceTo(controls.target)');
assert.equal(run('beginHandView([{x:150,y:200},{x:250,y:200}])'),true);
assert.equal(run('controls.enabled'),false);
run('moveHandView([{x:100,y:200},{x:300,y:200}])');
assert.ok(Math.abs(run('camera.position.distanceTo(controls.target)')-initialDistance/2)<1e-6,'Spreading two hands zooms in');
const targetBefore=run('controls.target.x');
run('moveHandView([{x:120,y:200},{x:320,y:200}])');
assert.notEqual(run('controls.target.x'),targetBefore,'Moving the midpoint pans the camera');
const positionBefore=run('camera.position.x');
run('moveHandView([{x:200,y:150},{x:200,y:250}])');
assert.notEqual(run('camera.position.x'),positionBefore,'Twisting the pair orbits the camera');
assert.equal(run('dirty'),false,'Camera gestures must not modify the saved layout');
run('moveHandView([{x:-100000,y:200},{x:100000,y:200}])');
assert.ok(run('camera.position.distanceTo(controls.target)>=controls.minDistance-1e-6'));
run('endHandView()');assert.equal(run('controls.enabled'),true);
assert.equal(run('window.smartspaceControls.getState().handViewActive'),false);
console.log('Two-hand camera zoom, pan, orbit, distance limits and layout preservation passed.');
assert.equal(run("dispatch('panel:library')"),true);assert.equal(run('activePanel'),'library');
assert.equal(run("dispatch('panel:objects')"),true);assert.equal(run('activePanel'),'objects');
run('saving=true');assert.equal(run("dispatch('panel:library')"),false);run('saving=false');
console.log('Gesture panel shortcuts use the shared command and busy guards.');
run('selectObject(1);beginHandDrag(1,200,200)');
assert.equal(run("dispatch('delete')"),true);
assert.equal(run('current.objects[0].is_deleted'),1);
assert.equal(run('window.smartspaceControls.getState().handDraggingId'),null);
run("dispatch('undo')");assert.equal(run('current.objects[0].is_deleted'),0);
console.log('Deletion while hand-selected ends the drag and remains recoverable with Undo.');

const browserMemory=new Map();
context.localStorage={getItem:key=>browserMemory.get(key)||null,setItem:(key,value)=>browserMemory.set(key,String(value)),removeItem:key=>browserMemory.delete(key)};
run("state.user='1';current.project.revision=8;dirty=true;current.objects[0].position_x=.8");
assert.equal(run('storeStudioDraft()'),true);
run('current.objects[0].position_x=0;dirty=false');
assert.equal(run('restoreStudioDraft()'),'restored');assert.equal(run('current.objects[0].position_x'),.8);
run('current.project.revision=9;current.objects[0].position_x=-.2');
assert.equal(run('restoreStudioDraft()'),'conflict');assert.equal(run('current.objects[0].position_x'),-.2);
assert.ok(browserMemory.has('smartspace-draft-1-1'),'A conflicting local draft remains available');
run('clearStudioDraft()');assert.equal(browserMemory.has('smartspace-draft-1-1'),false);
run("selectObject(1);activePanel='library';mode='rotate';camera.position.set(3,2,4);controls.target.set(0,.8,0);storeStudioView();camera.position.set(9,4,9);activePanel='objects';mode='translate';selectObject(null);restoreStudioView()");
assert.equal(run('activePanel'),'library');assert.equal(run('mode'),'rotate');assert.equal(run('selected.id'),1);
assert.ok(Math.abs(run('camera.position.x')-3)<1e-6);
assert.equal(browserMemory.get('smartspace-project-1'),'1');
console.log('Refresh preserves local drafts, rejects stale draft revisions, and restores room, selection, panel and camera view.');

run('selected.position_y=2;selected.rotation_x=1;selected.rotation_z=.5;applyTransform(selected,models.get(selected.id))');assert.equal(run('selected.position_y'),0);assert.equal(run('models.get(selected.id).position.y'),0);assert.equal(run('selected.rotation_x'),0);assert.equal(run('selected.rotation_z'),0);console.log('Furniture remains on the floor; old floating/tilted transforms are corrected.');

run("current.room.source_width=current.room.width;current.room.source_depth=current.room.depth;current.room.floor_finish='original';past=[];future=[]");
const roomWidth=run('current.room.width');context.roomWidth=roomWidth;
assert.equal(run("dispatch('room:width:0.5')"),true);assert.equal(run('current.room.width'),roomWidth+.5);
assert.equal(run("dispatch('finish:walnut')"),true);assert.equal(run('current.room.floor_finish'),'walnut');
run("dispatch('undo')");assert.equal(run('current.room.floor_finish'),'original');run("dispatch('undo')");assert.equal(run('current.room.width'),roomWidth);
run("dispatch('redo')");assert.equal(run('current.room.width'),roomWidth+.5);
run("dispatch('finish:oak');dirty=true;storeStudioDraft();current.room.floor_finish='original';current.room.width=roomWidth;restoreStudioDraft()");assert.equal(run('current.room.floor_finish'),'oak');assert.equal(run('current.room.width'),roomWidth+.5);
run('selectObject(1)');const oldRotation=run('selected.rotation_y');assert.equal(run("dispatch('rotate45')"),true);assert.ok(Math.abs(run('selected.rotation_y')-oldRotation-Math.PI/4)<1e-8);
assert.ok(elements.get('#inspector-content').innerHTML.includes('Surface finishes'));
console.log('Object Sheet dimensions, 45-degree rotation, room resize, floor finishes, undo/redo and local draft recovery passed.');

run("selectObject(1);dispatch('delete');past=[];future=[];refreshInspector()");assert.ok(elements.get('#inspector-content').innerHTML.includes('Deleted pieces'));assert.equal(run("dispatch('restore-object:1')"),true);assert.equal(run('current.objects[0].is_deleted'),0);assert.equal(run('models.get(1).visible'),true);run("dispatch('undo')");assert.equal(run('current.objects[0].is_deleted'),1);run("dispatch('redo')");assert.equal(run('current.objects[0].is_deleted'),0);
run("selectObject(1);dispatch('delete');past=[];future=[]");assert.equal(run("dispatch('restore-deleted')"),true);assert.equal(run('current.objects.some(o=>o.is_deleted)'),false);run('saving=true');assert.equal(run("dispatch('restore-deleted')"),false);run('saving=false');console.log('Deleted base furniture can be restored individually or together without undo history, with visibility and Undo/Redo recovery.');

// Prevent overlaps along the movement path and during all transform entry points.
run(`models.clear();scene=new THREE.Scene();current.room={width:8,depth:8,height:3};
 current.objects=[1,2].map((id)=>({id,name:'Chair',position_x:id===1?-1:0,position_y:0,position_z:0,rotation_x:0,rotation_y:0,rotation_z:0,scale_x:1,scale_y:1,scale_z:1,is_deleted:0}));
 for(const o of current.objects){const mesh=new THREE.Mesh(new THREE.BoxGeometry(.5,1,.5),new THREE.MeshStandardMaterial());models.set(o.id,mesh);scene.add(mesh);applyTransform(o,mesh)}selectObject(1);`);
assert.equal(run('changeSelected(o=>o.position_x=0)'),false);
assert.equal(run('selected.position_x'),-1);
assert.equal(run('changeSelected(o=>o.position_x=1)'),false,'large movement cannot pass through another piece');
assert.equal(run('changeSelected(o=>o.scale_x=4)'),false);
assert.equal(run('changeSelected(o=>o.position_x=-5)'),false,'walls block numeric and keyboard transforms');
assert.equal(run('changeSelected(o=>o.position_z=1)'),true);
run('models.get(1).position.set(0,0,0);syncFromModel()');
assert.equal(run('selected.position_z'),1,'gizmo collision restores previous valid transform');
assert.equal(run("dispatch('panel:library');activePanel"),'library');
assert.equal(run("dispatch('panel:objects');activePanel"),'objects');
console.log('Overlap prevention, swept movement, scale, room walls, gizmo rollback and direct panel shortcuts passed.');

// Autosave waits for editing to finish, coalesces changes, persists, and retries failures.
const timers=new Map(),timerDelays=new Map();let timerId=0,saveRequests=0;
context.setTimeout=(fn,delay)=>{timers.set(++timerId,fn);timerDelays.set(timerId,delay);return timerId};context.clearTimeout=id=>timers.delete(id);
context.request=async(action)=>{assert.equal(action,'save_layout');saveRequests++;return JSON.parse(run('JSON.stringify(current)'))};
run("current.project.revision=1;state.user='1';markChanged();markChanged()");
assert.equal(run('dirty'),true);
assert.equal(timerDelays.get(run('autosaveTimer')),0,'Edits schedule an immediate server save');
assert.ok(browserMemory.has(run("studioStorageKey('draft')")),'Edits immediately keep a recovery draft');
const fireAutosave=async()=>{const id=run('autosaveTimer'),fn=timers.get(id);assert.ok(fn);timers.delete(id);await fn()};
run('handDrag={id:1}');await fireAutosave();assert.equal(saveRequests,0,'save must wait until drag ends');
assert.equal(timerDelays.get(run('autosaveTimer')),250,'Active movement polls without flooding save requests');
run('handDrag={id:1,before:snapshot()};endHandDrag(false)');
assert.equal(timerDelays.get(run('autosaveTimer')),0,'Releasing a piece saves immediately without waiting for the poll');
await fireAutosave();assert.equal(saveRequests,1);assert.equal(run('dirty'),false);
context.request=async()=>{throw Error('offline')};run('markChanged()');await fireAutosave();assert.equal(run('dirty'),true);assert.ok(run('autosaveTimer'));assert.equal(timerDelays.get(run('autosaveTimer')),5000);
context.request=async()=>{saveRequests++;return JSON.parse(run('JSON.stringify(current)'))};await fireAutosave();assert.equal(run('dirty'),false);
console.log('Immediate autosave, instant release save, local recovery drafts, active-drag deferral, failure retention and retry passed.');

// Collision feedback must not insert/remove the top banner or rebuild the scene.
run(`selectObject(1);current.objects[0].position_x=-1;current.objects[0].position_z=0;applyTransform(current.objects[0],models.get(1));
 current.objects[1].position_x=0;current.objects[1].position_z=0;applyTransform(current.objects[1],models.get(2));
 globalThis.collisionModel=models.get(1);globalThis.collisionCamera=camera.position.clone();showError('Existing save warning');`);
assert.equal(run('tryTransform(selected,o=>o.position_x=1,{clamp:true})'),true,'drag reaches last safe position');
assert.ok(run('selected.position_x> -1&&selected.position_x< -.49'));
assert.equal(run('placementAllowed(selected)'),true);
const blockedX=run('selected.position_x');
for(let i=0;i<20;i++)run('tryTransform(selected,o=>o.position_x=1,{clamp:true})');
assert.equal(run('selected.position_x'),blockedX,'holding against a collision cannot bounce the piece');
assert.equal(elements.get('#studio-error').textContent,'Existing save warning','collision does not touch the layout-changing banner');
assert.equal(elements.get('#selection-hint').dataset.blocked,'true');
assert.equal(run('models.get(1)===collisionModel&&selected.id===1&&camera.position.equals(collisionCamera)'),true);
assert.equal(run('tryTransform(selected,o=>o.position_z=1,{clamp:true})'),true,'piece can move away from collision');
assert.equal(elements.get('#selection-hint').dataset.blocked,'false');
console.log('Collision clamping, no bounce, stable error banner, unchanged camera/model/selection and recovery passed.');

// A wide sofa beside the wall needs a small inward adjustment during a 45-degree turn.
run(`models.clear();scene=new THREE.Scene();current.room={width:7,depth:5.5,height:3};past=[];future=[];
 current.objects=[{id:1,name:'Sofa',position_x:2.13,position_y:0,position_z:.4,rotation_x:0,rotation_y:0,rotation_z:0,scale_x:1,scale_y:1,scale_z:1,is_deleted:0}];
 const sofa=new THREE.Mesh(new THREE.BoxGeometry(2.73,1.12,.93),new THREE.MeshStandardMaterial());models.set(1,sofa);scene.add(sofa);applyTransform(current.objects[0],sofa);selectObject(1);`);
assert.equal(run("dispatch('rotate45')"),true);
assert.ok(Math.abs(run('selected.rotation_y')-Math.PI/4)<1e-8);
assert.ok(run('selected.position_x<2.13&&selected.position_x>1.9'));
assert.equal(run('placementAllowed(selected)'),true);
assert.equal(run('past.length'),1,'turn plus inward adjustment is one undo step');
run("dispatch('undo')");assert.equal(run('selected.position_x'),2.13);assert.equal(run('selected.rotation_y'),0);
run(`const obstacle={...selected,id:2,name:'Wardrobe',position_x:.26,position_z:.4};current.objects.push(obstacle);
 const obstacleMesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,4),new THREE.MeshStandardMaterial());models.set(2,obstacleMesh);scene.add(obstacleMesh);applyTransform(obstacle,obstacleMesh);`);
assert.equal(run("dispatch('rotate45')"),false,'turn must still respect nearby furniture');
assert.equal(run('selected.position_x'),2.13);assert.equal(run('selected.rotation_y'),0,'failed turn restores both rotation and position');
console.log('Wall-adjacent sofa rotates with minimal inward clearance, one-step undo, and complete rollback when furniture blocks it.');

// Repeated rotation checks reuse geometry bounds instead of walking every mesh each time.
run(`current.objects=current.objects.filter(o=>o.id===1);models.delete(2);current.room.width=10;current.room.depth=10;
 selected.position_x=0;selected.position_z=0;applyTransform(selected,models.get(1));furnitureBounds(models.get(1));
 globalThis.boundsWalks=0;globalThis.savedTraverse=models.get(1).traverse;models.get(1).traverse=function(fn){boundsWalks++;return savedTraverse.call(this,fn)};`);
assert.equal(run("dispatch('rotate45')"),true);assert.equal(run('boundsWalks'),0,'cached collision checks must not traverse the model hierarchy');
assert.equal(run('placementAllowed(selected)'),true);
console.log('Repeated rotation validation reuses cached geometry bounds without per-sample model traversals.');

run(`models.clear();scene=new THREE.Scene();current.room={width:8,depth:8,height:3};past=[];future=[];dirty=false;
 current.objects=[{id:1,name:'Gesture chair',position_x:0,position_y:0,position_z:0,rotation_x:0,rotation_y:0,rotation_z:0,scale_x:1,scale_y:1,scale_z:1,is_deleted:0}];
 const gestureChair=new THREE.Mesh(new THREE.BoxGeometry(.5,1,.5),new THREE.MeshStandardMaterial());models.set(1,gestureChair);scene.add(gestureChair);applyTransform(current.objects[0],gestureChair);selectObject(1);
 camera.position.set(0,2,5);controls.target.set(0,0,0);controls.update();`);
assert.equal(run('beginHandRotate(1,200,200)'),true);
assert.equal(run('moveHandDrag(210,200)'),true);const angleRight=run('selected.rotation_y');assert.ok(angleRight<0);
assert.equal(run('moveHandDrag(205,200)'),true);assert.ok(run('selected.rotation_y')>angleRight,'Moving left reverses rotation');
assert.equal(run('selected.position_x'),0);assert.equal(run('selected.position_z'),0);
assert.equal(run('past.length'),0,'Individual rotation frames must not fill undo history');
const beforeReanchor=run('selected.rotation_y');run('reanchorHandDrag(300,200);moveHandDrag(300,200)');assert.equal(run('selected.rotation_y'),beforeReanchor,'Recovered tracking cannot jump the angle');
run('endHandDrag(false)');assert.equal(run('past.length'),1,'One continuous turn is one undo operation');assert.equal(timerDelays.get(run('autosaveTimer')),0,'Rotation release saves immediately');
run("dispatch('undo')");assert.equal(run('selected.rotation_y'),0);
run('saving=true');assert.equal(run('beginHandRotate(1,200,200)'),false);run('saving=false');
console.log('Direct hand rotation preserves position, reverses direction, reanchors on recovery, uses one undo entry and saves on release.');

let templateCalls=0;
context.window.handConfirm=()=>{throw Error('Template confirmation should have been removed')};
context.request=async(action,payload)=>{assert.equal(action,'apply_template');assert.equal(payload.template_id,'male_bedroom');templateCalls++;return JSON.parse(run('JSON.stringify(current)'))};
run('startViewer=async()=>{};shell=()=>{};state.page="studio";loading=false;saving=false;adding=false');
const templateButton={dataset:{applyTemplate:'male_bedroom'}};
const event={target:{closest(selector){return selector==='[data-apply-template]'?templateButton:null}},stopImmediatePropagation(){}};
for(const handler of documentClicks)await handler(event);
assert.equal(templateCalls,1,'Applying a template starts immediately, without a confirmation dialog');
console.log('Apply Template works immediately without the removed confirmation dialog.');

let resolveBackground;const backgroundPayloads=[];
context.request=(action,payload)=>{
 assert.equal(action,'save_layout');backgroundPayloads.push(JSON.parse(JSON.stringify(payload)));
 const saved=JSON.parse(run('JSON.stringify(current)'));saved.project.revision=(payload.revision||0)+1;
 return new Promise(resolve=>{resolveBackground=()=>resolve(saved)});
};
run('loading=false;saving=false;adding=false;selectObject(1);markChanged()');
const background=run('persist({background:true})');
assert.equal(run('busy()'),false,'Autosave must not disable hand input while the server is slow');
assert.equal(run('window.smartspaceControls.getState().saving'),true);
assert.equal(run('beginHandDrag(1,200,200)'),true,'A new hand gesture can start while saving');
assert.equal(run('moveHandDrag(220,200)'),true);
const newestX=run('selected.position_x'),liveObjects=run('current.objects'),liveSelected=run('selected');
resolveBackground();await background;
assert.equal(run('current.objects'),liveObjects,'A save response must preserve live model references');
assert.equal(run('selected'),liveSelected);assert.equal(run('selected.position_x'),newestX,'A slow save cannot roll back a newer movement');
assert.equal(run('handDrag.id'),1,'Completing autosave cannot end an active gesture');assert.equal(run('dirty'),true);
assert.equal(run("JSON.parse(localStorage.getItem(studioStorageKey('draft'))).revision"),run('current.project.revision'),'Recovery draft uses the acknowledged revision');
run('endHandDrag(false)');const latest=run('persist({background:true})');
assert.equal(backgroundPayloads.at(-1).revision,backgroundPayloads[0].revision+1,'Follow-up save uses the latest server revision');
assert.equal(backgroundPayloads.at(-1).objects[0].position[0],newestX);
resolveBackground();await latest;assert.equal(run('dirty'),false);
// A manual flush waits for the pending save instead of creating parallel requests.
run('markChanged()');const first=run('persist({background:true})'),flush=run('persist()');const countBefore=backgroundPayloads.length;
resolveBackground();await Promise.all([first,flush]);assert.equal(backgroundPayloads.length,countBefore);
console.log('Slow background saves preserve live gestures and newer edits, serialize revisions, and leave hand controls enabled.');
