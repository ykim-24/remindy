#!/usr/bin/env node
// Make the fish say something. Spaces need no quoting — every word becomes the
// message:  ./say hello there, swim on     →  "hello there, swim on"
// Optional bubble duration:  ./say --ttl=12000 take a break
//
// Talks to the local remindy HTTP API (override the port with REMINDY_PORT).
const http = require('http');

const PORT = process.env.REMINDY_PORT ? Number(process.env.REMINDY_PORT) : 4747;

let ttl;
const words = [];
for (const arg of process.argv.slice(2)) {
  const m = /^--ttl=(\d+)$/.exec(arg);
  if (m) ttl = Number(m[1]);
  else words.push(arg);
}

const message = words.join(' ').trim();
if (!message) {
  console.error('usage: ./say <your message here>   (optional: --ttl=<milliseconds>)');
  process.exit(1);
}

const payload = JSON.stringify({ message, ...(ttl ? { ttl } : {}) });
const req = http.request(
  {
    host: '127.0.0.1',
    port: PORT,
    path: '/remind',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  },
  (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => {
      if (res.statusCode === 200) console.log(`🐟 said: ${message}`);
      else console.error(`fish returned ${res.statusCode}: ${body}`);
    });
  }
);
req.on('error', () =>
  console.error(`🐟 no fish is listening on :${PORT} — is remindy running? (npm start)`)
);
req.write(payload);
req.end();
