"""Build two original, self-contained bedroom GLB sets. Rebuild: pip install trimesh pillow."""
import json
from pathlib import Path
import math
import random
import numpy as np
from PIL import Image, ImageDraw
import trimesh as tm
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals

OUT = Path(__file__).resolve().parents[1] / 'storage' / 'bedrooms'
rng = random.Random(484)


def wood_texture():
    pixels = np.zeros((512, 512, 3), dtype=np.uint8)
    noise = np.random.default_rng(484)
    for row in range(8):
        base = np.array([100, 65, 38]) + noise.integers(-12, 13)
        grain = noise.normal(0, 3, (64, 512, 1))
        waves = np.sin(np.arange(512)[None, :, None] * .13 + np.arange(64)[:, None, None] * .07) * 3
        pixels[row*64:(row+1)*64] = np.clip(base + grain + waves, 0, 255)
        pixels[row*64:row*64+2] = [48, 31, 21]
        offset = (row % 3) * 137
        for x in range(offset, 512, 280):
            pixels[row*64:(row+1)*64, x:x+2] = [53, 34, 23]
    return Image.fromarray(pixels)


def textile(color):
    rgb = np.array([int(color[i:i+2], 16) for i in (1, 3, 5)])
    n = np.random.default_rng(6).normal(0, 2, (128, 128, 1))
    n[::2] += 2
    return Image.fromarray(np.uint8(np.clip(rgb+n, 0, 255)))


def material(name, color, rough=.65, metal=0, image=None):
    rgb = [int(color[i:i+2], 16) for i in (1, 3, 5)] + [255]
    return PBRMaterial(name='bedroom_'+name, baseColorFactor=rgb if image is None else [255]*4,
                       baseColorTexture=image, roughnessFactor=rough, metallicFactor=metal)


