"""SmartSpace local storage. No third-party packages required."""
import json
import math
import shutil
import sqlite3
import uuid
import hashlib
import secrets
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / 'smartspace.db'
STORAGE = ROOT / 'storage'
OWNER_PHONE_ADDRESS = 'AA:BB:CC:11:22:01'

SCHEMA = '''
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(trim(name)) > 0),
 email TEXT UNIQUE,
 gender TEXT,
 age INTEGER CHECK(age IS NULL OR age >= 0),
 role TEXT NOT NULL DEFAULT 'user',
 theme TEXT NOT NULL DEFAULT 'light' CHECK(theme IN ('light','dark')),
 profile_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS bluetooth_devices (
 id INTEGER PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 bluetooth_address TEXT NOT NULL UNIQUE CHECK(length(bluetooth_address)=17),
 device_name TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS devices_user_idx ON bluetooth_devices(user_id);
CREATE TABLE IF NOT EXISTS projects (
 id INTEGER PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(trim(name)) > 0),
 description TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id);
CREATE TABLE IF NOT EXISTS assets (
 id INTEGER PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 original_name TEXT NOT NULL,
 relative_path TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('room','furniture')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS rooms (
 id INTEGER PRIMARY KEY,
 project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 width REAL NOT NULL CHECK(width > 0),
 depth REAL NOT NULL CHECK(depth > 0),
 height REAL NOT NULL CHECK(height > 0),
 original_asset_id INTEGER REFERENCES assets(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS room_objects (
 id INTEGER PRIMARY KEY,
 room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 category TEXT NOT NULL DEFAULT 'furniture',
 asset_id INTEGER REFERENCES assets(id) ON DELETE RESTRICT,
 position_x REAL NOT NULL DEFAULT 0,
 position_y REAL NOT NULL DEFAULT 0,
 position_z REAL NOT NULL DEFAULT 0,
 rotation_x REAL NOT NULL DEFAULT 0,
 rotation_y REAL NOT NULL DEFAULT 0,
 rotation_z REAL NOT NULL DEFAULT 0,
 scale_x REAL NOT NULL DEFAULT 1 CHECK(scale_x > 0),
 scale_y REAL NOT NULL DEFAULT 1 CHECK(scale_y > 0),
 scale_z REAL NOT NULL DEFAULT 1 CHECK(scale_z > 0),
 is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0,1))
);
CREATE INDEX IF NOT EXISTS objects_room_idx ON room_objects(room_id);
CREATE TABLE IF NOT EXISTS project_versions (
 id INTEGER PRIMARY KEY,
 project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 version_number INTEGER NOT NULL,
 label TEXT NOT NULL DEFAULT '',
 snapshot_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(project_id, version_number)
);
CREATE TABLE IF NOT EXISTS browser_sessions (
 token_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
'''


@contextmanager
def connection():
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys = ON')
    try:
        with db:
            yield db
    finally:
        db.close()


def init_database():
    STORAGE.mkdir(parents=True, exist_ok=True)
    with connection() as db:
        db.executescript(SCHEMA)
        if 'revision' not in {r['name'] for r in db.execute('PRAGMA table_info(projects)')}:
            db.execute('ALTER TABLE projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')
        room_columns = {r['name'] for r in db.execute('PRAGMA table_info(rooms)')}
        for name, kind in [('source_width', 'REAL'), ('source_depth', 'REAL'), ('floor_finish', "TEXT NOT NULL DEFAULT 'original'")]:
            if name not in room_columns:
                db.execute(f'ALTER TABLE rooms ADD COLUMN {name} {kind}')
        db.execute('UPDATE rooms SET source_width=COALESCE(source_width,width),source_depth=COALESCE(source_depth,depth)')
        if 'is_deleted' not in {r['name'] for r in db.execute('PRAGMA table_info(projects)')}:
            db.execute('ALTER TABLE projects ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0')
        db.execute('PRAGMA user_version = 5')


def create_browser_session(user_id):
    token = secrets.token_urlsafe(32)
    with connection() as conn:
        conn.execute('INSERT INTO browser_sessions(token_hash,user_id) VALUES(?,?)',
                     (hashlib.sha256(token.encode()).hexdigest(), user_id))
    return token


