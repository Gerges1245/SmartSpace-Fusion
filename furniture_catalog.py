"""Curated offline furniture catalog; exposed in the studio library and template assets."""
import json
from pathlib import Path
import database as db

ROOT = Path(__file__).resolve().parent
CATALOG_ROOT = ROOT / 'storage' / 'catalog'
TEMPLATES_ROOT = ROOT / 'templates'


def entries():
    manifest = CATALOG_ROOT / 'catalog.json'
    items = json.loads(manifest.read_text(encoding='utf-8')) if manifest.is_file() else []

    # 1. Bedroom template models (Male & Female)
    bedroom_models = [
        ('Bed_01', 'bed', 'Beds'),
        ('Wardrobe_01', 'wardrobe', 'Storage'),
        ('Desk_01', 'desk', 'Desks'),
        ('Chair_01', 'desk chair', 'Chairs'),
        ('Rug_01', 'rug', 'Rugs'),
        ('Plant_01', 'plant', 'Plants')
    ]
    for theme, title in [('male', 'Oak & navy'), ('female', 'Rose')]:
        for node, label, category in bedroom_models:
            # Check templates first, then storage
            path = TEMPLATES_ROOT / 'bedrooms' / theme / (node + '.glb')
            if not path.is_file():
                path = CATALOG_ROOT.parent / 'bedrooms' / theme / (node + '.glb')
            if path.is_file():
                items.append({
                    'id': f'bedroom_{theme}_{node}',
                    'name': f'{title} {label}',
                    'category': category,
                    'filename': f'bedroom_{theme}_{node}.glb',
                    'source': 'Template bedroom models',
                    'license': 'Project asset',
                    'template_folder': f'bedrooms/{theme}',
                    'node': node,
                    'bedroom_theme': theme,
                    'bedroom_node': node,
                    'bytes': path.stat().st_size
                })

    # 2. Living room / Studio template models
    living_models = [
        ('Bookshelf_01', 'Studio Bookshelf', 'Storage'),
        ('Coffee_Table_01', 'Studio Coffee Table', 'Tables'),
        ('Sofa_01', 'Studio Modern Sofa', 'Sofas'),
        ('Desk_01', 'Studio Work Desk', 'Desks'),
        ('Chair_01', 'Studio Modern Chair', 'Chairs'),
        ('Rug_01', 'Studio Area Rug', 'Rugs')
    ]
    for node, name, category in living_models:
        path = TEMPLATES_ROOT / 'living_room' / (node + '.glb')
        if not path.is_file():
            path = CATALOG_ROOT.parent / 'SmartSpace-Demo-Room' / (node + '.glb')
        if path.is_file():
            items.append({
                'id': f'template_living_{node}',
                'name': name,
                'category': category,
                'filename': f'living_{node}.glb',
                'source': 'Template living room models',
                'license': 'Project asset',
                'template_folder': 'living_room',
                'node': node,
                'bytes': path.stat().st_size
            })

    return items


def entry(catalog_id):
    result = next((item for item in entries() if item['id'] == catalog_id), None)
    if result is None:
        raise ValueError('Furniture is not in the catalog.')
    return result


def asset_path(catalog_id):
    item = entry(catalog_id)
    if item.get('template_folder'):
        path = (TEMPLATES_ROOT / item['template_folder'] / (item['node'] + '.glb')).resolve()
        if not path.is_file():
            if item.get('bedroom_theme'):
                path = (CATALOG_ROOT.parent / 'bedrooms' / item['bedroom_theme'] / (item['node'] + '.glb')).resolve()
            elif item['template_folder'] == 'living_room':
                path = (CATALOG_ROOT.parent / 'SmartSpace-Demo-Room' / (item['node'] + '.glb')).resolve()
    elif item.get('bedroom_theme'):
        path = (CATALOG_ROOT.parent / 'bedrooms' / item['bedroom_theme'] / (item['bedroom_node'] + '.glb')).resolve()
    else:
        path = (CATALOG_ROOT / item['filename']).resolve()

    if not path.is_file():
        raise FileNotFoundError('Catalog model is missing.')
    return path


def add_to_project(user_id, project_id, catalog_id):
    item = entry(catalog_id)
    with db.connection() as conn:
        db.require_project(conn, project_id, user_id)
        row = conn.execute("SELECT id FROM assets WHERE user_id=? AND original_name=? AND kind='furniture'", (user_id, item['filename'])).fetchone()
    asset_id = row['id'] if row else db.import_glb(user_id, asset_path(catalog_id), kind='furniture')
    if not row and (item.get('bedroom_theme') or item.get('template_folder')):
        with db.connection() as conn:
            conn.execute('UPDATE assets SET original_name=? WHERE id=? AND user_id=?', (item['filename'], asset_id, user_id))
    node_name = item.get('node', item.get('bedroom_node', item['id']))
    return db.add_object(user_id, project_id, node_name, category='catalog', asset_id=asset_id)