class Builder:
    def __init__(self, theme):
        self.theme = theme
        female = theme == 'female'
        self.colors = dict(wall='#e6d5c5' if female else '#bdc9cb', accent='#ce879f' if female else '#334f6d',
                           soft='#f0c6ce' if female else '#58728a', cream='#f6eee2', wood='#936341')
        c = self.colors
        self.mats = {
            'wall': material('wall', c['wall']), 'cream': material('cream', c['cream']),
            'white': material('white', '#f3f1e8'), 'accent': material('accent', c['accent'], image=textile(c['accent'])),
            'soft': material('soft', c['soft'], image=textile(c['soft'])),
            'fabric': material('fabric', '#e9ded1', image=textile('#e9ded1')),
            'wood': material('wood', c['wood'], image=wood_texture()),
            'oak': material('oak', '#bb9873'), 'dark': material('dark', '#232a31'),
            'metal': material('metal', '#9fabb3', .25, .7), 'gold': material('gold', '#b38a43', .3, .6),
            'green': material('green', '#3c7041'), 'leaf': material('leaf', '#75935b'),
            'soil': material('soil', '#463428'), 'pot': material('pot', '#bc815b'),
            'glass': material('glass', '#97c2cf', .25), 'screen': material('screen', '#142b41', .2),
            'paper': material('paper', '#e4d9b5'), 'red': material('red', '#a94e47'),
            'blue': material('blue', '#4b6a88'), 'pink': material('pink', '#c98c9f'),
        }
        self.scene = tm.Scene()
        self.index = 0

    def add(self, mesh, pos, mat, name='part', rotate=None):
        mesh = mesh.copy()
        if rotate is not None:
            mesh.apply_transform(tm.transformations.euler_matrix(*rotate))
        # UVs are local to each mesh, preserving grain on every piece.
        uv = mesh.vertices[:, [0, 2]].copy()
        spans = np.ptp(uv, axis=0)
        spans[spans < .001] = 1
        uv = (uv-uv.min(axis=0))/spans
        mesh.visual = TextureVisuals(uv=uv, material=self.mats[mat])
        mesh.apply_translation(pos)
        self.index += 1
        self.scene.add_geometry(mesh, node_name=f'{name}_{self.index}')
        return mesh

    def box(self, size, pos, mat='cream', name='box', radius=0, rotate=None):
        if radius:
            mesh = tm.creation.uv_sphere(count=[12, 20])
            directions = mesh.vertices.copy()
            mesh.vertices = np.sign(directions)*(np.array(size)/2-radius)+radius*directions
        else:
            mesh = tm.creation.box(extents=size)
        return self.add(mesh, pos, mat, name, rotate)

    def cylinder(self, r, h, pos, mat='wood', name='cylinder', sections=24):
        mesh = tm.creation.cylinder(radius=r, height=h, sections=sections)
        return self.add(mesh, pos, mat, name, [math.pi/2, 0, 0])

    def sphere(self, size, pos, mat, rotate=None, name='soft_detail'):
        mesh = tm.creation.uv_sphere(count=[12, 20])
        mesh.apply_scale(np.array(size)/2)
        return self.add(mesh, pos, mat, name, rotate)

    def rod(self, start, end, r=.012, mat='metal'):
        vec = np.array(end)-start
        mesh = tm.creation.cylinder(radius=r, height=np.linalg.norm(vec), sections=10)
        mesh.apply_transform(tm.geometry.align_vectors([0, 0, 1], vec))
        return self.add(mesh, (np.array(start)+end)/2, mat, 'rod')

    def plant(self, x, y, z, scale=1):
        s = scale
        self.cylinder(.17*s, .3*s, [x, y+.15*s, z], 'pot', 'terracotta_pot')
        self.cylinder(.15*s, .012, [x, y+.305*s, z], 'soil')
        for i in range(12):
            angle = i*2.399
            height = (.5+(i%4)*.13)*s
            end = [x+math.cos(angle)*.23*s, y+height, z+math.sin(angle)*.23*s]
            self.rod([x, y+.3*s, z], end, .009*s, 'green')
            self.sphere([.15*s, .34*s, .055*s], end, 'leaf' if i%3 else 'green',
                        [math.sin(angle)*.5, angle, math.cos(angle)*.65], 'plant_leaf')

    def book(self, x, y, z, color, height=.2, angle=0):
        self.box([.045, height, .15], [x, y+height/2, z], color, 'book_spine', rotate=[0, 0, angle])
        self.box([.034, height-.02, .145], [x, y+height/2, z+.008], 'paper', 'book_pages', rotate=[0, 0, angle])

    def frame(self, x, y, z, w, h, style=0):
        self.box([w, h, .035], [x, y, z], 'oak', 'picture_frame')
        self.box([w-.04, h-.04, .008], [x, y, z+.022], 'cream', 'picture_paper')
        self.sphere([w*.48, h*.35, .012], [x, y+h*.12, z+.03], 'pink' if self.theme=='female' else 'blue')
        self.box([w*.5, .014, .012], [x, y-h*.25, z+.035], 'gold')
        if style:
            self.sphere([w*.25, h*.22, .012], [x-w*.17, y-h*.14, z+.035], 'green')

    def shell(self):
        self.box([5, .15, 4], [0, -.085, 0], 'wood', 'parquet_floor')
        self.box([5.15, 2.6, .13], [0, 1.3, -2.065], 'wall', 'back_wall')
        self.box([.13, 2.6, 4.12], [-2.565, 1.3, -.01], 'wall', 'left_wall')
        for y, h in [(.065, .13), (2.55, .12)]:
            self.box([5.15, h, .08], [0, y, -1.97], 'white', 'back_moulding')
            self.box([.08, h, 4.05], [-2.47, y, 0], 'white', 'side_moulding')
        # Window, six mullions and individually modelled Venetian blind slats.
        self.box([1.42, 1.17, .07], [1.42, 1.77, -1.95], 'oak', 'window_frame')
        self.box([1.31, 1.06, .035], [1.42, 1.77, -1.90], 'glass', 'window_daylight')
        for x in [.76, 1.42, 2.08]:
            self.box([.035, 1.12, .08], [x, 1.77, -1.85], 'white', 'window_mullion')
        self.box([1.5, .06, .19], [1.42, 1.18, -1.84], 'white', 'window_sill')
        for i in range(8):
            self.box([1.45, .025, .1], [1.42, 2.31-i*.055, -1.80], 'oak', 'blind_slat', rotate=[.2, 0, 0])
        self.rod([2.12, 2.35, -1.73], [2.12, 1.55, -1.73], .005, 'cream')
        # Shelf with books and a small plant; asymmetric gallery below it.
        self.box([1.12, .06, .27], [-.91, 1.85, -1.8], 'oak', 'floating_shelf')
        for i in range(9):
            self.book(-1.38+i*.065, 1.89, -1.78, ['red','blue','cream','pink'][i%4], .18+(i%3)*.04)
        self.plant(-.56, 1.89, -1.78, .35)
        self.frame(-.9, 1.48, -1.96, .33, .4, 1)
        self.frame(-.46, 1.4, -1.96, .24, .29)
        self.frame(-1.24, 1.39, -1.96, .2, .24)
        for i in range(12):
            self.cylinder(.018, .47, [-1.14+i*.045, .34, -1.89], 'white', 'radiator_fin', 12)
        self.rod([-1.18, .13, -1.89], [-.59, .13, -1.89], .016, 'white')
        self.rod([-1.18, .55, -1.89], [-.59, .55, -1.89], .016, 'white')

    def bed(self):
        for x in [-.59, .59]:
            for z in [-.86, .86]:
                self.box([.1,.17,.1], [x,.085,z], 'oak', 'bed_foot')
        self.box([1.42,.27,2.03], [0,.28,0], 'accent', 'upholstered_bed_base', radius=.06)
        if self.theme == 'female':
            for x in np.linspace(-.64,.64,7):
                height=1.05+.16*(1-abs(x)/.64)
                self.box([.225,height,.14],[x,height/2,-1.01],'accent','scalloped_headboard',radius=.06)
        else:
            self.box([1.52,.99,.12],[0,.58,-1.01],'oak','timber_headboard',radius=.018)
            for y in np.linspace(.24,1.01,5):
                self.box([1.44,.12,.05],[0,y,-.925],'wood','horizontal_timber_slat',radius=.012)
        self.box([1.36,.2,1.94], [0,.49,0], 'fabric', 'mattress', radius=.075)
        self.box([1.39,.15,1.48], [0,.59,.23], 'soft', 'duvet', radius=.065)
        for x in np.linspace(-.65,.65,18):
            self.rod([x,.674,-.47],[x,.674,.94],.003,'accent')
        for x in [-.34,.34]:
            self.box([.58,.16,.37], [x,.64,-.68], 'cream', 'sleeping_pillow', radius=.07, rotate=[-.13,0,.04 if x<0 else -.04])
        self.box([.38,.35,.14], [.22,.79,-.6], 'accent', 'accent_cushion', radius=.055, rotate=[-.17,0,.12])
        # Folded linen blanket drapes over the foot.
        self.box([1.44,.035,.34], [0,.69,.66], 'fabric', 'folded_throw', radius=.012)
        self.box([.04,.25,.34], [.7,.56,.66], 'fabric', 'throw_drape', radius=.012)
        self.box([.4,.47,.4], [1.02,.235,-.7], 'oak', 'bedside_cabinet', radius=.02)
        self.box([.34,.16,.025], [1.02,.31,-.48], 'cream', 'drawer')
        self.sphere([.04,.04,.02], [1.02,.31,-.46], 'gold')
        self.cylinder(.07,.025,[1.02,.49,-.7],'gold','lamp_base')
        self.cylinder(.01,.21,[1.02,.6,-.7],'gold','lamp_stem')
        self.add(tm.creation.cone(radius=.13,height=.17,sections=24),
                 [1.02,.75,-.7],'cream','lampshade',[-math.pi/2,0,0])

    def wardrobe(self):
        self.box([1.05,2.24,.67], [0,1.12,0], 'oak', 'wardrobe_carcass', radius=.015)
        for x in [-.25,.25]:
            self.box([.49,2.12,.04], [x,1.13,.355], 'cream' if self.theme=='female' else 'wood', 'wardrobe_door', radius=.009)
            self.rod([x+(.17 if x<0 else -.17),1.03,.39],[x+(.17 if x<0 else -.17),1.32,.39],.01,'gold')
        self.box([1.1,.06,.73],[0,2.26,0],'oak','wardrobe_crown')

    def desk(self):
        self.box([1.45,.065,.68],[0,.78,0],'cream' if self.theme=='female' else 'oak','desktop',radius=.018)
        self.box([.38,.68,.58],[.47,.36,0],'white' if self.theme=='female' else 'dark','drawer_pedestal',radius=.015)
        for y in [.25,.46,.66]:
            self.box([.33,.17,.025],[.47,y,.305],'cream','desk_drawer')
            self.rod([.4,y,.33],[.54,y,.33],.007,'gold')
        for z in [-.25,.25]:
            self.rod([-.59,.04,z],[ -.59,.75,z],.018,'gold' if self.theme=='female' else 'dark')
        self.box([.49,.025,.3],[-.13,.825,.02],'dark','laptop_keyboard',radius=.01)
        self.box([.49,.32,.025],[-.13,.99,-.11],'dark','laptop_lid',radius=.009,rotate=[-.15,0,0])
        self.box([.44,.27,.008],[-.13,.995,-.087],'pink' if self.theme=='female' else 'screen','laptop_screen',rotate=[-.15,0,0])
        for x in np.linspace(-.33,.06,11):
            self.box([.023,.004,.02],[x,.841,.045],'metal','keyboard_key')
        self.cylinder(.05,.1,[.36,.865,.05],'pink' if self.theme=='female' else 'blue','coffee_mug')
        self.cylinder(.038,.004,[.36,.919,.05],'soil','coffee')
        self.plant(.55,.815,-.18,.3)
        if self.theme=='male':
            self.box([.43,.27,.028],[-.5,1.08,-.22],'dark','second_monitor_frame',radius=.012)
            self.box([.39,.23,.008],[-.5,1.08,-.20],'blue','second_monitor_screen')
            self.rod([-.5,.82,-.22],[-.5,.99,-.22],.015,'dark')
        else:
            mirror=tm.creation.cylinder(radius=.13,height=.025,sections=40)
            self.add(mirror,[-.52,1.06,-.2],'gold','vanity_mirror_frame')
            self.add(tm.creation.cylinder(radius=.115,height=.028,sections=40),[-.52,1.06,-.185],'metal','vanity_mirror')
            self.rod([-.52,.82,-.2],[-.52,.95,-.2],.009,'gold')
        for i in range(3):
            self.box([.22,.023,.16],[-.53,.831+i*.024,-.12],['paper','red','cream'][i],'notebook')

    def chair(self):
        self.cylinder(.035,.36,[0,.25,0],'metal','chair_piston')
        self.box([.49,.095,.48],[0,.49,0],'soft' if self.theme=='female' else 'dark','seat_cushion',radius=.04)
        self.box([.48,.58,.095],[0,.81,.2],'accent','backrest',radius=.045,rotate=[.1,0,0])
        for x in [-.27,.27]:
            self.rod([x,.48,.09],[x,.67,.09],.013,'metal')
            self.box([.055,.04,.29],[x,.68,-.02],'soft','armrest',radius=.017)
        for i in range(5):
            a=i*math.tau/5
            p=[math.cos(a)*.3,.08,math.sin(a)*.3]
            self.rod([0,.13,0],p,.018,'metal')
            self.sphere([.09,.07,.07],[p[0],.055,p[2]],'dark',name='caster')

    def rug(self):
        if self.theme=='male':
            self.box([1.8,.022,1.4],[0,.012,0],'blue','rectangular_rug',radius=.01)
            for x in np.linspace(-.78,.78,8):
                self.box([.055,.006,1.28],[x,.026,0],'fabric','rug_geometric_stripe')
            return
        self.cylinder(.95,.018,[0,.012,0],'fabric','rug_base',64)
        for radius in np.linspace(.2,.91,9):
            mesh=tm.creation.torus(major_radius=float(radius),minor_radius=.013,major_sections=64,minor_sections=6)
            self.add(mesh,[0,.028,0],'pink' if self.theme=='female' else 'blue','woven_rug_ring',[math.pi/2,0,0])

    def export(self, path):
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_bytes(self.scene.export(file_type='glb'))


