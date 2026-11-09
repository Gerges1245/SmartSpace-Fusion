import argparse
import asyncio
import json
import secrets
import webbrowser
from pathlib import Path

from aiohttp import WSMsgType, web

import database as db
import furniture_catalog as catalog
from setup_account import setup_account
from model_store import import_demo, save_layout, apply_template, get_templates
from bye_bye_gesture import ByeByeRecognizer

ROOT = Path(__file__).resolve().parent


from bluetooth_control import discover, match_devices
from model_store import restore_version


def workspace(user_id):
    with db.connection() as conn:
        row = conn.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
    if not row:
        raise ValueError('Account no longer exists.')
    user = dict(row)
    user.pop('pin_hash', None)
    user['profile'] = json.loads(user.pop('profile_json'))
    user['initials'] = ''.join(w[0] for w in user['name'].split()[:2])
    user['id'] = str(user['id'])
    user['projects'] = []
    for project in db.list_projects(user_id):
        data = db.get_project(user_id, project['id'])
        room = data['room']
        user['projects'].append({**project, 'date': project['updated_at'][:10],
                                 'size': f"{room['width']:.2f} x {room['depth']:.2f} m" if room else 'Room not imported',
                                 'pieces': sum(not o['is_deleted'] for o in data['objects']), 'color': '#a3af96'})
    return user


@web.middleware
async def local_only(request, handler):
    expected_host = request.app['host']
    if request.host != expected_host:
        raise web.HTTPForbidden(text='Use the local 127.0.0.1 address.')
    if request.path in ('/ws', '/wave/recognize', '/wave/templates') and request.headers.get('Origin') != f'http://{expected_host}':
        raise web.HTTPForbidden(text='Open SmartSpace from its local page.')
    response = await handler(request)
    if not response.prepared:
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


def project_action(user_id, payload, asset_token):
    action = payload['action']
    project_id = int(payload.get('project_id', 0))
    if action in ('import_demo', 'apply_template'):
        apply_template(user_id, project_id, template_id=payload.get('template_id'), replace=payload.get('replace', action == 'apply_template'))
    if action in ('save_layout', 'restore_version'):
        revision = payload.get('revision')
        if type(revision) is not int:
            raise ValueError('Reopen this room before saving.')
        if action == 'save_layout':
            save_layout(user_id, project_id, payload.get('objects'), revision, payload.get('room_settings'))
        else:
            restore_version(user_id, project_id, int(payload.get('version_number', 0)), revision)
    if action == 'add_furniture':
        with db.connection() as conn:
            project = db.require_project(conn, project_id, user_id)
            if payload.get('revision') != project['revision']:
                raise ValueError('This room changed in another window. Reopen it before adding furniture.')
            count = conn.execute('SELECT COUNT(*) FROM room_objects o JOIN rooms r ON r.id=o.room_id WHERE r.project_id=? AND o.is_deleted=0', (project_id,)).fetchone()[0]
            if count >= 100:
                raise ValueError('This room supports up to 100 visible pieces. Remove a piece first.')
        if payload.get('catalog_id'):
            catalog.add_to_project(user_id, project_id, str(payload['catalog_id']))
        else:
            asset_id = int(payload.get('asset_id', 0))
            asset = db.get_asset(user_id, asset_id)
            db.add_object(user_id, project_id, Path(asset['original_name']).stem, asset_id=asset_id)
    result = db.get_project(user_id, project_id)
    result['versions'] = db.list_versions(user_id, project_id)
    result['templates'] = get_templates()
    result['library'] = [{**item, 'asset_url': f"/catalog/{item['id']}.glb"} for item in catalog.entries()]
    if result['room']:
        result['room']['asset_url'] = f"/models/{result['room']['original_asset_id']}?token={asset_token}"
    for obj in result['objects']:
        obj['asset_url'] = f"/models/{obj['asset_id']}?token={asset_token}" if obj['asset_id'] else None
    return result


