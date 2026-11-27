// Newline-delimited JSON over the daemon's Unix socket: one request and one response per connection.
import net from 'node:net';
import { CmdError } from './errors.mjs';

export function request(socketPath, payload, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath);
    let buf = '';
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new CmdError('TIMEOUT', `daemon did not answer within ${timeoutMs} ms`));
    }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(JSON.stringify(payload) + '\n'));
    sock.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      clearTimeout(timer);
      sock.end();
      try {
        resolve(JSON.parse(buf.slice(0, nl)));
      } catch (err) {
        reject(new CmdError('BROWSER_ERROR', `bad daemon response: ${err.message}`));
      }
    });
    sock.on('error', (err) => {
      clearTimeout(timer);
      reject(new CmdError('NO_SESSION', `cannot reach daemon: ${err.code || err.message}`));
    });
  });
}

export function serve(socketPath, handler) {
  return net.createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', async (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      buf = '';
      let reply;
      try {
        reply = await handler(JSON.parse(line));
      } catch (err) {
        reply = { ok: false, error: { code: 'BROWSER_ERROR', message: String(err?.message || err) } };
      }
      sock.end(JSON.stringify(reply) + '\n');
    });
    sock.on('error', () => {});
  }).listen(socketPath);
}