def resume_browser_session(token):
    if not isinstance(token, str) or not 32 <= len(token) <= 128:
        return None
    with connection() as conn:
        row = conn.execute('SELECT user_id FROM browser_sessions WHERE token_hash=?',
                           (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
    return row['user_id'] if row else None


def revoke_browser_session(token):
    if not isinstance(token, str):
        return
    with connection() as conn:
        conn.execute('DELETE FROM browser_sessions WHERE token_hash=?',
                     (hashlib.sha256(token.encode()).hexdigest(),))


def normalize_address(address):
    value = address.strip().replace('-', ':').upper()
    parts = value.split(':')
    if len(parts) != 6 or any(len(p) != 2 or any(c not in '0123456789ABCDEF' for c in p) for p in parts):
        raise ValueError('Invalid Bluetooth address. Expected AA:BB:CC:11:22:33.')
    return value


def create_user(name, email=None, gender=None, age=None, theme='light', profile=None):
    with connection() as db:
        return db.execute('INSERT INTO users(name,email,gender,age,theme,profile_json) VALUES(?,?,?,?,?,?)',
                          (name.strip(), email, gender, age, theme, json.dumps(profile or {}, ensure_ascii=False))).lastrowid


def register_device(user_id, address, device_name=None):
    """Duplicate addresses raise an error; never silently reassign a device."""
    with connection() as db:
        return db.execute('INSERT INTO bluetooth_devices(user_id,bluetooth_address,device_name) VALUES(?,?,?)',
                          (user_id, normalize_address(address), device_name)).lastrowid


def get_user_by_bluetooth(address):
    """Lookup only. Does NOT verify live presence, connectivity or identity."""
    with connection() as db:
        row = db.execute('''SELECT u.* FROM users u JOIN bluetooth_devices d ON d.user_id=u.id
                            WHERE d.bluetooth_address=?''', (normalize_address(address),)).fetchone()
        if not row:
            return None
        user = dict(row)
        user['profile'] = json.loads(user.pop('profile_json'))
        return user


def seed_mohamed():
    """Repeatable setup; preserve existing account data and address ownership."""
    address = OWNER_PHONE_ADDRESS
    with connection() as db:
        row = db.execute('SELECT user_id FROM bluetooth_devices WHERE bluetooth_address=?', (address,)).fetchone()
        if row:
            return row['user_id']
        uid = db.execute("INSERT INTO users(name) VALUES('Mohamed')").lastrowid
        db.execute('INSERT INTO bluetooth_devices(user_id,bluetooth_address,device_name) VALUES(?,?,?)',
                   (uid, address, 'mohammed Bahaa'))
        return uid


def require_project(db, project_id, user_id):
    row = db.execute('SELECT * FROM projects WHERE id=? AND user_id=? AND is_deleted=0', (project_id, user_id)).fetchone()
    if not row:
        raise ValueError('Project not found for this user.')
    return dict(row)


def require_asset(db, asset_id, user_id, kind):
    if asset_id is not None and not db.execute('SELECT id FROM assets WHERE id=? AND user_id=? AND kind=?',
                                              (asset_id, user_id, kind)).fetchone():
        raise ValueError('Asset not found for this user or asset type is incorrect.')


def touch(db, project_id):
    db.execute("UPDATE projects SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revision=revision+1 WHERE id=?", (project_id,))


def create_project(user_id, name=None, description=''):
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        if name is None:
            names = {r['name'] for r in db.execute('SELECT name FROM projects WHERE user_id=?', (user_id,))}
            number = 1
            while f'Room {number}' in names:
                number += 1
            name = f'Room {number}'
        return db.execute('INSERT INTO projects(user_id,name,description) VALUES(?,?,?)',
                          (user_id, name.strip(), description)).lastrowid


def delete_project(user_id, project_id):
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        require_project(db, project_id, user_id)
        db.execute('DELETE FROM project_versions WHERE project_id=?', (project_id,))
        db.execute('DELETE FROM rooms WHERE project_id=?', (project_id,))
        # Keep the ID reserved so a stale tab cannot access a newly reused ID.
        db.execute('UPDATE projects SET is_deleted=1 WHERE id=? AND user_id=?', (project_id, user_id))


def list_projects(user_id):
    with connection() as db:
        return [dict(row) for row in db.execute('SELECT * FROM projects WHERE user_id=? AND is_deleted=0 ORDER BY updated_at DESC,id DESC', (user_id,))]


def import_glb(user_id, source_path, kind='room'):
    """Copy a self-contained GLB to local storage; save its relative path."""
    source = Path(source_path).resolve(strict=True)
    if source.suffix.lower() != '.glb' or not source.is_file():
        raise ValueError('Use a self-contained .glb file. Other formats are not imported yet.')
    STORAGE.mkdir(parents=True, exist_ok=True)
    target = STORAGE / (uuid.uuid4().hex + '.glb')
    try:
        shutil.copyfile(source, target)
        with connection() as db:
            return db.execute('INSERT INTO assets(user_id,original_name,relative_path,kind) VALUES(?,?,?,?)',
                              (user_id, source.name, target.relative_to(ROOT).as_posix(), kind)).lastrowid
    except Exception:
        target.unlink(missing_ok=True)
        raise


def positive_values(values):
    if any(not math.isfinite(float(v)) or float(v) <= 0 for v in values):
        raise ValueError('Dimensions and scales must be positive finite numbers.')


def save_room(user_id, project_id, name, width, depth, height, original_asset_id=None):
    """One room per project. Metres. None preserves an existing original model."""
    positive_values((width, depth, height))
    with connection() as db:
        require_project(db, project_id, user_id)
        existing = db.execute('SELECT original_asset_id FROM rooms WHERE project_id=?', (project_id,)).fetchone()
        if original_asset_id is None and existing:
            original_asset_id = existing['original_asset_id']
        require_asset(db, original_asset_id, user_id, 'room')
        db.execute('''INSERT INTO rooms(project_id,name,width,depth,height,original_asset_id) VALUES(?,?,?,?,?,?)
                      ON CONFLICT(project_id) DO UPDATE SET name=excluded.name,width=excluded.width,
                      depth=excluded.depth,height=excluded.height,original_asset_id=excluded.original_asset_id''',
                   (project_id, name, width, depth, height, original_asset_id))
        touch(db, project_id)
        return db.execute('SELECT id FROM rooms WHERE project_id=?', (project_id,)).fetchone()['id']


def add_object(user_id, project_id, name, category='furniture', asset_id=None):
    with connection() as db:
        require_project(db, project_id, user_id)
        require_asset(db, asset_id, user_id, 'furniture')
        room = db.execute('SELECT id FROM rooms WHERE project_id=?', (project_id,)).fetchone()
        if not room:
            raise ValueError('Create the room first.')
        oid = db.execute('INSERT INTO room_objects(room_id,name,category,asset_id) VALUES(?,?,?,?)',
                         (room['id'], name, category, asset_id)).lastrowid
        touch(db, project_id)
        return oid


def update_object(user_id, project_id, object_id, position, rotation, scale, is_deleted=False):
    """Position: metres. Rotation: radians (x,y,z). Scale: positive multipliers."""
    if any(len(v) != 3 for v in (position, rotation, scale)):
        raise ValueError('Position, rotation and scale each need three values.')
    values = (*position, *rotation, *scale)
    if any(not math.isfinite(float(v)) for v in values):
        raise ValueError('Transform values must be finite numbers.')
    positive_values(scale)
    with connection() as db:
        require_project(db, project_id, user_id)
        row = db.execute('''SELECT o.id FROM room_objects o JOIN rooms r ON r.id=o.room_id
                            WHERE o.id=? AND r.project_id=?''', (object_id, project_id)).fetchone()
        if not row:
            raise ValueError('Object not found in this project.')
        db.execute('''UPDATE room_objects SET position_x=?,position_y=?,position_z=?,rotation_x=?,rotation_y=?,
                      rotation_z=?,scale_x=?,scale_y=?,scale_z=?,is_deleted=? WHERE id=?''',
                   (*values, int(bool(is_deleted)), object_id))
        touch(db, project_id)


def project_data(db, user_id, project_id):
    project = require_project(db, project_id, user_id)
    room = db.execute('SELECT * FROM rooms WHERE project_id=?', (project_id,)).fetchone()
    return {'schema_version': 1, 'project': project, 'room': dict(room) if room else None,
            'objects': [dict(row) for row in db.execute('SELECT * FROM room_objects WHERE room_id=? ORDER BY id',
                                                       (room['id'],))] if room else []}


def get_project(user_id, project_id):
    with connection() as db:
        return project_data(db, user_id, project_id)


def get_asset(user_id, asset_id):
    with connection() as db:
        row = db.execute('SELECT * FROM assets WHERE id=? AND user_id=?', (asset_id, user_id)).fetchone()
        if not row:
            raise ValueError('Asset not found for this user.')
        return dict(row)


def save_version(user_id, project_id, label=''):
    """Atomic snapshot of room metadata and all object transforms, including removed objects."""
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        snapshot = project_data(db, user_id, project_id)
        number = db.execute('SELECT COALESCE(MAX(version_number),0)+1 FROM project_versions WHERE project_id=?',
                            (project_id,)).fetchone()[0]
        db.execute('INSERT INTO project_versions(project_id,version_number,label,snapshot_json) VALUES(?,?,?,?)',
                   (project_id, number, label, json.dumps(snapshot, ensure_ascii=False, allow_nan=False)))
        touch(db, project_id)
        return number


def list_versions(user_id, project_id):
    with connection() as db:
        require_project(db, project_id, user_id)
        return [dict(row) for row in db.execute('''SELECT version_number,label,created_at FROM project_versions
                                                  WHERE project_id=? ORDER BY version_number DESC''', (project_id,))]


def get_version(user_id, project_id, version_number):
    with connection() as db:
        require_project(db, project_id, user_id)
        row = db.execute('SELECT snapshot_json FROM project_versions WHERE project_id=? AND version_number=?',
                         (project_id, version_number)).fetchone()
        if not row:
            raise ValueError('Version not found.')
        return json.loads(row['snapshot_json'])


if __name__ == '__main__':
    init_database()
    user_id = seed_mohamed()
    print('Database ready:', DB_PATH)
    print('Mohamed user ID:', user_id)
    print('Registered Bluetooth address: AA:BB:CC:11:22:01')
    print('No Bluetooth scan or connection was performed.')


def set_user_theme(user_id, theme):
    if theme not in ('light', 'dark'):
        raise ValueError('Invalid theme.')
    with connection() as conn:
        if conn.execute('UPDATE users SET theme=? WHERE id=?', (theme, user_id)).rowcount != 1:
            raise ValueError('User not found.')


def revoke_all_browser_sessions():
    with connection() as conn:
        conn.execute('DELETE FROM browser_sessions')
