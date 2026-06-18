// ---- Image-based desktop pet ----
const pet = document.getElementById('pet');

// ---- Speech bubble ----
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
let hideTimer = null;

function renderMarkdown(text) {
  try {
    return window.marked.parse(text, { breaks: true, gfm: true });
  } catch {
    return null;
  }
}

// ---- Bubble "blub" sound (synthesized — no audio file needed) ----
let muted = localStorage.getItem('remindy-muted') === '1';
let audioCtx = null;

function blub() {
  if (muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    const f0 = 500 + Math.random() * 160; // slight pitch variety per pop
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.32, t + 0.13);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.19);
  } catch {
    /* audio unavailable — stay silent */
  }
}

function showReminder({ message, ttl }) {
  const html = renderMarkdown(message);
  if (html != null) bubbleText.innerHTML = html;
  else bubbleText.textContent = message;
  bubble.classList.remove('hidden');
  blub();
  // a little excited wiggle
  pet.style.animation = 'none';
  void pet.offsetWidth;
  pet.style.animation = 'bob 0.35s steps(2) 3, bob 2.4s ease-in-out infinite 1.05s';

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => bubble.classList.add('hidden'), ttl);
}

window.remindy.onRemind(showReminder);

// ---- Fish skins (cycle through different low-fi fish) ----
const FISH = [
  'fish/puffer-party.png', // 🎉 the birthday puffer (default so it shows first)
  'fish.png', // the original sturgeon
  'fish/goldfish.png',
  'fish/betta.png',
  'fish/angelfish.png',
  'fish/puffer.png',
  'fish/mandarin.png',
  'fish/discus.png',
  'fish/swordfish.png',
];
let fishIndex = Math.min(parseInt(localStorage.getItem('remindy-fish-v2') || '0', 10) || 0, FISH.length - 1);
function applyFish() {
  pet.src = FISH[fishIndex];
}
function nextFish() {
  fishIndex = (fishIndex + 1) % FISH.length;
  localStorage.setItem('remindy-fish-v2', String(fishIndex));
  applyFish();
  // little wiggle to acknowledge the swap
  pet.style.animation = 'none';
  void pet.offsetWidth;
  pet.style.animation = 'bob 0.35s steps(2) 3, bob 2.4s ease-in-out infinite 1.05s';
}
applyFish();

// ---- Pixel menu ----
const menu = document.getElementById('menu');

// Last known cursor position (window/client coords), used to anchor the menu.
let mx = 0;
let my = 0;

function openMenuAt(x, y) {
  menu.classList.remove('hidden');
  // Measure now that it's visible, then place it so it never leaves the window.
  const r = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = Math.min(x, vw - r.width - 4);
  left = Math.max(4, left);
  let top = y - r.height - 4; // open upward from the cursor by default
  if (top < 4) top = Math.min(y + 4, vh - r.height - 4); // not enough room above → drop below
  top = Math.max(4, top);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

function toggleMenu() {
  if (menu.classList.contains('hidden')) openMenuAt(mx, my);
  else menu.classList.add('hidden');
}

const muteItem = document.getElementById('mute-item');
function updateMuteLabel() {
  muteItem.textContent = muted ? '🔇 Sound: off' : '🔊 Sound: on';
}
updateMuteLabel();

menu.addEventListener('click', (e) => {
  const action = e.target.closest('.mi')?.dataset.action;
  if (!action) return;
  if (action === 'quit') {
    window.remindy.quit();
  } else if (action === 'dismiss') {
    bubble.classList.add('hidden');
  } else if (action === 'paste') {
    window.remindy.pasteCalendar();
  } else if (action === 'quote') {
    window.remindy.quote();
  } else if (action === 'fish') {
    nextFish();
  } else if (action === 'update') {
    window.remindy.update();
  } else if (action === 'next' || action === 'today') {
    window.remindy.calendar(action);
  } else if (action === 'mute') {
    muted = !muted;
    localStorage.setItem('remindy-muted', muted ? '1' : '0');
    updateMuteLabel();
    if (!muted) blub(); // preview the sound when turning it back on
  }
  if (action !== 'mute' && action !== 'fish') menu.classList.add('hidden'); // keep menu open on toggles
});

// ---- Drag to move, click to open the menu ----
let dragging = false;
let moved = false;
let lastX = 0;
let lastY = 0;

pet.addEventListener('mousedown', (e) => {
  dragging = true;
  moved = false;
  lastX = e.screenX;
  lastY = e.screenY;
  mx = e.clientX;
  my = e.clientY;
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - lastX;
  const dy = e.screenY - lastY;
  if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
  window.remindy.moveWindow(dx, dy);
  lastX = e.screenX;
  lastY = e.screenY;
});

window.addEventListener('mouseup', () => {
  if (dragging && !moved) toggleMenu(); // a click (not a drag) opens the menu
  dragging = false;
});

// Right-click opens the menu too — never quits.
pet.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  mx = e.clientX;
  my = e.clientY;
  toggleMenu();
});

// ---- Make the window click-through except over the fish / menu ----
// The window starts ignoring mouse events; we turn that off only when the
// cursor is actually over an interactive element, so empty space lets clicks
// pass through to whatever is behind the fish.
let ignoring = true;

function updateClickRegion(x, y) {
  const el = document.elementFromPoint(x, y);
  const over = !!(el && (el.id === 'pet' || el.closest('#menu')));
  if (ignoring !== over) return; // state already matches (ignoring === !over)
  ignoring = !over;
  window.remindy.setIgnoreMouse(ignoring);
}

window.addEventListener('mousemove', (e) => {
  mx = e.clientX;
  my = e.clientY;
  if (dragging) return; // stay solid while dragging so the drag never drops
  updateClickRegion(e.clientX, e.clientY);
});
