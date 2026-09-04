// Mocks del ambiente de IA: IdP (OIDC), WireMock, Prism, Mailpit, stripe-mock, MinIO/LocalStack,
// y llaves descartables (`mocks keys generate`). Todo escucha SOLO en 127.0.0.1.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { run, which } from '../lib/exec.mjs';
import { writeText } from '../lib/fsx.mjs';
import { MOCK_PORTS, slug } from './fakes.mjs';

export const MOCKS_DIR = 'mocks';
export const KEYS_DIR = join('.bot-secure', 'ai-keys');
/** Cabecera que marca las llaves como descartables (el escáner no las reporta). */
export const THROWAWAY_HEADER = '# bot-secure:throwaway';

/** @typedef {{path:string, content:string, mode?:string}} Artifact */

/** Imágenes de los mocks (tag fijo: reproducible sin depender de `latest`). */
export const MOCK_IMAGES = Object.freeze({
  idp: 'ghcr.io/navikt/mock-oauth2-server:2.1.10',
  wiremock: 'wiremock/wiremock:3.9.2',
  prism: 'stoplight/prism:5',
  mailpit: 'axllent/mailpit:v1.21',
  stripe: 'stripe/stripe-mock:v0.191.0',
  minio: 'minio/minio:RELEASE.2024-09-13T20-26-02Z',
  localstack: 'localstack/localstack:3.8',
  redis: 'redis:7.4-alpine',
});

const sdksOf = (apps = []) => new Set(apps.flatMap((a) => a.sdks ?? []));
const managersOf = (apps = []) => new Set(apps.flatMap((a) => a.secretManagers ?? []));

/**
 * Qué mocks necesita este workspace.
 * @param {object} policy
 * @param {object[]} apps
 * @returns {{idp:boolean, wiremock:boolean, prism:boolean, mailpit:boolean, stripe:boolean, s3:boolean, redis:boolean}}
 */
export function mocksNeeded(policy, apps = []) {
  const sdks = sdksOf(apps);
  const managers = managersOf(apps);
  const dependsRedis = apps.some((a) => (a.dependsOn ?? []).includes('redis')) || policy?.db?.engine === 'redis';
  return {
    idp: true,
    wiremock: true,
    prism: sdks.has('twilio') || sdks.has('sendgrid'),
    mailpit: sdks.has('sendgrid') || apps.some((a) => a.kind === 'backend'),
    stripe: sdks.has('stripe'),
    s3: sdks.has('aws') || managers.has('aws-secrets-manager'),
    redis: dependsRedis,
  };
}

/** Configuración del IdP simulado (mock-oauth2-server): emisor, claims y usuario de pruebas. */
function idpConfig(policy) {
  const project = slug(policy?.project || 'app');
  return JSON.stringify({
    interactiveLogin: false,
    httpServer: 'NettyWrapper',
    tokenCallbacks: [{
      issuerId: 'default',
      tokenExpiry: 3600,
      requestMappings: [{
        requestParam: 'scope',
        match: '*',
        claims: {
          sub: `ai-${project}-user`,
          aud: [`ai-${project}-api`],
          email: 'noreply@ai.local',
          name: 'Usuario de pruebas (sintético)',
          roles: ['user', 'admin'],
          'bot-secure': 'synthetic',
        },
      }],
    }],
  }, null, 2) + '\n';
}

const IDP_README = [
  '# IdP simulado (OIDC)',
  '',
  `- Emisor: \`http://localhost:${MOCK_PORTS.idp}/default\``,
  `- JWKS: \`http://localhost:${MOCK_PORTS.idp}/default/jwks\``,
  '- Token de pruebas:',
  '',
  '```sh',
  `curl -s -X POST "http://localhost:${MOCK_PORTS.idp}/default/token" \\`,
  '  -d grant_type=client_credentials -d client_id=ai-client -d client_secret=__AI_PLACEHOLDER__OIDC_CLIENT_SECRET__ \\',
  '  -d scope=api',
  '```',
  '',
  'Alternativas equivalentes: Keycloak (`start-dev`, realm `ai`) o Dex. El contrato es el mismo:',
  'emisor en `localhost:' + MOCK_PORTS.idp + '` y claims sintéticos. Ningún usuario real.',
  '',
].join('\n');

/** Mapeo de ejemplo de WireMock (respuesta fija, sin datos reales). */
const WIREMOCK_MAPPING = JSON.stringify({
  request: { method: 'GET', urlPathPattern: '/(.*)' },
  response: {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    jsonBody: { ok: true, source: 'wiremock', note: 'bot-secure:synthetic' },
  },
}, null, 2) + '\n';

