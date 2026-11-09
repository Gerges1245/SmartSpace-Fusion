import unittest
from unittest.mock import patch
import windows_bluetooth as native


class WindowsDiscoveryTests(unittest.TestCase):
    def test_cached_absent_device_does_not_select_user(self):
        devices = [
            {'address': 'AA:BB:CC:11:22:33', 'name': 'Cached phone', 'live': False},
            {'address': 'AA:BB:CC:11:22:34', 'name': 'Present phone', 'live': True},
        ]
        with patch.object(native, 'enumerate_devices', return_value=devices):
            self.assertEqual(native.discover(), [{'address': 'AA:BB:CC:11:22:34', 'name': 'Present phone'}])

    def test_empty_windows_timestamp_is_not_recent(self):
        self.assertEqual(native.SystemTime().timestamp(), 0)
