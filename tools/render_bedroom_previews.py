"""CPU raster previews of the actual exported GLB geometry; no browser required."""
from pathlib import Path
import json
import numpy as np
from PIL import Image
import trimesh as tm

ROOT=Path(__file__).resolve().parents[1]/'storage'/'bedrooms'


def render(theme):
    width,height=1200,900
    image=np.full((height,width,3),[235,228,221],dtype=np.uint8)
    depth=np.full((height,width),np.inf)
    position=np.array([6.,4.5,7.])
    target=np.array([0.,1.,0.])
    forward=target-position;forward/=np.linalg.norm(forward)
    right=np.cross(forward,[0,1,0]);right/=np.linalg.norm(right)
    up=np.cross(right,forward)
    basis=np.column_stack([right,up,forward])
    light=np.array([.5,1.,.6]);light/=np.linalg.norm(light)
    folder=ROOT/theme
    layout=json.loads((folder/'room_layout.json').read_text())
    for item in layout['objects']:
        scene=tm.load_scene(folder/item['file'])
        for node in scene.graph.nodes_geometry:
            matrix,key=scene.graph[node]
            mesh=scene.geometry[key].copy();mesh.apply_transform(matrix);mesh.apply_translation(item['position'])
            camera=(mesh.vertices-position)@basis
            projected=camera[:,:2]/camera[:,2,None]*1350
            projected[:,0]+=width/2;projected[:,1]=height/2-projected[:,1]
            material=mesh.visual.material
            base=np.asarray(material.baseColorFactor[:3],dtype=float)/255
            texture=np.array(material.baseColorTexture.convert('RGB')) if material.baseColorTexture else None
            for index,face in enumerate(mesh.faces):
                normal=mesh.face_normals[index]
                if normal@(position-mesh.triangles_center[index])<=0:
                    continue
                tri=projected[face]
                x0=max(0,int(np.floor(tri[:,0].min())));x1=min(width-1,int(np.ceil(tri[:,0].max())))
                y0=max(0,int(np.floor(tri[:,1].min())));y1=min(height-1,int(np.ceil(tri[:,1].max())))
                if x1<x0 or y1<y0:
                    continue
                a,b,c=tri
                denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
                if abs(denominator)<1e-8:
                    continue
                yy,xx=np.mgrid[y0:y1+1,x0:x1+1]
                w0=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/denominator
                w1=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/denominator
                w2=1-w0-w1
                reciprocal=w0/camera[face[0],2]+w1/camera[face[1],2]+w2/camera[face[2],2]
                z=1/np.maximum(reciprocal,1e-12)
                region=depth[y0:y1+1,x0:x1+1]
                mask=(w0>=-1e-5)&(w1>=-1e-5)&(w2>=-1e-5)&(z<region)
                if not np.any(mask):
                    continue
                shade=.55+.45*max(0,normal@light)
                if texture is not None:
                    uv=mesh.visual.uv[face]
                    coords=(w0[...,None]*uv[0]/camera[face[0],2]+w1[...,None]*uv[1]/camera[face[1],2]+w2[...,None]*uv[2]/camera[face[2],2])*z[...,None]
                    tx=(np.mod(coords[...,0],1)*(texture.shape[1]-1)).astype(int)
                    ty=((1-np.mod(coords[...,1],1))*(texture.shape[0]-1)).astype(int)
                    colors=texture[ty,tx]*base*shade
                else:
                    colors=np.broadcast_to(base*255*shade,(*mask.shape,3))
                region[mask]=z[mask]
                image[y0:y1+1,x0:x1+1][mask]=np.uint8(np.clip(colors[mask],0,255))
    Image.fromarray(image).save(ROOT/(theme+'-preview.png'))
    print(theme,'preview rendered')


if __name__=='__main__':
    render('female')
    render('male')
