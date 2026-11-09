import {mountMouseControls,mountKeyboardControls} from './mouse-control.js';
import {handCursorMarkup,mountHandCursor,stopHandCursor} from './hand-cursor.js';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

let current=null, renderer=null, controls=null, scene=null, camera=null, gizmo=null;
let frame=0, generation=0, resize=null, environmentTarget=null, outline=null;
let autosaveTimer=null,saveTask=null;
let selected=null, dirty=false, loading=false, saving=false, adding=false;
let activePanel='objects', mode='translate', moveStep=.25, libraryQuery='', libraryCategory='All';
const models=new Map(), previews=new Map();
let past=[], future=[], dragStart=null, unmountMouse=null;
let showGrid=false,showDimensions=false;
const loadingModels=new Set();
let previewRevision=0,previewJob=null,handDrag=null,handView=null,draftTimer=null;
const names={Bed_01:'Upholstered bed',Wardrobe_01:'Wardrobe',Plant_01:'Potted plant',Sofa_01:'Sofa',Coffee_Table_01:'Coffee table',Bookshelf_01:'Bookshelf',Desk_01:'Study desk',Chair_01:'Desk chair',Rug_01:'Woven rug'};
const label=o=>current?.library?.find(a=>a.id===o.name)?.name||names[o.name]||o.name;
const busy=()=>loading||saving||adding;
const icons={flower:'M12 8C3-2 0 11 8 12c-10 9 3 12 4 4 9 10 12-3 4-4 10-9-3-12-4-4',move:'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',rotate:'M4 9a8 8 0 1 1 0 6M4 3v6h6',scale:'M4 10V4h6M14 20h6v-6M4 4l6 6M20 20l-6-6',undo:'M9 5 3 11l6 6M3 11h11a6 6 0 0 1 6 6',redo:'M15 5l6 6-6 6M21 11H10a6 6 0 0 0-6 6',camera:'M15 8l6-3v14l-6-3M3 6h12v12H3z',fit:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',plus:'M12 5v14M5 12h14',trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',arrow:'M19 12H5M11 6l-6 6 6 6',check:'M5 12l4 4L19 6',grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(icons[name]||'').split('M').filter(Boolean).map(p=>`<path d="M${p}"/>`).join('')}</svg>`;
const actionButton=(command,text,graphic,disabled=false)=>`<button class="tool-button" data-command="${command}" ${disabled?'disabled':''}>${icon(graphic)}<span>${text}</span></button>`;
function snapshot(){return Object.assign(current.objects.map(o=>({...o})),{roomSettings:current.room?{...current.room}:null})}
function remember(before=snapshot()){past.push(before);if(past.length>40)past.shift();future=[]}
function publish(){window.dispatchEvent(new CustomEvent('smartspace:state',{detail:{selectedId:selected?.id||null,mode,busy:busy(),dirty}}))}
function status(text){const el=document.querySelector('#studio-status');if(el){el.textContent=text;el.dataset.dirty=String(dirty)}publish()}
function showError(text){const el=document.querySelector('#studio-error');if(el){el.hidden=!text;el.textContent=text}}
function syncTools(){document.querySelectorAll('[data-command]').forEach(button=>{const cmd=button.dataset.command;button.disabled=busy()||(['translate','rotate','scale','delete','focus'].includes(cmd)&&!selected)||(cmd==='undo'&&!past.length)||(cmd==='redo'&&!future.length);if(['translate','rotate','scale'].includes(cmd))button.setAttribute('aria-pressed',String(cmd===mode))});const save=document.querySelector('[data-studio="save"]');if(save)save.disabled=busy()||!dirty;const picker=document.querySelector('#workspace-user');if(picker)picker.disabled=busy();document.querySelectorAll('.tools-toggle').forEach(button=>button.setAttribute('aria-expanded',String(document.body.classList.contains('tools-open'))));publish()}
function updateContext(){const title=document.querySelector('#selection-name');if(title)title.textContent=selected?label(selected):'Choose a piece to start';const subtitle=document.querySelector('#selection-hint');if(subtitle)subtitle.textContent=selected?'Fist: move. Thumb up: rotate left/right. Open palm: deselect. Phone sign: delete.':'Hold a fist over a piece for 0.5s to select and move. Open palm: deselect.';syncTools()}
function scheduleAutosave(delay=0){
 if(typeof setTimeout!=='function')return;
 clearTimeout(autosaveTimer);autosaveTimer=setTimeout(async()=>{
  autosaveTimer=null;if(!dirty||state.page!=='studio')return;
  if(busy()||saveTask||handDrag||handView||dragStart){scheduleAutosave(250);return}
  if(!(await persist({background:true})))scheduleAutosave(5000);
 },delay);
}
function markChanged(){dirty=true;storeStudioDraft();scheduleAutosave();status('Saving changes automatically...');updateContext()}
window.studioFlush=async()=>!dirty||await persist();
function canLeaveStudio(){if(busy())return false;return true}
function leaveStudio(){if(!canLeaveStudio())return false;storeStudioDraft();storeStudioView();dirty=false;disposeViewer();return true}
window.studioCanSwitch=()=>!busy()&&(state.page!=='studio'||canLeaveStudio());
window.studioDispose=({discard=false}={})=>{if(discard)clearStudioDraft();dirty=false;disposeViewer()};
window.studioAfterProjectDelete=async(id,profile)=>{
 if(current?.project.id!==id)return;
 clearStudioDraft();dirty=false;disposeViewer();current=null;past=[];future=[];state.page='rooms-empty';document.body.classList.remove('studio-open','tools-open');
 if(profile.projects.length)await window.openStudio(profile.projects[0].id);else render();
};
window.studioCaptureState=()=>{storeStudioDraft();storeStudioView()};
window.studioRefreshAssets=async send=>{if(!current||state.page!=='studio')return;const fresh=await send('open_project',{project_id:current.project.id});current.room.asset_url=fresh.room?.asset_url;for(const o of current.objects){const updated=fresh.objects.find(v=>v.id===o.id);if(updated)o.asset_url=updated.asset_url}};
window.studioBeforeLeave=()=>!busy()&&(state.page!=='studio'||leaveStudio());
const baseNavigate=navigate;
navigate=function(page){if(state.page==='studio'&&page!=='studio'&&!leaveStudio())return;baseNavigate(page);document.body.classList.remove('studio-open')};
function disposeViewer(){if(autosaveTimer&&typeof clearTimeout==='function')clearTimeout(autosaveTimer);autosaveTimer=null;previewJob=null;previewRevision++;unmountMouse?.();unmountMouse=null;loadingModels.clear();stopHandCursor();generation++;cancelAnimationFrame(frame);resize?.disconnect();controls?.dispose();gizmo?.detach();gizmo?.dispose();gizmo=null;if(scene)disposeModel(scene);environmentTarget?.dispose();environmentTarget=null;renderer?.dispose();renderer?.forceContextLoss();renderer=null;scene=null;controls=null;models.clear();outline=null}
function shell(){cacheStudioShell();state.page='studio';document.body.classList.add('studio-open');document.body.classList.remove('tools-open');document.title=current.project.name+' - SmartSpace Studio';app.innerHTML=header()+`<main class="studio"><div class="studio-toolbar"><div class="project-heading"><button class="back-button" data-studio="back" aria-label="Choose room">${icon('grid')}</button><div><span class="studio-kicker">${document.body.classList.contains('feminine')?'Your creative space':'Room studio'}</span><h1>${escapeText(current.project.name)}</h1></div></div><div class="studio-save"><span id="studio-status" role="status" aria-live="polite" data-dirty="${dirty}">${dirty?'Unsaved changes':'All changes saved'}</span><button class="btn" data-studio="save">${icon('check')}Save now</button></div></div><div id="studio-error" class="studio-error" role="alert" hidden></div><div id="studio-content"></div></main>`}
function editorLayout(){document.querySelector('#studio-content').innerHTML=`<div class="studio-layout"><aside class="camera-rail" aria-label="Camera and hand controls">${handCursorMarkup()}</aside><section class="room-workspace" aria-label="3D room editor"><div class="edit-toolbar" role="toolbar" aria-label="Furniture tools"><div class="tool-group">${actionButton('translate','Move','move',true)}${actionButton('rotate','Rotate','rotate',true)}${actionButton('scale','Resize','scale',true)}</div><div class="tool-group tool-history">${actionButton('undo','Undo','undo',true)}${actionButton('redo','Redo','redo',true)}</div><div class="tool-group view-tools">${actionButton('reset-view','Room view','fit')}</div><button class="tools-toggle tool-button" data-command="toggle-tools" aria-controls="studio-side" aria-expanded="false">${icon('grid')}<span>Controls (T)</span></button><button class="tool-button" data-command="panel:library" aria-keyshortcuts="L">Furniture (L)</button><button class="tool-button" data-command="panel:objects" aria-keyshortcuts="T">Controls (T)</button></div><div class="viewport" id="viewport" aria-label="Interactive room. Select a piece to edit it."><span class="viewport-note" id="load-note" role="status">Loading your room...</span></div><div class="selection-bar"><div><strong id="selection-name">Choose a piece to start</strong><span id="selection-hint">Hold a fist over a piece for 0.5s to select and move. Open palm: deselect.</span></div><span class="room-size">${current.room.width.toFixed(1)} &times; ${current.room.depth.toFixed(1)} m</span></div><div class="hand-view-tools" aria-label="Hand accessible camera view"><button data-command="toggle-grid" aria-pressed="false">Grid</button><button data-command="toggle-dimensions" aria-pressed="false">Dimensions</button><button data-command="top-view">Top view</button><button data-command="view:left">Turn left</button><button data-command="view:right">Turn right</button><button data-command="view:in">Zoom in</button><button data-command="view:out">Zoom out</button></div><div class="workspace-bottom"><p>Two palms: zoom. Two pointing hands: turn and tilt. Thumb up: rotate furniture. V: undo. OK: redo.</p><div class="input-badge"><span class="input-dot"></span>Two-hand camera controls</div></div></section><aside class="studio-side" id="studio-side" aria-label="Furniture and layout controls"><button class="tools-close" data-command="toggle-tools" aria-label="Close tools">Close tools</button><div class="side-tabs" role="tablist" aria-label="Studio panels"><button id="tab-objects" role="tab" data-panel="objects" aria-controls="inspector-content">${icon('move')}My room</button><button id="tab-library" role="tab" data-panel="library" aria-controls="inspector-content">${icon('grid')}Add furniture</button><button id="tab-templates" role="tab" data-panel="templates" aria-controls="inspector-content">${icon('room')}Templates</button></div><div class="hand-scroll-tools" aria-label="Scroll side panel"><button data-hand-scroll="-1">Scroll up</button><button data-hand-scroll="1">Scroll down</button></div><div class="inspector" id="inspector-content" role="tabpanel"></div></aside></div>`;refreshInspector();mountHandCursor()}
function dimensionMarkup(){if(!showDimensions||!selected||!models.has(selected.id))return '';const size=new THREE.Box3().setFromObject(models.get(selected.id)).getSize(new THREE.Vector3());return `<p class="object-dimensions">${(size.x*100).toFixed(0)} ? ${(size.z*100).toFixed(0)} ? ${(size.y*100).toFixed(0)} cm<br><small>Width ? depth ? height</small></p>`}
function objectSheetValues(){
 const model=selected&&models.get(selected.id);if(!model)return null;
 const size=new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
 return {name:label(selected),footprint:`${Math.round(size.x*100)} \u00d7 ${Math.round(size.z*100)} cm`,height:`${Math.round(size.y*100)} cm`,position:`${Math.round((selected.position_x+current.room.width/2)*100)}, ${Math.round((selected.position_z+current.room.depth/2)*100)}`,rotation:`${Math.round(((THREE.MathUtils.radToDeg(selected.rotation_y)%360)+360)%360)}\u00b0`};
}
function updateObjectSheet(){const values=objectSheetValues();if(!values)return;for(const [key,value] of Object.entries(values)){const el=document.querySelector('[data-sheet-value="'+key+'"]');if(el&&el.textContent!==value)el.textContent=value}}
function selectedControls(){
 const v=objectSheetValues();
 return `<section class="object-sheet"><h2>Object Sheet</h2><p>Select an item with your hand to inspect its dimensions.</p><dl class="spec-sheet"><div class="spec-labels"><dt>Spec</dt><dd>Value</dd></div>${[['Module','name'],['Footprint','footprint'],['Height','height'],['Spatial X/Y','position'],['Rotation','rotation']].map(([name,key])=>`<div><dt>${name}</dt><dd data-sheet-value="${key}">${v?escapeText(v[key]):'&mdash;'}</dd></div>`).join('')}</dl><div class="rotation-controls" role="group" aria-label="Rotate selected furniture"><span class="rotation-heading">Rotate furniture</span><p>Point and hold to keep turning. Move away to stop.</p><div class="rotation-buttons"><button data-command="rotate:1" aria-label="Rotate furniture left 15 degrees" ${!selected?'disabled':''}>&#8634; Left 15&deg;</button><button data-command="rotate:-1" aria-label="Rotate furniture right 15 degrees" ${!selected?'disabled':''}>&#8635; Right 15&deg;</button></div></div><div class="sheet-actions"><button data-command="delete" ${!selected?'disabled':''}>Delete</button></div>${selected?`<details class="sheet-adjustments"><summary>Move &amp; resize</summary><div class="nudge-grid"><button data-nudge="z:-1">Back</button><button data-nudge="x:-1">Left</button><span></span><button data-nudge="x:1">Right</button><button data-nudge="z:1">Forward</button></div><div class="quick-row"><span>Size</span><button data-adjust="scale:-1">&minus;10%</button><button data-adjust="scale:1">+10%</button></div></details>`:''}</section>`+roomSheetControls();
}
function roomSheetControls(){
 const room=current.room;if(!room)return '';
 const finishes={original:['#d2ba93','Original'],oak:['#c9a27a','Natural oak'],walnut:['#8b5e3c','Dark walnut'],concrete:['#b7b1a7','Concrete'],terracotta:['#c47a5a','Terracotta']};
 return `<section class="room-sheet"><h3>Room boundaries (cm)</h3><div class="boundary-controls">${[['width','Width'],['depth','Length']].map(([key,name])=>`<div><label>${name}: <strong>${Math.round(room[key]*100)}</strong></label><div><button data-command="room:${key}:-0.5" ${room[key]<=2?'disabled':''}>&minus;50</button><button data-command="room:${key}:0.5" ${room[key]>=12?'disabled':''}>+50</button></div></div>`).join('')}</div><h3>Surface finishes</h3><div class="surface-finishes">${Object.entries(finishes).map(([key,[color,name]])=>`<button data-command="finish:${key}" style="--swatch:${color}" aria-label="${name}" title="${name}" aria-pressed="${(room.floor_finish||'original')===key}"><span>${name}</span></button>`).join('')}</div></section>`;
}
function applyRoomAppearance(){
 const shell=scene?.getObjectByName('editable-room-shell');if(!shell||!current.room)return;
 const room=current.room;shell.scale.set(room.width/(room.source_width||room.width),1,room.depth/(room.source_depth||room.depth));shell.updateMatrixWorld(true);
 const colors={oak:'#c9a27a',walnut:'#8b5e3c',concrete:'#b7b1a7',terracotta:'#c47a5a'};
 shell.traverse(node=>{if(!node.isMesh)return;const materials=Array.isArray(node.material)?node.material:[node.material];for(const mat of materials){if(!/parquet_floor|floor|ground/i.test(node.name+' '+(mat.name||'')))continue;if(!mat.userData.originalColor)mat.userData.originalColor=mat.color.clone();const finish=room.floor_finish||'original';if(finish==='original')mat.color.copy(mat.userData.originalColor);else mat.color.set(colors[finish]);mat.needsUpdate=true}});
 const roomSize=document.querySelector('.room-size');if(roomSize)roomSize.textContent=`${room.width.toFixed(1)} \u00d7 ${room.depth.toFixed(1)} m`;
}
function changeRoom(command){
 if(!current.room||busy())return false;
 if(command.startsWith('room:')){const [,axis,raw]=command.split(':');if(!['width','depth'].includes(axis)||![-.5,.5].includes(Number(raw)))return false;const next=THREE.MathUtils.clamp(current.room[axis]+Number(raw),2,12);if(next===current.room[axis])return false;
 // Do not shrink the walls through existing furniture.
 for(const obj of current.objects.filter(o=>!o.is_deleted)){const model=models.get(obj.id);if(!model)continue;const box=new THREE.Box3().setFromObject(model);if(axis==='width'&&(box.min.x<-next/2||box.max.x>next/2)||axis==='depth'&&(box.min.z<-next/2||box.max.z>next/2)){showError('Move furniture inward before shrinking this wall.');return false}}
 remember();current.room.source_width??=current.room.width;current.room.source_depth??=current.room.depth;current.room[axis]=next;
 }else{const finish=command.slice(7);if(!['original','oak','walnut','concrete','terracotta'].includes(finish))return false;if((current.room.floor_finish||'original')===finish)return false;remember();current.room.floor_finish=finish}
 applyRoomAppearance();showError('');markChanged();refreshInspector();return true;
}
function deletedPiecesMarkup(){
 const items=current.objects.filter(o=>o.is_deleted);if(!items.length)return '';
 return `<section class="deleted-pieces"><div class="section-heading"><h3>Deleted pieces (${items.length})</h3><button data-command="restore-deleted">Restore all</button></div><p>Original room furniture stays here after saving or refreshing.</p><details><summary>Choose a piece to restore</summary><div class="deleted-list">${items.map(o=>`<button data-command="restore-object:${o.id}"><span>${escapeText(label(o))}</span><span>Restore</span></button>`).join('')}</div></details></section>`;
}
function restoreDeletedPieces(ids){
 const items=current.objects.filter(o=>o.is_deleted&&ids.includes(o.id));if(!items.length)return false;
 if(current.objects.filter(o=>!o.is_deleted).length+items.length>100){showError('This room supports 100 visible pieces. Restore fewer pieces or remove another first.');return false}
 remember();for(const obj of items){obj.is_deleted=0;let model=models.get(obj.id);if(!model){model=new THREE.Mesh(new THREE.BoxGeometry(.6,1,.6),new THREE.MeshStandardMaterial({color:0xa27990,wireframe:true}));model.geometry.translate(0,.5,0);model.userData={objectId:obj.id,placeholder:true};models.set(obj.id,model);scene.add(model)}applyTransform(obj,model,false);if(!placementAllowed(obj))placeNewPiece(obj);if(model.userData.placeholder){model.userData.needsPlacement=true;void loadObjectModel(obj,generation)}}
 selectObject(items[0].id);showError('');markChanged();refreshInspector();return true;
}
function templateCards(){const tmpls=current.templates||[];if(!tmpls.length)return '<p class="subtle">No templates available.</p>';return tmpls.map(t=>`<div class="template-card"><div class="template-thumb-wrap"><img class="template-thumb" src="${escapeText(t.preview)}" alt="${escapeText(t.name)}" onerror="this.style.display='none'"></div><div class="template-info"><strong>${escapeText(t.name)}</strong><span class="subtle">${escapeText(t.category)} &middot; ${escapeText(t.room_size)}</span><p class="template-desc">${escapeText(t.description)}</p></div><button class="btn" data-apply-template="${escapeText(t.id)}">Apply Template</button></div>`).join('')}
function refreshInspector(){const panel=document.querySelector('#inspector-content');if(!panel)return;document.querySelectorAll('[data-panel]').forEach(button=>{const active=button.dataset.panel===activePanel;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1});panel.setAttribute('aria-labelledby','tab-'+activePanel);
 if(activePanel==='objects'){panel.innerHTML=deletedPiecesMarkup()+selectedControls()+`<section class="room-pieces"><div class="section-heading"><h3>In your room</h3><span>${current.objects.filter(o=>!o.is_deleted).length} pieces</span></div><div class="object-list">${current.objects.filter(o=>!o.is_deleted).map(o=>`<button class="object-option ${selected?.id===o.id?'selected':''}" data-object="${o.id}" aria-pressed="${selected?.id===o.id}"><span class="piece-marker">${icon(document.body.classList.contains('feminine')?'flower':o.category==='catalog'?'grid':'move')}</span><span>${escapeText(label(o))}</span><span class="object-check" aria-hidden="true">${selected?.id===o.id?icon('check'):''}</span></button>`).join('')}</div></section><details class="saved-versions"><summary>Saved versions (${current.versions.length})</summary><ul>${current.versions.slice(0,6).map(v=>`<li>Version ${v.version_number} <span>${escapeText(v.label)}</span><button class="version-restore" data-restore="${v.version_number}">Restore</button></li>`).join('')}</ul></details>`}
 else if(activePanel==='templates'){panel.innerHTML=deletedPiecesMarkup()+`<div class="library-heading"><h2>Furniture Templates</h2><p>Pre-designed room layouts ready to arrange.</p></div><div class="template-grid">${templateCards()}</div>`}
 else panel.innerHTML=deletedPiecesMarkup()+`<div class="library-heading"><h2>Find the right piece.</h2><p>Real furniture, ready for your room.</p></div><label class="small-label" for="furniture-search">Search furniture</label><input class="search" id="furniture-search" placeholder="Search sofas, chairs, tables..." value="${escapeText(libraryQuery)}"><label class="small-label" for="furniture-category">Category</label><select id="furniture-category">${['All',...new Set((current.library||[]).map(item=>item.category))].map(c=>`<option ${libraryCategory===c?'selected':''}>${c}</option>`).join('')}</select><div class="library-grid" id="furniture-cards">${libraryCards()}</div><p class="library-credit">Bedroom models from this project. Other models: <a href="https://polyhaven.com/license" target="_blank" rel="noopener">Poly Haven / CC0</a></p>`;
 updateContext();panel.querySelectorAll('input,select,button').forEach(el=>{if(busy())el.disabled=true});if(activePanel==='library'&&!busy()&&renderer)requestLibraryPreviews()}
