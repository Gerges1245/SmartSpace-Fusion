// Bluetooth is needed for first sign-in only. An opaque server session survives refresh.
let socket,opening,serial=0,detectedDevice=null,sessionProfile=null;
let sessionToken=localStorage.getItem('smartspace-session');
const pending=new Map();
function sendRequest(action,data={}){
 const request_id=++serial;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(request_id);reject(new Error('Request timed out. Check the local server and try again.'))},60000);
  pending.set(request_id,{resolve,reject,timer});
  try{socket.send(JSON.stringify({action,request_id,...data}))}catch(error){clearTimeout(timer);pending.delete(request_id);reject(error)}
 });
}
function forgetSession(){sessionToken=null;sessionProfile=null;detectedDevice=null;localStorage.removeItem('smartspace-session');localStorage.removeItem('smartspace-user');localStorage.removeItem('smartspace-shell')}
function showSignedOut(){
 window.studioCaptureState?.();window.studioDispose?.();stopBluetoothDetection();
 state.user=null;state.theme='light';state.page='connect';state.signedOut=false;localStorage.removeItem('smartspace-signed-out');document.body.classList.remove('studio-open','tools-open');render();startBluetoothDetection();
}
function connectSocket(){
 if(socket?.readyState===WebSocket.OPEN&&!opening)return Promise.resolve();
 if(opening)return opening;
 opening=new Promise((resolve,reject)=>{
  const instance=new WebSocket(`ws://${location.host}/ws`);socket=instance;
  instance.onmessage=e=>{
   if(socket!==instance)return;let msg;try{msg=JSON.parse(e.data)}catch{return}
   const item=pending.get(msg.request_id);if(!item)return;clearTimeout(item.timer);pending.delete(msg.request_id);
   if(msg.ok)item.resolve(msg.data);else{const error=new Error(msg.error);error.code=msg.error_code;item.reject(error)}
  };
  instance.onopen=async()=>{
   if(socket!==instance)return;
   try{
    if(sessionToken){
     try{sessionProfile=await sendRequest('resume_session',{token:sessionToken});setProfile(sessionProfile);await window.studioRefreshAssets?.(sendRequest)}
     catch(error){if(error.code!=='SESSION_INVALID')throw error;forgetSession();localStorage.removeItem('smartspace-signed-out');showSignedOut()}
    }
    resolve();
   }catch(error){instance.close();reject(error)}finally{opening=null}
  };
  instance.onerror=()=>{if(socket!==instance)return;reject(new Error('Cannot connect to Python. Keep the server running.'));opening=null};
  instance.onclose=()=>{
   if(socket!==instance)return;opening=null;reject(new Error('Server connection closed. Sign in with Bluetooth again.'));
   for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Connection closed. Your edits are still here; try again.'))}pending.clear();
   if(sessionToken){forgetSession();showSignedOut()}
  };
 });return opening;
}
async function request(action,data={}){
 await connectSocket();
 try{
  const result=await sendRequest(action,data);
  if(action==='select'&&result.session_token){sessionToken=result.session_token;sessionProfile=result;localStorage.setItem('smartspace-session',sessionToken);localStorage.removeItem('smartspace-signed-out');state.signedOut=false}
  if(action==='set_theme'&&sessionProfile){sessionProfile={...sessionProfile,theme:result.theme}}
  return result;
 }catch(error){if(error.code==='SESSION_INVALID'){forgetSession();localStorage.removeItem('smartspace-signed-out');showSignedOut()}throw error}
}
function clearSession(){detectedDevice=null;socket?.close();socket=null;opening=null}
function setProfile(profile){const {session_token,...publicProfile}=profile;sessionProfile=publicProfile;users[String(profile.id)]={...publicProfile,id:String(profile.id)};state.user=String(profile.id);stopBluetoothDetection();state.theme=profile.theme==='dark'?'dark':'light';localStorage.setItem('smartspace-theme-'+state.user,state.theme);localStorage.setItem('smartspace-user',state.user);try{const id=Number(localStorage.getItem('smartspace-project-'+state.user));const project=profile.projects?.find(p=>p.id===id)||profile.projects?.[0];localStorage.setItem('smartspace-shell',JSON.stringify({user:{id:state.user,name:profile.name,gender:profile.gender},project:project?{id:project.id,name:project.name}:null}))}catch{}applyAppearance()}
async function signOut(){
 if(window.studioCanSwitch&&!window.studioCanSwitch())return;
 if(window.studioFlush&&!(await window.studioFlush()))return;
 try{await request('sign_out');window.studioDispose?.({discard:true});localStorage.removeItem('smartspace-signed-out');forgetSession();clearSession();showSignedOut()}
 catch(error){if(error.code!=='SESSION_INVALID')modal('Could not sign out',`<p>${escapeText(error.message)}</p>`)}
}
async function initialize({signIn=false}={}){
 localStorage.removeItem('smartspace-signed-out');state.signedOut=false;
 try{
  await connectSocket();
  if(sessionProfile){
   setProfile(sessionProfile);const remembered=Number(localStorage.getItem('smartspace-project-'+state.user));
   const project=sessionProfile.projects.find(p=>p.id===remembered)||sessionProfile.projects[0];
   if(project)await window.openStudio(project.id);else{state.page='rooms-empty';render();showRooms()}return;
  }
  startBluetoothDetection();
 }catch(error){const el=document.querySelector('#entry-error');if(el)el.textContent=error.message;else modal('Connection error',`<p>${escapeText(error.message)}</p>`);if(!state.user)startBluetoothDetection()}
}
document.addEventListener('submit',async e=>{
 if(e.target.id!=='create-project')return;e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
 try{const profile=await request('create_project');setProfile(profile);document.querySelector('#help').close();await window.openStudio(profile.created_project_id)}
 catch(error){const el=e.target.querySelector('#create-error');if(el)el.textContent=error.message}finally{button.disabled=false}
});
window.addEventListener('load',()=>initialize());
window.addEventListener('storage',event=>{if(event.key==='smartspace-session'&&!event.newValue&&sessionToken){forgetSession();clearSession();showSignedOut()}});

async function deleteRoom(projectId){
 const project=users[state.user]?.projects.find(p=>p.id===projectId);if(!project)return;
 const confirmed=await window.handConfirm('Delete "'+project.name+'" and its saved versions? This cannot be undone.');
 if(!confirmed){showRooms();return}
 try{
  const profile=await request('delete_project',{project_id:projectId});setProfile(profile);
  await window.studioAfterProjectDelete?.(projectId,profile);
  for(const kind of ['draft','view'])localStorage.removeItem('smartspace-'+kind+'-'+state.user+'-'+projectId);
  if(Number(localStorage.getItem('smartspace-project-'+state.user))===projectId)localStorage.removeItem('smartspace-project-'+state.user);
  try{const preview=JSON.parse(localStorage.getItem('smartspace-room-preview-'+state.user)||'null');if(preview?.projectId===projectId)localStorage.removeItem('smartspace-room-preview-'+state.user)}catch{}
  showRooms();
 }catch(error){modal('Could not delete room',`<p>${escapeText(error.message)}</p><button class="btn" data-action="rooms">Back to rooms</button>`)}
}
