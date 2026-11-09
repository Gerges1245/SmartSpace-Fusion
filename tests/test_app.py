import json
import sys
import tempfile
import unittest
import asyncio
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aiohttp.test_utils import TestClient, TestServer
import database as db
import server
from setup_account import setup_account


class AppTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.patches = [patch.object(db, 'ROOT', root), patch.object(db, 'DB_PATH', root / 'test.db'),
                        patch.object(db, 'STORAGE', root / 'storage')]
        for item in self.patches:
            item.start()
        uid = setup_account()
        scanner = lambda: [{'address': 'AA:BB:CC:11:22:01', 'name': 'Test phone'},
                            {'address': 'AA:BB:CC:11:22:33', 'name': 'Unknown phone'}]
        self.app = server.create_app(scanner=scanner)
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()
        self.app['host'] = f'127.0.0.1:{self.client.port}'
        self.origin = f'http://{self.app["host"]}'

    async def asyncTearDown(self):
        await self.client.close()
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    async def send(self, ws, action, **data):
        await ws.send_json({'request_id': 1, 'action': action, **data})
        return await ws.receive_json()

    async def test_scan_select_profile_and_persistent_project(self):
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        result = await self.send(ws, 'scan')
        self.assertTrue(result['ok'])
        self.assertEqual(len(result['data']['accounts']), 1)
        result = await self.send(ws, 'select', address='AA:BB:CC:11:22:01')
        self.assertEqual(result['data']['name'], 'Mohamed Bahaa')
        self.assertEqual(result['data']['profile']['phone'], '01023590395')
        self.assertEqual(result['data']['projects'], [])
        created = await self.send(ws, 'create_project', name='Living room')
        self.assertEqual(created['data']['projects'][0]['name'], 'Living room')
        await ws.close()
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        denied = await self.send(ws, 'workspace')
        self.assertFalse(denied['ok'])
        await self.send(ws, 'scan')
        result = await self.send(ws, 'select', address='AA:BB:CC:11:22:01')
        self.assertEqual(len(result['data']['projects']), 1)
        await ws.close()

    async def test_unseen_devices_unregistered_devices_and_invalid_names(self):
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        self.assertFalse((await self.send(ws, 'select', address='AA:BB:CC:11:22:01'))['ok'])
        await self.send(ws, 'scan')
        self.assertFalse((await self.send(ws, 'select', address='AA:BB:CC:11:22:33'))['ok'])
        await self.send(ws, 'select', address='AA:BB:CC:11:22:01')
        self.assertFalse((await self.send(ws, 'create_project', name='   '))['ok'])
        await ws.close()

    async def test_mvp_room_library_save_and_user_isolation(self):
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        users = (await self.send(ws, 'list_users'))['data']
        first = users[0]['id']
        await self.select_account(ws, first)
        profile = (await self.send(ws, 'create_project', name='MVP room'))['data']
        project_id = profile['created_project_id']
        room = (await self.send(ws, 'open_project', project_id=project_id))['data']
        self.assertEqual(len(room['objects']), 6)
        self.assertGreaterEqual(len(room['library']), 20)
        self.assertEqual(sum(a['license'] == 'CC0' for a in room['library']), 8)
        self.assertEqual(sum(bool(a.get('bedroom_theme')) for a in room['library']), 12)
        self.assertEqual((await self.client.get(room['library'][0]['asset_url'])).status, 200)
        self.assertEqual((await self.client.get('/catalog/not-a-model.glb')).status, 404)
        model = await self.client.get(room['objects'][0]['asset_url'])
        self.assertEqual(model.status, 200)
        room = (await self.send(ws, 'add_furniture', project_id=project_id, catalog_id=room['library'][0]['id'], revision=room['project']['revision']))['data']
        self.assertEqual(len(room['objects']), 7)
        self.assertEqual(room['objects'][-1]['category'], 'catalog')
        self.assertEqual((await self.client.get(room['objects'][-1]['asset_url'])).status, 200)
        self.assertFalse((await self.send(ws, 'add_furniture', project_id=project_id, catalog_id='../smartspace.db'))['ok'])
        objects = [{'id': o['id'], 'position': [1, .2, -.5], 'rotation': [0, 1.2, 0],
                    'scale': [1.2, 1.2, 1.2], 'is_deleted': index == 0}
                   for index, o in enumerate(room['objects'])]
        self.assertTrue((await self.send(ws, 'save_layout', project_id=project_id, objects=objects, revision=room['project']['revision']))['ok'])
        await ws.close()
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        await self.select_account(ws, first)
        saved = (await self.send(ws, 'open_project', project_id=project_id))['data']
        self.assertEqual(saved['objects'][0]['position_x'], 1)
        self.assertEqual(saved['objects'][0]['scale_x'], 1.2)
        self.assertEqual(saved['objects'][0]['is_deleted'], 1)
        other = db.create_user('Second user')
        db.register_device(other, 'AA:BB:CC:11:22:33')
        await self.select_account(ws, other)
        self.assertEqual((await self.send(ws, 'workspace'))['data']['projects'], [])
        self.assertFalse((await self.send(ws, 'open_project', project_id=project_id))['ok'])
        self.assertFalse((await self.send(ws, 'add_furniture', project_id=project_id, catalog_id=room['library'][0]['id']))['ok'])
        await ws.close()

    async def select_account(self, ws, uid):
        await self.send(ws, 'sign_out')
        result = await self.send(ws, 'scan')
        account = next(a for a in result['data']['accounts'] if int(a['id']) == uid)
        return await self.send(ws, 'select', address=account['address'])

    async def test_bluetooth_entry_has_no_pin_or_manual_bypass(self):
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        female = db.create_user('Test user', gender='female')
        db.register_device(female, 'AA:BB:CC:11:22:33')
        self.assertFalse((await self.send(ws, 'select_user', user_id=female))['ok'])
        unlocked = await self.select_account(ws, female)
        self.assertTrue(unlocked['ok'])
        self.assertEqual(unlocked['data']['gender'], 'female')
        self.assertNotIn('pin_hash', unlocked['data'])
        await ws.close()

    async def test_bedroom_theme_uses_different_real_assets(self):
        from model_store import import_demo
        male = db.create_user('Bedroom male', gender='male')
        female = db.create_user('Bedroom female', gender='female')
        projects = []
        for uid in (male, female):
            pid = db.create_project(uid, 'Themed bedroom')
            import_demo(uid, pid)
            data = db.get_project(uid, pid)
            self.assertEqual({o['name'] for o in data['objects']},
                             {'Bed_01', 'Wardrobe_01', 'Desk_01', 'Chair_01', 'Rug_01', 'Plant_01'})
            bed = next(o for o in data['objects'] if o['name'] == 'Bed_01')
            asset = db.get_asset(uid, bed['asset_id'])
            content = (db.ROOT / asset['relative_path']).read_bytes()
            self.assertEqual(content[:4], b'glTF')
            projects.append(content)
        self.assertNotEqual(projects[0], projects[1])

    async def test_refresh_resumes_without_bluetooth_until_sign_out(self):
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        uid = (await self.send(ws, 'list_users'))['data'][0]['id']
        profile = (await self.select_account(ws, uid))['data']
        token = profile['session_token']
        pid = (await self.send(ws, 'create_project', name='Persistent session'))['data']['created_project_id']
        await ws.close()
        self.assertEqual(db.resume_browser_session(token), uid)
        # The phone can be absent after the first successful sign-in.
        self.app['scanner'] = lambda: (_ for _ in ()).throw(AssertionError('Refresh must not scan'))
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        resumed = await self.send(ws, 'resume_session', token=token)
        self.assertTrue(resumed['ok'])
        self.assertEqual(resumed['data']['id'], str(uid))
        room = (await self.send(ws, 'open_project', project_id=pid))['data']
        model_url = room['objects'][0]['asset_url']
        self.assertEqual((await self.client.get(model_url)).status, 200)
        other_tab = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        self.assertTrue((await self.send(other_tab, 'resume_session', token=token))['ok'])
        self.assertTrue((await self.send(ws, 'sign_out'))['ok'])
        self.assertIsNone(db.resume_browser_session(token))
        self.assertEqual((await self.client.get(model_url)).status, 403)
        self.assertEqual((await self.send(other_tab, 'workspace'))['error_code'], 'SESSION_INVALID')
        self.assertFalse((await self.send(ws, 'resume_session', token=token))['ok'])
        self.assertFalse((await self.send(ws, 'resume_session', token=str(uid)))['ok'])
        await ws.close()
        await other_tab.close()

    async def test_session_is_hashed_and_revoked_on_server_restart(self):
        uid = db.seed_mohamed()
        token = db.create_browser_session(uid)
        with db.connection() as conn:
            stored = conn.execute('SELECT token_hash FROM browser_sessions WHERE user_id=?', (uid,)).fetchone()[0]
        self.assertNotEqual(stored, token)
        app = server.create_app(scanner=lambda: [])
        async with TestClient(TestServer(app)) as client:
            app['host'] = f'127.0.0.1:{client.port}'
            ws = await client.ws_connect('/ws', headers={'Origin': f'http://{app["host"]}'})
            self.assertFalse((await self.send(ws, 'resume_session', token=token))['ok'])
            self.assertIsNone(db.resume_browser_session(token))
            await ws.close()

    async def test_multiple_device_configuration_is_repeatable_and_ordered(self):
        from bluetooth_control import register_configured_devices, match_devices
        config = db.ROOT / 'bluetooth_devices.json'
        config.write_text(json.dumps([
            {'name': 'Nour', 'gender': 'female', 'addresses': ['AA:BB:CC:11:22:41', 'AA:BB:CC:11:22:42']},
            {'name': 'Adam', 'gender': 'male', 'addresses': ['AA:BB:CC:11:22:43']}
        ]), encoding='utf-8')
        register_configured_devices(config)
        register_configured_devices(config)
        with db.connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM users WHERE name='Nour'").fetchone()[0], 1)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM bluetooth_devices').fetchone()[0], 4)
        found = match_devices([
            {'address': 'AA:BB:CC:11:22:43', 'name': 'Adam phone'},
            {'address': 'AA:BB:CC:11:22:42', 'name': 'Nour second phone'}
        ])
        self.assertEqual([a['name'] for a in found['accounts']], ['Nour', 'Adam'])
        self.assertEqual(found['accounts'][0]['address'], 'AA:BB:CC:11:22:42')

    async def test_stale_save_restore_and_reconnect(self):
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        uid = (await self.send(ws, 'list_users'))['data'][0]['id']
        await self.select_account(ws, uid)
        pid = (await self.send(ws, 'create_project', name='Regression room'))['data']['created_project_id']
        room = (await self.send(ws, 'open_project', project_id=pid))['data']
        old_url = room['objects'][0]['asset_url']
        revision = room['project']['revision']
        objects = [{'id': o['id'], 'position': [3, 0, 0], 'rotation': [0, 0, 0],
                    'scale': [1, 1, 1], 'is_deleted': False} for o in room['objects']]
        saved = await self.send(ws, 'save_layout', project_id=pid, objects=objects, revision=revision)
        self.assertTrue(saved['ok'])
        stale = await self.send(ws, 'save_layout', project_id=pid, objects=objects, revision=revision)
        self.assertFalse(stale['ok'])
        self.assertIn('another window', stale['error'])
        restored = await self.send(ws, 'restore_version', project_id=pid, version_number=1,
                                   revision=saved['data']['project']['revision'])
        self.assertTrue(restored['ok'])
        self.assertEqual(restored['data']['objects'][0]['position_x'], room['objects'][0]['position_x'])
        await ws.close()
        self.assertEqual((await self.client.get(old_url)).status, 403)
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        self.assertFalse((await self.send(ws, 'workspace'))['ok'])
        await self.select_account(ws, uid)
        reopened = (await self.send(ws, 'open_project', project_id=pid))['data']
        self.assertEqual((await self.client.get(reopened['objects'][0]['asset_url'])).status, 200)
        await ws.close()

    async def test_deleted_pieces_do_not_consume_capacity(self):
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        uid = (await self.send(ws, 'list_users'))['data'][0]['id']
        await self.select_account(ws, uid)
        pid = (await self.send(ws, 'create_project', name='Capacity room'))['data']['created_project_id']
        for _ in range(94):
            db.add_object(uid, pid, 'Removed item')
        with db.connection() as conn:
            conn.execute('UPDATE room_objects SET is_deleted=1')
        room = (await self.send(ws, 'open_project', project_id=pid))['data']
        added = await self.send(ws, 'add_furniture', project_id=pid, catalog_id=room['library'][0]['id'],
                                revision=room['project']['revision'])
        self.assertTrue(added['ok'])
        self.assertEqual(len(added['data']['objects']), 101)
        self.assertEqual(sum(not o['is_deleted'] for o in added['data']['objects']), 1)
        objects = [{'id': o['id'], 'position': [0, 0, 0], 'rotation': [0, 0, 0],
                    'scale': [1, 1, 1], 'is_deleted': bool(o['is_deleted'])} for o in added['data']['objects']]
        self.assertTrue((await self.send(ws, 'save_layout', project_id=pid, objects=objects,
                                        revision=added['data']['project']['revision']))['ok'])
        await ws.close()

    async def test_slow_model_copy_does_not_block_other_connections(self):
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        other = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        uid = (await self.send(ws, 'list_users'))['data'][0]['id']
        await self.select_account(ws, uid)
        import threading
        started = threading.Event()
        release = threading.Event()
        original = server.import_demo

        def slow_import(*args):
            started.set()
            release.wait(2)
            return original(*args)

        with patch.object(server, 'import_demo', slow_import):
            creating = asyncio.create_task(self.send(ws, 'create_project', name='Slow copy'))
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 1))
                users = await asyncio.wait_for(self.send(other, 'list_users'), timeout=1)
                self.assertTrue(users['ok'])
            finally:
                release.set()
                await creating
        await ws.close()
        await other.close()

    async def test_personal_database_is_not_served(self):
        self.assertEqual((await self.client.get('/smartspace.db')).status, 404)
        self.assertEqual((await self.client.get('/assets/../smartspace.db')).status, 404)
        response = await self.client.get('/ws', headers={'Origin': 'https://example.com'})
        self.assertEqual(response.status, 403)

    async def test_room_boundaries_finishes_save_validation_and_restore(self):
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        await self.send(ws, 'scan')
        await self.send(ws, 'select', address='AA:BB:CC:11:22:01')
        profile = (await self.send(ws, 'create_project', name='Object Sheet'))['data']
        pid = profile['created_project_id']
        room = (await self.send(ws, 'open_project', project_id=pid))['data']
        original_width = room['room']['width']
        original_source_width = room['room']['source_width']
        self.assertEqual((room['room']['width'], room['room']['depth']), (9, 6))
        objects = [{'id': o['id'], 'position': [o['position_'+a] for a in 'xyz'], 'rotation': [o['rotation_'+a] for a in 'xyz'], 'scale': [o['scale_'+a] for a in 'xyz'], 'is_deleted': bool(o['is_deleted'])} for o in room['objects']]
        saved = await self.send(ws, 'save_layout', project_id=pid, revision=room['project']['revision'], objects=objects, room_settings={'width': 7, 'depth': 6, 'floor_finish': 'walnut'})
        self.assertTrue(saved['ok'])
        room = saved['data']
        self.assertEqual(room['room']['width'], 7)
        self.assertEqual(room['room']['floor_finish'], 'walnut')
        self.assertEqual(room['room']['source_width'], original_source_width)
        revision = room['project']['revision']
        for settings in [{'width': 0, 'depth': 4}, {'width': 7, 'depth': 6, 'floor_finish': 'fake'}]:
            denied = await self.send(ws, 'save_layout', project_id=pid, revision=revision, objects=objects, room_settings=settings)
            self.assertFalse(denied['ok'])
        reopened = (await self.send(ws, 'open_project', project_id=pid))['data']
        self.assertEqual(reopened['project']['revision'], revision)
        self.assertEqual(reopened['room']['floor_finish'], 'walnut')
        restored = await self.send(ws, 'restore_version', project_id=pid, revision=revision, version_number=1)
        self.assertTrue(restored['ok'])
        self.assertEqual(restored['data']['room']['width'], original_width)
        self.assertEqual(restored['data']['room']['floor_finish'], 'original')
        await ws.close()

    async def test_shared_bedroom_catalog_both_styles_and_reuse(self):
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        await self.send(ws, 'scan')
        await self.send(ws, 'select', address='AA:BB:CC:11:22:01')
        profile = (await self.send(ws, 'create_project', name='Shared library'))['data']
        pid = profile['created_project_id']
        data = (await self.send(ws, 'open_project', project_id=pid))['data']
        for theme in ('male', 'female'):
            item = next(a for a in data['library'] if a['id'] == f'bedroom_{theme}_Bed_01')
            self.assertEqual((await self.client.get(item['asset_url'])).status, 200)
            first = (await self.send(ws, 'add_furniture', project_id=pid, revision=data['project']['revision'], catalog_id=item['id']))['data']
            asset_id = first['objects'][-1]['asset_id']
            data = (await self.send(ws, 'add_furniture', project_id=pid, revision=first['project']['revision'], catalog_id=item['id']))['data']
            self.assertEqual(data['objects'][-1]['asset_id'], asset_id)
        female = db.create_user('Shared female test', gender='female')
        db.register_device(female, 'AA:BB:CC:11:22:33')
        await self.select_account(ws, female)
        created = (await self.send(ws, 'create_project', name='Female shared library'))['data']
        other = (await self.send(ws, 'open_project', project_id=created['created_project_id']))['data']
        self.assertEqual({a['id'] for a in other['library']}, {a['id'] for a in data['library']})
        await ws.close()

    async def test_automatic_project_names_delete_and_user_isolation(self):
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        self.assertFalse((await self.send(ws, 'delete_project', project_id=1))['ok'])
        await self.send(ws, 'scan')
        await self.send(ws, 'select', address='AA:BB:CC:11:22:01')
        first = (await self.send(ws, 'create_project'))['data']
        one = first['created_project_id']
        self.assertEqual(next(p for p in first['projects'] if p['id'] == one)['name'], 'Room 1')
        second = (await self.send(ws, 'create_project'))['data']
        two = second['created_project_id']
        self.assertEqual(next(p for p in second['projects'] if p['id'] == two)['name'], 'Room 2')
        deleted = await self.send(ws, 'delete_project', project_id=one)
        self.assertTrue(deleted['ok'])
        self.assertNotIn(one, [p['id'] for p in deleted['data']['projects']])
        self.assertFalse((await self.send(ws, 'open_project', project_id=one))['ok'])
        self.assertFalse((await self.send(ws, 'delete_project', project_id=one))['ok'])
        with db.connection() as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM rooms WHERE project_id=?', (one,)).fetchone()[0], 0)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM project_versions WHERE project_id=?', (one,)).fetchone()[0], 0)
        third = (await self.send(ws, 'create_project'))['data']
        three = third['created_project_id']
        self.assertGreater(three, two)
        self.assertEqual(next(p for p in third['projects'] if p['id'] == three)['name'], 'Room 3')
        other = db.create_user('Other user')
        db.register_device(other, 'AA:BB:CC:11:22:33')
        await self.select_account(ws, other)
        self.assertFalse((await self.send(ws, 'delete_project', project_id=two))['ok'])
        own = (await self.send(ws, 'create_project'))['data']
        self.assertEqual(own['projects'][0]['name'], 'Room 1')
        self.assertEqual(len(db.list_projects(1)), 2)
        await ws.close()

    async def test_theme_is_authenticated_and_scoped_to_each_user(self):
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        self.assertFalse((await self.send(ws, 'set_theme', theme='dark'))['ok'])
        await self.send(ws, 'scan')
        profile = (await self.send(ws, 'select', address='AA:BB:CC:11:22:01'))['data']
        uid = int(profile['id'])
        other = db.create_user('Other account', theme='light')
        self.assertTrue((await self.send(ws, 'set_theme', theme='dark'))['ok'])
        self.assertEqual((await self.send(ws, 'workspace'))['data']['theme'], 'dark')
        with db.connection() as conn:
            self.assertEqual(conn.execute('SELECT theme FROM users WHERE id=?', (other,)).fetchone()['theme'], 'light')
        self.assertFalse((await self.send(ws, 'set_theme', theme='invalid'))['ok'])
        self.assertEqual((await self.send(ws, 'workspace'))['data']['theme'], 'dark')
        token = profile['session_token']
        await ws.close()
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        resumed = await self.send(ws, 'resume_session', token=token)
        self.assertEqual(resumed['data']['theme'], 'dark')
        self.assertEqual(int(resumed['data']['id']), uid)
        await ws.close()


    async def test_bluetooth_scan_stops_after_authentication(self):
        ws = await self.client.ws_connect('/ws', headers={'Origin': self.origin})
        await self.send(ws, 'scan')
        self.assertTrue((await self.send(ws, 'select', address='AA:BB:CC:11:22:01'))['ok'])
        self.app['scanner'] = lambda: (_ for _ in ()).throw(AssertionError('Must not scan after login'))
        result = await self.send(ws, 'scan')
        self.assertTrue(result['ok'])
        self.assertEqual(result['data']['devices'], [])
        await ws.close()

    async def test_wave_training_recognition_and_local_origin(self):
        from test_bye_bye import samples
        result=await self.client.get('/wave/status')
        self.assertFalse((await result.json())['ready'])
        rejected=await self.client.post('/wave/templates',json={'samples':samples()},headers={'Origin':'http://untrusted.invalid'})
        self.assertEqual(rejected.status,403)
        saved=await self.client.post('/wave/templates',json={'samples':samples()},headers={'Origin':self.origin})
        self.assertEqual(saved.status,200)
        self.assertTrue((await saved.json())['ready'])
        result=await self.client.post('/wave/recognize',json={'points':samples()['Bye Bye'][0]},headers={'Origin':self.origin})
        self.assertTrue((await result.json())['toggle'])
        result=await self.client.post('/wave/recognize',json={'points':samples()['Other'][0]},headers={'Origin':self.origin})
        self.assertFalse((await result.json())['toggle'])
        result=await self.client.post('/wave/templates',json={'samples':{}},headers={'Origin':self.origin})
        self.assertEqual(result.status,400)


if __name__ == '__main__':
    unittest.main()