def build(theme):
    directory=OUT/theme
    objects=[]
    layouts=[('Room_Shell','shell',[0,0,0]),('Bed_01','bed',[.15,0,-.86]),
             ('Wardrobe_01','wardrobe',[-1.82,0,-1.25]),('Desk_01','desk',[1.57,0,.66]),
             ('Chair_01','chair',[1.42,0,1.38]),('Rug_01','rug',[-.32,0,.72]),
             ('Plant_01','plant',[-1.73,0,1.1])]
    for name,method,position in layouts:
        builder=Builder(theme)
        if method=='plant':
            builder.plant(0,0,0,1.25)
        else:
            getattr(builder,method)()
        builder.export(directory/(name+'.glb'))
        objects.append({'node':name,'kind':'structure' if method=='shell' else 'furniture',
                        'position':position,'rotation':[0,0,0],'scale':[1,1,1],'file':name+'.glb'})
    layout={'name':theme+' bedroom','units':'metres','room':{'width':5,'depth':4,'height':2.6},'objects':objects}
    (directory/'room_layout.json').write_text(json.dumps(layout,indent=2),encoding='utf-8')
    print(theme, 'bedroom built:', sum(p.stat().st_size for p in directory.glob('*.glb')), 'bytes')


if __name__=='__main__':
    build('male')
    build('female')
