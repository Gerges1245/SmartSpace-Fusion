// Validate the bundled GLBs with the exact Three.js loader used by the editor.
// Image decoding is stubbed: the test checks geometry, dependencies and bounds.
import fs from 'node:fs';
import {GLTFLoader} from '../frontend/vendor/loaders/GLTFLoader.js';
import {Box3,Vector3} from '../frontend/vendor/three.module.min.js';
globalThis.self=globalThis;
globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
const manifest=JSON.parse(fs.readFileSync(new URL('../storage/catalog/catalog.json',import.meta.url),'utf8'));
for(const item of manifest){
 const data=fs.readFileSync(new URL('../storage/catalog/'+item.filename,import.meta.url));
 const gltf=await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
 const box=new Box3().setFromObject(gltf.scene),size=box.getSize(new Vector3());
 if(![size.x,size.y,size.z].every(n=>Number.isFinite(n)&&n>0)||Math.max(size.x,size.y,size.z)>10)throw Error('Invalid furniture dimensions: '+item.id);
 let meshes=0,textures=0;gltf.scene.traverse(o=>{if(o.isMesh){meshes++;if(o.material.map)textures++}});
 if(!meshes||!textures)throw Error('Furniture is missing textured meshes: '+item.id);
 console.log(item.id, meshes+' meshes',size.toArray().map(n=>n.toFixed(2)).join(' x ')+' m');
}