async def socket_handler(request):
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=4 * 1024 * 1024)
    await ws.prepare(request)
    user_id = None
    session_token = None
    asset_token = secrets.token_urlsafe(32)
    detected_addresses = set()
    async for message in ws:
        if message.type != WSMsgType.TEXT:
            continue
        request_id = None
        try:
            payload = json.loads(message.data)
            if not isinstance(payload, dict):
                raise ValueError('Invalid request.')
            request_id = payload.get('request_id')
            action = payload.get('action')
            if user_id is not None and await asyncio.to_thread(db.resume_browser_session, session_token) != user_id:
                request.app['asset_tokens'].pop(asset_token, None)
                request.app['asset_sessions'].pop(asset_token, None)
                user_id = None
                session_token = None
                await ws.send_json({'request_id': request_id, 'ok': False, 'error': 'This session was signed out.', 'error_code': 'SESSION_INVALID'})
                continue
            if action == 'resume_session':
                restored = await asyncio.to_thread(db.resume_browser_session, payload.get('token'))
                if restored is None:
                    await ws.send_json({'request_id': request_id, 'ok': False, 'error': 'This session is no longer available.', 'error_code': 'SESSION_INVALID'})
                    continue
                user_id = restored
                session_token = payload['token']
                request.app['asset_tokens'][asset_token] = user_id
                request.app['asset_sessions'][asset_token] = session_token
                result = await asyncio.to_thread(workspace, user_id)
            elif action == 'sign_out':
                await asyncio.to_thread(db.revoke_browser_session, session_token)
                for key, token in list(request.app['asset_sessions'].items()):
                    if token == session_token:
                        request.app['asset_tokens'].pop(key, None)
                        request.app['asset_sessions'].pop(key, None)
                user_id = None
                session_token = None
                result = {'signed_out': True}
            elif action == 'list_users':
                with db.connection() as conn:
                    result = [dict(row) for row in conn.execute('SELECT id,name,gender FROM users ORDER BY id')]
            elif action == 'scan':
                detected_addresses.clear()
                lock = request.app['scan_lock']
                if lock.locked():
                    raise ValueError('A Bluetooth scan is already running. Try again shortly.')
                async with lock:
                    devices = [] if user_id is not None else await asyncio.to_thread(request.app['scanner'])
                result = await asyncio.to_thread(match_devices, devices)
                detected_addresses = {d['address'] for d in devices}
            elif action == 'select':
                address = db.normalize_address(str(payload.get('address', '')))
                if address not in detected_addresses:
                    raise ValueError('Choose a device returned by this page scan.')
                account = db.get_user_by_bluetooth(address)
                if not account:
                    raise ValueError('No account is linked to this address.')
                user_id = account['id']
                if session_token:
                    await asyncio.to_thread(db.revoke_browser_session, session_token)
                session_token = await asyncio.to_thread(db.create_browser_session, user_id)
                request.app['asset_tokens'][asset_token] = user_id
                request.app['asset_sessions'][asset_token] = session_token
                result = await asyncio.to_thread(workspace, user_id)
                result['session_token'] = session_token
            elif action == 'workspace':
                if user_id is None:
                    raise ValueError('Choose your account first.')
                result = await asyncio.to_thread(workspace, user_id)
            elif action == 'set_theme':
                if user_id is None:
                    raise ValueError('Choose your account first.')
                theme = payload.get('theme')
                if theme not in ('light', 'dark'):
                    raise ValueError('Invalid theme.')
                async with request.app['mutation_lock']:
                    await asyncio.to_thread(db.set_user_theme, user_id, theme)
                result = {'theme': theme}
            elif action == 'create_project':
                if user_id is None:
                    raise ValueError('Choose your account first.')
                name = None if payload.get('name') is None else str(payload['name']).strip()
                if name is not None and not 1 <= len(name) <= 100:
                    raise ValueError('Project name must be between 1 and 100 characters.')
                project_id = await asyncio.to_thread(db.create_project, user_id, name)
                try:
                    await asyncio.to_thread(import_demo, user_id, project_id)
                except Exception:
                    with db.connection() as conn:
                        conn.execute('DELETE FROM projects WHERE id=? AND user_id=?', (project_id, user_id))
                    raise
                result = await asyncio.to_thread(workspace, user_id)
                result['created_project_id'] = project_id
            elif action == 'delete_project':
                if user_id is None:
                    raise ValueError('Choose your account first.')
                project_id = payload.get('project_id')
                if type(project_id) is not int:
                    raise ValueError('Invalid project.')
                async with request.app['mutation_lock']:
                    await asyncio.to_thread(db.delete_project, user_id, project_id)
                result = await asyncio.to_thread(workspace, user_id)
                result['deleted_project_id'] = project_id
            elif action in ('open_project', 'import_demo', 'apply_template', 'save_layout', 'add_furniture', 'restore_version'):
                if user_id is None:
                    raise ValueError('Choose your account first.')
                async with request.app['mutation_lock']:
                    result = await asyncio.to_thread(project_action, user_id, payload, asset_token)
            else:
                raise ValueError('Unknown action.')
            await ws.send_json({'request_id': request_id, 'ok': True, 'data': result})
        except ImportError:
            await ws.send_json({'request_id': request_id, 'ok': False, 'error': 'Install requirements.txt in your hci_project environment, then restart the server.'})
        except (ValueError, RuntimeError, FileNotFoundError) as error:
            await ws.send_json({'request_id': request_id, 'ok': False, 'error': str(error)})
        except Exception as error:
            print('Request failed:', type(error).__name__, str(error))
            await ws.send_json({'request_id': request_id, 'ok': False, 'error': 'Request failed. Check Bluetooth and the Python server window.'})
    request.app['asset_tokens'].pop(asset_token, None)
    request.app['asset_sessions'].pop(asset_token, None)
    return ws


