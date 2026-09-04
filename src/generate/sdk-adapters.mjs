// Adaptadores por SDK: lo que NO se resuelve con una variable de entorno.
// Cada adaptador devuelve un fragmento revisable (`sanitize --refactor` lo propone como diff).
import { MOCK_PORTS, slug } from './fakes.mjs';
import { appJoin } from './env-ai.mjs';

/** @typedef {{sdk:string, file:string, snippet:string, docs:string, lang?:string}} Adapter */

const PY = new Set(['django', 'fastapi', 'flask', 'python']);
const JVM = new Set(['spring', 'quarkus', 'micronaut', 'java', 'kotlin', 'android']);
const FRONT = new Set(['angular', 'next', 'nuxt', 'vite', 'cra', 'vue', 'svelte']);

const lang = (app) => (PY.has(app?.stack) ? 'python' : JVM.has(app?.stack) ? 'java' : app?.stack === 'dotnet' ? 'csharp' : app?.stack === 'go' ? 'go' : app?.stack === 'php' || app?.stack === 'laravel' || app?.stack === 'symfony' ? 'php' : 'ts');

const ext = (app) => ({ python: 'py', java: 'java', csharp: 'cs', go: 'go', php: 'php', ts: 'ts' })[lang(app)];

/** Ruta del fragmento del adaptador dentro de la app (archivo NUEVO: nunca pisa código existente). */
function adapterFile(app, sdk) {
  const l = lang(app);
  if (l === 'python') return `ai_adapters/${sdk.replace(/-/g, '_')}_ai.py`;
  if (l === 'java') return `src/main/java/aienv/adapters/${pascal(sdk)}Ai.java`;
  if (l === 'csharp') return `AiAdapters/${pascal(sdk)}Ai.cs`;
  if (l === 'go') return `internal/aienv/adapters/${sdk.replace(/-/g, '')}.go`;
  if (l === 'php') return `ai-adapters/${sdk}-ai.php`;
  return `src/ai-adapters/${sdk}-ai.${ext(app)}`;
}

/** PascalCase de un id de SDK (nombre de clase en Java/C#). */
function pascal(s) { return String(s).split(/[^a-z0-9]+/i).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(''); }

const P = MOCK_PORTS;

function stripe(app) {
  const l = lang(app);
  if (l === 'python') {
    return [
      '"""Stripe en el ambiente de IA: todo va a stripe-mock, nunca a api.stripe.com."""',
      'import os',
      '',
      'import stripe',
      '',
      'if os.environ.get("AI_ENV") == "1":',
      `    stripe.api_base = "http://localhost:${P.stripe}"`,
      `    stripe.upload_api_base = "http://localhost:${P.stripe}"`,
      '    stripe.verify_ssl_certs = False',
      '',
    ].join('\n');
  }
  if (l === 'java') {
    return [
      'package aienv.adapters;',
      '',
      'import com.stripe.Stripe;',
      '',
      '/** Stripe apuntando a stripe-mock cuando AI_ENV=1. */',
      'public final class StripeAi {',
      '  public static void apply() {',
      '    if (!"1".equals(System.getenv("AI_ENV"))) {',
      '      return;',
      '    }',
      `    Stripe.overrideApiBase("http://localhost:${P.stripe}");`,
      `    Stripe.overrideUploadBase("http://localhost:${P.stripe}");`,
      '  }',
      '}',
      '',
    ].join('\n');
  }
  if (l === 'csharp') {
    return [
      '// Stripe apuntando a stripe-mock cuando AI_ENV=1.',
      'using Stripe;',
      '',
      'public static class StripeAi',
      '{',
      '    public static void Apply()',
      '    {',
      '        if (Environment.GetEnvironmentVariable("AI_ENV") != "1")',
      '        {',
      '            return;',
      '        }',
      '',
      `        StripeConfiguration.ApiBase = "http://localhost:${P.stripe}";`,
      '    }',
      '}',
      '',
    ].join('\n');
  }
  return [
    "// Stripe en el ambiente de IA: cliente contra stripe-mock (nunca api.stripe.com).",
    "import Stripe from 'stripe';",
    '',
    "const isAi = process.env.AI_ENV === '1';",
    '',
    'export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", isAi',
    '  ? {',
    "      host: 'localhost',",
    `      port: ${P.stripe},`,
    "      protocol: 'http',",
    '    }',
    '  : {});',
    '',
  ].join('\n');
}

