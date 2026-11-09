const LABELS=['Bye Bye','Other'];
export function wavePalm(hand,aspect=4/3){
 if(!hand?.landmarks||hand.landmarks.length!==21)return null;
 const lm=hand.landmarks,ids=[0,5,9,13,17]; // [mirrored palm x, palm y, aspect-corrected wrist->middle-MCP roll], as in tools/train_bye_from_videos.py
 return [1-ids.reduce((sum,i)=>sum+lm[i].x,0)/5,ids.reduce((sum,i)=>sum+lm[i].y,0)/5,Math.atan2(aspect*(lm[0].x-lm[9].x),lm[0].y-lm[9].y)];
}
export class ByeByeTheme {
 constructor({fetchFn=(...args)=>fetch(...args),now=()=>performance.now(),toggle=()=>document.querySelector('[data-action="theme"]')?.click()}={}){
  this.fetch=fetchFn;this.now=now;this.toggle=toggle;this.stopped=false;this.ready=false;this.status='loading';this.buffers=new Map();this.pending=false;this.lastRequest=-Infinity;this.checking=false;this.checkedAt=-Infinity;this.resultUntil=0;this.latched=false;this.neutralAt=null;this.lastToggle=-Infinity;this.recording=null;this.message='Record five Bye Bye and five Other samples. Each sample takes 3 seconds.';
  try{this.samples=JSON.parse(localStorage.getItem('smartspace-wave-training')||'null')}catch{}
  if(!this.samples||!LABELS.every(label=>Array.isArray(this.samples[label])))this.samples={'Bye Bye':[],'Other':[]};
  this.onClick=event=>{const button=event.target.closest('[data-wave-setup],[data-wave-record],[data-wave-save],[data-wave-reset],[data-wave-close]');if(!button||button.disabled)return;
   if(button.hasAttribute('data-wave-setup'))this.openSetup();
   else if(button.dataset.waveRecord)this.startRecording(button.dataset.waveRecord);
   else if(button.hasAttribute('data-wave-save'))void this.saveTraining();
   else if(button.hasAttribute('data-wave-reset')){this.samples={'Bye Bye':[],'Other':[]};this.store();this.message='New recording set. Previously saved recognition stays available until you save new samples.';this.renderTraining()}
   else document.querySelector('#help')?.close();
  };
  document.addEventListener('click',this.onClick);void this.checkStatus();
 }
 async json(path,body){const response=await this.fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw Error(data.error||'Wave request failed.');return data}
 async checkStatus(){
  if(this.checking||this.stopped)return;this.checking=true;this.checkedAt=this.now();
  try{const data=await this.json('/wave/status');if(!this.stopped){this.ready=data.ready;this.status=data.ready?'ready':'record samples'}}catch{if(!this.stopped)this.status='server unavailable'}finally{this.checking=false}
 }
 store(){try{localStorage.setItem('smartspace-wave-training',JSON.stringify(this.samples))}catch{}}
 openSetup(){
  const dialog=document.querySelector('#help');if(!dialog)return;
  document.querySelector('#dialog-title').textContent='Bye Bye - theme gesture';
  document.querySelector('#dialog-body').innerHTML=`<section aria-label="Record wave samples"><p>Use one hand. Keep it visible inside the camera guide. You have 2 seconds to get ready, then 3 seconds per sample.</p><p><strong>Bye Bye:</strong> open your hand and wave left-right several times.</p><p><strong>Other:</strong> make ordinary movements, such as one sweep or moving up/down, without waving.</p><p id="wave-training-status" role="status" aria-live="polite"></p><div class="confirm-actions"><button class="btn" data-wave-record="Bye Bye">Record Bye Bye (<span id="wave-count-bye">0</span>/5)</button><button class="btn secondary" data-wave-record="Other">Record Other (<span id="wave-count-other">0</span>/5)</button></div><div class="confirm-actions"><button class="btn" data-wave-save>Save samples</button><button class="btn secondary" data-wave-reset>Start new set</button><button class="btn secondary" data-wave-close>Done</button></div></section>`;
  if(!dialog.open)dialog.showModal();this.renderTraining();
 }
 renderTraining(){
  const status=document.querySelector('#wave-training-status');if(!status)return;
  if(status.textContent!==this.message)status.textContent=this.message;
  document.querySelector('#wave-count-bye').textContent=String(this.samples['Bye Bye'].length);
  document.querySelector('#wave-count-other').textContent=String(this.samples.Other.length);
  for(const button of document.querySelectorAll('[data-wave-record]'))button.disabled=!!this.recording||this.pending||this.samples[button.dataset.waveRecord].length>=5;
  const save=document.querySelector('[data-wave-save]');if(save)save.disabled=!!this.recording||this.pending||!LABELS.every(label=>this.samples[label].length>=5);
 }
 startRecording(label){
  if(!LABELS.includes(label)||this.recording||this.pending||this.samples[label].length>=5)return;
  this.recording={label,start:this.now()+2000,id:null,points:[]};this.buffers.clear();this.message='Get ready...';this.renderTraining();
 }
 recordFrame(hands,t){
  const record=this.recording;if(t<record.start)return;
  if(!record.id)record.id=(hands.find(h=>h.id===this.primaryId)||hands[0])?.id;
  const point=wavePalm(hands.find(h=>h.id===record.id),this.aspect);
  if(point)record.points.push(point);
  this.message=`Recording ${record.label}: ${Math.max(0,(record.start+3000-t)/1000).toFixed(1)}s`;this.renderTraining();
  if(t-record.start<3000)return;
  this.recording=null;
  if(record.points.length<8)this.message='Too few visible frames. Keep one hand visible and record this sample again.';
  else if(Math.max(...[0,1].map(axis=>Math.max(...record.points.map(p=>p[axis]))-Math.min(...record.points.map(p=>p[axis]))))<.0001)this.message='Move your hand while recording, then try this sample again.';
  else{this.samples[record.label].push(record.points);this.store();this.message=`${record.label} saved (${this.samples[record.label].length}/5).`}
  this.renderTraining();if(LABELS.every(label=>this.samples[label].length>=5))void this.saveTraining();
 }
 async saveTraining(){
  if(this.pending||!LABELS.every(label=>this.samples[label].length>=5))return;
  this.pending=true;this.message='Saving recorded samples...';this.renderTraining();
  try{const data=await this.json('/wave/templates',{samples:this.samples});if(!this.stopped){this.ready=data.ready;this.status='ready';this.message='Ready. Close this panel, open your hand and wave for 2-3 seconds to switch the theme.'}}
  catch(error){if(!this.stopped)this.message=error.message}finally{this.pending=false;if(!this.stopped)this.renderTraining()}
 }
 update(hands,t=this.now(),{suspended=false,primaryId=null,aspect=4/3}={}){
  if(this.stopped)return;this.primaryId=primaryId;this.aspect=aspect;
  if(this.recording){this.recordFrame(hands,t);return}
  if(t-this.checkedAt>5000)void this.checkStatus();
  const isOpen=h=>h.indexExtended&&h.middleExtended&&h.ringExtended&&h.pinkyExtended;
  const eligible=suspended?[]:hands.filter(h=>wavePalm(h)&&(isOpen(h)||t-(this.buffers.get(h.id)?.lastOpen??-Infinity)<700));
  if(!eligible.length){for(const [id,b] of this.buffers)if(suspended||t-b.last>700)this.buffers.delete(id);this.neutralAt??=t;if(t-this.neutralAt>=700)this.latched=false;return}
  this.neutralAt=null;
  if(!this.ready||this.latched||t-this.lastToggle<4000)return;
  for(const [id,buffer] of this.buffers)if(!eligible.some(h=>h.id===id)||t-buffer.last>700)this.buffers.delete(id);
  for(const hand of eligible){
   let buffer=this.buffers.get(hand.id);if(!buffer){buffer={start:t,last:t,lastOpen:t,points:[],times:[]};this.buffers.set(hand.id,buffer)}
   buffer.last=t;if(isOpen(hand))buffer.lastOpen=t;buffer.points.push(wavePalm(hand,aspect));buffer.times.push(t);
   while(buffer.times.length&&(t-buffer.times[0]>2500||buffer.times.length>240)){buffer.times.shift();buffer.points.shift()}
   const duration=t-buffer.times[0];if(t>=this.resultUntil)this.status='wave '+Math.min(1.2,duration/1000).toFixed(1)+'/1.2s';
   if(duration>=1200&&buffer.points.length>=8&&!this.pending&&t-this.lastRequest>=700){
    this.lastRequest=t;void this.recognize(buffer.points.map(point=>[...point]),t);
   }
  }
 }
 async recognize(points,t){
  this.pending=true;
  try{const result=await this.json('/wave/recognize',{points});this.resultUntil=this.now()+1500;if(!this.stopped&&!result.toggle)this.status=result.ready?`not matched (${result.name||'none'} ${Number(result.score||0).toFixed(2)})`:'record samples';if(!this.stopped&&result.toggle){this.latched=true;this.lastToggle=this.now();this.status='theme switched';this.buffers.clear();this.toggle()}}
  catch{if(!this.stopped)this.status='recognition unavailable'}finally{this.pending=false}
 }
 stop(){this.stopped=true;this.recording=null;this.buffers.clear();document.removeEventListener('click',this.onClick)}
}
