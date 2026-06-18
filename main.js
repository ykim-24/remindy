const { app, BrowserWindow, ipcMain, screen, clipboard } = require('electron');
const http = require('http');
const path = require('path');
const { exec, execFile } = require('child_process');

const PORT = process.env.REMINDY_PORT ? Number(process.env.REMINDY_PORT) : 4747;

let win = null;
// Global message queue so bubbles never overlap — quotes, calendar reminders,
// and API messages all line up and display one at a time.
const queue = [];
let showing = false;

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const W = 360;
  const H = 640; // tall enough that the full menu + bubble stack above the fish without clipping

  win = new BrowserWindow({
    width: W,
    height: H,
    x: sw - W - 40,
    y: sh - H - 40,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Float above almost everything, including other apps' native fullscreen.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });

  // Click-through everywhere by default; the renderer flips this off only while
  // the cursor is over the fish or the menu (forward:true keeps mousemove flowing).
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile('index.html');

  win.webContents.on('did-finish-load', () => pump());
}

// Show the next queued message, then wait its ttl (+ a gap) before the next.
function pump() {
  if (showing || queue.length === 0) return;
  if (!win || win.webContents.isLoading()) return; // wait until the window is ready
  const msg = queue.shift();
  showing = true;
  win.webContents.send('remind', msg);
  setTimeout(() => {
    showing = false;
    pump();
  }, msg.ttl + 600);
}

function sendReminder(payload) {
  const msg = {
    message: String(payload.message || '').slice(0, 280) || '👋',
    ttl: Number(payload.ttl) > 0 ? Number(payload.ttl) : 8000,
  };
  queue.push(msg);
  pump();
  return msg;
}

// --- Tiny dependency-free HTTP API ---
function startServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === '/remind') {
      if (req.method === 'GET') {
        const sent = sendReminder({
          message: url.searchParams.get('message'),
          ttl: url.searchParams.get('ttl'),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, sent }));
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 1e6) req.destroy();
        });
        req.on('end', () => {
          let data = {};
          try {
            data = body ? JSON.parse(body) : {};
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }));
            return;
          }
          const sent = sendReminder(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, sent }));
        });
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`🐾 remindy API listening on http://127.0.0.1:${PORT}`);
    console.log(`   try: curl "http://127.0.0.1:${PORT}/remind?message=hello"`);
  });
}

// Reposition the window when the renderer drags the pet.
ipcMain.on('move-window', (_e, { dx, dy }) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy));
});

// --- Nice quotes every 10–30 min (first one only after a delay, so nothing
// pops on launch). They go through the same queue, so they never overlap. ---
const quotes = require('./quotes');
let lastQuote = -1;

// Pick a random quote that isn't the same as the one we showed last time.
function randomQuote() {
  let i;
  do {
    i = Math.floor(Math.random() * quotes.length);
  } while (quotes.length > 1 && i === lastQuote);
  lastQuote = i;
  return quotes[i];
}

function scheduleQuote() {
  const delay = (10 + Math.random() * 20) * 60000; // 10–30 minutes
  setTimeout(() => {
    sendReminder({ message: randomQuote(), ttl: 9000 });
    scheduleQuote();
  }, delay);
}

// Menu: show a random quote on demand.
ipcMain.on('quote', () => {
  sendReminder({ message: randomQuote(), ttl: 9000 });
});

// --- Calendar: poll the iCal feed, auto-remind, answer menu queries ---
const cal = require('./cal');

let cachedEvents = []; // upcoming events from the last poll
const reminded = new Set(); // event keys we've already nudged about

function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function minsUntil(d) {
  return Math.round((d.getTime() - Date.now()) / 60000);
}

async function pollCalendar() {
  if (!cal.configuredUrls().length) return;
  const now = Date.now();
  let events;
  try {
    events = await cal.fetchEvents(new Date(now - 60000), new Date(now + 24 * 3600000));
  } catch {
    return;
  }
  cachedEvents = events;

  const lead = cal.leadMinutes() * 60000;
  for (const e of events) {
    if (e.allDay) continue;
    const start = e.start.getTime();
    const key = `${e.title}@${start}`;
    if (reminded.has(key)) continue;
    if (now >= start) {
      reminded.add(key); // already started — no point reminding
    } else if (start - lead <= now) {
      const m = minsUntil(e.start);
      sendReminder({ message: `⏰ ${e.title} ${m <= 0 ? 'now' : `in ${m} min`}`, ttl: 15000 });
      reminded.add(key);
    }
  }
}

// Read the clipboard, validate it looks like an iCal URL, save it, and poll.
ipcMain.on('paste-calendar', async () => {
  const url = (clipboard.readText() || '').trim();
  if (!/^https?:\/\//i.test(url) || !/(ics|ical|calendar)/i.test(url)) {
    sendReminder({ message: '📋 copy your iCal link first, then click this', ttl: 7000 });
    return;
  }
  cal.setIcsUrl(url);
  reminded.clear();
  sendReminder({ message: '✅ calendar linked! checking your events…', ttl: 6000 });
  await pollCalendar();
  const next = cachedEvents.find((e) => e.start.getTime() >= Date.now());
  sendReminder(
    next
      ? { message: `📅 next: ${next.title} at ${fmtTime(next.start)}`, ttl: 9000 }
      : { message: '📅 linked! no upcoming events in the next 24h', ttl: 7000 }
  );
});