function sendgrid(app) {
  if (lang(app) === 'python') {
    return [
      '"""SendGrid contra un mock local (Prism/WireMock): nunca sale correo real."""',
      'import os',
      '',
      'from sendgrid import SendGridAPIClient',
      '',
      'client = SendGridAPIClient(os.environ.get("SENDGRID_API_KEY", ""))',
      'if os.environ.get("AI_ENV") == "1":',
      `    client.host = "http://localhost:${P.prism}"`,
      '',
    ].join('\n');
  }
  return [
    '// SendGrid contra un mock local: el correo termina en Mailpit, no en el cliente.',
    "import sgMail from '@sendgrid/mail';",
    '',
    "sgMail.setApiKey(process.env.SENDGRID_API_KEY ?? '');",
    "if (process.env.AI_ENV === '1') {",
    `  sgMail.setClient(Object.assign(sgMail.client, { defaultRequest: { baseUrl: 'http://localhost:${P.prism}' } }));`,
    '}',
    '',
  ].join('\n');
}

function twilio(app) {
  if (lang(app) === 'python') {
    return [
      '"""Twilio contra Prism (OpenAPI público de Twilio). Ningún SMS real."""',
      'import os',
      '',
      'from twilio.rest import Client',
      '',
      'client = Client(os.environ.get("TWILIO_ACCOUNT_SID"), os.environ.get("TWILIO_AUTH_TOKEN"))',
      'if os.environ.get("AI_ENV") == "1":',
      `    client.edge = None`,
      `    client._session = None  # noqa: SLF001`,
      `    Client.base_url = "http://localhost:${P.prism}"`,
      '',
    ].join('\n');
  }
  return [
    '// Twilio contra Prism (mock del OpenAPI público). Ningún SMS real sale del ambiente de IA.',
    "import twilio from 'twilio';",
    '',
    'export const client = twilio(',
    "  process.env.TWILIO_ACCOUNT_SID ?? '',",
    "  process.env.TWILIO_AUTH_TOKEN ?? '',",
    "  process.env.AI_ENV === '1'",
    `    ? { lazyLoading: true, userAgentExtensions: ['bot-secure-ai'] }`,
    '    : {},',
    ');',
    '',
    '// Redirige el host: en el ambiente de IA todas las llamadas van a Prism.',
    "if (process.env.AI_ENV === '1') {",
    `  client.request = ((original) => (opts) => original({ ...opts, uri: String(opts.uri).replace('https://api.twilio.com', 'http://localhost:${P.prism}') }))(client.request.bind(client));`,
    '}',
    '',
  ].join('\n');
}

function firebase(app, c) {
  if (lang(app) === 'python') {
    return [
      '"""Firebase con emuladores y proyecto demo-*: sin proyecto real."""',
      'import os',
      '',
      'if os.environ.get("AI_ENV") == "1":',
      `    os.environ.setdefault("FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099")`,
      `    os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "localhost:8080")`,
      `    os.environ.setdefault("GCLOUD_PROJECT", "demo-${slug(c.project)}-ai")`,
      '',
    ].join('\n');
  }
  return [
    '// Firebase en el ambiente de IA: emuladores + proyecto demo-* (requiere Java instalado).',
    "import { initializeApp } from 'firebase/app';",
    "import { connectAuthEmulator, getAuth } from 'firebase/auth';",
    "import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';",
    '',
    `export const app = initializeApp({ projectId: 'demo-${slug(c.project)}-ai', apiKey: process.env.FIREBASE_API_KEY ?? '' });`,
    '',
    "if (process.env.AI_ENV === '1') {",
    "  connectAuthEmulator(getAuth(app), 'http://localhost:9099', { disableWarnings: true });",
    "  connectFirestoreEmulator(getFirestore(app), 'localhost', 8080);",
    '}',
    '',
  ].join('\n');
}

function supabase() {
  return [
    '// Supabase local (supabase start). La llave `service_role` NUNCA va al front.',
    "import { createClient } from '@supabase/supabase-js';",
    '',
    `const url = process.env.AI_ENV === '1' ? 'http://localhost:${P.supabase}' : (process.env.SUPABASE_URL ?? '');`,
    '',
    "export const supabase = createClient(url, process.env.SUPABASE_ANON_KEY ?? '');",
    '',
  ].join('\n');
}

function aws(app) {
  if (lang(app) === 'python') {
    return [
      '"""boto3 contra LocalStack/MinIO: AWS_ENDPOINT_URL basta para todos los clientes."""',
      'import os',
      '',
      'if os.environ.get("AI_ENV") == "1":',
      `    os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:${P.aws}")`,
      '    os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")',
      '',
    ].join('\n');
  }
  return [
    '// AWS SDK v3 contra LocalStack/MinIO. AWS_ENDPOINT_URL lo respetan todos los clientes v3.',
    "if (process.env.AI_ENV === '1') {",
    `  process.env.AWS_ENDPOINT_URL ??= 'http://localhost:${P.aws}';`,
    "  process.env.AWS_DEFAULT_REGION ??= 'us-east-1';",
    '}',
    '',
    "export const s3Options = process.env.AI_ENV === '1'",
    `  ? { endpoint: 'http://localhost:${P.aws}', forcePathStyle: true, region: 'us-east-1' }`,
    '  : {};',
    '',
  ].join('\n');
}

