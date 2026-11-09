/**
 * Visual Interactive Gesture Guide
 * Displays all hand gestures with icons, titles, badges, and explanations in a clean popup modal.
 * Completely in English, with hands-free dwell-click navigation and scrolling.
 */

export const GESTURES = [
  {
    id: 'bye-bye',
    icon: '👋',
    name: 'Bye Bye Wave',
    tag: 'Theme (Dark ⇄ Light)',
    desc: 'Wave your open hand side-to-side for 1–2 seconds to toggle between Dark and Light mode.'
  },
  {
    id: 'point-hold',
    icon: '☝️',
    name: 'Point & Hold (0.5s)',
    tag: 'Click Buttons',
    desc: 'Point with your index finger at a button for 0.5s to click it. Keep pointing at scroll or adjustment buttons to repeat automatically. Use a fist to select furniture.'
  },
  {
    id: 'move-index',
    icon: '👆',
    name: 'Fist & Move',
    tag: 'Move / Drag Piece',
    desc: 'Hold a closed fist over a piece for 0.5s to select it, then move your fist to drag it. Open your palm to release and deselect.'
  },
  {
    id: 'fist',
    icon: '✊',
    name: 'Closed Fist',
    tag: 'Select & Hold',
    desc: 'Hold a closed fist over furniture for 0.5s to select and hold it. Keep the fist closed while moving.'
  },
  {
    id: 'open-palm',
    icon: '🖐️',
    name: 'Open Palm (5 Fingers)',
    tag: 'Release & Deselect',
    desc: 'Open your palm to stop dragging and clear the selection. This does not delete the piece.'
  },
  {
    id: 'phone',
    icon: '\u{1F919}',
    name: 'Phone Sign',
    tag: 'Delete Piece',
    desc: 'Extend your thumb and pinky, keeping the other three fingers folded. Hold this sign for 1 second to delete the selected piece. Open your palm to cancel. V sign undoes deletion.'
  },
  {
    id: 'thumb-rotate',
    icon: '\u{1F44D}',
    name: 'Thumb Up & Move',
    tag: 'Rotate Furniture',
    desc: 'Select furniture with a fist, then hold your thumb up for 0.25s. Move your hand left or right to rotate it. Open your palm to finish and save. V still undoes your last action.'
  },
  {
    id: 'victory',
    icon: '✌️',
    name: 'V Sign (Peace)',
    tag: 'Undo Action',
    desc: 'Show a V peace sign (index + middle fingers) to undo your last action.'
  },
  {
    id: 'ok-sign',
    icon: '👌',
    name: 'OK Sign',
    tag: 'Redo Action',
    desc: 'Form an OK circle (thumb touching index) to redo the undone action.'
  },
  {
    id: 'three-fingers',
    icon: '🤟',
    name: '3 Fingers Up',
    tag: 'Catalog (L)',
    desc: 'Hold 3 fingers up to quickly open the Furniture Catalog.'
  },
  {
    id: 'four-fingers',
    icon: '✋',
    name: '4 Fingers Up',
    tag: 'Controls (T)',
    desc: 'Hold 4 fingers up to open the Object Controls and Properties panel.'
  },
  {
    id: 'two-palms',
    icon: '👐',
    name: 'Two Open Palms',
    tag: 'Zoom In / Out',
    desc: 'Show two open palms. Move them apart to zoom in, or closer together to zoom out.'
  },
  {
    id: 'two-fingers',
    icon: '👆👆',
    name: 'Two Index Fingers',
    tag: 'Orbit & Tilt View',
    desc: 'Hold one index finger steady and move the other to orbit, rotate, and tilt the room view.'
  }
];

export function gestureGuideMarkup(){
  return '';
}

export function gestureShortcutsMarkup(){
  return '';
}

export function openGestureGuide(){
  const dialog = document.querySelector('#help');
  if(!dialog) return;

  const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const titleEl = document.querySelector('#dialog-title');
  if(titleEl) titleEl.textContent = '✋ Hand Gestures Guide';

  const cardsHtml = GESTURES.map(g => `
    <button type="button" class="gesture-visual-card" data-gesture-card="${g.id}">
      <span class="gesture-visual-icon" aria-hidden="true">${g.icon}</span>
      <span class="gesture-visual-body">
        <span class="gesture-visual-head">
          <strong class="gesture-visual-title">${escapeText(g.name)}</strong>
          <span class="gesture-visual-badge">${escapeText(g.tag)}</span>
        </span>
        <span class="gesture-visual-desc">${escapeText(g.desc)}</span>
      </span>
    </button>
  `).join('');

  const bodyEl = document.querySelector('#dialog-body');
  if(bodyEl){
    bodyEl.innerHTML = `
      <section class="gestures-guide-modal" aria-label="Hand Controls Guide">
        <div class="gestures-guide-topbar">
          <p class="gestures-guide-subtitle">Control SmartSpace completely hands-free using these natural gestures:</p>
          <div class="gestures-guide-nav-actions">
            <button type="button" class="btn secondary hand-nav-btn" data-hand-dialog-scroll="-1" title="Scroll Up">▲ Up</button>
            <button type="button" class="btn secondary hand-nav-btn" data-hand-dialog-scroll="1" title="Scroll Down">▼ Down</button>
            <button type="button" class="btn secondary hand-nav-btn" data-gesture-guide-close title="Close Guide">✕ Close</button>
          </div>
        </div>
        <div class="gestures-visual-grid" id="gestures-grid">${cardsHtml}</div>
        <div class="confirm-actions gestures-guide-footer">
          <button type="button" class="btn secondary hand-nav-btn" data-hand-dialog-scroll="-1">▲ Scroll Up</button>
          <button type="button" class="btn secondary hand-nav-btn" data-hand-dialog-scroll="1">▼ Scroll Down</button>
          <button type="button" class="btn hand-nav-btn" data-gesture-guide-close style="flex:1">Done &middot; Close Guide</button>
        </div>
      </section>
    `;
  }

  if(!dialog.open) dialog.showModal();
}

document.addEventListener('click', event => {
  const openBtn = event.target.closest('[data-gesture-guide]');
  if(openBtn){
    openGestureGuide();
    return;
  }

  const closeBtn = event.target.closest('[data-gesture-guide-close]');
  if(closeBtn){
    document.querySelector('#help')?.close();
    return;
  }

  const scrollBtn = event.target.closest('[data-hand-dialog-scroll]');
  if(scrollBtn){
    const delta = Number(scrollBtn.dataset.handDialogScroll) * 260;
    const grid = document.querySelector('#gestures-grid') || document.querySelector('.gestures-visual-grid') || document.querySelector('#help');
    if(grid){
      grid.scrollBy({top: delta, behavior: 'smooth'});
    }
    return;
  }

  const card = event.target.closest('[data-gesture-card]');
  if(card){
    document.querySelectorAll('.gesture-visual-card.is-active').forEach(c => c.classList.remove('is-active'));
    card.classList.add('is-active');
  }
});
