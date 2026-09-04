// `bot-secure mocks <up|down|idp|keys|status>`: mocks del ambiente de IA (IdP, WireMock, Prism,
// Mailpit, stripe-mock, LocalStack) y llaves descartables. Nada escucha fuera de 127.0.0.1.
// La lógica vive en src/generate/mocks.mjs (misma que usan `bot-secure up` y `down`).
import { BotSecureError, EXIT } from '../lib/errors.mjs';
import { findWorkspaceRoot } from '../lib/paths.mjs';
import { loadPolicy } from '../policy/index.mjs';
import { COMPOSE_FILE } from '../generate/compose.mjs';
import { MOCK_PORTS } from '../generate/fakes.mjs';
import { down, generateKeys, keysStatus, status, up } from '../generate/mocks.mjs';

const SUBS = ['up', 'down', 'idp', 'keys', 'status'];

/** Workspace + política, o error con el arreglo exacto. */
function loadWorkspace(ctx) {
  const root = findWorkspaceRoot(ctx.cwd);
  if (!root) throw new BotSecureError('generate-env.noWorkspace', { fix: 'bot-secure start', exitCode: EXIT.ERROR });
  const policy = loadPolicy(root);
  if (!policy) throw new BotSecureError('generate-env.noPolicy', { fix: 'bot-secure init', exitCode: EXIT.ERROR });
  return { root, policy, apps: policy.apps ?? [] };
}

/** Convierte el motivo de fallo del módulo en un error con su arreglo exacto. */
function failure(reason) {
  if (reason === 'no-compose') return new BotSecureError('generate-env.noCompose', { vars: { file: COMPOSE_FILE }, fix: 'bot-secure init', exitCode: EXIT.ERROR });
  if (reason === 'no-runtime') return new BotSecureError('generate-env.noRuntime', { fix: 'brew install colima docker docker-compose && colima start', exitCode: EXIT.ERROR });
  return new BotSecureError('generate-env.noRuntime', { fix: `docker compose -f ${COMPOSE_FILE} up -d`, exitCode: EXIT.ERROR });
}

async function cmdUp(ctx, { root, policy, apps }, services) {
  const res = await up(root, policy, { apps, dryRun: ctx.dryRun, services });
  if (res.dryRun) {
    ctx.log.info(ctx.t('generate-env.dryRun'));
    ctx.log.data({ command: 'mocks up', ...res });
    return EXIT.OK;
  }
  if (!res.ok) throw failure(res.reason);
  ctx.log.ok(ctx.t('generate-env.upDone', { services: res.services.join(', ') }));
  if (res.services.includes('idp')) {
    ctx.log.info(ctx.t('generate-env.idpUp', {
      issuer: `http://localhost:${MOCK_PORTS.idp}/default`,
      jwks: `http://localhost:${MOCK_PORTS.idp}/default/jwks`,
    }));
  }
  ctx.log.info(ctx.t('generate-env.fakeNotSecret'));
  ctx.log.data({ command: 'mocks up', ...res });
  return EXIT.OK;
}

async function cmdDown(ctx, { root, policy, apps }) {
  const res = await down(root, policy, { apps, dryRun: ctx.dryRun });
  if (res.dryRun) {
    ctx.log.info(ctx.t('generate-env.dryRun'));
    ctx.log.data({ command: 'mocks down', ...res });
    return EXIT.OK;
  }
  if (!res.ok) throw failure(res.reason);
  ctx.log.ok(ctx.t('generate-env.downDone', { services: res.services.join(', ') }));
  ctx.log.data({ command: 'mocks down', ...res });
  return EXIT.OK;
}

async function cmdStatus(ctx, { root, policy, apps }) {
  const res = await status(root, policy, { apps });
  if (res.reason === 'no-runtime') ctx.log.warn(ctx.t('generate-env.noRuntime'));
  if (res.reason === 'no-compose') ctx.log.warn(ctx.t('generate-env.noCompose', { file: COMPOSE_FILE }));
  const rows = [];
  for (const s of res.services) {
    const running = res.running.includes(s);
    if (running) ctx.log.ok(ctx.t('generate-env.statusRunning', { service: s, port: res.ports[s] ?? '?' }));
    else ctx.log.info(ctx.t('generate-env.statusStopped', { service: s }));
    rows.push([s, running ? `127.0.0.1:${res.ports[s] ?? '?'}` : '—']);
  }
  ctx.log.table(rows);
  ctx.log.data({ command: 'mocks status', ...res });
  return EXIT.OK;
}

async function cmdKeys(ctx, { root }) {
  const action = ctx.args[1] ?? 'generate';
  if (action !== 'generate') {
    throw new BotSecureError('generate-env.unknownSub', { vars: { sub: `keys ${action}`, subs: 'keys generate' }, fix: 'bot-secure mocks keys generate', exitCode: EXIT.ERROR });
  }
  const before = keysStatus(root);
  const res = generateKeys(root, { dryRun: ctx.dryRun });
  if (res.dryRun) {
    ctx.log.info(ctx.t('generate-env.dryRun'));
    ctx.log.data({ command: 'mocks keys generate', dir: res.dir, files: res.files, dryRun: true });
    return EXIT.OK;
  }
  if (before.exists && before.files.length) ctx.log.warn(ctx.t('generate-env.keysExisting', { dir: res.dir }));
  ctx.log.ok(ctx.t('generate-env.keysDone', { dir: res.dir, count: res.files.length }));
  if (!res.openssl) ctx.log.warn(ctx.t('generate-env.keysNoOpenssl'));
  ctx.log.info(ctx.t('generate-env.fakeNotSecret'));
  // Nunca se imprime el contenido de una llave: solo las rutas.
  ctx.log.data({ command: 'mocks keys generate', dir: res.dir, files: res.files, pkcs12: res.pkcs12, openssl: res.openssl });
  return EXIT.OK;
}

export default {
  name: 'mocks',
  aliases: [],
  advanced: false,
  hidden: false,
  summary: {
    es: 'Mocks del ambiente de IA: IdP, WireMock, Prism, Mailpit y llaves descartables',
    en: 'AI-environment mocks: IdP, WireMock, Prism, Mailpit and throwaway keys',
  },
  usage: {
    es: `bot-secure mocks <${SUBS.join('|')}> [keys generate] [--json] [--dry-run]`,
    en: `bot-secure mocks <${SUBS.join('|')}> [keys generate] [--json] [--dry-run]`,
  },
  async run(ctx) {
    const sub = ctx.args[0] ?? 'status';
    if (!SUBS.includes(sub)) {
      throw new BotSecureError('generate-env.unknownSub', { vars: { sub, subs: SUBS.join(', ') }, fix: 'bot-secure mocks status', exitCode: EXIT.ERROR });
    }
    const ws = loadWorkspace(ctx);
    if (sub === 'up') return cmdUp(ctx, ws);
    if (sub === 'down') return cmdDown(ctx, ws);
    if (sub === 'idp') return cmdUp(ctx, ws, ['idp']);
    if (sub === 'keys') return cmdKeys(ctx, ws);
    return cmdStatus(ctx, ws);
  },
};
