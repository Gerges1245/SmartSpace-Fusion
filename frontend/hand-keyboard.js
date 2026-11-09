// All editable fields are usable by dwell, without a physical keyboard.
let keyboard=null;
export function openHandKeyboard(input){
 keyboard?.remove();
 const numeric=input.type==='number';
 const root=document.createElement('section');root.className='hand-keyboard';keyboard=root;
 root.setAttribute('aria-label','Hand keyboard');
 const title=document.createElement('strong');title.textContent=input.getAttribute('aria-label')||input.placeholder||'Type with your hand';root.append(title);
 const value=document.createElement('output');value.textContent=input.value||' ';root.append(value);
 const keys=document.createElement('div');keys.className='hand-keys';root.append(keys);
 const commit=()=>{input.dispatchEvent(new Event('change',{bubbles:true}));root.remove();if(keyboard===root)keyboard=null};
 for(const key of [...(numeric?'1234567890.-':'qwertyuiopasdfghjklzxcvbnm1234567890'),...(numeric?[]:['Space']), 'Backspace','Clear','Done']){
  const button=document.createElement('button');button.type='button';button.textContent=key;button.dataset.handKey=key;
  button.addEventListener('click',()=>{
   if(!input.isConnected){root.remove();return}
   if(key==='Done'){commit();return}
   let next=key==='Clear'?'':key==='Backspace'?input.value.slice(0,-1):input.value+(key==='Space'?' ':key);
   if(input.maxLength>0)next=next.slice(0,input.maxLength);
   // Number inputs reject incomplete negative/decimal values; keep an edit buffer.
   root.editValue=key==='Clear'?'':key==='Backspace'?(root.editValue??input.value).slice(0,-1):(root.editValue??input.value)+(key==='Space'?' ':key);
   if(numeric)next=root.editValue;
   if(!numeric||next===''||Number.isFinite(Number(next)))input.value=next;
   value.textContent=next||' ';input.dispatchEvent(new Event('input',{bubbles:true}));
  });keys.append(button);
 }
 (input.closest('dialog[open]')||document.body).append(root);
}
