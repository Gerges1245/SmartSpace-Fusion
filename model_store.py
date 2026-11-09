"""Import the supplied demo assets, load furniture templates, and persist editable layouts."""
import json
import math
import shutil
import uuid
from pathlib import Path

import database as db

ROOT = Path(__file__).resolve().parent
TEMPLATES_DIR = ROOT / 'templates'
DEFAULT_ROOM_WIDTH = 9.0
DEFAULT_ROOM_DEPTH = 6.0


def get_templates():
    manifest_file = TEMPLATES_DIR / 'templates.json'
    if manifest_file.exists():
        try:
            return json.loads(manifest_file.read_text(encoding='utf-8'))
        except (ValueError, OSError):
            pass
    return []


def apply_template(user_id, project_id, template_id=None, replace=False):
    layout_path = None
    template_name = 'Demo room'
    if template_id:
        templates = get_templates()
        found = next((t for t in templates if t['id'] == template_id), None)
        if found:
            candidate = (TEMPLATES_DIR / found['folder'] / found['layout_file']).resolve()
            if candidate.is_file():
                layout_path = candidate
                template_name = found['name']

    if not layout_path:
        with db.connection() as conn:
            user = conn.execute('SELECT gender FROM users WHERE id=?', (user_id,)).fetchone()
        theme = 'female' if user and user['gender'] == 'female' else 'male'
        bedroom = TEMPLATES_DIR / 'bedrooms' / theme / 'room_layout.json'
        if not bedroom.is_file():
            bedroom = ROOT / 'storage' / 'bedrooms' / theme / 'room_layout.json'
        candidates = [bedroom] if bedroom.is_file() else sorted(db.STORAGE.rglob('room_layout.json'))
        if not candidates:
            candidates = sorted((ROOT / 'SmartSpace-Demo-Room').rglob('room_layout.json'))
        if not candidates:
            raise FileNotFoundError('No room templates or demo layouts found.')
        layout_path = candidates[0]

    layout = json.loads(layout_path.read_text(encoding='utf-8'))
    room = layout['room']
    db.positive_values((room['width'], room['depth'], room['height']))
    files = []
    try:
        with db.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            db.require_project(conn, project_id, user_id)
            existing_room = conn.execute('SELECT id FROM rooms WHERE project_id=?', (project_id,)).fetchone()
            if existing_room:
                if not replace:
                    raise ValueError('This project already has a room. Open it instead of importing again.')
                # Clear existing room and objects to apply the new template design
                conn.execute('DELETE FROM room_objects WHERE room_id=?', (existing_room['id'],))
                conn.execute('DELETE FROM rooms WHERE id=?', (existing_room['id'],))

            assets = []
            for obj in layout['objects']:
                source = (layout_path.parent / obj['file']).resolve()
                if not source.is_relative_to(layout_path.parent.resolve()) or source.suffix.lower() != '.glb':
                    raise ValueError('Invalid asset path in room_layout.json.')
                with source.open('rb') as file:
                    if file.read(4) != b'glTF':
                        raise ValueError('Invalid GLB asset.')
                target = db.STORAGE / (uuid.uuid4().hex + '.glb')
                files.append(target)
                shutil.copyfile(source, target)
                kind = 'room' if obj['kind'] == 'structure' else 'furniture'
                asset_id = conn.execute('INSERT INTO assets(user_id,original_name,relative_path,kind) VALUES(?,?,?,?)',
                                         (user_id, source.name, target.relative_to(db.ROOT).as_posix(), kind)).lastrowid
                assets.append((obj, asset_id))

            structural = [aid for obj, aid in assets if obj['kind'] == 'structure']
            if len(structural) != 1:
                raise ValueError('The template needs exactly one room shell.')
            room_id = conn.execute('INSERT INTO rooms(project_id,name,width,depth,height,original_asset_id,source_width,source_depth) VALUES(?,?,?,?,?,?,?,?)',
                                   (project_id, template_name, DEFAULT_ROOM_WIDTH, DEFAULT_ROOM_DEPTH, room['height'], structural[0], room['width'], room['depth'])).lastrowid
            for obj, aid in assets:
                if obj['kind'] == 'structure':
                    continue
                values = (*obj['position'], *obj['rotation'], *obj['scale'])
                if len(values) != 9 or not all(math.isfinite(float(x)) for x in values):
                    raise ValueError('Invalid demo transform.')
                conn.execute('''INSERT INTO room_objects(room_id,name,asset_id,position_x,position_y,position_z,
                                rotation_x,rotation_y,rotation_z,scale_x,scale_y,scale_z) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',
                             (room_id, obj['node'], aid, *values))
            db.touch(conn, project_id)
            snapshot = db.project_data(conn, user_id, project_id)
            next_ver = conn.execute('SELECT COALESCE(MAX(version_number), 0) + 1 FROM project_versions WHERE project_id=?', (project_id,)).fetchone()[0]
            conn.execute('INSERT INTO project_versions(project_id,version_number,label,snapshot_json) VALUES(?,?,?,?)',
                         (project_id, next_ver, f'Template: {template_name}', json.dumps(snapshot)))
    except Exception:
        for file in files:
            file.unlink(missing_ok=True)
        raise


def import_demo(user_id, project_id):
    apply_template(user_id, project_id, template_id=None, replace=False)


def save_layout(user_id, project_id, objects, expected_revision=None, room_settings=None):
    if not isinstance(objects, list) or len(objects) > 10000:
        raise ValueError('Invalid layout.')
    if sum(not bool(o.get('is_deleted')) for o in objects if isinstance(o, dict)) > 100:
        raise ValueError('This room supports up to 100 visible pieces.')
    with db.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        db.require_project(conn, project_id, user_id)
        current = db.get_project(user_id, project_id)
        current_rev = current.get('project', {}).get('revision', current.get('revision'))
        if expected_revision is not None and current_rev != expected_revision:
            raise ValueError('This room changed in another window. Reopen it before saving.')
        if room_settings and isinstance(room_settings, dict):
            for axis in ('width', 'depth'):
                if axis in room_settings:
                    val = room_settings[axis]
                    if type(val) not in (int, float) or not (2 <= val <= 12):
                        raise ValueError(f'Room {axis} must be between 2 and 12 meters.')
                    conn.execute(f'UPDATE rooms SET {axis}=? WHERE project_id=?', (val, project_id))
            if 'floor_finish' in room_settings:
                finish = room_settings['floor_finish']
                if finish not in ('original', 'oak', 'walnut', 'concrete', 'terracotta'):
                    raise ValueError('Invalid floor finish.')
                conn.execute('UPDATE rooms SET floor_finish=? WHERE project_id=?', (finish, project_id))
        for o in objects:
            if not isinstance(o, dict) or 'id' not in o:
                continue
            pos = o.get('position')
            pos_x = pos[0] if isinstance(pos, (list, tuple)) and len(pos) >= 3 else o.get('position_x', 0)
            pos_y = pos[1] if isinstance(pos, (list, tuple)) and len(pos) >= 3 else o.get('position_y', 0)
            pos_z = pos[2] if isinstance(pos, (list, tuple)) and len(pos) >= 3 else o.get('position_z', 0)
            rot = o.get('rotation')
            rot_x = rot[0] if isinstance(rot, (list, tuple)) and len(rot) >= 3 else o.get('rotation_x', 0)
            rot_y = rot[1] if isinstance(rot, (list, tuple)) and len(rot) >= 3 else o.get('rotation_y', 0)
            rot_z = rot[2] if isinstance(rot, (list, tuple)) and len(rot) >= 3 else o.get('rotation_z', 0)
            scale = o.get('scale')
            scale_x = scale[0] if isinstance(scale, (list, tuple)) and len(scale) >= 3 else o.get('scale_x', 1)
            scale_y = scale[1] if isinstance(scale, (list, tuple)) and len(scale) >= 3 else o.get('scale_y', 1)
            scale_z = scale[2] if isinstance(scale, (list, tuple)) and len(scale) >= 3 else o.get('scale_z', 1)
            conn.execute('''UPDATE room_objects SET
                            position_x=?, position_y=?, position_z=?,
                            rotation_x=?, rotation_y=?, rotation_z=?,
                            scale_x=?, scale_y=?, scale_z=?,
                            is_deleted=?
                            WHERE id=? AND room_id=(SELECT id FROM rooms WHERE project_id=?)''',
                         (pos_x, pos_y, pos_z,
                          rot_x, rot_y, rot_z,
                          scale_x, scale_y, scale_z,
                          int(bool(o.get('is_deleted', False))),
                          o['id'], project_id))
        db.touch(conn, project_id)
        snapshot = db.project_data(conn, user_id, project_id)
        next_ver = conn.execute('SELECT COALESCE(MAX(version_number), 0) + 1 FROM project_versions WHERE project_id=?', (project_id,)).fetchone()[0]
        conn.execute('INSERT INTO project_versions(project_id,version_number,label,snapshot_json) VALUES(?,?,?,?)',
                     (project_id, next_ver, 'Saved layout', json.dumps(snapshot)))


def restore_version(user_id, project_id, version_number, expected_revision=None):
    with db.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        db.require_project(conn, project_id, user_id)
        current = db.get_project(user_id, project_id)
        current_rev = current.get('project', {}).get('revision', current.get('revision'))
        if expected_revision is not None and current_rev != expected_revision:
            raise ValueError('This room changed in another window. Reopen it before restoring.')
        ver = conn.execute('SELECT snapshot_json FROM project_versions WHERE project_id=? AND version_number=?',
                           (project_id, version_number)).fetchone()
        if not ver:
            raise ValueError('Version not found.')
        snapshot = json.loads(ver['snapshot_json'])
        # Restore room settings
        room = snapshot.get('room')
        if room:
            conn.execute('UPDATE rooms SET width=?, depth=?, height=?, floor_finish=?, source_width=COALESCE(source_width,?), source_depth=COALESCE(source_depth,?) WHERE project_id=?',
                         (room['width'], room['depth'], room['height'], room.get('floor_finish', 'original'), room.get('source_width', room['width']), room.get('source_depth', room['depth']), project_id))
        # Restore objects
        room_row = conn.execute('SELECT id FROM rooms WHERE project_id=?', (project_id,)).fetchone()
        if room_row:
            room_id = room_row['id']
            for o in snapshot.get('objects', []):
                conn.execute('''UPDATE room_objects SET
                                position_x=?, position_y=?, position_z=?,
                                rotation_x=?, rotation_y=?, rotation_z=?,
                                scale_x=?, scale_y=?, scale_z=?,
                                is_deleted=?
                                WHERE id=? AND room_id=?''',
                             (o['position_x'], o['position_y'], o['position_z'],
                              o['rotation_x'], o['rotation_y'], o['rotation_z'],
                              o['scale_x'], o['scale_y'], o['scale_z'],
                              int(bool(o.get('is_deleted', False))),
                              o['id'], room_id))
        db.touch(conn, project_id)