function selectObject(id){if(busy())return;if(handView)endHandView();if(handDrag)endHandDrag(false);selected=current.objects.find(o=>o.id===Number(id)&&!o.is_deleted)||null;gizmo?.detach();if(outline){scene.remove(outline);outline.geometry.dispose();outline.material.dispose();outline=null}if(selected&&models.has(selected.id)){const model=models.get(selected.id);gizmo.detach();gizmo.setMode(mode);outline=new THREE.BoxHelper(model,0x257c82);scene.add(outline);activePanel='objects'}refreshInspector()}
function applyTransform(o,model,updateChildren=true){o.position_y=0;o.rotation_x=0;o.rotation_z=0;model.position.set(o.position_x,o.position_y,o.position_z);model.rotation.set(o.rotation_x,o.rotation_y,o.rotation_z);model.scale.set(o.scale_x,o.scale_y,o.scale_z);model.visible=!o.is_deleted;if(updateChildren)model.updateMatrixWorld(true);else model.updateWorldMatrix(true,false)}
function resetCamera(){const bedroom=current?.objects?.some(o=>o.name==='Bed_01'),scale=Math.max(1,current.room.width/(bedroom?5:6),current.room.depth/(bedroom?4:5));controls.maxDistance=Math.max(18,Math.hypot(current.room.width,current.room.depth)*2);camera.position.set((bedroom?6.2:7)*scale,(bedroom?4.4:6)*scale,(bedroom?7.3:8)*scale);controls.target.set(0,bedroom?1.05:.8,0);controls.update()}
function focusSelected(){if(!selected)return;const box=new THREE.Box3().setFromObject(models.get(selected.id)),center=box.getCenter(new THREE.Vector3()),distance=Math.max(2.5,box.getSize(new THREE.Vector3()).length()*1.3);camera.position.copy(center).add(new THREE.Vector3(distance,distance*.7,distance));controls.target.copy(center);controls.update()}
function restore(objects){const id=selected?.id;if(objects.roomSettings&&current.room){Object.assign(current.room,objects.roomSettings);applyRoomAppearance()}current.objects=objects.map(o=>({...o}));for(const o of current.objects)if(models.has(o.id)){applyTransform(o,models.get(o.id));if(!o.is_deleted&&models.get(o.id).userData.placeholder)loadObjectModel(o,generation)}selectObject(id);markChanged()}
function isFloorCovering(o){return /rug|carpet|mat(?:_|$)/i.test(o.name)}
const furnitureBoundsCache=new WeakMap();
function furnitureBounds(model){
 let cached=furnitureBoundsCache.get(model);
 if(!cached||cached.geometry!==model.geometry||cached.children!==model.children.length){
  model.updateWorldMatrix(true,true);
  const inverse=model.matrixWorld.clone().invert(),local=new THREE.Box3();
  model.traverse(node=>{
   if(!node.isMesh||!node.geometry)return;
   if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();
   const transform=new THREE.Matrix4().multiplyMatrices(inverse,node.matrixWorld);
   local.union(node.geometry.boundingBox.clone().applyMatrix4(transform));
  });
  cached={box:local,geometry:model.geometry,children:model.children.length};furnitureBoundsCache.set(model,cached);
 }
 model.updateWorldMatrix(true,false);
 return cached.box.clone().applyMatrix4(model.matrixWorld);
}
function placementAllowed(obj){
 const model=models.get(obj.id);if(!model)return false;
 if(obj.is_deleted)return true;
 const box=furnitureBounds(model),w=current.room.width/2,d=current.room.depth/2;
 if(box.min.x < -w-.001||box.max.x>w+.001||box.min.z < -d-.001||box.max.z>d+.001)return false;
 if(isFloorCovering(obj))return true;
 return !current.objects.some(other=>{
  if(other.id===obj.id||other.is_deleted||isFloorCovering(other)||!models.has(other.id))return false;
  const b=furnitureBounds(models.get(other.id));
  return Math.min(box.max.x,b.max.x)-Math.max(box.min.x,b.min.x)>.005 &&
   Math.min(box.max.z,b.max.z)-Math.max(box.min.z,b.min.z)>.005 &&
   Math.min(box.max.y,b.max.y)-Math.max(box.min.y,b.min.y)>.005;
 });
}
function placementFeedback(blocked){
 const hint=document.querySelector('#selection-hint');if(!hint)return;
 const text=blocked?'Blocked by furniture or wall. Move in another direction.':selected?'Fist: move. Thumb up: rotate left/right. Open palm: deselect. Phone sign: delete.':'Hold a fist over a piece for 0.5s to select and move. Open palm: deselect.';
 if(hint.textContent!==text)hint.textContent=text;
 hint.dataset.blocked=String(blocked);
}
function tryTransform(obj,change,{clamp=false}={}){
 const before={...obj},model=models.get(obj.id);if(!model)return false;furnitureBounds(model);
 change(obj);const after={...obj};
 // Check the path as well as the endpoint, so large hand movements cannot jump through furniture.
 const steps=Math.max(1,Math.ceil(Math.hypot(after.position_x-before.position_x,after.position_z-before.position_z)/.04),Math.ceil(Math.abs(after.rotation_y-before.rotation_y)/.08),...['x','y','z'].map(a=>Math.ceil(Math.abs(after['scale_'+a]-before['scale_'+a])/.05)));
 let valid=true,lastValid={...before};
 for(let step=1;step<=steps;step++){
  for(const key of ['position_x','position_z','rotation_y','scale_x','scale_y','scale_z'])obj[key]=before[key]+(after[key]-before[key])*step/steps;
  applyTransform(obj,model,false);if(!placementAllowed(obj)){valid=false;break}lastValid={...obj};
 }
 Object.assign(obj,valid?after:clamp?lastValid:before);applyTransform(obj,model);
 placementFeedback(!valid);
 return valid||clamp&&['position_x','position_z','rotation_y','scale_x','scale_y','scale_z'].some(key=>Math.abs(obj[key]-before[key])>1e-8);
}
function changeSelected(change){if(!selected||busy())return false;const before=snapshot();if(!tryTransform(selected,change))return false;remember(before);outline?.update();markChanged();refreshInspector();return true}
function rotateSelected(angle,{record=true}={}){
 if(!selected||busy())return false;
 const model=models.get(selected.id);if(!model)return false;
 furnitureBounds(model);
 const original={...selected},before=snapshot(),steps=Math.max(1,Math.ceil(Math.abs(angle)/.04));
 let minX=-Infinity,maxX=Infinity,minZ=-Infinity,maxZ=Infinity;
 const w=current.room.width/2,d=current.room.depth/2;
 // Find a small inward shift that leaves clearance for the entire turn.
 for(let i=0;i<=steps;i++){
  selected.rotation_y=original.rotation_y+angle*i/steps;applyTransform(selected,model,false);
  const box=furnitureBounds(model);
  minX=Math.max(minX,-w+.005-box.min.x);maxX=Math.min(maxX,w-.005-box.max.x);
  minZ=Math.max(minZ,-d+.005-box.min.z);maxZ=Math.min(maxZ,d-.005-box.max.z);
 }
 Object.assign(selected,original);applyTransform(selected,model);
 const fail=()=>{Object.assign(selected,original);applyTransform(selected,model);outline?.update();placementFeedback(true);const hint=document.querySelector('#selection-hint');if(hint)hint.textContent='Cannot rotate here. Move the piece away from nearby furniture.';return false};
 if(minX>maxX||minZ>maxZ)return fail();
 const dx=THREE.MathUtils.clamp(0,minX,maxX),dz=THREE.MathUtils.clamp(0,minZ,maxZ);
 if((Math.abs(dx)>1e-8||Math.abs(dz)>1e-8)&&!tryTransform(selected,o=>{o.position_x+=dx;o.position_z+=dz}))return fail();
 if(!tryTransform(selected,o=>o.rotation_y+=angle))return fail();
 if(record)remember(before);outline?.update();if(!dirty||record)markChanged();else queueStudioDraft();if(record)refreshInspector();else updateObjectSheet();return true;
}
function dispatch(command){if(state.page!=='studio'||busy())return false;if(handView)endHandView();if(handDrag)endHandDrag(false);if(command==='restore-deleted')return restoreDeletedPieces(current.objects.filter(o=>o.is_deleted).map(o=>o.id));if(command.startsWith('restore-object:'))return restoreDeletedPieces([Number(command.split(':')[1])]);if(command.startsWith('room:')||command.startsWith('finish:'))return changeRoom(command);if(command==='delete-last'){const last=current.objects.filter(o=>!o.is_deleted).at(-1);if(!last)return false;selectObject(last.id);return dispatch('delete')}if(command==='rotate45')return rotateSelected(Math.PI/4);if(command==='toggle-tools'){document.body.classList.toggle('tools-open');syncTools();return true}if(command==='panel:library'||command==='panel:objects'){document.body.classList.add('tools-open');activePanel=command.slice(6);refreshInspector();return true}if(['translate','rotate','scale'].includes(command)){if(!selected)return false;mode=command;gizmo.setMode(mode);if(command==='rotate'){activePanel='objects';document.body.classList.add('tools-open');refreshInspector();status('Point at Left or Right to rotate; keep pointing to repeat')}syncTools();return true}if(command==='toggle-grid'){showGrid=!showGrid;const grid=scene?.getObjectByName('measurement-grid');if(grid)grid.visible=showGrid;document.querySelector('[data-command="toggle-grid"]')?.setAttribute('aria-pressed',String(showGrid));return true}if(command==='toggle-dimensions'){showDimensions=!showDimensions;document.querySelector('[data-command="toggle-dimensions"]')?.setAttribute('aria-pressed',String(showDimensions));refreshInspector();return true}if(command==='top-view'){controls.target.set(0,0,0);camera.position.set(0,9,.35);controls.update();return true}if(command==='reset-view'){resetCamera();return true}if(command.startsWith('view:')){const action=command.split(':')[1];if(!['left','right','in','out'].includes(action))return false;const offset=camera.position.clone().sub(controls.target),spherical=new THREE.Spherical().setFromVector3(offset);if(action==='left')spherical.theta-=Math.PI/12;if(action==='right')spherical.theta+=Math.PI/12;if(action==='in')spherical.radius=Math.max(controls.minDistance,spherical.radius*.85);if(action==='out')spherical.radius=Math.min(controls.maxDistance,spherical.radius*1.15);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));controls.update();return true}if(command==='focus'){focusSelected();return true}if(command==='undo'&&past.length){future.push(snapshot());restore(past.pop());return true}if(command==='redo'&&future.length){past.push(snapshot());restore(future.pop());return true}if(command==='delete'&&selected){const id=selected.id;remember();current.objects.find(o=>o.id===id).is_deleted=1;models.get(id).visible=false;selectObject(null);markChanged();return true}if(command.startsWith('move:')){const [,axis,sign]=command.split(':');if(!['x','z'].includes(axis)||!['-1','1'].includes(sign))return false;return changeSelected(o=>o['position_'+axis]=THREE.MathUtils.clamp(o['position_'+axis]+Number(sign)*moveStep,-20,20))}if(command.startsWith('rotate:')){const sign=Number(command.split(':')[1]);if(![-1,1].includes(sign))return false;return rotateSelected(sign*Math.PI/12)}if(command.startsWith('scale:')){const sign=Number(command.split(':')[1]);if(![-1,1].includes(sign))return false;return changeSelected(o=>{for(const a of ['x','y','z'])o['scale_'+a]=THREE.MathUtils.clamp(o['scale_'+a]*(sign>0?1.1:.9),.1,5)})}return false}
// Mouse, keyboard and hand input share these editor commands.
window.smartspaceControls=Object.freeze({dispatch,hitTest:hitTestFurniture,select:id=>selectObject(id),beginHandDrag,beginHandRotate,moveHandDrag,reanchorHandDrag,endHandDrag,beginHandView,moveHandView,endHandView,gestureView,getState:()=>({active:state.page==='studio',selectedId:selected?.id||null,mode,busy:busy(),saving:!!saveTask||saving,loading,adding,handDraggingId:handDrag?.id||null,handViewActive:!!handView})});
function gestureView({zoom=0,zoomFactor=null,twist=0,tilt=0}){if(!camera||!controls||busy()||handDrag)return false;const offset=camera.position.clone().sub(controls.target),spherical=new THREE.Spherical().setFromVector3(offset);spherical.radius=THREE.MathUtils.clamp(zoomFactor!==null&&Number.isFinite(zoomFactor)?spherical.radius/THREE.MathUtils.clamp(zoomFactor,.92,1.08):spherical.radius/(1+THREE.MathUtils.clamp(zoom,-1,1)*.04),controls.minDistance,controls.maxDistance);spherical.theta+=THREE.MathUtils.clamp(twist,-.6,.6)*.15;spherical.phi=THREE.MathUtils.clamp(spherical.phi+THREE.MathUtils.clamp(tilt,-.2,.2)*.3,.05,controls.maxPolarAngle);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));controls.update();return true}
function syncFromModel(){const model=models.get(selected.id),values={};for(const [group,vector] of [['position',model.position],['rotation',model.rotation],['scale',model.scale]])for(const a of ['x','y','z'])values[group+'_'+a]=group==='scale'?THREE.MathUtils.clamp(vector[a],.1,5):vector[a];applyTransform(selected,model);if(!tryTransform(selected,o=>Object.assign(o,values)))return;outline?.update();markChanged()}
async function startViewer(){disposeViewer();selected=null;loading=true;const version=generation;editorLayout();showError('');try{const container=document.querySelector('#viewport');renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;updateViewerTheme();renderer.domElement.setAttribute('data-drag','');renderer.domElement.setAttribute('data-nodwell','');container.append(renderer.domElement);scene=new THREE.Scene();const pmrem=new THREE.PMREMGenerator(renderer),environment=new RoomEnvironment();environmentTarget=pmrem.fromScene(environment,.04);scene.environment=environmentTarget.texture;scene.environmentIntensity=.35;environment.dispose();pmrem.dispose();camera=new THREE.PerspectiveCamera(40,1,.1,100);controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI/2-.03;controls.minDistance=1.5;controls.maxDistance=18;resetCamera();gizmo=new TransformControls(camera,renderer.domElement);gizmo.setMode(mode);gizmo.setSize(.8);scene.add(gizmo.getHelper());gizmo.addEventListener('dragging-changed',e=>{controls.enabled=!e.value;if(e.value)dragStart=snapshot();else if(dragStart){if(JSON.stringify(dragStart)!==JSON.stringify(snapshot()))remember(dragStart);dragStart=null;refreshInspector();if(dirty)scheduleAutosave(0)}});gizmo.addEventListener('objectChange',()=>{if(selected&&!busy())syncFromModel()});scene.add(new THREE.HemisphereLight(0xdce9ef,0x4c4235,.65));const sun=new THREE.DirectionalLight(0xfff1dc,2.4);sun.position.set(3,8,5);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-6;sun.shadow.camera.right=6;sun.shadow.camera.top=6;sun.shadow.camera.bottom=-6;sun.shadow.camera.near=.5;sun.shadow.camera.far=25;sun.shadow.normalBias=.025;sun.shadow.bias=-.0003;scene.add(sun);const grid=new THREE.GridHelper(10,20,0x647c82,0x7c9399);grid.position.y=.015;grid.name='measurement-grid';grid.visible=showGrid;scene.add(grid);const loader=new GLTFLoader();try{const structure=await loader.loadAsync(current.room.asset_url);if(version!==generation){disposeModel(structure.scene);return}prepareRoomMaterials(structure.scene,true);structure.scene.name='editable-room-shell';current.room.source_width??=current.room.width;current.room.source_depth??=current.room.depth;scene.add(structure.scene);applyRoomAppearance()}catch(error){const floor=new THREE.Mesh(new THREE.PlaneGeometry(current.room.width,current.room.depth),new THREE.MeshStandardMaterial({color:0x858585,side:THREE.DoubleSide}));floor.rotation.x=-Math.PI/2;scene.add(floor);showError('Room shell unavailable. Showing the floor so you can keep editing.')}
 for(const obj of current.objects){const placeholder=new THREE.Mesh(new THREE.BoxGeometry(.6,1,.6),new THREE.MeshStandardMaterial({color:0xa27990,wireframe:true}));placeholder.geometry.translate(0,.5,0);placeholder.userData={objectId:obj.id,placeholder:true};applyTransform(obj,placeholder);scene.add(placeholder);models.set(obj.id,placeholder)}
 const queue=current.objects.filter(o=>!o.is_deleted);await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{while(queue.length&&version===generation)await loadObjectModel(queue.shift(),version)}));if(version!==generation)return;
 resize=new ResizeObserver(()=>{if(version!==generation||!renderer)return;const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()});resize.observe(container);
 unmountMouse=mountMouseControls(renderer.domElement,{gizmo,busy,hitTest:hitTestFurniture,select:selectObject});
 document.querySelector('#load-note').hidden=true;function animate(){if(version!==generation)return;frame=requestAnimationFrame(animate);controls.update();outline?.update();renderer.render(scene,camera)}animate();loading=false;restoreStudioView();refreshInspector();if(dirty)scheduleAutosave();
 }catch(error){if(version!==generation)return;loading=false;showError('Could not display the room. '+error.message);status('Room unavailable');syncTools()}}
