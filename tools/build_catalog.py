"""Download selected CC0 Poly Haven models and embed their files into offline GLBs.
Run manually to rebuild the bundled catalog. Requires requests (build-time only).
"""
import hashlib
import json
import struct
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import requests

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'storage' / 'catalog'
SELECTION = [
    ('sofa_02', 'Tufted leather sofa', 'Sofas'),
    ('sofa_03', 'Upholstered sofa', 'Sofas'),
    ('modern_arm_chair_01', 'Modern lounge chair', 'Chairs'),
    ('dining_chair_02', 'Wooden dining chair', 'Chairs'),
    ('modern_coffee_table_01', 'Modern coffee table', 'Tables'),
    ('dining_table', 'Wooden dining table', 'Tables'),
    ('side_table_01', 'Round side table', 'Tables'),
    ('modern_wooden_cabinet', 'Modern wooden cabinet', 'Storage'),
]

def fetch(url, checksum=None):
    r = requests.get(url, timeout=60, headers={'User-Agent': 'SmartSpace3D-MVP/1.0 (offline CC0 asset packaging)'})
    r.raise_for_status()
    if checksum and hashlib.md5(r.content).hexdigest() != checksum:
        raise ValueError('Checksum mismatch: ' + url)
    return r.content

def build(item):
    key, name, category = item
    spec = json.loads(fetch('https://api.polyhaven.com/files/' + key))['gltf']['1k']['gltf']
    gltf = json.loads(fetch(spec['url'], spec['md5']))
    dependencies = spec['include']
    def get_dependency(uri):
        entry = dependencies[uri]
        return fetch(entry['url'], entry['md5'])
    binary = bytearray()
    offsets = []
    for buffer in gltf['buffers']:
        binary.extend(b'\x00' * (-len(binary) % 4))
        offsets.append(len(binary))
        binary.extend(get_dependency(buffer['uri']))
    for view in gltf.get('bufferViews', []):
        view['byteOffset'] = view.get('byteOffset', 0) + offsets[view.get('buffer', 0)]
        view['buffer'] = 0
    for image in gltf.get('images', []):
        uri = image.pop('uri')
        data = get_dependency(uri)
        binary.extend(b'\x00' * (-len(binary) % 4))
        image['bufferView'] = len(gltf.setdefault('bufferViews', []))
        image['mimeType'] = 'image/png' if uri.endswith('.png') else 'image/jpeg'
        gltf['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)})
        binary.extend(data)
    gltf['buffers'] = [{'byteLength': len(binary)}]
    gltf['asset']['copyright'] = 'Poly Haven contributors. CC0. https://polyhaven.com/a/' + key
    encoded = json.dumps(gltf, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary.extend(b'\x00' * (-len(binary) % 4))
    output = struct.pack('<III', 0x46546c67, 2, 28 + len(encoded) + len(binary))
    output += struct.pack('<II', len(encoded), 0x4e4f534a) + encoded
    output += struct.pack('<II', len(binary), 0x004e4942) + binary
    (DEST / (key + '.glb')).write_bytes(output)
    print(key, len(output), flush=True)
    return {'id': key, 'name': name, 'category': category, 'filename': key+'.glb',
            'source': 'https://polyhaven.com/a/'+key, 'license': 'CC0',
            'bytes': len(output), 'sha256': hashlib.sha256(output).hexdigest()}

if __name__ == '__main__':
    DEST.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        catalog = list(pool.map(build, SELECTION))
    (DEST / 'catalog.json').write_text(json.dumps(catalog, indent=2), encoding='utf-8')
    (DEST / 'LICENSE.txt').write_text('Models and included textures: Poly Haven contributors, CC0 1.0.\nhttps://polyhaven.com/license\nhttps://creativecommons.org/publicdomain/zero/1.0/\nSee catalog.json for individual source URLs.\n', encoding='utf-8')