const PRISM_README = [
  '# Prism (mock desde OpenAPI)',
  '',
  'Coloca aquí el OpenAPI del proveedor (por ejemplo el público de Twilio) como `openapi.yaml`.',
  `Prism lo sirve en \`http://localhost:${MOCK_PORTS.prism}\` con respuestas de ejemplo.`,
  '',
  'Regla: los ejemplos del OpenAPI son sintéticos. Nunca pegues una respuesta real de producción.',
  '',
].join('\n');

const PRISM_OPENAPI = [
  '# bot-secure: OpenAPI mínimo de relleno. Sustitúyelo por el del proveedor que mockeas.',
  'openapi: 3.0.0',
  'info:',
  '  title: Mock del ambiente de IA',
  '  version: 1.0.0',
  'paths:',
  '  /health:',
  '    get:',
  '      responses:',
  "        '200':",
  '          description: ok',
  '          content:',
  '            application/json:',
  '              schema:',
  '                type: object',
  '                properties:',
  '                  ok:',
  '                    type: boolean',
  '                    example: true',
  '',
].join('\n');

/** README de mocks/ con puertos y comandos. */
function mocksReadme(policy, need) {
  const rows = [
    need.idp && ['IdP (OIDC)', MOCK_PORTS.idp, `http://localhost:${MOCK_PORTS.idp}/default`],
    need.wiremock && ['WireMock', MOCK_PORTS.wiremock, `http://localhost:${MOCK_PORTS.wiremock}/__admin`],
    need.prism && ['Prism', MOCK_PORTS.prism, `http://localhost:${MOCK_PORTS.prism}`],
    need.mailpit && ['Mailpit (UI)', MOCK_PORTS.mailpitUi, `http://localhost:${MOCK_PORTS.mailpitUi}`],
    need.stripe && ['stripe-mock', MOCK_PORTS.stripe, `http://localhost:${MOCK_PORTS.stripe}`],
    need.s3 && ['LocalStack', MOCK_PORTS.aws, `http://localhost:${MOCK_PORTS.aws}`],
    need.redis && ['Redis', MOCK_PORTS.redis, `redis://localhost:${MOCK_PORTS.redis}/0`],
  ].filter(Boolean);
  return [
    '# Mocks del ambiente de IA',
    '',
    `Proyecto: **${policy?.project || 'app'}**. Todo escucha SOLO en \`127.0.0.1\`: nada queda expuesto en la red.`,
    '',
    '| Servicio | Puerto | URL |',
    '|---|---|---|',
    ...rows.map(([n, p, u]) => `| ${n} | ${p} | \`${u}\` |`),
    '',
    '## Comandos',
    '',
    '```sh',
    'bot-secure mocks up        # levanta los mocks y la BD de pruebas',
    'bot-secure mocks status    # qué está arriba',
    'bot-secure mocks idp       # solo el proveedor de identidad',
    'bot-secure mocks keys generate  # llaves descartables en .bot-secure/ai-keys/',
    'bot-secure mocks down      # apaga todo',
    '```',
    '',
    'Ningún mock guarda datos reales. Si necesitas datos, usa los sintéticos de `bot-secure db seed`.',
    '',
  ].join('\n');
}

/**
 * Artefactos de mocks/ (config del IdP, mappings de WireMock, Prism, README).
 * @param {string} root
 * @param {object} policy
 * @param {object[]} apps
 * @returns {Artifact[]}
 */
export function generateMocks(root, policy, apps = []) {
  const need = mocksNeeded(policy, apps);
  const out = [];
  const p = (...parts) => join(MOCKS_DIR, ...parts);
  if (need.idp) {
    out.push({ path: p('idp', 'config.json'), content: idpConfig(policy) });
    out.push({ path: p('idp', 'README.md'), content: IDP_README });
  }
  if (need.wiremock) out.push({ path: p('wiremock', 'mappings', 'default.json'), content: WIREMOCK_MAPPING });
  if (need.prism) {
    out.push({ path: p('prism', 'openapi.yaml'), content: PRISM_OPENAPI });
    out.push({ path: p('prism', 'README.md'), content: PRISM_README });
  }
  out.push({ path: p('README.md'), content: mocksReadme(policy, need) });
  return out;
}

/* ------------------------------------------------- llaves descartables ---------------------- */

/** Nombre del archivo de llaves por tipo. */
const KEY_FILES = { rsa: 'ai-rsa', ec: 'ai-ec' };