function layoutPayload(){return {project_id:current.project.id,revision:current.project.revision,
 room_settings:{width:current.room.width,depth:current.room.depth,floor_finish:current.room.floor_finish||'original'},
 objects:current.objects.map(o=>({id:o.id,position:[o.position_x,o.position_y,o.position_z],rotation:[o.rotation_x,o.rotation_y,o.rotation_z],scale:[o.scale_x,o.scale_y,o.scale_z],is_deleted:!!o.is_deleted}))}}
function layoutSignature(payload){return JSON.stringify({room_settings:payload.room_settings,objects:payload.objects})}
function persist(options={}){
 if(saveTask)return saveTask.then(ok=>ok&&dirty?persist(options):ok);
 if(busy()||!current)return Promise.resolve(false);
 saveTask=saveLayout(options).finally(()=>{saveTask=null});return saveTask;
}
async function saveLayout({background=false}={}){
 if(autosaveTimer&&typeof clearTimeout==='function')clearTimeout(autosaveTimer);autosaveTimer=null;
 if(!background){endHandView();endHandDrag(false);saving=true;if(gizmo)gizmo.enabled=false}
 const payload=layoutPayload(),signature=layoutSignature(payload),version=generation;
 status('Saving layout...');syncTools();
 try{
  const saved=await request('save_layout',payload);
  if(version!==generation||current?.project.id!==payload.project_id)return true;
  // Keep the live furniture and selection: the response can describe an older edit.
  current.project=saved.project;current.versions=saved.versions;
  dirty=layoutSignature(layoutPayload())!==signature;
  if(dirty){storeStudioDraft();scheduleAutosave(0)}else clearStudioDraft();
  status(dirty?'Saving latest changes...':'All changes saved');showError('');return true;
 }catch(error){
  if(version===generation&&current?.project.id===payload.project_id){storeStudioDraft();showError('Layout was not saved. '+error.message);status('Save failed - retrying automatically')}
  return false;
 }finally{
  if(!background)saving=false;
  if(version===generation){if(gizmo)gizmo.enabled=!busy()&&!handDrag;if(background){syncTools();updateObjectSheet()}else refreshInspector()}
 }
}

