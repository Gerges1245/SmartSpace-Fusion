"""Remove the generated ceiling fans from GLBs, preserving all other geometry/textures."""
import json
import re
import struct
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAN = re.compile(r'^fan_(?:stem|motor|blade)_\d+$')


def remove_fan(data):
    magic, version, size = struct.unpack_from('<4sII', data)
    if magic != b'glTF' or version != 2 or size != len(data):
        raise ValueError('Invalid GLB')
    chunks, offset = [], 12
    while offset < len(data):
        length, kind = struct.unpack_from('<II', data, offset)
        chunks.append((kind, data[offset + 8:offset + 8 + length]))
        offset += 8 + length
    document = json.loads(chunks[0][1])
    nodes = document.get('nodes', [])
    removed = {i for i, node in enumerate(nodes) if FAN.fullmatch(node.get('name', ''))}
    if not removed:
        return data, 0
    if document.get('animations') or document.get('skins'):
        raise ValueError('Fan removal requires a static room shell')
    if any(nodes[i].get('children') for i in removed):
        raise ValueError('Unexpected fan hierarchy')
    node_map = {old: new for new, old in enumerate(i for i in range(len(nodes)) if i not in removed)}
    fan_meshes = {nodes[i]['mesh'] for i in removed if 'mesh' in nodes[i]}
    used_meshes = {node['mesh'] for i, node in enumerate(nodes) if i not in removed and 'mesh' in node}
    mesh_removed = fan_meshes - used_meshes
    mesh_map = {old: new for new, old in enumerate(i for i in range(len(document.get('meshes', []))) if i not in mesh_removed)}
    document['nodes'] = [node for i, node in enumerate(nodes) if i not in removed]
    for node in document['nodes']:
        if 'children' in node:
            node['children'] = [node_map[i] for i in node['children'] if i not in removed]
        if 'mesh' in node:
            node['mesh'] = mesh_map[node['mesh']]
    for scene in document.get('scenes', []):
        scene['nodes'] = [node_map[i] for i in scene.get('nodes', []) if i not in removed]
    document['meshes'] = [mesh for i, mesh in enumerate(document.get('meshes', [])) if i not in mesh_removed]
    encoded = json.dumps(document, separators=(',', ':'), ensure_ascii=True).encode('utf-8')
    encoded += b' ' * (-len(encoded) % 4)
    chunks[0] = (chunks[0][0], encoded)
    body = b''.join(struct.pack('<II', len(chunk), kind) + chunk for kind, chunk in chunks)
    return struct.pack('<4sII', b'glTF', 2, 12 + len(body)) + body, len(removed)


def main():
    changes = []
    for path in ROOT.rglob('*.glb'):
        original = path.read_bytes()
        cleaned, count = remove_fan(original)
        if count:
            changes.append((path, original, cleaned, count))
    if not changes:
        print('No ceiling fans remain.')
        return
    backup_dir = ROOT / 'backups'
    backup_dir.mkdir(exist_ok=True)
    backup = backup_dir / ('ceiling-fans-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.zip')
    with zipfile.ZipFile(backup, 'x', zipfile.ZIP_DEFLATED) as archive:
        for path, original, _, _ in changes:
            archive.writestr(path.relative_to(ROOT).as_posix(), original)
    for path, _, cleaned, count in changes:
        path.write_bytes(cleaned)
        assert remove_fan(path.read_bytes())[1] == 0
    print(f'Removed {sum(c[3] for c in changes)} fan parts from {len(changes)} models.')
    print('Original models backed up in:', backup.relative_to(ROOT))


if __name__ == '__main__':
    main()
