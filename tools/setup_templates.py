"""Set up dedicated templates/ directory containing room and furniture design templates."""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / 'templates'
TEMPLATES.mkdir(exist_ok=True)

manifest = [
    {
        'id': 'male_bedroom',
        'name': 'Modern Oak & Navy Bedroom',
        'category': 'Bedroom',
        'description': 'Complete modern bedroom design featuring an oak frame bed, spacious wardrobe, study desk, ergonomic chair, decorative plant and navy rug.',
        'pieces_count': 6,
        'room_size': '5.0 x 4.0 m',
        'preview': '/templates/previews/male-preview.png',
        'folder': 'bedrooms/male',
        'layout_file': 'room_layout.json'
    },
    {
        'id': 'female_bedroom',
        'name': 'Elegant Rose Bedroom',
        'category': 'Bedroom',
        'description': 'Warm and elegant rose-themed bedroom layout with upholstered bed, wardrobe, vanity/desk, chair, accent plant and soft rug.',
        'pieces_count': 6,
        'room_size': '5.0 x 4.0 m',
        'preview': '/templates/previews/female-preview.png',
        'folder': 'bedrooms/female',
        'layout_file': 'room_layout.json'
    },
    {
        'id': 'living_room',
        'name': 'SmartSpace Studio & Living Room',
        'category': 'Living Room',
        'description': 'Spacious open-concept living and workspace with comfortable sofa, coffee table, workstation desk, bookshelf, chair and area rug.',
        'pieces_count': 6,
        'room_size': '6.0 x 5.0 m',
        'preview': '/templates/previews/room_preview.png',
        'folder': 'living_room',
        'layout_file': 'room_layout.json'
    }
]

# Copy previews
previews_dir = TEMPLATES / 'previews'
previews_dir.mkdir(exist_ok=True)
if (ROOT / 'storage/bedrooms/male-preview.png').exists():
    shutil.copy2(ROOT / 'storage/bedrooms/male-preview.png', previews_dir / 'male-preview.png')
if (ROOT / 'storage/bedrooms/female-preview.png').exists():
    shutil.copy2(ROOT / 'storage/bedrooms/female-preview.png', previews_dir / 'female-preview.png')
if (ROOT / 'storage/SmartSpace-Demo-Room/room_preview.png').exists():
    shutil.copy2(ROOT / 'storage/SmartSpace-Demo-Room/room_preview.png', previews_dir / 'room_preview.png')

# Copy bedroom templates
for theme in ['male', 'female']:
    dst = TEMPLATES / 'bedrooms' / theme
    dst.mkdir(parents=True, exist_ok=True)
    src = ROOT / 'storage/bedrooms' / theme
    if src.exists():
        for item in src.glob('*'):
            if item.is_file():
                shutil.copy2(item, dst / item.name)

# Copy living room template
dst_living = TEMPLATES / 'living_room'
dst_living.mkdir(parents=True, exist_ok=True)
src_living = ROOT / 'storage/SmartSpace-Demo-Room'
if src_living.exists():
    for item in src_living.glob('*'):
        if item.is_file() and item.suffix.lower() in ('.glb', '.json', '.png'):
            shutil.copy2(item, dst_living / item.name)

# Write manifest
(TEMPLATES / 'templates.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
print('Templates set up successfully! Count:', len(manifest))
