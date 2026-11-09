const app=document.querySelector('#app');
const users={};
const state={page:'connect',user:null,signedOut:false,theme:'light'};
const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uiIcon=(name)=>{const paths={room:'M3 10 12 3l9 7v11H3ZM9 21v-8h6v8',flower:'M12 8C3-2 0 11 8 12c-10 9 3 12 4 4 9 10 12-3 4-4 10-9-3-12-4-4ZM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4',moon:'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11',sun:'M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',bluetooth:'M7 7l10 10-5 5V2l5 5L7 17',lock:'M6 10h12v11H6ZM8 10V6a4 4 0 0 1 8 0v4',plus:'M12 4v16M4 12h16'};return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.room}"/></svg>`};
function applyAppearance(){document.body.classList.toggle('dark',state.theme==='dark');document.body.classList.toggle('feminine',String(users[state.user]?.gender).trim().toLowerCase()==='female');document.documentElement.style.colorScheme=state.theme==='dark'?'dark':'light'}
async function toggleUserTheme(){
 const id=state.user,previous=state.theme,theme=previous==='dark'?'light':'dark';
 state.theme=theme;applyAppearance();
 if(!id)return;
 users[id].theme=theme;localStorage.setItem('smartspace-theme-'+id,theme);
 try{await request('set_theme',{theme});if(state.user===id){state.theme=theme;users[id].theme=theme;applyAppearance()}}catch(error){
  users[id].theme=previous;localStorage.setItem('smartspace-theme-'+id,previous);
  if(state.user===id){state.theme=previous;applyAppearance();modal('Theme not saved',`<p>${escapeText(error.message)}</p>`)}
 }
}
function header(){return `<header><button class="brand" data-action="home" aria-label="Choose room">${uiIcon(document.body.classList.contains('feminine')?'flower':'room')}<span>SmartSpace <small>Spatial studio</small></span></button><div class="header-actions">${state.user?`<button class="text-btn" data-action="rooms">Rooms</button><span class="connected-user">${uiIcon('bluetooth')}${escapeText(users[state.user]?.name)}</span><button class="text-btn" data-action="sign-out">Sign out</button>`:''}<button class="icon-btn" data-action="theme" aria-label="Switch color theme">${uiIcon(state.theme==='dark'?'sun':'moon')}</button></div></header>`}
function footer(){return ''}
function render(){const restoring=!!localStorage.getItem('smartspace-session')&&!state.signedOut&&(state.page==='restoring'||!state.user);if(restoring){renderRestoringStudio();return}applyAppearance();if(state.page==='rooms-empty'&&state.user){app.innerHTML=header()+`<main class="entry"><section class="entry-copy"><h1>Your next room.</h1><p>Your session is still open.</p></section><section class="entry-access"><h2>Create a room</h2>${newRoomForm()}</section></main>`;return}app.innerHTML=header()+`<main class="entry"><section class="entry-copy">${uiIcon('room')}<h1>Rearrange<br>the room.<br><em>With your hands.</em></h1><p>Your own 3D space. Two hands. Endless possibilities.</p></section><section class="entry-access"><div class="bluetooth-search-icon">${uiIcon('bluetooth')}</div><h2>${restoring?'Opening your room':'Finding your device'}</h2><p>${restoring?'Restoring your saved workspace.':'Your studio opens automatically when a registered Bluetooth device is found.'}</p><p id="bluetooth-status" role="status" aria-live="polite">${restoring?'Restoring your session...':'Searching for nearby devices...'}</p>${!restoring?'<p class="subtle">Keep Bluetooth on and your device discoverable.</p>':''}<p id="entry-error" role="alert"></p></section></main>`}
function renderRestoringStudio(){
 let cache={},preview=null;
 try{cache=JSON.parse(localStorage.getItem('smartspace-shell')||'{}')||{};preview=JSON.parse(localStorage.getItem('smartspace-room-preview-'+(cache.user?.id||localStorage.getItem('smartspace-user')))||'null')}catch{}
 const id=cache.user?.id||localStorage.getItem('smartspace-user');
 if(id){state.user=String(id);users[state.user]={id:state.user,name:cache.user?.name||'Workspace',gender:cache.user?.gender||'',projects:[]}}
 state.theme=localStorage.getItem('smartspace-theme-'+state.user)||'light';
 state.page='restoring';document.body.classList.add('studio-open');applyAppearance();document.title=(cache.project?.name||'Your room')+' - SmartSpace Studio';
 const image=preview?.projectId===cache.project?.id&&typeof preview?.image==='string'&&preview.image.startsWith('data:image/jpeg;base64,')?preview.image:null;
 app.innerHTML=header()+`<main class="studio restore-studio" aria-busy="true"><div class="studio-toolbar"><div class="project-heading"><div><span class="studio-kicker">Room studio</span><h1>${escapeText(cache.project?.name||'Your room')}</h1></div></div><div class="studio-save"><span role="status">Restoring room...</span><button class="text-btn" data-action="retry">Retry connection</button><button class="btn" disabled>Save layout</button></div></div><div id="entry-error" class="studio-error restore-error" role="alert"></div><div id="studio-content"><div class="studio-layout"><aside class="camera-rail restore-camera"><strong>Camera</strong><div class="restore-camera-frame"></div><p>Camera resumes with your room.</p></aside><section class="room-workspace"><div class="edit-toolbar"><div class="tool-group">${['Move','Rotate','Resize','Undo','Redo'].map(text=>`<button class="tool-button" disabled>${text}</button>`).join('')}</div></div><div class="viewport restore-viewport">${image?`<img class="restore-room-preview" src="${escapeText(image)}" alt="Last view of your room">`:''}<span class="viewport-note" role="status">Restoring your room...</span></div><div class="selection-bar"><strong>Your layout is being restored</strong></div></section><aside class="studio-side restore-sidebar"><div class="side-tabs"><button disabled>My room</button><button disabled>Add furniture</button></div><div class="restore-placeholder"></div><div class="restore-placeholder"></div><div class="restore-placeholder"></div></aside></div></div></main>`;
}
function navigate(){render()}
function modal(title,html){document.querySelector('#dialog-title').textContent=title;document.querySelector('#dialog-body').innerHTML=html;const dialog=document.querySelector('#help');if(!dialog.open)dialog.showModal()}
function newRoomForm(){return `<form id="create-project"><p>New rooms are named automatically: Room 1, Room 2, ...</p><button class="btn" type="submit">${uiIcon('plus')}Create room</button><p id="create-error" role="alert"></p></form>`}
function showRooms(){const u=users[state.user];if(!u)return;modal('Your rooms',`<div class="room-list-scroll"><button data-scroll-target=".room-picker" data-direction="-1">Previous rooms</button><button data-scroll-target=".room-picker" data-direction="1">More rooms</button></div><div class="room-picker">${u.projects.map(p=>`<div class="room-picker-row"><button class="account" data-open-room="${p.id}">${uiIcon('room')}<span>${escapeText(p.name)}<small>${p.pieces} pieces &middot; ${p.date}</small></span></button><button type="button" class="room-delete" data-delete-project="${p.id}" aria-label="Delete ${escapeText(p.name)}">Delete</button></div>`).join('')||'<p>No rooms yet. Create a room to start arranging.</p>'}</div>${newRoomForm()}`)}
document.querySelector('.close').onclick=()=>document.querySelector('#help').close();
document.addEventListener('click',async e=>{const button=e.target.closest('button');if(!button)return;const action=button.dataset.action;if(button.dataset.deleteProject){await deleteRoom(Number(button.dataset.deleteProject));return}if(button.dataset.openRoom){document.querySelector('#help').close();window.openStudio(Number(button.dataset.openRoom));return}if(action==='theme'){await toggleUserTheme();if(state.page!=='studio')render();return}if(action==='retry')initialize({signIn:true});if(action==='scan')scanBluetooth();if(action==='rooms'||action==='home'){if(state.user){try{setProfile(await request('workspace'));showRooms()}catch(error){modal('Connection error',`<p>${escapeText(error.message)}</p>`)}}}if(action==='sign-out')await signOut()});

render();

// In-page confirmations can be selected by hand; native confirm cannot.
window.handConfirm=message=>new Promise(resolve=>{
 modal('Confirm change',`<p>${escapeText(message)}</p><div class="confirm-actions"><button class="btn" id="hand-confirm-yes">Continue</button><button class="btn secondary" id="hand-confirm-no">Cancel</button></div>`);
 const dialog=document.querySelector('#help');let choice=false;
 dialog.addEventListener('close',()=>resolve(choice),{once:true});
 document.querySelector('#hand-confirm-yes').onclick=()=>{choice=true;dialog.close()};
 document.querySelector('#hand-confirm-no').onclick=()=>dialog.close();
});