function placeNewPiece(obj){const model=models.get(obj.id);const others=current.objects.filter(o=>o.id!==obj.id&&!o.is_deleted&&!isFloorCovering(o)&&models.has(o.id)).map(o=>new THREE.Box3().setFromObject(models.get(o.id)));const w=current.room.width/2,d=current.room.depth/2;let found=false;for(let z=-d+.3;z<=d&&!found;z+=.3)for(let x=-w+.3;x<=w;x+=.3){obj.position_x=x;obj.position_z=z;applyTransform(obj,model);const box=new THREE.Box3().setFromObject(model);if(box.min.x< -w+.05||box.max.x>w-.05||box.min.z< -d+.05||box.max.z>d-.05)continue;const overlaps=!isFloorCovering(obj)&&others.some(b=>box.min.x<b.max.x+.08&&box.max.x>b.min.x-.08&&box.min.z<b.max.z+.08&&box.max.z>b.min.z-.08);if(!overlaps){found=true;break}}if(!found){obj.is_deleted=1;applyTransform(obj,model);showError('No clear floor space. The piece is in Deleted pieces until there is room to restore it.')}return found}
async function addFurniture(id){if(busy())return;if(dirty&&!(await persist()))return;adding=true;status('Adding furniture...');syncTools();try{current=await request('add_furniture',{project_id:current.project.id,revision:current.project.revision,catalog_id:id});const object=current.objects.at(-1);const gltf=await new GLTFLoader().loadAsync(object.asset_url);prepareRoomMaterials(gltf.scene,false);const model=centerFurniture(gltf.scene);model.userData.objectId=object.id;models.set(object.id,model);scene.add(model);applyTransform(object,model);past=past.map(items=>[...items,{...object,is_deleted:1}]);future=[];remember(current.objects.map(o=>({...o,is_deleted:o.id===object.id?1:o.is_deleted})));placeNewPiece(object);dirty=true;queueStudioDraft();adding=false;activePanel='objects';selectObject(object.id);status('Piece added - saving automatically');scheduleAutosave()}catch(error){showError('Could not add furniture. '+error.message);adding=false;await startViewer();showError('Could not add furniture. '+error.message)}finally{adding=false;refreshInspector()}}
window.openStudio=async function(id){if(busy())return;if(state.page==='studio'&&!canLeaveStudio())return;if(dirty&&!(await persist()))return;loading=true;syncTools();try{const opened=await request('open_project',{project_id:Number(id)});storeStudioDraft();storeStudioView();disposeViewer();current=opened;const draftStatus=restoreStudioDraft();dirty=draftStatus==='restored';try{localStorage.setItem('smartspace-project-'+state.user,String(current.project.id))}catch{}past=[];future=[];activePanel='objects';applyAppearance();shell();loading=false;if(!current.room){const tmpls=current.templates||[];document.querySelector('#studio-content').innerHTML=`<div class="studio-layout"><aside class="camera-rail">${handCursorMarkup()}</aside><section class="room-empty"><h2>Choose a Furniture Template</h2><p>Select a ready-made design layout to start arranging your room.</p><div class="empty-template-grid">${tmpls.map(t=>`<div class="empty-template-card"><img src="${escapeText(t.preview)}" alt="${escapeText(t.name)}" onerror="this.style.display='none'"><h3>${escapeText(t.name)}</h3><span class="subtle">${escapeText(t.category)} &middot; ${escapeText(t.room_size)}</span><p>${escapeText(t.description)}</p><button class="btn" data-apply-template="${escapeText(t.id)}">Use this design</button></div>`).join('')||`<button class="btn" data-studio="import">Create room</button>`}</div></section></div>`;mountHandCursor();return}await startViewer();if(draftStatus==='conflict')showError('This room changed elsewhere. The saved layout was opened; your earlier local draft was kept separately.');window.scrollTo(0,0)}catch(error){loading=false;syncTools();modal('Could not open room',`<p>${escapeText(error.message)}</p>`)}};
async function backToProjects(){if(dirty&&!(await persist()))return;try{setProfile(await request('workspace'));showRooms()}catch(error){showError(error.message)}}
async function restoreSavedVersion(number){if(busy()||!(await window.handConfirm('Restore this saved layout? Current unsaved edits will be replaced.')))return;if(saveTask&&!(await persist()))return;saving=true;syncTools();try{const restored=await request('restore_version',{project_id:current.project.id,version_number:number,revision:current.project.revision});current=restored;dirty=false;past=[];future=[];saving=false;shell();await startViewer();status('Saved version restored')}catch(error){showError(error.message)}finally{saving=false;syncTools()}}

