import {handCursorMarkup,mountHandCursor,stopHandCursor} from './hand-cursor.js';
// Keep gesture navigation available on Bluetooth entry and after logout as well.
// Studio mounts its own camera rail. Replacing its video releases the old stream.
function syncCamera(){
 let video=document.querySelector('#hand-video');
 const entry=document.querySelector('main.entry');
 if(entry&&!video){
  stopHandCursor();
  const rail=document.createElement('aside');rail.className='entry-camera camera-rail';rail.innerHTML=handCursorMarkup();entry.prepend(rail);video=rail.querySelector('video');
  void mountHandCursor();
 }
}
new MutationObserver(syncCamera).observe(document.querySelector('#app'),{childList:true,subtree:true});
syncCamera();
// Virtual controls inside a modal must be able to scroll long room lists too.
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-scroll-target]');if(!button)return;
 document.querySelector(button.dataset.scrollTarget)?.scrollBy({top:Number(button.dataset.direction)*180,behavior:'smooth'});
});