function secretManager(app, name) {
  const l = lang(app);
  if (l === 'java') {
    return [
      'package aienv.adapters;',
      '',
      `/** ${name}: en el ambiente de IA NO se consulta al proveedor; los valores vienen de .env.ai. */`,
      'public final class SecretsAi {',
      '  public static boolean bypass() {',
      '    return "1".equals(System.getenv("AI_ENV"));',
      '  }',
      '}',
      '',
      '// application-ai.yml: marca la fuente como opcional para que su ausencia no rompa el arranque.',
      '// spring.config.import: "optional:configserver:"',
      '',
    ].join('\n');
  }
  if (l === 'csharp') {
    return [
      `// ${name}: se omite el proveedor cuando AI_ENV=1 (los valores vienen de appsettings.AI.json).`,
      'if (Environment.GetEnvironmentVariable("AI_ENV") != "1")',
      '{',
      '    builder.Configuration.AddAzureKeyVault(new Uri(keyVaultUri), new DefaultAzureCredential());',
      '}',
      '',
    ].join('\n');
  }
  if (l === 'python') {
    return [
      `"""${name}: se omite el proveedor cuando AI_ENV=1."""`,
      'import os',
      '',
      'def load_secrets() -> dict:',
      '    if os.environ.get("AI_ENV") == "1":',
      '        return {}  # los valores ya están en el entorno (.env.ai)',
      '    return fetch_from_provider()  # tu implementación real',
      '',
    ].join('\n');
  }
  return [
    `// ${name}: en el ambiente de IA no se consulta al proveedor; los valores vienen de .env.ai.`,
    'export async function loadSecrets(): Promise<Record<string, string>> {',
    "  if (process.env.AI_ENV === '1') return {};",
    '  return fetchFromProvider();',
    '}',
    '',
  ].join('\n');
}

function frontScript(sdk) {
  if (sdk === 'google-maps') {
    return [
      '<!-- Google Maps en el ambiente de IA: Leaflet + OpenStreetMap, sin API key. -->',
      '<link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />',
      '<script>',
      "  // En ai-dev no se carga maps.googleapis.com: una key sin restricción de referrer genera facturas ajenas.",
      "  window.__AI_MAPS__ = 'leaflet';",
      '</script>',
      '',
    ].join('\n');
  }
  if (sdk === 'stripe-js') {
    return [
      '<!-- Stripe.js en el ambiente de IA: stub local, no se carga js.stripe.com. -->',
      '<script>',
      '  window.Stripe = function () {',
      '    return {',
      '      elements: () => ({ create: () => ({ mount() {}, on() {}, unmount() {} }) }),',
      '      confirmCardPayment: async () => ({ paymentIntent: { status: "succeeded", id: "pi_ai_stub" } }),',
      '    };',
      '  };',
      '</script>',
      '',
    ].join('\n');
  }
  if (sdk === 'recaptcha') {
    return [
      '<!-- reCAPTCHA con las llaves de prueba oficiales de Google (siempre pasan). -->',
      '<script src="https://www.google.com/recaptcha/api.js" async defer></script>',
      '<div class="g-recaptcha" data-sitekey="6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"></div> <!-- bot-secure:fake recaptcha-site -->',
      '',
    ].join('\n');
  }
  return [
    '// Sentry apagado en el ambiente de IA: ningún evento (ni PII de un stack trace) sale de la máquina.',
    "import * as Sentry from '@sentry/browser';",
    '',
    "Sentry.init({ dsn: process.env.AI_ENV === '1' ? '' : process.env.SENTRY_DSN, enabled: process.env.AI_ENV !== '1' });",
    '',
  ].join('\n');
}

const DOCS = {
  stripe: 'Apunta el cliente a `stripe-mock` (`host`/`port`/`protocol` en Node, `api_base` en Python, `overrideApiBase` en Java).',
  sendgrid: 'Cambia `baseUrl` a un mock local; el correo se ve en Mailpit (http://localhost:' + P.mailpitUi + ').',
  twilio: 'Redirige el `HttpClient` a Prism con el OpenAPI público de Twilio: ningún SMS real.',
  firebase: 'Usa `connect*Emulator` y un proyecto `demo-*` (los proyectos `demo-` nunca tocan producción). Requiere Java.',
  supabase: 'URL local (`supabase start`). La llave `service_role` no debe existir en el front.',
  aws: '`AWS_ENDPOINT_URL` hacia LocalStack/MinIO; todos los clientes del SDK v3 y boto3 lo respetan.',
  clerk: 'Llave `pk_test_` de desarrollo; el dominio del ambiente de IA es `ai.local`.',
  mapbox: 'Token `pk.` falso; en el ambiente de IA los mapas usan Leaflet + OpenStreetMap.',
  sentry: 'Apagado (`enabled: false`): un stack trace puede llevar PII.',
  'google-maps': 'Proveedor alterno (Leaflet + OSM): una API key de Maps sin restricción de referrer genera facturas ajenas.',
  'stripe-js': 'Stub local de `Stripe.js`; no se carga `js.stripe.com`.',
  recaptcha: 'Llaves de prueba oficiales de Google (site y secret) que siempre validan.',
};

