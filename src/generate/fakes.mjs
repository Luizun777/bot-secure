// Fakes tipados: valores FALSOS pero VÁLIDOS POR FORMATO para el ambiente de IA (.env.ai).
// Deterministas, reconocibles por el escáner (isFake) y nunca secretos reales.
import { createHash } from 'node:crypto';

/** Placeholder para credenciales cuyo consumidor acepta cualquier string. */
export const PLACEHOLDER_RE = /^__AI_PLACEHOLDER__[A-Z0-9_]+__$/;
/** Placeholder rellenado (p. ej. JWT ≥ 64 chars). */
const PLACEHOLDER_PADDED_RE = /^__AI_PLACEHOLDER__[A-Z0-9_]+__[A-Za-z0-9]*$/;
export const FAKE_COMMENT_PREFIX = '# bot-secure:fake';
export const GUID_FAKE = '00000000-0000-4000-8000-000000000000';
export const EMAIL_FAKE = 'noreply@ai.local';
export const HOST_FAKE = 'localhost';
export const REGION_FAKE = 'us-east-1';

/** Puertos de los mocks locales (una sola fuente para .env.ai, compose y docs). */
export const MOCK_PORTS = Object.freeze({
  idp: 8081, wiremock: 8090, prism: 4010, stripe: 12111, smtp: 1025, mailpitUi: 8025,
  minio: 9000, minioConsole: 9001, aws: 4566, redis: 6379, supabase: 54321, kafka: 9092, amqp: 5672, mongo: 27017,
});

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function digest(seed) { return createHash('sha256').update(`bot-secure:fake:${seed}`).digest(); }

/** Relleno determinista de longitud n con el alfabeto dado. */
function fill(seed, n, alphabet = ALNUM) {
  let out = ''; let i = 0;
  while (out.length < n) { for (const b of digest(`${seed}:${i++}`)) { out += alphabet[b % alphabet.length]; if (out.length >= n) break; } }
  return out;
}
const hex = (seed, n) => fill(seed, n, '0123456789abcdef');

