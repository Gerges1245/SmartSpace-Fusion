import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools'))
from bye_bye_gesture import ByeByeRecognizer, FEATURE


def wave(i):
    # Hand swings around the wrist: roll oscillates, palm barely moves (like the Hands/Bye videos).
    return [[.5+.02*math.sin(j/30*3*math.pi), .5, (.45+i*.05)*math.sin(j/30*3*math.pi)] for j in range(31)]


def other(i):
    # Hand moves up/down while keeping its orientation.
    return [[.5, .5+(.12+i*.01)*math.sin(j/30*2*math.pi), .05*math.sin(j/30*4*math.pi)] for j in range(31)]


def samples():
    return {'Bye Bye': [wave(i) for i in range(5)], 'Other': [other(i) for i in range(5)]}


class ByeByeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)/'samples.json'
        self.recognizer = ByeByeRecognizer(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def test_missing_data_and_recorded_sample_roundtrip(self):
        self.assertFalse(self.recognizer.status()['ready'])
        self.assertFalse(self.recognizer.recognize(samples()['Bye Bye'][0])['toggle'])
        self.assertTrue(self.recognizer.save(samples())['ready'])
        self.assertEqual(self.recognizer.status()['counts'], {'Bye Bye': 5, 'Other': 5})
        before = self.path.read_bytes()
        for _ in range(2):
            result = self.recognizer.recognize(samples()['Bye Bye'][0])
            self.assertTrue(result['toggle'])
            self.assertEqual(result['name'], 'Bye Bye')
        self.assertEqual(self.path.read_bytes(), before, 'DollarPy must not mutate stored recordings')

    def test_negative_motion_stillness_and_single_sweep(self):
        self.recognizer.save(samples())
        self.assertFalse(self.recognizer.recognize(samples()['Other'][0])['toggle'])
        self.assertFalse(self.recognizer.recognize([[.5, .5, 0]]*30)['toggle'])
        self.assertFalse(self.recognizer.recognize([[.2+i*.01, .5, -.6+i*.02] for i in range(60)])['toggle'], 'one tilt is not a wave')

    def test_low_frame_rate_resampling(self):
        self.recognizer.save(samples())
        self.assertTrue(self.recognizer.recognize(wave(0)[::3])['toggle'])

    def test_bad_data_does_not_replace_saved_samples(self):
        self.recognizer.save(samples())
        before = self.path.read_bytes()
        with self.assertRaises(ValueError):
            self.recognizer.save({'Bye Bye': [], 'Other': []})
        with self.assertRaises(ValueError):
            self.recognizer.recognize([[float('nan'), .5, 0]]*20)
        with self.assertRaises(ValueError):
            self.recognizer.recognize([[.5, .5]]*20)
        self.assertEqual(self.path.read_bytes(), before)

    def test_user_recordings_are_added_to_video_templates(self):
        self.recognizer.write({'feature': FEATURE, 'source': 'videos', 'samples': samples()})
        status = self.recognizer.save(samples())
        self.assertEqual(status['counts'], {'Bye Bye': 10, 'Other': 10})
        self.assertEqual(json.loads(self.path.read_text())['source'], 'videos')


class VideoTrainedTemplatesTests(unittest.TestCase):
    """The shipped bye_bye_templates.json is trained from Hands/ and must work on those videos."""

    def test_shipped_templates_on_recorded_videos(self):
        import train_bye_from_videos as trainer
        recognizer = ByeByeRecognizer(ROOT/'bye_bye_templates.json')
        self.assertTrue(recognizer.status()['ready'])
        samples = recognizer.load()
        videos = trainer.load_videos(False)
        fired = {v['name']: any(trainer.triggers(samples, t, recognizer.threshold)[0] for t in v['tracks']) for v in videos}
        others = [v['name'] for v in videos if v['label'] == 'Other']
        byes = [v['name'] for v in videos if v['label'] == 'Bye Bye']
        self.assertFalse(any(fired[n] for n in others), 'Other videos must never switch the theme')
        self.assertGreaterEqual(sum(fired[n] for n in byes), 5)


if __name__ == '__main__':
    unittest.main()
