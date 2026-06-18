// Calendar backend: poll one or more private iCal (.ics) feeds, expand
// recurring events, and surface upcoming events for reminders + the menu.
const ical = require('node-ical');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function configuredUrls() {
  const cfg = loadConfig();
  const urls = cfg.icsUrls || (cfg.icsUrl ? [cfg.icsUrl] : []);
  if (process.env.REMINDY_ICS_URL) urls.push(process.env.REMINDY_ICS_URL);
  return urls.filter(Boolean);
}

function leadMinutes() {
  const cfg = loadConfig();
  return Number.isFinite(cfg.leadMinutes) ? cfg.leadMinutes : 5;
}

// Push every occurrence of `ev` that falls within [from, to] into `out`.
function addOccurrences(ev, from, to, out) {
  const title = ev.summary || '(untitled)';
  const allDay = ev.datetype === 'date';
  const durationMs = ev.end && ev.start ? ev.end - ev.start : 30 * 60000;

  if (!ev.rrule) {
    if (ev.start >= from && ev.start <= to) {
      out.push({ title, start: new Date(ev.start), allDay });
    }
    return;
  }

  // Recurring: ask the rule for occurrences in range, then apply
  // exclusions (EXDATE) and per-instance overrides (RECURRENCE-ID).
  for (const d of ev.rrule.between(from, to, true)) {
    const key = d.toISOString().slice(0, 10);
    if (ev.exdate && ev.exdate[key]) continue;

    let start = d;
    let t = title;
    if (ev.recurrences && ev.recurrences[key]) {
      const r = ev.recurrences[key];
      start = r.start || d;
      t = r.summary || title;
    }
    out.push({ title: t, start: new Date(start), allDay });
  }
}

// Fetch + expand events across all feeds within [from, to] (Date objects).
async function fetchEvents(from, to) {
  const urls = configuredUrls();
  const out = [];
  for (const url of urls) {
    let data;
    try {
      data = await ical.async.fromURL(url);
    } catch {
      continue; // network blip / bad url — skip this feed this round
    }
    if (!data) continue;
    for (const k of Object.keys(data)) {
      const ev = data[k];
      if (ev && ev.type === 'VEVENT') addOccurrences(ev, from, to, out);
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

// Save a single iCal URL into config.json (used by the menu's paste action).
function setIcsUrl(url) {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    cfg = {};
  }
  cfg.icsUrls = [url];
  if (!Number.isFinite(cfg.leadMinutes)) cfg.leadMinutes = 5;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

module.exports = { loadConfig, configuredUrls, leadMinutes, fetchEvents, setIcsUrl };