document.addEventListener('click',async e=>{const project=e.target.closest('[data-project-id]');if(project){e.stopImmediatePropagation();window.openStudio(project.dataset.projectId);return}if(state.page!=='studio')return;const command=e.target.closest('[data-command]')?.dataset.command,panel=e.target.closest('[data-panel]')?.dataset.panel,object=e.target.closest('[data-object]'),asset=e.target.closest('[data-add]'),nudge=e.target.closest('[data-nudge]'),adjust=e.target.closest('[data-adjust]'),action=e.target.closest('[data-studio]')?.dataset.studio,globalAction=e.target.closest('[data-action]')?.dataset.action;
 if(globalAction==='theme'){e.stopImmediatePropagation();await toggleUserTheme();updateViewerTheme();const themeButton=document.querySelector('[data-action="theme"]');if(themeButton)themeButton.innerHTML=uiIcon(state.theme==='dark'?'sun':'moon');return}if(globalAction==='home'){e.stopImmediatePropagation();await backToProjects();return}if(globalAction==='new'&&busy()){e.stopImmediatePropagation();return}
 const restoreButton=e.target.closest('[data-restore]');if(restoreButton){e.stopImmediatePropagation();await restoreSavedVersion(Number(restoreButton.dataset.restore));return}
 const applyBtn=e.target.closest('[data-apply-template]');if(applyBtn){e.stopImmediatePropagation();if(busy())return;const tmplId=applyBtn.dataset.applyTemplate;if(saveTask&&!(await persist()))return;loading=true;syncTools();try{current=await request('apply_template',{project_id:current.project.id,template_id:tmplId,replace:true});dirty=false;past=[];future=[];loading=false;shell();await startViewer();activePanel='objects';refreshInspector()}catch(err){loading=false;syncTools();showError(err.message)}return}
 if(command||panel||object||asset||nudge||adjust||action){e.stopImmediatePropagation();if(busy())return;if(command)dispatch(command);else if(panel){activePanel=panel;refreshInspector();document.querySelector('#tab-'+panel)?.focus()}else if(object)selectObject(object.dataset.object);else if(asset)await addFurniture(asset.dataset.add);else if(nudge)dispatch('move:'+nudge.dataset.nudge);else if(adjust)dispatch(adjust.dataset.adjust);else if(action==='back')await backToProjects();else if(action==='save')await persist();else if(action==='import'){loading=true;try{current=await request('import_demo',{project_id:current.project.id});loading=false;shell();await startViewer()}catch(error){loading=false;showError(error.message)}}}
},true);
document.addEventListener('change',e=>{if(e.target.id==='move-step'){moveStep=Number(e.target.value);return}if(e.target.id==='furniture-category'){libraryCategory=e.target.value;updateLibraryCards();return}const key=e.target.dataset.transform;if(!key||!selected||busy()||['position_y','rotation_x','rotation_z'].includes(key))return;endHandDrag(false);let value=Number(e.target.value);if(e.target.value.trim()===''||!Number.isFinite(value)){e.target.value=selected[key];return}if(key.startsWith('rotation'))value=THREE.MathUtils.degToRad(value);if(key.startsWith('scale'))value=THREE.MathUtils.clamp(value,.1,5);if(key.startsWith('position'))value=THREE.MathUtils.clamp(value,-20,20);changeSelected(o=>o[key]=value)});
document.addEventListener('input',e=>{if(e.target.id==='furniture-search'){libraryQuery=e.target.value;updateLibraryCards()}});
mountKeyboardControls({active:()=>state.page==='studio',busy,dirty:()=>dirty,save:persist,dispatch,switchPanel:()=>{activePanel=activePanel==='objects'?'library':'objects';refreshInspector();document.querySelector('#tab-'+activePanel)?.focus()}});
window.addEventListener('beforeunload',e=>{storeStudioDraft();storeStudioView();if(saving||adding){e.preventDefault();e.returnValue=''}});

