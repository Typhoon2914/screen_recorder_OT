// One recoverable finalized recording. Live chunks remain in memory for now.
function database() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('screen-recorder-experiment',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('pending');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
export async function vault(action,value) {
  const db=await database();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('pending',action==='get'?'readonly':'readwrite');
      const store=tx.objectStore('pending');
      const request=action==='get'?store.get('recording'):action==='put'?store.put(value,'recording'):store.delete('recording');
      tx.oncomplete=()=>resolve(request.result);
      tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || Error('Recovery storage aborted'));
    });
  } finally {db.close();}
}
