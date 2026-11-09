// Automatic Bluetooth entry. Only one scan/retry loop runs at a time.
let detectionTimer=null,detectionRunning=false,detectionEpoch=0;
function bluetoothStatus(message,error=''){const status=document.querySelector('#bluetooth-status');if(status)status.textContent=message;const alert=document.querySelector('#entry-error');if(alert)alert.textContent=error}
function stopBluetoothDetection(){++detectionEpoch;clearTimeout(detectionTimer);detectionTimer=null}
function startBluetoothDetection(){if(state.user)return;stopBluetoothDetection();const epoch=detectionEpoch;if(detectionRunning){detectionTimer=setTimeout(()=>{if(epoch===detectionEpoch)startBluetoothDetection()},500);return}scanBluetooth(epoch)}
async function scanBluetooth(epoch=detectionEpoch){
 if(detectionRunning||state.user||epoch!==detectionEpoch)return;
 detectionRunning=true;const button=document.querySelector('[data-action="retry"]');if(button)button.disabled=true;
 bluetoothStatus('Searching for nearby devices...');
 try{
  const result=await request('scan');if(epoch!==detectionEpoch||state.user)return;
  const match=result.accounts[0];
  if(!match){bluetoothStatus(result.devices.length?'Nearby devices found, but none matches a registered address. Check your phone Bluetooth address.':'No Bluetooth devices found. Open Bluetooth settings on your phone and leave it discoverable. Searching again shortly...');return}
  bluetoothStatus('Found '+match.name+'. Opening your studio...');
  const profile=await request('select',{address:match.address});if(epoch!==detectionEpoch)return;
  detectedDevice={address:match.address,user_id:profile.id};setProfile(profile);stopBluetoothDetection();
  if(profile.projects.length)await window.openStudio(profile.projects[0].id);
  else{const created=await request('create_project');setProfile(created);await window.openStudio(created.created_project_id)}
  stopBluetoothDetection();
 }catch(error){if(epoch===detectionEpoch){if(state.page!=='studio'&&state.user){clearSession();state.user=null;render()}bluetoothStatus('Bluetooth search will retry automatically.',error.message)}}
 finally{detectionRunning=false;if(button)button.disabled=false;if(!state.user&&epoch===detectionEpoch)detectionTimer=setTimeout(()=>scanBluetooth(epoch),500)}
}
window.addEventListener('pagehide',stopBluetoothDetection);