function centerFurniture(model){
    model.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(model),center=box.getCenter(new THREE.Vector3());
    const offset=new THREE.Group();offset.position.set(-center.x,-box.min.y,-center.z);offset.add(model);
    const root=new THREE.Group();root.add(offset);return root;
}
function libraryCards(){
    const items=(current.library||[]).filter(a=>(libraryCategory==='All'||a.category===libraryCategory)&&a.name.toLowerCase().includes(libraryQuery.toLowerCase()));
    return items.map(a=>`<button class="furniture-card" data-add="${escapeText(a.id)}" aria-label="Add ${escapeText(a.name)}"><span class="furniture-preview"><img data-preview="${escapeText(a.id)}" ${previews.has(a.id)?`src="${previews.get(a.id)}"`:'hidden'} alt="${escapeText(a.name)} 3D model" width="180" height="140"><span class="preview-loading" ${previews.has(a.id)?'hidden':''}>3D preview</span></span><strong>${escapeText(a.name)}</strong><span>${escapeText(a.category)} <span aria-hidden="true">+</span></span></button>`).join('')||'<p class="studio-help" role="status">No matching furniture.</p>';
}
function updateLibraryCards(){const el=document.querySelector('#furniture-cards');if(el)el.innerHTML=libraryCards()}
function disposeModel(model){model.traverse(o=>{o.geometry?.dispose();for(const material of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){for(const value of Object.values(material))if(value?.isTexture)value.dispose();material.dispose()}})}
async function generatePreviews(version){
    const previewVersion=++previewRevision;
    let previewRenderer,envTarget;
    try{
        const items=(current.library||[]).filter(a=>!previews.has(a.id));if(!items.length)return;
        previewRenderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});previewRenderer.setSize(240,180);previewRenderer.setClearColor(getComputedStyle(document.body).getPropertyValue('--preview-bg').trim()||'#ece8df');previewRenderer.outputColorSpace=THREE.SRGBColorSpace;previewRenderer.toneMapping=THREE.ACESFilmicToneMapping;
        const stage=new THREE.Scene(),pmrem=new THREE.PMREMGenerator(previewRenderer),environment=new RoomEnvironment();envTarget=pmrem.fromScene(environment,.04);stage.environment=envTarget.texture;stage.environmentIntensity=.45;environment.dispose();pmrem.dispose();
        stage.add(new THREE.HemisphereLight(0xffffff,0x65605a,.6));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,5,4);stage.add(light);
        const view=new THREE.PerspectiveCamera(35,240/180,.01,100),loader=new GLTFLoader();
        for(const item of items){
            if(version!==generation||previewVersion!==previewRevision)return;
            const gltf=await loader.loadAsync(item.asset_url),model=centerFurniture(gltf.scene);
            if(version!==generation||previewVersion!==previewRevision){disposeModel(model);return}
            stage.add(model);const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());const distance=Math.max(size.x,size.y,size.z)*2.3;view.position.copy(center).add(new THREE.Vector3(distance,.65*distance,distance));view.lookAt(center);view.updateProjectionMatrix();previewRenderer.render(stage,view);previews.set(item.id,previewRenderer.domElement.toDataURL('image/webp',.85));stage.remove(model);disposeModel(model);
            document.querySelectorAll('[data-preview]').forEach(img=>{if(img.dataset.preview===item.id){img.src=previews.get(item.id);img.hidden=false;img.nextElementSibling.hidden=true}});
            await new Promise(resolve=>requestAnimationFrame(resolve));
        }
    }catch(error){console.warn('Furniture preview unavailable:',error.message)}finally{envTarget?.dispose();previewRenderer?.dispose();previewRenderer?.forceContextLoss()}
}

