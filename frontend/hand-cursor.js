import {ByeByeTheme} from './bye-bye-theme.js';
import {HandDetector} from './reference/vision.js';
import {HandControls} from './hand-controls.js';
import {gestureGuideMarkup,gestureShortcutsMarkup} from './gesture-guide.js';
import {openHandKeyboard} from './hand-keyboard.js';

let wave=null,stream=null,video=null,detector=null,engine=null,cursor=null,processing=null;
let active=false,starting=false,epoch=0,frameHandle=0,raf=0,selectMenu=null,resumeOnVisible=false,lastFeedback=0;
export function handCursorMarkup(){return `<section class="camera-dock hand-camera" aria-label="Hand controls"><div class="hand-camera-heading"><div><strong>Hand controls</strong><span>Keep hands inside camera view</span></div><button class="camera-minimize" id="hand-camera-minimize" aria-label="Minimize camera" aria-expanded="true">&minus;</button><button class="camera-toggle" id="hand-camera-toggle" type="button" aria-pressed="false">Start camera</button></div><div class="hand-camera-preview" id="hand-camera-preview" hidden><video id="hand-video" autoplay playsinline muted></video><canvas id="hand-overlay" width="320" height="240" aria-hidden="true" style="transform:none"></canvas></div><p class="hand-camera-status" id="hand-camera-status" role="status" aria-live="polite">Camera off. Website pointer only.</p><button type="button" class="btn secondary gesture-guide-open-btn" data-gesture-guide="all" aria-haspopup="dialog" style="width:100%;margin-top:8px;font-size:12px;min-height:38px;padding:6px 10px;display:flex;align-items:center;justify-content:center;gap:8px">✋ Hand Gestures Guide</button></section>`}
function feedback(text){const el=document.querySelector('#hand-camera-status');if(el&&el.textContent!==text)el.textContent=text}
function buttonState(){const setup=document.querySelector('#wave-setup-button');if(setup)setup.disabled=!active;const b=document.querySelector('#hand-camera-toggle');if(b){b.textContent=active?'Stop camera':starting?'Cancel':'Start camera';b.dataset.active=String(active);b.setAttribute('aria-pressed',String(active))}}
export function mountHandCursor({autoStart=true}={}){
 const toggle=document.querySelector('#hand-camera-toggle');if(toggle&&!toggle.dataset.bound){toggle.dataset.bound='true';toggle.addEventListener('click',()=>active||starting?stopHandCursor():start())}
 document.querySelector('#hand-camera-minimize')?.addEventListener('click',e=>{const minimized=e.currentTarget.closest('.hand-camera').classList.toggle('is-minimized');e.currentTarget.setAttribute('aria-expanded',String(!minimized));e.currentTarget.innerHTML=minimized?'+':'&minus;'});
 buttonState();if(autoStart&&!active&&!starting){if(document.hidden){resumeOnVisible=true;return Promise.resolve()}return start()}return Promise.resolve();
}
export function stopHandCursor(message='Camera off. Website pointer only.'){
 ++epoch;active=false;starting=false;resumeOnVisible=false;cancelAnimationFrame(raf);if(video?.cancelVideoFrameCallback&&frameHandle)video.cancelVideoFrameCallback(frameHandle);
 wave?.stop();wave=null;engine?.stop();cursor=null;engine=null;
 const old=detector,pending=processing;detector=null;processing=null;if(old)Promise.resolve(pending).catch(()=>{}).then(()=>old.hands?.close()).catch(()=>{});
 stream?.getTracks().forEach(t=>t.stop());stream=null;if(video){video.srcObject=null;video=null}selectMenu?.remove();selectMenu=null;
 const preview=document.querySelector('#hand-camera-preview');if(preview)preview.hidden=true;buttonState();feedback(message);
}
async function start(){
 if(active||starting)return;resumeOnVisible=false;const token=++epoch;starting=true;buttonState();feedback('Waiting for camera permission...');
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Open the local SmartSpace page to use the camera.');
  const candidate=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user',frameRate:{ideal:30}}});
  if(token!==epoch){candidate.getTracks().forEach(t=>t.stop());return}stream=candidate;video=document.querySelector('#hand-video');if(!video)throw new Error('Camera preview is unavailable.');video.srcObject=stream;await video.play();if(token!==epoch)return;
  if(typeof window.Hands==='undefined')throw new Error('The MediaPipe Hands library could not load. Refresh the page.');
  detector=new HandDetector(240,180);engine=new HandControls({api:()=>window.smartspaceControls,click:clickWebsitePoint});cursor=engine;wave=new ByeByeTheme();active=true;starting=false;document.querySelector('#hand-camera-preview').hidden=false;buttonState();feedback('Loading MediaPipe Hands...');
  stream.getVideoTracks()[0]?.addEventListener('ended',()=>{if(token===epoch)stopHandCursor('Camera disconnected. Start again to reconnect.')});
  const onFrame=async()=>{
   if(token!==epoch||!active)return;
   const localVideo=video,localDetector=detector,localEngine=engine;
   try{
   if(!localVideo.paused&&!localVideo.ended&&localVideo.readyState>=2){processing=localDetector.send(localVideo);await processing;if(token!==epoch||!active)return;processing=null}
   // Same ordered send -> gesture update -> debug drawing loop as the supplied app.
   localEngine.update(localDetector.result,performance.now());
   if(token!==epoch||!active)return;
   wave?.update(localDetector.result.present?localDetector.result.hands:[],performance.now(),{primaryId:localEngine.primary,aspect:(localVideo.videoWidth||640)/(localVideo.videoHeight||480),suspended:!!localEngine.owner||!!localEngine.pair||!!document.querySelector('dialog[open]')});
   const canvas=document.querySelector('#hand-overlay');if(canvas){const height=Math.round(320*(localVideo.videoHeight||480)/(localVideo.videoWidth||640));if(canvas.height!==height){canvas.width=320;canvas.height=height}localDetector.drawDebug(canvas.getContext('2d'),canvas.width,canvas.height);}
   if(performance.now()-lastFeedback>250){lastFeedback=performance.now();feedback(`Hands: ${localDetector.result.hands?.length||0}/2 | ${localEngine.pair?'Two-hand '+(localEngine.pair.key.startsWith('orbit')?'rotate':'zoom'):localEngine.pose} | Wave: ${wave?.status||'off'} | ${localDetector.procMs.toFixed(0)}ms`)}
   }catch(error){
    console.warn('Hand frame recovered:',error);
    // Do not let a transient UI/render failure terminate camera processing.
    if(token===epoch&&active){
     try{localEngine.update({present:false,hands:[]},performance.now())}catch{}
     feedback('Tracking recovering... Keep your index finger visible.');
    }
   }finally{
    if(token===epoch&&active){
     processing=null;
     if('requestVideoFrameCallback' in localVideo)frameHandle=localVideo.requestVideoFrameCallback(onFrame);else raf=requestAnimationFrame(onFrame);
    }
   }
  };
  if('requestVideoFrameCallback' in video)frameHandle=video.requestVideoFrameCallback(onFrame);else raf=requestAnimationFrame(onFrame);
 }catch(error){if(token!==epoch)return;stopHandCursor(error.name==='NotAllowedError'?'Camera permission denied. Allow camera access and try again.':error.message)}
}
export function clickWebsitePoint(x,y,preferredControl=null){
 const target=preferredControl?.isConnected?preferredControl:document.elementFromPoint(x,y);if(!target||target.closest('[disabled],[aria-disabled="true"],dialog:not([open])'))return false;
 const control=target.closest('button,a,input,select,summary');
 if(control){
  control.focus({preventScroll:true});
  if(control.tagName==='INPUT'&&['text','search','number','email',''].includes(control.type)){openHandKeyboard(control);return true}
  if(control.tagName==='SELECT'){openHandSelect(control);return true}
  if(control.tagName==='INPUT'&&control.type==='range'){const rect=control.getBoundingClientRect(),min=Number(control.min||0),max=Number(control.max||100),step=Number(control.step||1);control.value=String(Math.max(min,Math.min(max,min+Math.round(((x-rect.left)/rect.width)*(max-min)/step)*step)));control.dispatchEvent(new Event('input',{bubbles:true}));return true}
  control.click();return true;
 }
 if(target.tagName==='CANVAS'){
  if(window.smartspaceControls?.hitTest){const id=window.smartspaceControls.hitTest(x,y);if(id){window.smartspaceControls.select(id);return true}return false}
  const options={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,pointerId:99,pointerType:'mouse',isPrimary:true};
  target.dispatchEvent(new PointerEvent('pointermove',{...options,buttons:0}));
  target.dispatchEvent(new PointerEvent('pointerdown',{...options,buttons:1}));
  target.dispatchEvent(new PointerEvent('pointerup',{...options,buttons:0}));
  target.dispatchEvent(new MouseEvent('click',options));return true;
 }
 return false;
}
function openHandSelect(control){
 selectMenu?.remove();selectMenu=document.createElement('div');selectMenu.className='hand-select-menu';selectMenu.setAttribute('aria-label','Choose '+(control.getAttribute('aria-label')||control.id));
 for(const option of control.options){if(option.disabled)continue;const button=document.createElement('button');button.textContent=option.textContent;button.dataset.handOption=control.id+':'+option.value;button.addEventListener('click',()=>{control.value=option.value;control.dispatchEvent(new Event('change',{bubbles:true}));selectMenu?.remove();selectMenu=null});selectMenu.append(button)}
 const close=document.createElement('button');close.textContent='Close';close.addEventListener('click',()=>{selectMenu?.remove();selectMenu=null});selectMenu.append(close);document.body.append(selectMenu);const rect=control.getBoundingClientRect();selectMenu.style.left=Math.max(8,Math.min(window.innerWidth-240,rect.left))+'px';selectMenu.style.top=Math.max(8,Math.min(window.innerHeight-selectMenu.offsetHeight-8,rect.bottom+5))+'px';
}

document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(active||starting)){e.preventDefault();stopHandCursor()}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(active||starting)){stopHandCursor('Camera paused because this tab is hidden.');resumeOnVisible=true}else if(!document.hidden&&resumeOnVisible&&document.querySelector('#hand-camera-toggle')){resumeOnVisible=false;void start()}});
window.addEventListener('pagehide',()=>stopHandCursor());
document.addEventListener('click',e=>{
 const button=e.target.closest('[data-hand-scroll]');
 if(button)document.querySelector('#inspector-content')?.scrollBy({top:Number(button.dataset.handScroll)*260,behavior:'smooth'});
 const dialogScroll=e.target.closest('[data-hand-dialog-scroll]');
 if(dialogScroll){
  const target=document.querySelector('#gestures-grid')||document.querySelector('.gestures-visual-grid')||document.querySelector('#help');
  if(target)target.scrollBy({top:Number(dialogScroll.dataset.handDialogScroll)*260,behavior:'smooth'});
 }
});
