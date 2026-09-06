import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const scriptPath = fileURLToPath(import.meta.url);
const workspace = path.resolve(path.dirname(scriptPath), '../../..');
const runtimeDir = path.join(workspace, 'work/chat-bullq-local');
const envPath = path.join(runtimeDir, '.env.local');
const manifestPath = path.join(workspace, 'work/chat-bullq-local.json');
const composePath = path.join(path.dirname(scriptPath), 'compose.yaml');
const apiArg = process.argv.indexOf('--api-dir');
const apiDir = path.resolve(apiArg >= 0 ? process.argv[apiArg + 1] : path.join(workspace, 'work/references/chat-bullq-api'));
const action = process.argv[2] || 'status';
const project = 'consultaisp-chat-local';
const logPaths = Object.fromEntries(['build', 'migrations', 'api', 'api-error', 'infra'].map(name => [name, path.join(runtimeDir, `${name}.log`)]));

function readEnvironment() {
  if (!fs.existsSync(envPath)) throw new Error('Private environment is missing. Run start first.');
  const entries = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const split = line.indexOf('=');
    if (split < 1) throw new Error('Invalid private environment file');
    return [line.slice(0, split), line.slice(split + 1)];
  });
  const env = Object.fromEntries(entries);
  const database = new URL(env.DATABASE_URL);
  if (env.LOCAL_ENV_ID !== project || env.HOST !== '127.0.0.1' || database.hostname !== '127.0.0.1' || database.pathname !== '/chat_bullq_local' || database.port !== env.POSTGRES_PORT || env.REDIS_HOST !== '127.0.0.1') {
    throw new Error('Local environment identity or loopback isolation is invalid');
  }
  if ([env.POSTGRES_PORT, env.REDIS_PORT, env.PORT].some(port => !/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)) throw new Error('Invalid local port');
  if (new Set([env.POSTGRES_PORT, env.REDIS_PORT, env.PORT]).size !== 3 || env.POSTGRES_PORT === '5432') throw new Error('Ports must be distinct and must not use the Consulta ISP database port');
  return env;
}

function initializeEnvironment() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  if (!fs.existsSync(envPath)) {
    const secret = () => randomBytes(32).toString('hex');
    const postgresPassword = secret();
    const env = {
      LOCAL_ENV_ID: project, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3002',
      POSTGRES_PORT: '5544', POSTGRES_PASSWORD: postgresPassword,
      DATABASE_URL: `postgresql://chat_bullq_local:${postgresPassword}@127.0.0.1:5544/chat_bullq_local`,
      REDIS_HOST: '127.0.0.1', REDIS_PORT: '6382', REDIS_PASSWORD: secret(),
      JWT_SECRET: secret(), JWT_REFRESH_SECRET: secret(), PLATFORM_API_KEY: secret(),
      CORS_ORIGIN: 'http://localhost:5000', APP_URL: 'http://127.0.0.1:3002',
      CONSULTA_ISP_WEBHOOK_URL: 'http://127.0.0.1:5000/api/webhooks/chat-bullq',
      OPENAI_API_KEY: '', SAKANA_API_KEY: '', GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '',
      VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '',
    };
    fs.writeFileSync(envPath, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
    if (process.platform === 'win32') {
      const account = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
      execFileSync('icacls', [envPath, '/inheritance:r', '/grant:r', `${account}:(F)`], { windowsHide: true, stdio: 'ignore' });
    }
  }
  // Runtime logs and the PID manifest stay local; .env.* is already ignored.
  const exclude = path.join(workspace, '.git/info/exclude');
  if (fs.existsSync(exclude)) {
    const previous = fs.readFileSync(exclude, 'utf8');
    for (const entry of ['/work/chat-bullq-local/', '/work/chat-bullq-local.json']) {
      if (!previous.split(/\r?\n/).includes(entry)) fs.appendFileSync(exclude, `\n${entry}\n`);
    }
  }
  const env = readEnvironment();
  if (!env.CONSULTA_ISP_WEBHOOK_URL) {
    fs.appendFileSync(envPath, '\nCONSULTA_ISP_WEBHOOK_URL=http://127.0.0.1:5000/api/webhooks/chat-bullq\n');
    env.CONSULTA_ISP_WEBHOOK_URL = 'http://127.0.0.1:5000/api/webhooks/chat-bullq';
  }
  return env;
}

function run(file, args, env, log) {
  const fd = fs.openSync(log, 'a');
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: apiDir, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', fd, fd] });
    child.once('error', error => { fs.closeSync(fd); reject(error); });
    child.once('exit', code => { fs.closeSync(fd); code === 0 ? resolve() : reject(new Error(`Command failed (${code}); inspect ${log}`)); });
  });
}

