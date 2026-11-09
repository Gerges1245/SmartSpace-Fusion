
"""Bluetooth Classic discovery and MAC-based user matching."""

try:
    import bluetooth
except ImportError:
    bluetooth = None
import database as db


USERS = {
    "AA:BB:CC:11:22:01": "Mohammed",
    "AA:BB:CC:11:22:02": "Hanady",
    "AA:BB:CC:11:22:03": "Ayman (S23 Ultra)",
    "AA:BB:CC:11:22:04": "Ayman (S23 Ultra)"
}


def scan_bluetooth():
    print("Scanning Bluetooth Classic devices...\n", flush=True)

    if bluetooth is None:
        try:
            from windows_bluetooth import discover as win_discover
            return win_discover()
        except Exception as e:
            print(f"Bluetooth inquiry error: {e}", flush=True)
            return []

    try:
        devices = bluetooth.discover_devices(
            duration=5,
            lookup_names=True,
            flush_cache=True
        )

        results = []
        found = False

        for mac, name in devices:
            mac = mac.upper()

            print(f"Device: {name} | MAC: {mac}", flush=True)

            results.append({
                "address": mac,
                "name": name or "Unknown device"
            })

            if mac in USERS:
                print(f"\nWELCOME {USERS[mac]}!")
                print(f"Matched MAC: {mac}\n")
                found = True

        if not found:
            print("\nNo registered users found.")

        return results

    except Exception as e:
        print(f"Bluetooth Error: {e}", flush=True)
        raise RuntimeError("Bluetooth Error: " + str(e)) from e


def discover():
    return scan_bluetooth()


def match_devices(devices):
    found = {
        db.normalize_address(d["address"]): dict(d)
        for d in devices
    }

    accounts = []
    seen = set()

    with db.connection() as conn:
        linked = conn.execute("""
            SELECT
                d.bluetooth_address,
                d.user_id,
                u.name
            FROM bluetooth_devices d
            JOIN users u ON u.id = d.user_id
            ORDER BY d.id
        """).fetchall()

    for row in linked:
        address = db.normalize_address(row["bluetooth_address"])

        if address not in found:
            continue

        found[address]["linked_name"] = row["name"]

        if row["user_id"] not in seen:
            accounts.append({
                "id": str(row["user_id"]),
                "name": row["name"],
                "address": address
            })

            seen.add(row["user_id"])

    return {
        "devices": list(found.values()),
        "accounts": accounts
    }


def register_configured_devices(path):
    import json

    if not path.is_file():
        return

    entries = json.loads(
        path.read_text(encoding="utf-8-sig")
    )

    if not isinstance(entries, list):
        raise ValueError(
            "bluetooth_devices.json must contain a list."
        )

    with db.connection() as conn:
        conn.execute("BEGIN IMMEDIATE")

        for item in entries:
            if (
                not isinstance(item, dict)
                or not isinstance(item.get("name"), str)
                or not item["name"].strip()
            ):
                raise ValueError(
                    "Each Bluetooth user needs a name."
                )

            name = item["name"].strip()
            gender = item.get("gender")
            addresses = item.get("addresses")

            if (
                gender not in ("male", "female")
                or not isinstance(addresses, list)
                or not addresses
            ):
                raise ValueError(
                    "Each user needs gender and addresses."
                )

            addresses = [
                db.normalize_address(a)
                for a in addresses
            ]

            rows = conn.execute(
                "SELECT id FROM users WHERE name=?",
                (name,)
            ).fetchall()

            if len(rows) > 1:
                raise ValueError(
                    "Multiple accounts: " + name
                )

            if rows:
                uid = rows[0]["id"]
            else:
                uid = conn.execute(
                    "INSERT INTO users(name,gender) VALUES(?,?)",
                    (name, gender)
                ).lastrowid

            conn.execute(
                "UPDATE users SET gender=? WHERE id=?",
                (gender, uid)
            )

            for address in addresses:
                old = conn.execute(
                    "SELECT user_id FROM bluetooth_devices "
                    "WHERE bluetooth_address=?",
                    (address,)
                ).fetchone()

                if old and old["user_id"] != uid:
                    raise ValueError(
                        "Address already linked: " + address
                    )

                if not old:
                    conn.execute(
                        "INSERT INTO bluetooth_devices"
                        "(user_id,bluetooth_address) VALUES(?,?)",
                        (uid, address)
                    )


if __name__ == "__main__":
    scan_bluetooth()
