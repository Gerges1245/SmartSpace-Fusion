// Mouse selection and keyboard shortcuts. No Bluetooth or camera tracking here.
export function mountMouseControls(canvas,{gizmo,busy,hitTest,select}){
 let down=null,wasHandle=false;
 const onDown=e=>{down=[e.clientX,e.clientY];wasHandle=!!gizmo.axis};
 const onUp=e=>{if(busy()||wasHandle||gizmo.axis||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;select(hitTest(e.clientX,e.clientY));down=null};
 const cancel=()=>{down=null};
 canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointerup',onUp);canvas.addEventListener('pointercancel',cancel);
 return ()=>{canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointerup',onUp);canvas.removeEventListener('pointercancel',cancel)};
}
export function mountKeyboardControls({active,busy,dirty,save,dispatch,switchPanel}){
 const keydown=e=>{if(!active()||document.querySelector('dialog[open]')||e.target.closest('input,select,textarea,[contenteditable="true"]'))return;
 if(e.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();switchPanel();return}
 let cmd;const key=e.key.toLowerCase();
 if((e.ctrlKey||e.metaKey)&&key==='s'){e.preventDefault();if(!busy()&&dirty())save();return}
 if(e.ctrlKey||e.metaKey){if(key==='z')cmd=e.shiftKey?'redo':'undo';else if(key==='y')cmd='redo'}else cmd={ArrowLeft:'move:x:-1',ArrowRight:'move:x:1',ArrowUp:'move:z:-1',ArrowDown:'move:z:1',Delete:'delete',w:'translate',e:'rotate',r:'scale',f:'focus'}[e.key]||{w:'translate',e:'rotate',r:'scale',f:'focus',l:'panel:library',t:'panel:objects'}[key];
 if(cmd){e.preventDefault();dispatch(cmd)}};
 document.addEventListener('keydown',keydown);return ()=>document.removeEventListener('keydown',keydown);
}