function composeArgs(...args) { return ['compose', '--project-name', project, '--env-file', envPath, '-f', composePath, ...args]; }
async function portAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(Number(port), '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
function running(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function readManifest() { return fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null; }
function output(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }

async function start() {
  const env = initializeEnvironment();
  const previous = readManifest();
  if (previous?.pid && running(previous.pid)) return output({ ...previous, reused: true });
  if (!(await portAvailable(env.PORT))) throw new Error('The configured API port is already occupied');
  if (!fs.existsSync(path.join(apiDir, 'node_modules/@nestjs/cli/bin/nest.js'))) throw new Error('Install the Chat BullQ dependencies before starting');
  await run(process.execPath, ['node_modules/@nestjs/cli/bin/nest.js', 'build'], env, logPaths.build);
  await run('docker', composeArgs('up', '-d', '--wait', '--wait-timeout', '60'), env, logPaths.infra);

  const requireApi = createRequire(path.join(apiDir, 'package.json'));
  const { Client } = requireApi('pg');
  const db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  const identity = await db.query('SELECT current_database() AS database, current_user AS username');
  const tables = await db.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'");
  await db.end();
  if (identity.rows[0].database !== 'chat_bullq_local' || identity.rows[0].username !== 'chat_bullq_local') throw new Error('Refusing migration outside the dedicated local database');
  if (tables.rows[0].count === 0) {
    await run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], env, logPaths.migrations);
  } else {
    // Never reset or migrate an existing database implicitly.
    await run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'status'], env, logPaths.migrations);
  }

  const stdout = fs.openSync(logPaths.api, 'a');
  const stderr = fs.openSync(logPaths['api-error'], 'a');
  const child = spawn(process.execPath, [scriptPath, 'serve', '--api-dir', apiDir], {
    cwd: runtimeDir, env: { ...process.env, ...env }, detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr],
  });
  fs.closeSync(stdout); fs.closeSync(stderr); child.unref();
  const manifest = {
    environment: project, pid: child.pid, apiUrl: `http://127.0.0.1:${env.PORT}`, docsUrl: `http://127.0.0.1:${env.PORT}/docs`,
    apiDir, secretFile: envPath, ports: { api: Number(env.PORT), postgres: Number(env.POSTGRES_PORT), redis: Number(env.REDIS_PORT) },
    containers: [`${project}-postgres-1`, `${project}-redis-1`],
    volumes: ['consultaisp-chat-local-postgres', 'consultaisp-chat-local-redis'], logs: logPaths,
    startedAt: new Date().toISOString(), state: 'starting',
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  for (let attempt = 0; attempt < 60; attempt++) {
    if (!running(child.pid)) throw new Error(`API exited during startup; inspect ${logPaths['api-error']}`);
    try {
      const response = await fetch(`${manifest.apiUrl}/api/v1/auth/me`, { signal: AbortSignal.timeout(1000) });
      if (response.status === 401) {
        manifest.state = 'running';
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        return output(manifest);
      }
    } catch { /* Startup may still be initializing its modules. */ }
    await delay(500);
  }
  throw new Error(`API did not become ready; inspect ${logPaths.api}`);
}

async function stop() {
  const manifest = readManifest();
  if (manifest?.pid && running(manifest.pid)) {
    if (process.platform === 'win32') {
      const command = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(manifest.pid)}").CommandLine`], { encoding: 'utf8', windowsHide: true });
      if (!command.includes(scriptPath) || !command.includes('serve')) throw new Error('PID no longer belongs to this local launcher');
    }
    process.kill(manifest.pid, 'SIGTERM');
  }
  await run('docker', composeArgs('stop'), readEnvironment(), logPaths.infra);
  if (manifest) { manifest.state = 'stopped'; fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)); }
  output({ state: 'stopped', volumesPreserved: true });
}

try {
  if (action === 'serve') {
    Object.assign(process.env, readEnvironment());
    createRequire(path.join(apiDir, 'package.json'))(path.join(apiDir, 'dist/src/main.js'));
  } else if (action === 'start') await start();
  else if (action === 'stop') await stop();
  else if (action === 'status') {
    const manifest = readManifest();
    output(manifest ? { ...manifest, processRunning: !!manifest.pid && running(manifest.pid) } : { state: 'not-created' });
  } else throw new Error('Supported actions: start, stop, status');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Local runtime failed'}\n`);
  process.exitCode = 1;
}