/** Normaliza un nombre de variable a MAYÚSCULAS_CON_GUION_BAJO. */
export function normName(name) { return String(name || 'VALUE').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'VALUE'; }
/** Slug minúsculas con guiones (buckets, ids, project ids). */
export function slug(s) { return String(s || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app'; }

const b64 = (buf) => Buffer.from(buf).toString('base64');
const b64url = (s) => Buffer.from(s).toString('base64url');

/** Catálogo de fakes por SDK (id → detector por nombre, generador, reconocedor). */
export const SDK_CATALOG = [
  { id: 'stripe-secret', names: /STRIPE.*(SECRET|API_?KEY|_SK\b)|^STRIPE_KEY$/i, gen: () => `sk_test_AIPLACEHOLDER${fill('stripe-secret', 19)}`, test: (v) => /^sk_test_AIPLACEHOLDER[A-Za-z0-9]{19}$/.test(v) },
  { id: 'stripe-publishable', names: /STRIPE.*(PUBLISHABLE|PUBLIC|_PK\b)/i, gen: () => `pk_test_AIPLACEHOLDER${fill('stripe-publishable', 19)}`, test: (v) => /^pk_test_AIPLACEHOLDER[A-Za-z0-9]{19}$/.test(v) },
  { id: 'stripe-webhook', names: /STRIPE.*WEBHOOK/i, gen: () => `whsec_AIPLACEHOLDER${fill('stripe-webhook', 19)}`, test: (v) => /^whsec_AIPLACEHOLDER[A-Za-z0-9]{19}$/.test(v) },
  { id: 'twilio-sid', names: /TWILIO.*(SID|ACCOUNT)/i, gen: () => `AC${hex('twilio-sid', 32)}`, test: (v) => v === `AC${hex('twilio-sid', 32)}` },
  { id: 'twilio-token', names: /TWILIO.*(TOKEN|SECRET|KEY)/i, gen: () => hex('twilio-token', 32), test: (v) => v === hex('twilio-token', 32) },
  { id: 'sendgrid', names: /SENDGRID/i, gen: () => `SG.AIPLACEHOLDER${fill('sendgrid-a', 9, B64URL)}.AIPLACEHOLDER${fill('sendgrid-b', 30, B64URL)}`, test: (v) => /^SG\.AIPLACEHOLDER[A-Za-z0-9_-]{9}\.AIPLACEHOLDER[A-Za-z0-9_-]{30}$/.test(v) },
  { id: 'jwt-secret', names: /JWT.*(SECRET|KEY|SIGNING)|(SECRET|SIGNING).*JWT|TOKEN_SECRET|SESSION_SECRET|COOKIE_SECRET/i, gen: (name) => padPlaceholder(name, 64), test: (v) => PLACEHOLDER_PADDED_RE.test(v) && v.length >= 64 },
  { id: 'laravel-app-key', names: /^APP_KEY$/i, gen: () => `base64:${b64(digest('laravel-app-key'))}`, test: (v) => v === `base64:${b64(digest('laravel-app-key'))}` },
  { id: 'aes-32', names: /(ENCRYPTION|ENCRYPT|CIPHER|AES|FERNET).*(KEY|SECRET)/i, gen: () => `AIPLACEHOLDERAES${fill('aes-32', 16)}`, test: (v) => v === `AIPLACEHOLDERAES${fill('aes-32', 16)}` },
  { id: 'clerk-publishable', names: /CLERK.*(PUBLISHABLE|PUBLIC)/i, gen: () => `pk_test_${b64url('ai.local$')}`, test: (v) => v === `pk_test_${b64url('ai.local$')}` },
  { id: 'firebase-project', names: /FIREBASE.*PROJECT|GCLOUD_PROJECT|GOOGLE_CLOUD_PROJECT/i, gen: (_n, project) => `demo-${slug(project)}-ai`, test: (v) => /^demo-[a-z0-9-]+-ai$/.test(v) },
  { id: 'recaptcha-site', names: /RECAPTCHA.*(SITE|PUBLIC)/i, gen: () => '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI', test: (v) => v === '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI' },
  { id: 'recaptcha-secret', names: /RECAPTCHA.*SECRET/i, gen: () => '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe', test: (v) => v === '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe' },
  { id: 'mapbox', names: /MAPBOX/i, gen: () => `pk.${b64url(JSON.stringify({ u: 'ai-local', a: 'bot-secure:fake' }))}.AIPLACEHOLDER`, test: (v) => /^pk\.[A-Za-z0-9_-]+\.AIPLACEHOLDER$/.test(v) },
  { id: 'aws-access-key', names: /AWS_ACCESS_KEY_ID|AWS.*ACCESS_KEY$/i, gen: () => 'AKIAIOSFODNN7EXAMPLE', test: (v) => v === 'AKIAIOSFODNN7EXAMPLE' },
  { id: 'aws-secret-key', names: /AWS_SECRET_ACCESS_KEY|AWS.*SECRET/i, gen: () => 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', test: (v) => v === 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
];

/** Placeholder rellenado a una longitud mínima (JWT HS256 exige ≥ 32 bytes; usamos 64). */
export function padPlaceholder(name, min) {
  const base = `__AI_PLACEHOLDER__${normName(name)}__`;
  return base.length >= min ? base : base + fill(`pad:${normName(name)}`, min - base.length);
}

/** SDK del catálogo que corresponde a un nombre de variable (o null). */
export function sdkForName(name) { const n = String(name || ''); return SDK_CATALOG.find((s) => s.names.test(n)) || null; }

/** Puerto de mock según el nombre de la variable (url). */
export function mockUrlFor(name, { backendPort = 8080, frontendPort = 4200 } = {}) {
  const n = String(name || '').toUpperCase();
  if (/JWKS/.test(n)) return `http://localhost:${MOCK_PORTS.idp}/default/jwks`;
  if (/ISSUER|OIDC|OAUTH|KEYCLOAK|AUTHORITY|IDP|AUTH0|COGNITO|OPENID/.test(n)) return `http://localhost:${MOCK_PORTS.idp}/default`;
  if (/STRIPE/.test(n)) return `http://localhost:${MOCK_PORTS.stripe}`;
  if (/REDIS|CACHE_URL|CELERY|BROKER/.test(n)) return `redis://localhost:${MOCK_PORTS.redis}/0`;
  if (/MONGO/.test(n)) return `mongodb://localhost:${MOCK_PORTS.mongo}/app_ai`;
  if (/AMQP|RABBIT/.test(n)) return `amqp://localhost:${MOCK_PORTS.amqp}`;
  if (/KAFKA|BOOTSTRAP/.test(n)) return `localhost:${MOCK_PORTS.kafka}`;
  if (/SMTP|MAIL/.test(n)) return `smtp://localhost:${MOCK_PORTS.smtp}`;
  if (/S3|MINIO|AWS|LOCALSTACK/.test(n)) return `http://localhost:${MOCK_PORTS.aws}`;
  if (/SUPABASE/.test(n)) return `http://localhost:${MOCK_PORTS.supabase}`;
  if (/SENDGRID|TWILIO|PRISM|OPENAPI/.test(n)) return `http://localhost:${MOCK_PORTS.prism}`;
  if (/FRONT|CORS|ORIGIN|APP_URL|SITE_URL|PUBLIC_URL|BASE_URL|WEB_URL|CLIENT_URL/.test(n)) return `http://localhost:${frontendPort}`;
  if (/API|BACKEND|SERVER|SERVICE|GATEWAY/.test(n)) return `http://localhost:${backendPort}`;
  return `http://localhost:${MOCK_PORTS.wiremock}`;
}

/**
 * Infiera el tipo (remediation.kind) de una variable por su nombre.
 * 'plain' = valor no sensible que se conserva tal cual (PORT, NODE_ENV, flags).
 * @returns {'secret'|'identifier'|'url'|'host'|'email'|'guid'|'bucket'|'region'|'sdk-key'|'db-url'|'plain'}
 */
export function inferKind(name) {
  const n = normName(name);
  if (/^(NODE_ENV|APP_ENV|APP_DEBUG|ENV|ENVIRONMENT|DEBUG|LOG_LEVEL|TZ|LANG|LOCALE|PORT|HTTP_PORT|SERVER_PORT|AI_ENV)$/.test(n) || /_(PORT|ENABLED|DISABLED|TIMEOUT|LIMIT|LEVEL|MODE|VERSION|TTL|SIZE|COUNT|DEBUG|AI_ENV)$/.test(n)) return 'plain';
  if (/SENTRY_DSN/.test(n)) return 'plain';
  if (/DATABASE_URL|^DB_URL$|JDBC|CONNECTION_?STRING|_DSN$|^DSN$|DATABASE_URI|MONGODB_URI|^MONGO_URL$/.test(n)) return 'db-url';
  if (sdkForName(n)) return 'sdk-key';
  if (/(^|_)(URL|URI|URLS|ENDPOINT|ENDPOINTS|ISSUER|ORIGIN|ORIGINS|AUTHORITY|HREF|CALLBACK)$|_URL_|_ISSUER_URI$|JWKS/.test(n)) return 'url';
  if (/(^|_)(HOST|HOSTNAME|SERVER|ADDR|ADDRESS)$/.test(n)) return 'host';
  if (/BUCKET/.test(n)) return 'bucket';
  if (/(^|_)(EMAIL|MAIL_FROM|FROM_ADDRESS|FROM|TO|SENDER|RECIPIENT)$|EMAIL_/.test(n)) return 'email';
  if (/TENANT|GUID|UUID/.test(n)) return 'guid';
  if (/REGION/.test(n)) return 'region';
  if (/(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD|CREDENTIAL|CREDENTIALS|PRIVATE|SALT|SIGNING|CERT)(_|$)/.test(n)) return 'secret';
  if (/(^|_)(ID|CLIENT|CLIENT_ID|ACCOUNT|USER|USERNAME|NAME|PROJECT|APP_ID|AUDIENCE|REALM|NAMESPACE|QUEUE|TOPIC|INDEX|DATABASE|DB|SCHEMA)$/.test(n)) return 'identifier';
  return 'plain';
}

/**
 * Valor falso pero válido por formato para el tipo dado.
 * @param {string} kind tipo (remediation.kind o id de SDK del catálogo)
 * @param {string} name nombre de la variable
 * @param {{project?:string, dbUrl?:string, backendPort?:number, frontendPort?:number, example?:string}} [opts]
 * @returns {string}
 */
export function fakeFor(kind, name, opts = {}) {
  const project = opts.project || 'app';
  const sdk = SDK_CATALOG.find((s) => s.id === kind);
  if (sdk) return sdk.gen(name, project);
  switch (kind) {
    case 'secret': return `__AI_PLACEHOLDER__${normName(name)}__`;
    case 'sdk-key': { const s = sdkForName(name); return s ? s.gen(name, project) : `__AI_PLACEHOLDER__${normName(name)}__`; }
    case 'identifier': return `ai-${slug(project)}-${slug(name)}`;
    case 'bucket': return `ai-${slug(project)}-${slug(String(name).replace(/_?BUCKET(_NAME)?$/i, '') || 'bucket')}`;
    case 'url': return mockUrlFor(name, opts);
    case 'db-url': return opts.dbUrl || 'postgres://app:__AI_PLACEHOLDER__DB_PASSWORD__@127.0.0.1:5433/app_ai';
    case 'host': return HOST_FAKE;
    case 'email': return EMAIL_FAKE;
    case 'guid': return GUID_FAKE;
    case 'region': return REGION_FAKE;
    case 'plain': return keepPlain(opts.example);
    default: return `__AI_PLACEHOLDER__${normName(name)}__`;
  }
}

/** Conserva un valor de ejemplo solo si no parece un token (nunca copiamos algo con forma de secreto). */
function keepPlain(example) {
  const v = example == null ? '' : String(example).trim();
  if (!v) return '';
  if (v.length >= 20 && /^[A-Za-z0-9+/=_.-]{20,}$/.test(v)) return '';
  return v;
}

/** Etiqueta de fake para el tipo (id de SDK si aplica). */
export function fakeLabel(kind, name) {
  if (kind === 'sdk-key') return sdkForName(name)?.id || 'secret';
  return kind;
}

/** Comentario que precede al valor en .env.ai. */
export function fakeComment(kind, name) { return `${FAKE_COMMENT_PREFIX} ${fakeLabel(kind, name)}`; }

/** ¿Es un valor generado por bot-secure (placeholder o fake del catálogo)? Nunca reconoce secretos reales. */
export function isFake(value) {
  const v = String(value ?? '').trim();
  if (!v) return false;
  if (PLACEHOLDER_RE.test(v) || PLACEHOLDER_PADDED_RE.test(v)) return true;
  if (SDK_CATALOG.some((s) => s.test(v))) return true;
  if (v === GUID_FAKE || v === EMAIL_FAKE || v === HOST_FAKE) return true;
  if (/^ai-[a-z0-9]+(-[a-z0-9]+)+$/.test(v)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[A-Za-z0-9/._-]*)?$/.test(v)) return true;
  if (/^(redis|mongodb|amqp|smtp):\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[A-Za-z0-9_]*)?$/.test(v)) return true;
  if (/^[a-z0-9+]+:\/\/[A-Za-z0-9_-]+:__AI_PLACEHOLDER__[A-Z0-9_]+__@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]+$/.test(v)) return true;
  return false;
}

