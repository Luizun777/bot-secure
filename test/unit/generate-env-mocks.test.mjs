// compose.ai.yml, mocks, CI, org-pack y devcontainer. La invariante dura: NADA escucha fuera
// de 127.0.0.1 y ningún artefacto lleva un valor real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeAiObject, networkName, publishedPorts, renderComposeAi } from '../../src/generate/compose.mjs';
import { MOCK_IMAGES, THROWAWAY_HEADER, generateKeys, generateMocks, keysStatus, mockServices, mocksNeeded } from '../../src/generate/mocks.mjs';
import { generateCi } from '../../src/generate/ci.mjs';
import { generateOrgPack, managedSettings } from '../../src/generate/orgpack.mjs';
import { generateDevcontainer } from '../../src/generate/devcontainer.mjs';
import { adaptersFor } from '../../src/generate/sdk-adapters.mjs';

const POLICY = {
  project: 'tienda',
  profile: 'sensitive',
  level: 2,
  db: { engine: 'postgres', port: 5433, database: 'app_ai', user: 'app' },
  branches: { ai: 'ai-dev', taskPrefix: 'ai/', protected: ['dev', 'qa', 'prd', 'release/*'] },
  owners: { infosec: '@org/infosec' },
  network: { allowedDomains: [], registries: ['registry.npmjs.org'], prodHosts: [] },
  mcp: { allowed: [] },
  scan: { failOn: 'HIGH' },
  apps: [],
};
const APPS = [
  { name: 'backend', path: 'backend', kind: 'backend', stack: 'spring', sdks: ['stripe', 'twilio', 'aws'], secretManagers: ['azure-key-vault'], port: 8080, hasDockerfile: true, dependsOn: ['db'] },
  { name: 'frontend', path: 'frontend', kind: 'frontend', stack: 'angular', sdks: ['google-maps', 'sentry'], secretManagers: [], port: 4200, hasDockerfile: false },
];