// Keep the simple demo palette legible under physically based lighting.
// Catalog models retain their original texture maps and material colors.
function prepareRoomMaterials(root,isDemo){
 const palette={wall:0xb7b9b1,floor:0x957957,wood:0x86613f,wood_dark:0x59432e,sofa:0x617c69,sofa_dark:0x435c4c,fabric:0xb49b78,rug:0xad7862,glass:0x7caaa9,metal:0x424e49,book_red:0xac4f38,book_cream:0xc4ac79};
 root.traverse(mesh=>{if(!mesh.isMesh)return;mesh.castShadow=true;mesh.receiveShadow=true;
  for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
   if(isDemo&&palette[material.name]!==undefined&&!material.map){material.color.setHex(palette[material.name]);material.roughness=.85;material.metalness=0;material.envMapIntensity=.6;}
  }
 });
}

function hitTestFurniture(x,y){
 if(busy()||!renderer||!camera||state.page!=='studio')return null;
 const rect=renderer.domElement.getBoundingClientRect();
 if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)return null;
 const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),camera);
 // Include the room shell so opaque walls block selection, just as they block the view.
 const shell=scene?.getObjectByName('editable-room-shell');
 const targets=[...models.values(),...(shell?[shell]:[])];
 const hit=ray.intersectObjects(targets,true).find(intersection=>{
  for(let node=intersection.object;node;node=node.parent)if(!node.visible)return false;
  const materials=intersection.object.material;
  const material=Array.isArray(materials)?materials[intersection.face?.materialIndex??0]:materials;
  return material?.visible!==false&&!(material?.transparent&&material.opacity<.5);
 });
 if(!hit)return null;let object=hit.object;while(object&&!object.userData.objectId)object=object.parent;return object?.userData.objectId||null;
}

function updateViewerTheme(){if(!renderer)return;const color=getComputedStyle(document.body).getPropertyValue('--viewport-bg').trim();renderer.setClearColor(color||(state.theme==='dark'?'#252c32':'#8a9b9f'));previews.clear();previewJob=null;previewRevision++;if(!loading&&activePanel==='library')requestLibraryPreviews()}
async function loadObjectModel(obj,version){
 if(loadingModels.has(obj.id))return;loadingModels.add(obj.id);
 try{const gltf=await new GLTFLoader().loadAsync(obj.asset_url);if(version!==generation){disposeModel(gltf.scene);return}prepareRoomMaterials(gltf.scene,obj.category!=='catalog');const model=obj.category==='catalog'?centerFurniture(gltf.scene):gltf.scene;model.userData.objectId=obj.id;const latest=current.objects.find(o=>o.id===obj.id);if(!latest){disposeModel(model);return}applyTransform(latest,model);const old=models.get(obj.id);if(selected?.id===obj.id)gizmo?.detach();if(old){scene.remove(old);disposeModel(old)}models.set(obj.id,model);scene.add(model);if(old?.userData.needsPlacement&&!latest.is_deleted&&!placementAllowed(latest)){placeNewPiece(latest);markChanged()}if(selected?.id===obj.id){gizmo?.detach();if(outline){scene.remove(outline);outline.geometry.dispose();outline.material.dispose()}outline=new THREE.BoxHelper(model,0x257c82);scene.add(outline);refreshInspector()}}catch(error){if(version===generation)showError('Some furniture could not load. Outlined placeholders keep their saved positions. Reopen this room to retry.')}finally{if(version===generation)loadingModels.delete(obj.id)}
}

function requestLibraryPreviews(){if(previewJob?.generation===generation)return;const job={generation};previewJob=job;generatePreviews(generation).finally(()=>{if(previewJob===job)previewJob=null})}

// Hand movement follows the floor plane through the camera, so screen-right
// stays screen-right even after orbiting the room. Height is preserved.
function handFloorPoint(x,y,height){
 if(!renderer||!camera||![x,y,height].every(Number.isFinite))return null;const rect=renderer.domElement.getBoundingClientRect();
 if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)return null;
 const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),camera);
 return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-height),new THREE.Vector3());
}
function beginHandDrag(id,x,y){
 if(busy()||state.page!=='studio'||document.querySelector('dialog[open]'))return false;
 const object=current.objects.find(o=>o.id===Number(id)&&!o.is_deleted);if(!object||!models.has(object.id))return false;
 const anchor=handFloorPoint(x,y,object.position_y);if(!anchor)return false;
 selectObject(object.id);handDrag={id:object.id,before:snapshot(),anchor,startX:object.position_x,startZ:object.position_z};
 if(controls)controls.enabled=false;if(gizmo)gizmo.enabled=false;status('Moving - keep a fist; open palm to deselect; phone sign 1s to delete');return true;
}
function beginHandRotate(id,x,y){
 if(!beginHandDrag(id,x,y))return false;
 handDrag.kind='rotate';handDrag.lastX=x;
 status('Rotating - move your thumb hand left or right; open palm to finish');return true;
}
function reanchorHandDrag(x,y){
 if(!handDrag||!selected)return false;if(handDrag.kind==='rotate'){handDrag.lastX=x;return true}const point=handFloorPoint(x,y,selected.position_y);if(!point)return false;
 handDrag.anchor=point;handDrag.startX=selected.position_x;handDrag.startZ=selected.position_z;return true;
}
function moveHandDrag(x,y){
 if(!handDrag||busy()||!selected||selected.id!==handDrag.id)return false;
 if(handDrag.kind==='rotate'){
  if(!Number.isFinite(x)||!Number.isFinite(y))return false;
  const rect=renderer.domElement.getBoundingClientRect();
  if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom){handDrag.lastX=x;return false}
  const angle=THREE.MathUtils.clamp(-(x-handDrag.lastX)/Math.max(1,rect.width)*Math.PI*2,-Math.PI/12,Math.PI/12);
  handDrag.lastX=x;if(Math.abs(angle)<.0001)return true;
  return rotateSelected(angle,{record:false});
 }
 const point=handFloorPoint(x,y,selected.position_y);if(!point)return false;
 const model=models.get(selected.id);if(!model)return false;
 let nx=handDrag.startX+point.x-handDrag.anchor.x,nz=handDrag.startZ+point.z-handDrag.anchor.z;
 const box=furnitureBounds(model),w=current.room.width/2,d=current.room.depth/2;
 const minX=selected.position_x-box.min.x,maxX=box.max.x-selected.position_x,minZ=selected.position_z-box.min.z,maxZ=box.max.z-selected.position_z;
 if(minX+maxX>w*2||minZ+maxZ>d*2){status('This piece is too large for the room. Resize it before moving.');return false}
 nx=THREE.MathUtils.clamp(nx,-w+minX,w-maxX);
 nz=THREE.MathUtils.clamp(nz,-d+minZ,d-maxZ);
 if(Math.hypot(nx-selected.position_x,nz-selected.position_z)<.0005)return true;
 const moved=tryTransform(selected,o=>{o.position_x=nx;o.position_z=nz},{clamp:true});reanchorHandDrag(x,y);if(!moved)return false;outline?.update();updateObjectSheet();if(!dirty)markChanged();else queueStudioDraft();return true;
}
function endHandDrag(deselect=true){
 if(!handDrag)return;const before=handDrag.before;handDrag=null;
 if(JSON.stringify(before)!==JSON.stringify(snapshot()))remember(before);
 if(controls)controls.enabled=true;if(gizmo)gizmo.enabled=!busy();
 if(deselect&&!busy())selectObject(null);else refreshInspector();
 if(dirty){storeStudioDraft();scheduleAutosave(0)}
}

