import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const logPath = path.join(dir, 'probe-log.jsonl');
const port = Number(process.env.PROBE_PORT ?? 8787);
const host = process.env.PROBE_HOST ?? '0.0.0.0';

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push({ name, address: addr.address });
    }
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, service: 'shortcut-probe', log: logPath });
  }

  if (req.method === 'POST' && (req.url === '/sms' || req.url === '/text')) {
    let raw;
    try {
      raw = await readBody(req);
    } catch {
      return send(res, 413, { ok: false, error: 'body_too_large' });
    }

    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = { text: raw };
    }

    const text = typeof parsed?.text === 'string' ? parsed.text.slice(0, 4000) : '';
    const sender = typeof parsed?.sender === 'string' ? parsed.sender.slice(0, 200) : null;
    if (!text) {
      return send(res, 400, { ok: false, error: 'text_required' });
    }

    const received = {
      kind: req.url === '/sms' ? 'sms' : 'text',
      text,
      sender,
      at: new Date().toISOString(),
      remote: req.socket.remoteAddress,
    };

    fs.appendFileSync(logPath, JSON.stringify(received) + '\n', 'utf8');
    console.log(`[probe] ${received.kind} from ${received.remote}: ${text.slice(0, 160)}`);

    return send(res, 200, { ok: true, received });
  }

  return send(res, 404, { ok: false, error: 'not_found' });
});

server.listen(port, host, () => {
  console.log('Shortcut probe is running (local network only, no auth).');
  console.log(`Log file: ${logPath}`);
  for (const { name, address } of lanAddresses()) {
    console.log(`  ${name}: http://${address}:${port}/sms`);
  }
  console.log('Press Ctrl+C to stop.');
});
