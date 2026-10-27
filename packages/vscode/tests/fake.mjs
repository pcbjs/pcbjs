// Test doubles shared by the host and server tests: a fake child process and a recording spawn.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

let nextPid = 40000;

export class FakeChild extends EventEmitter {
  constructor({ obeysTerm = true } = {}) {
    super();
    this.pid = nextPid++;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.signals = [];
    this.exited = false;
    this.obeysTerm = obeysTerm;
  }
  kill(signal = 'SIGTERM') {
    this.signals.push(signal);
    if (signal === 'SIGKILL' || this.obeysTerm) setImmediate(() => this.exit(null, signal));
    return true;
  }
  exit(code, signal = null) {
    if (this.exited) return;
    this.exited = true;
    this.stdout.end();
    this.stderr.end();
    this.emit('exit', code, signal);
  }
}

/** A spawn that records every call and hands out FakeChild instances. */
export function fakeSpawn(opts = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    const child = new FakeChild(opts);
    calls.push({ command, args, options, child, at: Date.now() });
    return child;
  };
  return { spawn, calls };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(fn, ms = 2000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await sleep(5);
  }
}