/**
 * Genera llaves DESCARTABLES para el ambiente de IA en `.bot-secure/ai-keys/`.
 * RSA y EC con node:crypto (siempre); certificado autofirmado y PKCS#12 con `openssl` si existe.
 * @param {string} root raíz del workspace
 * @param {{types?:string[], dryRun?:boolean, password?:string}} [opts]
 * @returns {{dir:string, files:string[], pkcs12:string|null, openssl:boolean, dryRun:boolean, password:string}}
 */
export function generateKeys(root, opts = {}) {
  const dir = join(root, KEYS_DIR);
  const types = opts.types?.length ? opts.types : ['rsa', 'ec'];
  const password = opts.password || '__AI_PLACEHOLDER__KEYSTORE_PASSWORD__';
  const files = [];
  if (opts.dryRun) {
    for (const t of types) files.push(join(KEYS_DIR, `${KEY_FILES[t] ?? t}.key.pem`), join(KEYS_DIR, `${KEY_FILES[t] ?? t}.pub.pem`));
    return { dir, files, pkcs12: null, openssl: !!which('openssl'), dryRun: true, password };
  }

  mkdirSync(dir, { recursive: true });
  for (const type of types) {
    const base = KEY_FILES[type] ?? type;
    const { privateKey, publicKey } = type === 'ec'
      ? generateKeyPairSync('ec', { namedCurve: 'prime256v1', publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
      : generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    writeText(join(dir, `${base}.key.pem`), `${THROWAWAY_HEADER}\n${privateKey}`);
    writeText(join(dir, `${base}.pub.pem`), `${THROWAWAY_HEADER}\n${publicKey}`);
    files.push(join(KEYS_DIR, `${base}.key.pem`), join(KEYS_DIR, `${base}.pub.pem`));
  }

  // El certificado X.509 y el PKCS#12 no se pueden construir con node:crypto sin dependencias:
  // se usa `openssl` del sistema si está, y si no se dice exactamente qué falta.
  const ossl = which('openssl');
  let pkcs12 = null;
  if (ossl) {
    const key = join(dir, 'ai-rsa.key.pem');
    const crt = join(dir, 'ai-rsa.crt.pem');
    const p12 = join(dir, 'ai-keystore.p12');
    const req = run(ossl, ['req', '-new', '-x509', '-key', key, '-out', crt, '-days', '365', '-subj', '/CN=ai.local/O=bot-secure/C=MX'], { cwd: root });
    if (req.status === 0) {
      const exp = run(ossl, ['pkcs12', '-export', '-inkey', key, '-in', crt, '-out', p12, '-name', 'ai', '-passout', `pass:${password}`], { cwd: root });
      // El certificado también lleva la marca: así el escáner lo trata como descartable.
      try { writeText(crt, `${THROWAWAY_HEADER}\n${readFileSync(crt, 'utf8')}`); } catch { /* el certificado ya está en disco */ }
      files.push(join(KEYS_DIR, 'ai-rsa.crt.pem'));
      if (exp.status === 0) { pkcs12 = join(KEYS_DIR, 'ai-keystore.p12'); files.push(pkcs12); }
    }
  }
  writeText(join(dir, 'README.md'), keysReadme(password, !!ossl));
  files.push(join(KEYS_DIR, 'README.md'));
  return { dir, files, pkcs12, openssl: !!ossl, dryRun: false, password };
}

function keysReadme(password, hasOpenssl) {
  return [
    '# Llaves descartables del ambiente de IA',
    '',
    `Marcadas con \`${THROWAWAY_HEADER}\`: son de usar y tirar, nunca protegen nada real.`,
    'Esta carpeta está en `.gitignore` y el hook `pre-commit` la bloquea aunque el ignore falle.',
    '',
    `- \`ai-rsa.key.pem\` / \`ai-rsa.pub.pem\` — RSA 2048 (firma de JWT de pruebas).`,
    '- `ai-ec.key.pem` / `ai-ec.pub.pem` — EC P-256.',
    hasOpenssl
      ? `- \`ai-keystore.p12\` — PKCS#12 autofirmado; contraseña \`${password}\`.`
      : '- PKCS#12: no se generó porque no hay `openssl` en el PATH. Arreglo: instala openssl y repite `bot-secure mocks keys generate`.',
    '',
    'Rotación: no aplica. Si se filtran, no hay nada que rotar; regenera con el mismo comando.',
    '',
  ].join('\n');
}

/** ¿Ya hay llaves generadas? */
export function keysStatus(root) {
  const dir = join(root, KEYS_DIR);
  if (!existsSync(dir)) return { exists: false, files: [] };
  const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
  return { exists: true, files };
}

/** Semilla aleatoria para contraseñas de keystore de un solo uso (no se registra en ningún log). */
export function throwawayPassword() { return `__AI_PLACEHOLDER__KEYSTORE_${randomBytes(4).toString('hex').toUpperCase()}__`; }

/* ------------------------------------------ operación (up/down/status) ---------------------- */

/** Servicio de compose que corresponde a cada mock necesario. */
export const SERVICE_OF = Object.freeze({ idp: 'idp', wiremock: 'wiremock', prism: 'prism', mailpit: 'mailpit', stripe: 'stripe-mock', s3: 'localstack', redis: 'redis' });
/** Puerto publicado (en 127.0.0.1) de cada servicio. */
export const PORT_OF = Object.freeze({ idp: MOCK_PORTS.idp, wiremock: MOCK_PORTS.wiremock, prism: MOCK_PORTS.prism, mailpit: MOCK_PORTS.mailpitUi, 'stripe-mock': MOCK_PORTS.stripe, localstack: MOCK_PORTS.aws, redis: MOCK_PORTS.redis });

/** Servicios de mocks activos para esta política. */
export function mockServices(policy, apps = []) {
  const need = mocksNeeded(policy, apps);
  return Object.entries(need).filter(([, on]) => on).map(([k]) => SERVICE_OF[k]).filter(Boolean);
}

const COMPOSE_AI = 'compose.ai.yml';
const projectName = (policy) => `${slug(policy?.project || 'app')}-ai`;

/** Carga perezosa del runtime de contenedores (compartido con `src/db`). */
async function runtime() {
  const mod = await import('../db/runtime.mjs');
  return { rt: await mod.containerRuntime(), compose: mod.compose };
}

/**
 * Levanta los mocks del ambiente de IA (o solo los indicados).
 * @returns {Promise<{ok:boolean, services:string[], runtime:string|null, dryRun:boolean, reason?:string}>}
 */
export async function up(root, policy, opts = {}) {
  const services = opts.services?.length ? opts.services : mockServices(policy, opts.apps ?? policy?.apps ?? []);
  const file = join(root, COMPOSE_AI);
  if (opts.dryRun) return { ok: true, services, runtime: null, dryRun: true };
  if (!existsSync(file)) return { ok: false, services, runtime: null, dryRun: false, reason: 'no-compose' };
  const { rt, compose } = await runtime();
  if (!rt.kind || !rt.compose.length) return { ok: false, services, runtime: null, dryRun: false, reason: 'no-runtime' };
  const res = compose(rt, { file: COMPOSE_AI, project: projectName(policy), cwd: root, args: ['up', '-d', ...services] });
  return { ok: res.status === 0, services, runtime: rt.kind, dryRun: false, reason: res.status === 0 ? undefined : 'compose-failed' };
}

/** Apaga los mocks (sin borrar volúmenes: los mocks no guardan estado). */
export async function down(root, policy, opts = {}) {
  const services = opts.services?.length ? opts.services : mockServices(policy, opts.apps ?? policy?.apps ?? []);
  const file = join(root, COMPOSE_AI);
  if (opts.dryRun) return { ok: true, services, runtime: null, dryRun: true };
  if (!existsSync(file)) return { ok: false, services, runtime: null, dryRun: false, reason: 'no-compose' };
  const { rt, compose } = await runtime();
  if (!rt.kind || !rt.compose.length) return { ok: false, services, runtime: null, dryRun: false, reason: 'no-runtime' };
  const res = compose(rt, { file: COMPOSE_AI, project: projectName(policy), cwd: root, args: ['stop', ...services] });
  return { ok: res.status === 0, services, runtime: rt.kind, dryRun: false };
}

/** Qué mocks están arriba (y dónde escuchan). */
export async function status(root, policy, opts = {}) {
  const services = mockServices(policy, opts.apps ?? policy?.apps ?? []);
  const keys = keysStatus(root);
  const file = join(root, COMPOSE_AI);
  if (!existsSync(file)) return { ok: false, services, running: [], ports: PORT_OF, runtime: null, keys, reason: 'no-compose' };
  const { rt, compose } = await runtime();
  if (!rt.kind || !rt.compose.length) return { ok: false, services, running: [], ports: PORT_OF, runtime: null, keys, reason: 'no-runtime' };
  const res = compose(rt, { file: COMPOSE_AI, project: projectName(policy), cwd: root, args: ['ps', '--services', '--filter', 'status=running'] });
  const running = (res.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return { ok: true, services, running, ports: PORT_OF, runtime: rt.kind, keys };
}
