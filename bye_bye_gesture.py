import json
import math
import os
import tempfile
from pathlib import Path
from dollarpy import Recognizer, Template, Point

LABELS = ('Bye Bye', 'Other')
FEATURE = 'time-roll'
# Minimum roll swing (radians) inside the window. Bye Bye videos swing 0.6-1.2 rad, Other <= 0.4.
ROLL_GATE = .35
ROLL_STEP = .12
MAX_TEMPLATES = 200


def validate_points(points, allow_stationary=False):
    if not isinstance(points, list) or not 8 <= len(points) <= 240:
        raise ValueError('Record at least 8 visible hand frames over three seconds.')
    result = []
    for point in points:
        if not isinstance(point, (list, tuple)) or len(point) != 3 or any(type(v) not in (int, float) or not math.isfinite(v) for v in point):
            raise ValueError('Invalid palm coordinates.')
        x, y, roll = (float(v) for v in point)
        if not (-.25 <= x <= 1.25 and -.25 <= y <= 1.25 and -math.pi - 1e-6 <= roll <= math.pi + 1e-6):
            raise ValueError('Invalid palm coordinates.')
        result.append((x, y, roll))
    if not allow_stationary and max(max(p[a] for p in result)-min(p[a] for p in result) for a in (0, 1, 2)) < .0001:
        raise ValueError('Move your hand while recording this sample.')
    return result


def unwrap(values):
    out = [values[0]]
    for v in values[1:]:
        d = v - out[-1]
        d -= 2 * math.pi * round(d / (2 * math.pi))
        out.append(out[-1] + d)
    return out


def roll_reversals(rolls, step=ROLL_STEP):
    direction = reversals = 0
    anchor = rolls[0]
    for r in rolls[1:]:
        delta = r - anchor
        if abs(delta) < step:
            continue
        current = 1 if delta > 0 else -1
        if direction and current != direction:
            reversals += 1
        direction = current
        anchor = r
    return reversals


def roll_swing(points):
    rolls = unwrap([p[2] for p in points])
    return max(rolls) - min(rolls), roll_reversals(rolls)


def to_dollar(points):
    """(normalised time, roll) curve; fresh Point objects because DollarPy mutates its input."""
    rolls = unwrap([p[2] for p in points])
    n = len(rolls) - 1
    return [Point(i / n, r, 1) for i, r in enumerate(rolls)]


class ByeByeRecognizer:
    def __init__(self, path):
        self.path = Path(path)
        self.threshold = .35

    def _read(self):
        if not self.path.exists():
            return None
        data = json.loads(self.path.read_text(encoding='utf-8-sig'))
        if not isinstance(data, dict) or data.get('feature') != FEATURE:
            raise ValueError('Old Bye Bye templates. Run tools/train_bye_from_videos.py.')
        return data

    def load(self):
        data = self._read()
        if data is None:
            return None
        merged = {}
        for label in LABELS:
            items = list((data.get('samples') or {}).get(label) or []) + list((data.get('user_samples') or {}).get(label) or [])
            if not 5 <= len(items) <= MAX_TEMPLATES:
                raise ValueError('Record five samples for each gesture.')
            merged[label] = [validate_points(sample) for sample in items]
        return merged

    def status(self):
        try:
            samples = self.load()
            data = self._read() if samples else None
            return {'ready': samples is not None, 'counts': {label: len(samples[label]) if samples else 0 for label in LABELS},
                    'threshold': self.threshold, 'source': (data or {}).get('source')}
        except (ValueError, OSError) as error:
            return {'ready': False, 'counts': {label: 0 for label in LABELS}, 'error': str(error)}

    def save(self, samples):
        """Add in-app recordings to the video-trained templates (they are kept, not replaced)."""
        if not isinstance(samples, dict) or set(samples) != set(LABELS) or any(not isinstance(samples[label], list) or not 5 <= len(samples[label]) <= 20 for label in LABELS):
            raise ValueError('Record five Bye Bye and five Other samples before saving.')
        clean = {label: [validate_points(sample) for sample in samples[label]] for label in LABELS}
        try:
            data = self._read() or {}
        except ValueError:
            data = {}
        data['feature'] = FEATURE
        data.setdefault('source', 'In-app MediaPipe recordings')
        data.setdefault('samples', {label: [] for label in LABELS})
        data['user_samples'] = clean
        self.write(data)
        return self.status()

    def write(self, data):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=self.path.parent, prefix='.wave-', suffix='.json', delete=False) as file:
                temporary = Path(file.name)
                json.dump(data, file)
            os.replace(temporary, self.path)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()

    @staticmethod
    def classify(samples, points, threshold):
        swing, reversals = roll_swing(points)
        # Stillness, a pose change or a single sweep is not a wave: require a real back-and-forth swing.
        if swing < ROLL_GATE or reversals < 1:
            return {'name': None, 'score': 0, 'toggle': False, 'swing': round(swing, 3)}
        templates = [Template(label, to_dollar(sample)) for label, examples in samples.items() for sample in examples]
        name, score = Recognizer(templates).recognize(to_dollar(points))
        return {'name': name, 'score': round(score, 4), 'toggle': name == 'Bye Bye' and score >= threshold, 'swing': round(swing, 3)}

    def recognize(self, points):
        samples = self.load()
        if samples is None:
            return {'ready': False, 'name': None, 'score': 0, 'toggle': False}
        points = validate_points(points, allow_stationary=True)
        return {'ready': True, **self.classify(samples, points, self.threshold)}
