"""Initialize the local database and the account supplied by its owner."""
import database as db


def setup_account():
    db.init_database()
    uid = db.seed_mohamed()
    with db.connection() as conn:
        # Seed only blank defaults; preserve subsequent edits by the user.
        user = conn.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
        profile = db.json.loads(user['profile_json'])
        profile.setdefault('phone', '01023590395')
        profile.setdefault('occupation', 'Student')
        conn.execute('''UPDATE users SET name=?, email=COALESCE(email,?),
                        gender=COALESCE(gender,?), age=COALESCE(age,?), profile_json=? WHERE id=?''',
                     ('Mohamed Bahaa' if user['name'] == 'Mohamed' else user['name'],
                      'hm1757907@gmail.com', 'male', 21,
                      db.json.dumps(profile, ensure_ascii=False), uid))
    from bluetooth_control import register_configured_devices
    register_configured_devices(db.ROOT / 'bluetooth_devices.json')
    return uid


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Set up local SmartSpace accounts.')
    parser.add_argument('--add-user', metavar='NAME')
    parser.add_argument('--gender', choices=['female', 'male'])
    parser.add_argument('--bluetooth', metavar='AA:BB:CC:11:22:33')
    args = parser.parse_args()
    if args.add_user:
        if not args.add_user.strip():
            parser.error('Name cannot be empty.')
        address = db.normalize_address(args.bluetooth) if args.bluetooth else None
        db.init_database()
        if address and db.get_user_by_bluetooth(address):
            parser.error('This Bluetooth address is already linked to an account.')
        uid = db.create_user(args.add_user, gender=args.gender)
        if address:
            db.register_device(uid, address)
        print('Account ready. Bluetooth entry is automatic. User ID:', uid)
    else:
        print('Account ready. User ID:', setup_account())