function handPairMetrics(points){
 if(!Array.isArray(points)||points.length!==2||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
 const [a,b]=points;return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.max(40,Math.hypot(b.x-a.x,b.y-a.y)),angle:Math.atan2(b.y-a.y,b.x-a.x)};
}
function beginHandView(points){
 if(busy()||state.page!=='studio'||!camera||!renderer||!controls||document.querySelector('dialog[open]'))return false;
 const metrics=handPairMetrics(points);if(!metrics)return false;
 const rect=renderer.domElement.getBoundingClientRect();if(metrics.x<rect.left||metrics.x>rect.right||metrics.y<rect.top||metrics.y>rect.bottom)return false;
 endHandDrag(true);camera.updateMatrixWorld(true);
 handView={...metrics,target:controls.target.clone(),spherical:new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)),right:new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up:new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1),height:Math.max(1,rect.height)};
 controls.enabled=false;if(gizmo)gizmo.enabled=false;return true;
}
function moveHandView(points){
 if(!handView||busy()||!camera||!controls)return false;
 const metrics=handPairMetrics(points);if(!metrics)return false;
 const spherical=handView.spherical.clone();spherical.radius=THREE.MathUtils.clamp(handView.spherical.radius*handView.distance/metrics.distance,controls.minDistance,controls.maxDistance);
 const twist=Math.atan2(Math.sin(metrics.angle-handView.angle),Math.cos(metrics.angle-handView.angle));spherical.theta-=twist;
 const units=2*handView.spherical.radius*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/handView.height;
 const target=handView.target.clone().addScaledVector(handView.right,-(metrics.x-handView.x)*units).addScaledVector(handView.up,(metrics.y-handView.y)*units);
 target.x=THREE.MathUtils.clamp(target.x,-current.room.width,current.room.width);target.y=THREE.MathUtils.clamp(target.y,0,current.room.height);target.z=THREE.MathUtils.clamp(target.z,-current.room.depth,current.room.depth);
 controls.target.copy(target);camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical));controls.update();return true;
}
function endHandView(){if(!handView)return;handView=null;if(controls)controls.enabled=!handDrag;if(gizmo)gizmo.enabled=!busy()&&!handDrag}

const transformKeys=['position_x','position_y','position_z','rotation_x','rotation_y','rotation_z','scale_x','scale_y','scale_z'];
function studioStorageKey(kind){return state.user&&current?'smartspace-'+kind+'-'+state.user+'-'+current.project.id:null}
function queueStudioDraft(){if(typeof setTimeout!=='function'){storeStudioDraft();return}if(draftTimer)clearTimeout(draftTimer);draftTimer=setTimeout(storeStudioDraft,200)}
function storeStudioDraft(){
 const key=studioStorageKey('draft');if(!key||!dirty)return false;
 try{localStorage.setItem(key,JSON.stringify({revision:current.project.revision,room:{width:current.room.width,depth:current.room.depth,floor_finish:current.room.floor_finish||'original'},objects:current.objects.map(o=>({id:o.id,is_deleted:o.is_deleted,...Object.fromEntries(transformKeys.map(k=>[k,o[k]]))}))}));return true}catch{return false}
}
function clearStudioDraft(){if(draftTimer&&typeof clearTimeout==='function')clearTimeout(draftTimer);draftTimer=null;const key=studioStorageKey('draft');if(key)try{localStorage.removeItem(key)}catch{}}
function restoreStudioDraft(){
 const key=studioStorageKey('draft');if(!key)return null;
 try{
  const raw=localStorage.getItem(key);if(!raw)return null;const draft=JSON.parse(raw);
  if(draft.revision!==current.project.revision||!Array.isArray(draft.objects)||draft.objects.length!==current.objects.length)return 'conflict';
  const items=new Map(draft.objects.map(o=>[o.id,o]));
  if(items.size!==current.objects.length||current.objects.some(o=>!items.has(o.id)))return 'conflict';
  if(draft.objects.some(o=>transformKeys.some(k=>typeof o[k]!=='number'||!Number.isFinite(o[k])||Math.abs(o[k])>=10000||k.startsWith('scale_')&&o[k]<=0)))return 'conflict';
  if(draft.room){if(!current.room||![draft.room.width,draft.room.depth].every(v=>Number.isFinite(v)&&v>=2&&v<=12)||!['original','oak','walnut','concrete','terracotta'].includes(draft.room.floor_finish))return 'conflict';Object.assign(current.room,{width:draft.room.width,depth:draft.room.depth,floor_finish:draft.room.floor_finish,source_width:current.room.source_width||current.room.width,source_depth:current.room.source_depth||current.room.depth})}
  for(const object of current.objects){const saved=items.get(object.id);for(const key of transformKeys)object[key]=saved[key];object.is_deleted=saved.is_deleted?1:0}
  return 'restored';
 }catch{return 'conflict'}
}
function storeStudioView(){
 cacheStudioShell();storeRoomPreview();
 const key=studioStorageKey('view');if(!key||!camera||!controls)return;
 try{localStorage.setItem(key,JSON.stringify({position:camera.position.toArray(),target:controls.target.toArray(),panel:activePanel,mode,showGrid,showDimensions,toolsOpen:document.body.classList.contains('tools-open'),selectedId:selected?.id||null}));localStorage.setItem('smartspace-project-'+state.user,String(current.project.id))}catch{}
}
function restoreStudioView(){
 const key=studioStorageKey('view');if(!key||!camera||!controls)return;
 try{
  const value=JSON.parse(localStorage.getItem(key)||'null');if(!value)return;
  if(![value.position,value.target].every(v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<100)))return;
  camera.position.fromArray(value.position);controls.target.fromArray(value.target);const offset=camera.position.clone().sub(controls.target);const radius=offset.length();if(radius<.001)return;
  offset.multiplyScalar(THREE.MathUtils.clamp(radius,controls.minDistance,controls.maxDistance)/radius);camera.position.copy(controls.target).add(offset);controls.update();
  if(['translate','rotate','scale'].includes(value.mode)){mode=value.mode;gizmo?.setMode(mode)}
  showGrid=!!value.showGrid;showDimensions=!!value.showDimensions;const grid=scene?.getObjectByName('measurement-grid');if(grid)grid.visible=showGrid;document.querySelector('[data-command="toggle-grid"]')?.setAttribute('aria-pressed',String(showGrid));document.querySelector('[data-command="toggle-dimensions"]')?.setAttribute('aria-pressed',String(showDimensions));selectObject(value.selectedId);if(['objects','library'].includes(value.panel))activePanel=value.panel;document.body.classList.toggle('tools-open',!!value.toolsOpen);
 }catch{}
}

function cacheStudioShell(){
 if(!state.user||!current)return;try{const cache=JSON.parse(localStorage.getItem('smartspace-shell')||'{}');if(String(cache.user?.id)!==String(state.user))return;cache.project={id:current.project.id,name:current.project.name};localStorage.setItem('smartspace-shell',JSON.stringify(cache))}catch{}
}
function storeRoomPreview(){
 if(!state.user||!current||!renderer||!scene||!camera||!renderer.domElement?.toDataURL)return;
 try{renderer.render(scene,camera);const image=renderer.domElement.toDataURL('image/jpeg',.7);localStorage.setItem('smartspace-room-preview-'+state.user,JSON.stringify({projectId:current.project.id,image}))}catch{}
}
