import assert from 'node:assert/strict';
// Verify cancelling a permission request releases any stream that arrives later.
const handlers={};const button={dataset:{},addEventListener(type,callback){handlers[type]=callback},setAttribute(){}};
globalThis.document={querySelector(selector){if(selector==='#hand-camera-toggle')return button;return null},addEventListener(){}};
globalThis.window={addEventListener(){}};globalThis.cancelAnimationFrame=()=>{};
let resolvePermission,permissionRequests=0;Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia(){permissionRequests++;return new Promise(resolve=>resolvePermission=resolve)}}},configurable:true});
const {mountHandCursor,stopHandCursor,handCursorMarkup,clickWebsitePoint}=await import('../frontend/hand-cursor.js');
assert.ok(handCursorMarkup().includes('Website pointer only'));
const pending=mountHandCursor();assert.equal(permissionRequests,1,'Camera starts on mounting without a click');const duplicate=mountHandCursor();assert.equal(permissionRequests,1,'Do not open the same camera twice');stopHandCursor();let stopped=0;resolvePermission({getTracks:()=>[{stop(){stopped++}}]});await Promise.all([pending,duplicate]);assert.equal(stopped,1);
console.log('Camera auto-start, duplicate start guard and cancellation passed.');

let clicks=0;const control={focus(){},click(){clicks++}};document.elementFromPoint=()=>({closest(selector){return selector.startsWith('[disabled]')?null:control}});assert.equal(clickWebsitePoint(50,50),true);assert.equal(clicks,1);document.elementFromPoint=()=>({closest(){return {}}});assert.equal(clickWebsitePoint(50,50),false);console.log('Website activation and disabled-control guard passed.');


let preferredClicks=0;
const preferred={isConnected:true,tagName:'BUTTON',focus(){},click(){preferredClicks++},closest(selector){return selector.startsWith('[disabled]')?null:this}};
document.elementFromPoint=()=>null;
assert.equal(clickWebsitePoint(0,0,preferred),true);assert.equal(preferredClicks,1,'activate the known dwell target without unreliable coordinate re-hit-testing');
console.log('Known connected hand target activates directly without a second coordinate hit test.');