const SECRET_MANAGER_LABEL = {
  'azure-key-vault': 'Azure Key Vault', 'aws-secrets-manager': 'AWS Secrets Manager',
  'gcp-secret-manager': 'GCP Secret Manager', vault: 'HashiCorp Vault',
  'spring-cloud-config': 'Spring Cloud Config Server', doppler: 'Doppler',
  'dotenv-vault': 'dotenv-vault', infisical: 'Infisical', sops: 'SOPS',
};

/**
 * Adaptadores aplicables a una app, según `app.sdks` y `app.secretManagers`.
 * @param {object} app App de policy.apps (usa `sdks`, `secretManagers`, `stack`, `kind`, `path`)
 * @param {{project?:string}} [opts]
 * @returns {Adapter[]}
 */
export function adaptersFor(app, opts = {}) {
  const c = { project: opts.project || 'app' };
  const sdks = new Set(app?.sdks ?? []);
  const managers = app?.secretManagers ?? [];
  const out = [];
  const add = (sdk, snippet, docs) => out.push({ sdk, file: appJoin(app, ...adapterFile(app, sdk).split('/')), snippet, docs, lang: lang(app) });

  if (sdks.has('stripe')) add('stripe', stripe(app), DOCS.stripe);
  if (sdks.has('sendgrid')) add('sendgrid', sendgrid(app), DOCS.sendgrid);
  if (sdks.has('twilio')) add('twilio', twilio(app), DOCS.twilio);
  if (sdks.has('firebase')) add('firebase', firebase(app, c), DOCS.firebase);
  if (sdks.has('supabase')) add('supabase', supabase(), DOCS.supabase);
  if (sdks.has('aws')) add('aws', aws(app), DOCS.aws);

  for (const m of managers) {
    add(m, secretManager(app, SECRET_MANAGER_LABEL[m] ?? m),
      `${SECRET_MANAGER_LABEL[m] ?? m}: se omite el proveedor cuando \`AI_ENV=1\`; los valores vienen de \`.env.ai\`.`);
  }

  if (FRONT.has(app?.stack) || app?.kind === 'frontend') {
    // Los tres primeros entran por <script>: el fragmento es HTML, no TypeScript.
    const html = (sdk) => out.push({ sdk, file: appJoin(app, 'src', 'ai-adapters', `${sdk}-ai.html`), snippet: frontScript(sdk), docs: DOCS[sdk], lang: 'html' });
    if (sdks.has('google-maps')) html('google-maps');
    if (sdks.has('stripe')) html('stripe-js');
    html('recaptcha');
    if (sdks.has('sentry')) add('sentry', frontScript('sentry'), DOCS.sentry);
  }
  return out;
}

/** Markdown con la tabla de adaptadores de todas las apps (docs/ADAPTERS.md). */
export function adaptersDoc(apps = [], opts = {}) {
  const lines = [
    '# Adaptadores por SDK en el ambiente de IA',
    '',
    'Algunos SDK no se mockean con una variable de entorno. El bot genera el fragmento concreto',
    'como archivo NUEVO (nunca pisa tu código): revísalo y aplícalo donde construyes el cliente.',
    '',
  ];
  let any = false;
  for (const app of apps) {
    const adapters = adaptersFor(app, opts);
    if (!adapters.length) continue;
    any = true;
    lines.push(`## ${app.name} (\`${app.path || '.'}\`, ${app.stack})`, '', '| SDK | Archivo | Qué hace |', '|---|---|---|');
    for (const a of adapters) lines.push(`| ${a.sdk} | \`${a.file}\` | ${a.docs} |`);
    lines.push('');
  }
  if (!any) lines.push('_No se detectó ningún SDK que necesite adaptador._', '');
  return lines.join('\n');
}

/** Artefactos de los adaptadores (un archivo por adaptador). */
export function adapterArtifacts(apps = [], opts = {}) {
  const out = [];
  for (const app of apps) for (const a of adaptersFor(app, opts)) out.push({ path: a.file, content: a.snippet });
  return out;
}

export { FRONT };
