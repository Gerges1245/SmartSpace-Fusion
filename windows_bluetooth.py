"""Windows Bluetooth inquiry without the PyBluez socket discovery wrapper."""
import ctypes as ct
from ctypes import wintypes as wt
from datetime import datetime, timezone


class SystemTime(ct.Structure):
    _fields_ = [(name, wt.WORD) for name in
                ('year', 'month', 'weekday', 'day', 'hour', 'minute', 'second', 'milliseconds')]

    def timestamp(self):
        try:
            return datetime(self.year, self.month, self.day, self.hour, self.minute,
                            self.second, self.milliseconds * 1000, tzinfo=timezone.utc).timestamp()
        except ValueError:
            return 0


class DeviceInfo(ct.Structure):
    _fields_ = [('size', wt.DWORD), ('address', ct.c_ulonglong), ('device_class', wt.ULONG),
                ('connected', wt.BOOL), ('remembered', wt.BOOL), ('authenticated', wt.BOOL),
                ('last_seen', SystemTime), ('last_used', SystemTime), ('name', wt.WCHAR * 248)]


class SearchParams(ct.Structure):
    _fields_ = [('size', wt.DWORD), ('authenticated', wt.BOOL), ('remembered', wt.BOOL),
                ('unknown', wt.BOOL), ('connected', wt.BOOL), ('inquiry', wt.BOOL),
                ('timeout', ct.c_ubyte), ('radio', wt.HANDLE)]


def enumerate_devices(inquiry=True):
    api = ct.WinDLL('bthprops.cpl', use_last_error=True)
    api.BluetoothFindFirstDevice.argtypes = [ct.POINTER(SearchParams), ct.POINTER(DeviceInfo)]
    api.BluetoothFindFirstDevice.restype = wt.HANDLE
    api.BluetoothFindNextDevice.argtypes = [wt.HANDLE, ct.POINTER(DeviceInfo)]
    api.BluetoothFindNextDevice.restype = wt.BOOL
    api.BluetoothFindDeviceClose.argtypes = [wt.HANDLE]
    api.BluetoothFindDeviceClose.restype = wt.BOOL
    params = SearchParams(ct.sizeof(SearchParams), True, True, True, True, inquiry, 8, None)
    info = DeviceInfo()
    info.size = ct.sizeof(DeviceInfo)
    started = datetime.now(timezone.utc).timestamp()
    handle = api.BluetoothFindFirstDevice(ct.byref(params), ct.byref(info))
    if not handle:
        error = ct.get_last_error()
        if error in (0, 259):
            return []
        raise RuntimeError('Windows Bluetooth inquiry failed: ' + ct.FormatError(error))
    devices = []
    try:
        while True:
            raw = f'{info.address:012X}'
            devices.append({'address': ':'.join(raw[i:i+2] for i in range(0, 12, 2)),
                            'name': info.name or 'Unknown device',
                            'connected': bool(info.connected), 'remembered': bool(info.remembered),
                            'last_seen': info.last_seen.timestamp(),
                            'live': bool(info.connected) or info.last_seen.timestamp() >= started - 2})
            info = DeviceInfo()
            info.size = ct.sizeof(DeviceInfo)
            if not api.BluetoothFindNextDevice(handle, ct.byref(info)):
                error = ct.get_last_error()
                if error not in (0, 259):
                    raise RuntimeError('Windows Bluetooth enumeration failed: ' + ct.FormatError(error))
                break
    finally:
        api.BluetoothFindDeviceClose(handle)
    return devices


def discover():
    # Cached/paired records alone must not sign in an absent phone.
    return [{'address': d['address'], 'name': d['name']} for d in enumerate_devices() if d['live']]
