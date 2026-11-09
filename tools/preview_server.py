"""Disposable browser-review server; never edits the real database or stored assets."""
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aiohttp import web
import database as db
from model_store import import_demo
from server import create_app

if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='smartspace-preview-') as folder:
        db.ROOT = Path(folder)
        db.DB_PATH = db.ROOT / 'preview.db'
        db.STORAGE = db.ROOT / 'storage'
        db.init_database()
        for name, gender in [('Adam', 'male'), ('Nour', 'female')]:
            uid = db.create_user(name, gender=gender)
            db.register_device(uid, 'AA:BB:CC:11:22:' + ('31' if gender == 'male' else '32'))
            pid = db.create_project(uid, name + ' room')
            import_demo(uid, pid)
        print('Disposable preview: Bluetooth fixture selects Nour automatically', flush=True)
        web.run_app(create_app(port=8767, scanner=lambda: [{'address': 'AA:BB:CC:11:22:32', 'name': 'Preview phone'}]), host='127.0.0.1', port=8767)