ipcMain.on('calendar', (_e, kind) => {
  if (!cal.configuredUrls().length) {
    sendReminder({ message: '📅 add your calendar URL in config.json', ttl: 7000 });
    return;
  }
  const now = Date.now();
  const upcoming = cachedEvents.filter((e) => e.start.getTime() >= now);

  if (kind === 'today') {
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const today = upcoming.filter((e) => e.start <= endOfDay).slice(0, 4);
    const msg = today.length
      ? '🗓️ ' + today.map((e) => `${fmtTime(e.start)} ${e.title}`).join(' · ')
      : '🗓️ nothing left today 🎉';
    sendReminder({ message: msg, ttl: 12000 });
  } else {
    const next = upcoming[0];
    const msg = next
      ? `📅 ${next.title} at ${fmtTime(next.start)} (in ${Math.max(0, minsUntil(next.start))} min)`
      : '📅 no upcoming events';
    sendReminder({ message: msg, ttl: 10000 });
  }
});

ipcMain.on('set-ignore-mouse', (_e, ignore) => {
  if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
});

// --- Self-update: compare this checkout against origin/main on GitHub ---
const REPO = __dirname;
let updating = false;
let lastAnnounced = null;

// Run a git subcommand inside the repo, resolving with trimmed stdout.
function git(args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', REPO, ...args], { timeout }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.toString().trim());
    });
  });
}

// True only if this is a git checkout we can fast-forward (avoids touching
// installs that aren't git clones, or that have diverging local commits).
async function isGitClone() {
  try {
    await git(['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

// Fetch origin/main and, if we're strictly behind it, optionally nudge the user.
async function checkForUpdate(announce = true) {
  if (updating) return false;
  if (!(await isGitClone())) return false;
  try {
    await git(['fetch', '--quiet', 'origin', 'main']);
    const local = await git(['rev-parse', 'HEAD']);
    const remote = await git(['rev-parse', 'origin/main']);
    if (local === remote) return false;
    // Behind only if HEAD is an ancestor of origin/main (not ahead/diverged).
    try {
      await git(['merge-base', '--is-ancestor', 'HEAD', 'origin/main']);
    } catch {
      return false; // diverged — don't offer to clobber local work
    }
    if (announce && remote !== lastAnnounced) {
      lastAnnounced = remote;
      sendReminder({
        message: '🆕 A new version of remindy is available! Open my menu → ⬆️ Update remindy',
        ttl: 13000,
      });
    }
    return true;
  } catch {
    return false; // offline / no remote — skip silently
  }
}

// Menu action: fast-forward to origin/main, reinstall deps if needed, relaunch.
ipcMain.on('update', async () => {
  if (updating) return;
  if (!(await isGitClone())) {
    sendReminder({
      message: '⬆️ Updates need a git clone. Grab the latest from github.com/ykim-24/remindy',
      ttl: 10000,
    });
    return;
  }
  updating = true;
  sendReminder({ message: '⬆️ Checking for updates…', ttl: 8000 });
  try {
    const out = await git(['pull', '--ff-only', 'origin', 'main'], 60000);
    if (/already up to date/i.test(out)) {
      sendReminder({ message: '✅ remindy is already on the latest version 🎉', ttl: 7000 });
      updating = false;
      return;
    }
  } catch {
    sendReminder({
      message: '⚠️ Update failed — maybe local changes or no internet. Try `git pull` by hand.',
      ttl: 11000,
    });
    updating = false;
    return;
  }
  // Pick up any dependency changes (cheap no-op when nothing changed).
  sendReminder({ message: '📦 Updating dependencies…', ttl: 9000 });
  await new Promise((res) =>
    exec('npm install --no-audit --no-fund', { cwd: REPO, timeout: 180000 }, () => res())
  );
  sendReminder({ message: '✅ Updated! Restarting remindy…', ttl: 4000 });
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 1600);
});

ipcMain.on('quit', () => app.quit());

app.whenReady().then(() => {
  // Become an "accessory" (agent) app on macOS: no Dock icon, and — crucially —
  // its always-on-top window can then float over other apps' native fullscreen.
  if (process.platform === 'darwin') {
    app.setActivationPolicy('accessory');
    app.dock?.hide();
  }
  createWindow();
  startServer();
  // Poll the calendar now and every 60s for auto-reminders + menu data.
  pollCalendar();
  setInterval(pollCalendar, 60000);
  // Start the gentle-quote loop (first one fires 10–30 min from now).
  scheduleQuote();
  // Check for a newer version shortly after launch, then every 6 hours.
  setTimeout(() => checkForUpdate(true), 8000);
  setInterval(() => checkForUpdate(true), 6 * 3600 * 1000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Keep running even with no visible chrome; this is a tray-less background pet.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
