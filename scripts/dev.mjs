import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const children = [];

function run(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  child.on('exit', (code) => {
    console.log(`[dev] ${name} exited with code ${code}`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('api', ['--watch', 'server/src/index.ts']);
run('web', [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--config', 'web/vite.config.ts']);