async def index(request):
    return web.FileResponse(ROOT / 'frontend' / 'index.html')


async def model_file(request):
    token = request.query.get('token')
    user_id = request.app['asset_tokens'].get(token)
    if user_id is None:
        raise web.HTTPForbidden()
    if await asyncio.to_thread(db.resume_browser_session, request.app['asset_sessions'].get(token)) != user_id:
        raise web.HTTPForbidden()
    try:
        asset = db.get_asset(user_id, int(request.match_info['asset_id']))
        path = (db.ROOT / asset['relative_path']).resolve()
        if not path.is_relative_to(db.STORAGE.resolve()):
            raise ValueError('Invalid asset path.')
        if not path.is_file():
            raise FileNotFoundError()
    except (ValueError, FileNotFoundError):
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers={'Content-Type': 'model/gltf-binary'})


async def catalog_file(request):
    try:
        path = catalog.asset_path(request.match_info['catalog_id'])
    except (ValueError, FileNotFoundError):
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers={'Content-Type': 'model/gltf-binary'})


async def wave_status(request):
    return web.json_response(await asyncio.to_thread(request.app['wave_recognizer'].status))


async def wave_recognize(request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError('Invalid wave request.')
        result = await asyncio.to_thread(request.app['wave_recognizer'].recognize, payload.get('points'))
        return web.json_response(result)
    except (ValueError, TypeError) as error:
        return web.json_response({'error': str(error)}, status=400)


async def wave_templates(request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError('Invalid training data.')
        result = await asyncio.to_thread(request.app['wave_recognizer'].save, payload.get('samples'))
        return web.json_response(result)
    except (ValueError, TypeError) as error:
        return web.json_response({'error': str(error)}, status=400)


async def clear_server_sessions(app):
    # Startup also clears tokens left behind by a crash or forced process stop.
    await asyncio.to_thread(db.revoke_all_browser_sessions)


def create_app(port=8766, scanner=None):
    app = web.Application(middlewares=[local_only])
    app['host'] = f'127.0.0.1:{port}'
    app['scan_lock'] = asyncio.Lock()
    app['mutation_lock'] = asyncio.Lock()
    app['scanner'] = scanner or discover
    app['asset_tokens'] = {}
    app['asset_sessions'] = {}
    app['wave_recognizer'] = ByeByeRecognizer(db.ROOT / 'bye_bye_templates.json')
    app.on_startup.append(clear_server_sessions)
    app.on_cleanup.append(clear_server_sessions)
    app.router.add_get('/', index)
    app.router.add_get('/ws', socket_handler)
    app.router.add_get('/wave/status', wave_status)
    app.router.add_post('/wave/recognize', wave_recognize)
    app.router.add_post('/wave/templates', wave_templates)
    app.router.add_get('/models/{asset_id}', model_file)
    app.router.add_get('/catalog/{catalog_id}.glb', catalog_file)
    # Only frontend files are served; the database and personal details file are not public routes.
    app.router.add_static('/assets/', ROOT / 'frontend', show_index=False)
    app.router.add_static('/templates/', ROOT / 'templates', show_index=False)
    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    setup_account()
    app = create_app(args.port)
    if not args.no_browser:
        async def open_page(app):
            async def delayed_open():
                await asyncio.sleep(1)
                await asyncio.to_thread(webbrowser.open, f'http://127.0.0.1:{args.port}')
            app['browser_task'] = asyncio.create_task(delayed_open())
        app.on_startup.append(open_page)
    print('Keep this terminal open. Press Ctrl+C to stop.')
    web.run_app(app, host='127.0.0.1', port=args.port)


if __name__ == '__main__':
    main()