test('compose.ai.yml no expone ningún puerto fuera de 127.0.0.1', () => {
  const ports = publishedPorts(POLICY, APPS);
  assert.ok(ports.length > 0, 'no se publicó ningún puerto');
  for (const p of ports) {
    assert.match(p, /^127\.0\.0\.1:\d+:\d+$/, `puerto expuesto fuera del loopback: ${p}`);
  }
  // Y lo mismo en el YAML renderizado: cada entrada bajo `ports:` empieza por 127.0.0.1.
  // (`0.0.0.0` sí puede aparecer en el `command` de un mock: ese es el bind DENTRO del contenedor.)
  const yaml = renderComposeAi(POLICY, APPS);
  let enPorts = false;
  for (const line of yaml.split('\n')) {
    if (/^\s+ports:\s*$/.test(line)) { enPorts = true; continue; }
    if (enPorts && !/^\s+- /.test(line)) { enPorts = false; continue; }
    if (!enPorts) continue;
    assert.match(line.trim(), /^- ["']?127\.0\.0\.1:/, `puerto sin loopback: ${line}`);
  }
});

test('compose.ai.yml incluye la BD y declara la red interna', () => {
  const obj = composeAiObject(POLICY, APPS);
  assert.deepEqual(obj.include, ['mocks/db/compose.db.yml']);
  assert.equal(obj.networks['ai-internal'].internal, true);
  assert.equal(obj.networks['ai-internal'].name, networkName(POLICY));
  assert.equal(networkName(POLICY), 'tienda-ai-internal');
  for (const [name, svc] of Object.entries(obj.services)) {
    assert.deepEqual(svc.networks, ['ai-internal'], `${name} fuera de la red interna`);
  }
});

test('las apps con Dockerfile van en el perfil `apps` (no se levantan por defecto)', () => {
  const obj = composeAiObject(POLICY, APPS);
  assert.deepEqual(obj.services.backend.profiles, ['apps']);
  assert.equal(obj.services.frontend, undefined, 'sin Dockerfile no hay servicio');
  assert.deepEqual(obj.services.backend.env_file, ['./backend/.env.ai']);
  assert.equal(obj.services.backend.environment.AI_ENV, '1');
});

test('los mocks se eligen por los SDK detectados', () => {
  const need = mocksNeeded(POLICY, APPS);
  assert.equal(need.idp, true, 'el IdP siempre está: .env.ai declara un emisor');
  assert.equal(need.stripe, true, 'hay SDK de Stripe');
  assert.equal(need.prism, true, 'Twilio se mockea con Prism');
  assert.equal(need.s3, true, 'hay SDK de AWS');
  assert.equal(need.redis, false, 'ninguna app depende de redis');

  const sinSdks = mocksNeeded(POLICY, [{ name: 'web', kind: 'frontend', stack: 'angular', sdks: [] }]);
  assert.equal(sinSdks.stripe, false);
  assert.equal(sinSdks.s3, false);
  assert.ok(mockServices(POLICY, APPS).includes('stripe-mock'));
});

test('las imágenes de los mocks llevan tag fijo (nunca latest)', () => {
  for (const [name, image] of Object.entries(MOCK_IMAGES)) {
    assert.ok(image.includes(':'), `${name} sin tag`);
    assert.ok(!image.endsWith(':latest'), `${name} usa latest: ${image}`);
  }
});

test('la configuración del IdP solo tiene datos sintéticos', () => {
  const artifacts = generateMocks('/tmp/x', POLICY, APPS);
  const idp = artifacts.find((a) => a.path.endsWith(join('idp', 'config.json')));
  const cfg = JSON.parse(idp.content);
  const claims = cfg.tokenCallbacks[0].requestMappings[0].claims;
  assert.equal(claims.email, 'noreply@ai.local');
  assert.equal(claims['bot-secure'], 'synthetic');
  assert.match(claims.sub, /^ai-tienda-/);
  // Los mappings de WireMock también deben ser JSON válido.
  const wm = artifacts.find((a) => a.path.includes('wiremock'));
  JSON.parse(wm.content);
});

test('las llaves descartables se generan con node:crypto y van marcadas', () => {
  const root = mkdtempSync(join(tmpdir(), 'bs-keys-'));
  try {
    const res = generateKeys(root);
    assert.ok(res.files.length >= 5, res.files.join(', '));
    for (const rel of res.files.filter((f) => /\.(key|pub)\.pem$/.test(f))) {
      const text = readFileSync(join(root, rel), 'utf8');
      assert.ok(text.startsWith(THROWAWAY_HEADER), `${rel} sin la marca de descartable`);
      assert.match(text, /-----BEGIN (PUBLIC|PRIVATE) KEY-----/);
    }
    for (const rel of res.files.filter((f) => f.endsWith('.crt.pem'))) {
      assert.ok(readFileSync(join(root, rel), 'utf8').startsWith(THROWAWAY_HEADER), `${rel} sin la marca`);
    }
    assert.ok(existsSync(join(root, '.bot-secure', 'ai-keys', 'ai-rsa.key.pem')));
    assert.ok(existsSync(join(root, '.bot-secure', 'ai-keys', 'ai-ec.key.pem')));
    assert.equal(keysStatus(root).exists, true);

    // Simulación: no escribe nada.
    const vacio = mkdtempSync(join(tmpdir(), 'bs-keys2-'));
    const dry = generateKeys(vacio, { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.ok(!existsSync(join(vacio, '.bot-secure', 'ai-keys')));
    rmSync(vacio, { recursive: true, force: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('los workflows de CI dejan el gate en los PR a las ramas protegidas', () => {
  const files = generateCi(POLICY);
  assert.deepEqual(files.map((f) => f.path), [
    '.github/workflows/bot-secure.yml',
    '.github/workflows/ai-sync.yml',
    '.github/workflows/ai-return.yml',
  ]);
  const gate = files[0].content;
  assert.match(gate, /^ {6}- dev$/m);
  assert.match(gate, /^ {6}- qa$/m);
  assert.ok(!/release\/\*/.test(gate), 'los patrones con comodín no van en el gate');
  assert.match(gate, /bot-secure scan --ci --fail-on HIGH/);
  // placeholder-leak: solo en dev/qa/prd, nunca en la rama de IA.
  assert.match(gate, /placeholder-leak/);
  assert.match(gate, /github\.base_ref != 'ai-dev'/);

  const sync = files[1].content;
  assert.match(sync, /BOT_SECURE_CI: "1"/);
  assert.match(sync, /bot-secure sync --from dev --to ai-dev/);
});

test('el modo warn del CI no tumba el PR', () => {
  const gate = generateCi('/tmp', POLICY, { provider: 'github', mode: 'warn' })[0].content;
  assert.match(gate, /continue-on-error: true/);
  assert.ok(!/continue-on-error/.test(generateCi(POLICY)[0].content));
});

test('managed-settings.json es JSON válido y cierra los canales de retención', () => {
  const artifacts = generateOrgPack(POLICY);
  const ms = artifacts.find((a) => a.path.endsWith('managed-settings.json'));
  const json = JSON.parse(ms.content);
  assert.equal(json.disableBypassPermissionsMode, 'disable');
  assert.equal(json.allowManagedHooksOnly, true);
  assert.equal(json.allowManagedPermissionRulesOnly, true, 'perfil sensitive');
  assert.equal(json.sandbox.failIfUnavailable, true, 'perfil sensitive: sin sandbox no se trabaja');
  assert.equal(json.autoMemoryEnabled, false);
  for (const v of ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_TELEMETRY', 'DISABLE_FEEDBACK_COMMAND', 'CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY']) {
    assert.equal(json.env[v], '1', `falta ${v}`);
  }
  assert.ok(json.sandbox.network.allowedDomains.includes('api.anthropic.com'));

  // Perfil standard: el sandbox avisa pero no bloquea.
  const relajado = JSON.parse(generateOrgPack({ ...POLICY, profile: 'standard' })
    .find((a) => a.path.endsWith('managed-settings.json')).content);
  assert.equal(relajado.sandbox.failIfUnavailable, false);
});

test('rulesets.json es JSON válido y apply.sh es ejecutable', () => {
  const artifacts = generateOrgPack('/tmp', POLICY);
  const rules = JSON.parse(artifacts.find((a) => a.path.endsWith('rulesets.json')).content);
  assert.ok(Array.isArray(rules) && rules.length >= 2);
  const productivas = rules[0];
  assert.ok(productivas.conditions.ref_name.include.includes('refs/heads/dev'));
  assert.ok(productivas.rules.some((r) => r.type === 'required_status_checks'
    && r.parameters.required_status_checks.some((c) => c.context === 'bot-secure')));
  assert.ok(productivas.rules.some((r) => r.type === 'non_fast_forward'), 'sin force push');

  const apply = artifacts.find((a) => a.path.endsWith('apply.sh'));
  assert.equal(apply.mode, '0755');
  assert.match(apply.content, /^#!\/bin\/sh/);
  assert.ok(!apply.content.includes('bash'), 'debe ser sh POSIX, no bash');
});

test('el devcontainer de nivel 2 no monta docker.sock ni permite github.com', () => {
  const artifacts = generateDevcontainer(POLICY);
  const dc = JSON.parse(artifacts.find((a) => a.path.endsWith('devcontainer.json')).content);
  assert.ok(dc.runArgs.includes('--cap-drop=ALL'));
  assert.ok(dc.runArgs.includes('--cap-add=NET_ADMIN'));
  assert.ok(dc.runArgs.includes('no-new-privileges:true'));
  assert.ok(dc.runArgs.includes('127.0.0.11'), 'DNS interno de Docker');
  assert.equal(JSON.stringify(dc).includes('docker.sock'), false, 'nunca se monta el socket de Docker');
  assert.ok(dc.mounts.some((m) => m.includes('.claude')), '~/.claude por proyecto');

  const dockerfile = artifacts.find((a) => a.path.endsWith('Dockerfile')).content;
  assert.match(dockerfile, /ENV CLAUDE_CODE_VERSION=\d+\.\d+\.\d+/, 'la versión va fijada');
  assert.ok(!/@sha256:[0-9a-f]{64}/.test(dockerfile) || /FROM .*@sha256:/.test(dockerfile));

  const fw = artifacts.find((a) => a.path.endsWith('init-firewall.sh'));
  assert.equal(fw.mode, '0755');
  assert.match(fw.content, /iptables -P OUTPUT DROP/);
  assert.ok(!fw.content.includes('github.com'), 'github.com no está en la allowlist');
  assert.ok(fw.content.includes('api.anthropic.com'));
});

test('los adaptadores de SDK crean archivos NUEVOS y apagan la salida real', () => {
  const back = adaptersFor(APPS[0], { project: 'tienda' });
  const porSdk = Object.fromEntries(back.map((a) => [a.sdk, a]));
  assert.match(porSdk.stripe.snippet, /localhost:12111/, 'Stripe va a stripe-mock');
  assert.match(porSdk.twilio.snippet, /localhost:4010/, 'Twilio va a Prism');
  assert.match(porSdk.aws.snippet, /localhost:4566/, 'AWS va a LocalStack');
  assert.match(porSdk['azure-key-vault'].snippet, /AI_ENV/, 'el gestor de secretos se omite con AI_ENV');
  for (const a of back) {
    assert.ok(a.file.startsWith('backend/'), a.file);
    assert.ok(!/api\.stripe\.com|api\.twilio\.com/.test(a.snippet.replace(/replace\(/g, '')) || a.sdk === 'twilio');
  }

  const front = adaptersFor(APPS[1], { project: 'tienda' });
  const mapa = front.find((a) => a.sdk === 'google-maps');
  assert.match(mapa.snippet, /leaflet/i, 'Maps se sustituye por Leaflet');
  const sentry = front.find((a) => a.sdk === 'sentry');
  assert.match(sentry.snippet, /enabled: process\.env\.AI_ENV !== '1'/, 'Sentry apagado en el ambiente de IA');
  const recaptcha = front.find((a) => a.sdk === 'recaptcha');
  assert.match(recaptcha.snippet, /6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI/, 'llave de prueba oficial de Google');
});
