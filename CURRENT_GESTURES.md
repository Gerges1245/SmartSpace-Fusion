# SmartSpace Fusion

Run START.bat and open http://127.0.0.1:8770. Allow camera access, then reload with Ctrl+F5 after updating files.

## Hand controls

- Either hand can become the active pointer. Both detected hands are visible; one pointer controls actions at a time.
- Index finger: hold over furniture for 0.5 seconds to select and drag. Move while pointing.
- Close the controlling hand into a fist to release. Open it fully while holding furniture to delete the piece.
- V sign: undo. OK sign: redo.
- Point at a button for 0.5 seconds for one click. Move away and return to repeat. Entering the sidebar ends dragging but keeps the furniture selected.
- Three fingers / L: library. Four fingers with thumb folded / T: controls.
- Two open palms: move apart/together to zoom. Two index fingers: hold one steady and move the other to turn/tilt the view.
- Keep hands inside the camera guide. Identity retention, pointer filtering and stable button dwell remain enabled.

## Saving and accounts

Changes save automatically after editing pauses. Furniture movement respects room bounds and overlap checks; rugs can sit below furniture. Each account stores its own light/dark theme. Bluetooth discovery stops once the user signs in. Refresh restores the session and last room while the server is running. Stopping/restarting the server invalidates the session, and Bluetooth search resumes automatically.

## Implementation and checks

MediaPipe Hands provides landmarks. Local JavaScript rules classify poses. DollarPy is used only for the Bye Bye theme gesture; other controls keep their existing local rules.

frontend/hand-controls.js manages the active hand pointer; frontend/button-dwell.js handles stable button activation; frontend/reference/hand-identity.js retains hand identities across short dropouts; frontend/reference/vision.js runs the two-hand detector.

Checks: node tools/test_hand_controls.mjs; node tools/test_button_dwell.mjs; node tools/test_hand_identity.mjs; node tools/test_studio.mjs; Python unittest discovery in the hci_project environment. Camera accuracy still needs real-world testing.

## Bye Bye theme gesture (DollarPy)

This integrates the palm-trajectory recording and DollarPy workflow in Untitled-1.ipynb. The original notebook saved output logs but did not contain its recorded point arrays, so real samples must be recorded again.

1. Restart START.bat and reload with Ctrl+F5.
2. Start the camera and click **Set up Bye Bye theme gesture**.
3. Record **Bye Bye** five times: use one open hand and wave side to side for three seconds per sample. A two-second preparation delay precedes each recording.
4. Record **Other** five times: move normally, make one sweep, or move up/down without waving.
5. The last sample saves automatically. Close the setup panel. A rolling 2-3-second wave now activates the existing theme button; lower or close the hand before repeating.

Samples persist in bye_bye_templates.json, and partial browser recordings survive refresh. The notebook also has an export cell for gesture_samples. No synthetic templates replace the user's recordings. The wave detector reuses the browser MediaPipe camera, sends only palm trajectories to local DollarPy, and never opens a second camera. Theme changes use the existing button and per-user theme persistence.

Additional checks: node tools/test_bye_bye.mjs; Python tests/test_bye_bye.py and the wave endpoint integration test.

Wave recognition tolerates camera rates down to eight samples per capture and gaps up to 700ms. Overlapping rolling windows avoid losing the gesture when waving starts late. Existing recorded samples are retained. Camera status shows the last DollarPy label/score when a gesture is not matched.