/** Registro serializable (para .bot-secure/fakes.json y el escáner): id, kind, ejemplo y patrón. */
export const FAKE_REGISTRY = Object.freeze([
  { id: 'placeholder', kind: 'secret', pattern: PLACEHOLDER_RE.source, example: '__AI_PLACEHOLDER__DB_PASSWORD__' },
  { id: 'placeholder-padded', kind: 'secret', pattern: PLACEHOLDER_PADDED_RE.source, example: padPlaceholder('JWT_SECRET', 64) },
  { id: 'identifier', kind: 'identifier', pattern: '^ai-[a-z0-9]+(-[a-z0-9]+)+$', example: 'ai-tienda-bucket' },
  { id: 'guid', kind: 'guid', pattern: '^00000000-0000-4000-8000-000000000000$', example: GUID_FAKE },
  { id: 'email', kind: 'email', pattern: '^noreply@ai\\.local$', example: EMAIL_FAKE },
  { id: 'host', kind: 'host', pattern: '^localhost$', example: HOST_FAKE },
  { id: 'url', kind: 'url', pattern: '^https?://(localhost|127\\.0\\.0\\.1)(:\\d+)?(/.*)?$', example: `http://localhost:${MOCK_PORTS.idp}/default` },
  ...SDK_CATALOG.map((s) => ({ id: s.id, kind: 'sdk-key', pattern: null, example: s.gen('EXAMPLE', 'tienda') })),
]);
