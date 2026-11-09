import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import bluetooth_control


class BluetoothDiscoveryTests(unittest.TestCase):
    def test_original_library_discovers_both_phone_addresses(self):
        scan = Mock(return_value=[('AA:BB:CC:11:22:01', 'Mohammed phone'), ('AA:BB:CC:11:22:02', 'iPhone')])
        with patch.dict(sys.modules, {'bluetooth': SimpleNamespace(discover_devices=scan)}), patch.object(bluetooth_control, 'bluetooth', SimpleNamespace(discover_devices=scan), create=True):
            devices = bluetooth_control.discover()
        scan.assert_called_once_with(lookup_names=True, duration=5, flush_cache=True)
        self.assertEqual([d['address'] for d in devices],
                         ['AA:BB:CC:11:22:01', 'AA:BB:CC:11:22:02'])

    def test_empty_search_does_not_invent_presence(self):
        with patch.dict(sys.modules, {'bluetooth': SimpleNamespace(discover_devices=lambda **kwargs: [])}), patch.object(bluetooth_control, 'bluetooth', SimpleNamespace(discover_devices=lambda **kwargs: []), create=True):
            self.assertEqual(bluetooth_control.discover(), [])

    def test_scan_error_is_reported_to_the_page(self):
        scan = Mock(side_effect=OSError('adapter error'))
        with patch.dict(sys.modules, {'bluetooth': SimpleNamespace(discover_devices=scan)}), patch.object(bluetooth_control, 'bluetooth', SimpleNamespace(discover_devices=scan), create=True):
            with self.assertRaisesRegex(RuntimeError, 'Bluetooth Error: adapter error'):
                bluetooth_control.discover()
