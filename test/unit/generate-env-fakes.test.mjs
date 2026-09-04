// Los fakes son la frontera: si un valor "falso" se cuela como real (o el escáner lo reporta
// como secreto), el ambiente de IA deja de ser usable. Estas pruebas fijan ambas cosas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FAKE_REGISTRY, GUID_FAKE, SDK_CATALOG, fakeComment, fakeFor, inferKind, isFake, padPlaceholder, sdkForName,
} from '../../src/generate/fakes.mjs';
import { renderEnvAi } from '../../src/generate/env-ai.mjs';
import { scanPaths } from '../../src/engine/index.mjs';

const HMAC = 'k'.repeat(64);

test('fakeFor es determinista: dos llamadas dan el mismo valor', () => {
  for (const kind of ['secret', 'identifier', 'url', 'host', 'email', 'guid', 'bucket', 'region', 'sdk-key']) {
    const a = fakeFor(kind, 'MI_VARIABLE', { project: 'tienda' });
    const b = fakeFor(kind, 'MI_VARIABLE', { project: 'tienda' });
    assert.equal(a, b, `${kind} no es determinista`);
  }
  for (const s of SDK_CATALOG) assert.equal(s.gen('X', 'tienda'), s.gen('X', 'tienda'), `${s.id} no es determinista`);
});

test('los fakes de SDK son válidos POR FORMATO', () => {
  const gen = (id, name = 'X') => SDK_CATALOG.find((s) => s.id === id).gen(name, 'tienda');

  // Twilio: SID = "AC" + 32 hexadecimales; token = 32 hexadecimales.
  assert.match(gen('twilio-sid'), /^AC[0-9a-f]{32}$/);
  assert.match(gen('twilio-token'), /^[0-9a-f]{32}$/);

  // Stripe: prefijo de prueba y al menos 32 alfanuméricos después de `sk_test_`.
  const sk = gen('stripe-secret');
  assert.ok(sk.startsWith('sk_test_'), sk);
  assert.ok(sk.slice('sk_test_'.length).length >= 32, `stripe-secret corto: ${sk.length}`);
  assert.match(gen('stripe-publishable'), /^pk_test_[A-Za-z0-9]{32,}$/);
  assert.match(gen('stripe-webhook'), /^whsec_[A-Za-z0-9]{32,}$/);

  // SendGrid: SG.<22>.<43>
  assert.match(gen('sendgrid'), /^SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);

  // JWT: HS256 exige al menos 32 bytes; el bot usa 64 caracteres.
  assert.ok(gen('jwt-secret', 'JWT_SECRET').length >= 64);

  // Laravel: base64: + 32 bytes (44 caracteres base64).
  const appKey = gen('laravel-app-key');
  assert.ok(appKey.startsWith('base64:'));
  assert.equal(Buffer.from(appKey.slice('base64:'.length), 'base64').length, 32);

  // Clerk y Firebase.
  assert.match(gen('clerk-publishable'), /^pk_test_[A-Za-z0-9_-]+$/);
  assert.equal(SDK_CATALOG.find((s) => s.id === 'firebase-project').gen('X', 'tienda'), 'demo-tienda-ai');

  // reCAPTCHA: las llaves de prueba oficiales de Google.
  assert.equal(gen('recaptcha-site'), '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI');
  assert.equal(gen('recaptcha-secret'), '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe');

  // Mapbox: token público con forma pk.<payload>.<firma>
  assert.match(gen('mapbox'), /^pk\.[A-Za-z0-9_-]+\./);

  // AWS: forma válida (AKIA + 16) pero reconocible como placeholder.
  assert.match(gen('aws-access-key'), /^AKIA[A-Z0-9]{16}$/);
});

test('GUID, email, host y región tienen el valor esperado', () => {
  assert.equal(fakeFor('guid', 'AZURE_TENANT_ID'), GUID_FAKE);
  assert.match(GUID_FAKE, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(fakeFor('email', 'MAIL_FROM'), 'noreply@ai.local');
  assert.equal(fakeFor('host', 'DB_HOST'), 'localhost');
  assert.equal(fakeFor('region', 'AWS_REGION'), 'us-east-1');
});

test('los buckets e identificadores van en minúsculas y sin guiones bajos', () => {
  const bucket = fakeFor('bucket', 'AWS_STORAGE_BUCKET_NAME', { project: 'Tienda_MX' });
  assert.equal(bucket, bucket.toLowerCase());
  assert.ok(!bucket.includes('_'), bucket);
  assert.match(bucket, /^ai-tienda-mx-/);

  const id = fakeFor('identifier', 'CLIENT_ID', { project: 'Tienda MX' });
  assert.equal(id, 'ai-tienda-mx-client-id');
  assert.ok(!/[A-Z_]/.test(id), id);
});

test('el placeholder solo se usa donde vale cualquier cadena', () => {
  assert.equal(fakeFor('secret', 'DB_PASSWORD'), '__AI_PLACEHOLDER__DB_PASSWORD__');
  assert.ok(padPlaceholder('JWT_SECRET', 64).startsWith('__AI_PLACEHOLDER__JWT_SECRET__'));
  assert.equal(fakeFor('url', 'API_URL', { backendPort: 8080 }), 'http://localhost:8080');
});

test('inferKind deduce el tipo por el sufijo del nombre', () => {
  assert.equal(inferKind('PAYMENTS_API_URL'), 'url');
  assert.equal(inferKind('REDIS_HOST'), 'host');
  assert.equal(inferKind('AWS_STORAGE_BUCKET_NAME'), 'bucket');
  assert.equal(inferKind('SUPPORT_EMAIL'), 'email');
  assert.equal(inferKind('AZURE_TENANT_ID'), 'guid');
  assert.equal(inferKind('CLIENT_ID'), 'identifier');
  assert.equal(inferKind('SESSION_PASSWORD'), 'secret');
  assert.equal(inferKind('STRIPE_SECRET_KEY'), 'sdk-key');
  assert.equal(inferKind('DATABASE_URL'), 'db-url');
  assert.equal(inferKind('PORT'), 'plain');
});

test('isFake reconoce todo lo que genera el bot y nada más', () => {
  for (const s of SDK_CATALOG) {
    const v = s.gen(s.id.toUpperCase().replace(/-/g, '_'), 'tienda');
    assert.ok(isFake(v), `isFake no reconoce ${s.id}: ${v}`);
  }
  for (const kind of ['secret', 'identifier', 'url', 'host', 'email', 'guid', 'bucket']) {
    const v = fakeFor(kind, `X_${kind.toUpperCase()}`, { project: 'tienda' });
    assert.ok(isFake(v), `isFake no reconoce ${kind}: ${v}`);
  }
  assert.ok(isFake('postgres://app:__AI_PLACEHOLDER__DB_PASSWORD__@127.0.0.1:5433/app_ai'));

  // Nunca debe dar por falso algo con forma de secreto real.
  assert.equal(isFake('ghp_16CharactersOfSomethingRealLooking123'), false);
  assert.equal(isFake('https://api.tienda.com.mx/v1'), false);
  assert.equal(isFake(''), false);
});

test('sdkForName encuentra el fake del catálogo por el nombre de la variable', () => {
  assert.equal(sdkForName('STRIPE_SECRET_KEY')?.id, 'stripe-secret');
  assert.equal(sdkForName('TWILIO_ACCOUNT_SID')?.id, 'twilio-sid');
  assert.equal(sdkForName('SENDGRID_API_KEY')?.id, 'sendgrid');
  assert.equal(sdkForName('UNA_VARIABLE_CUALQUIERA'), null);
});

test('FAKE_REGISTRY describe cada familia con un ejemplo reconocible', () => {
  assert.ok(FAKE_REGISTRY.length >= SDK_CATALOG.length);
  for (const entry of FAKE_REGISTRY) {
    assert.equal(typeof entry.id, 'string');
    assert.ok(entry.example, `${entry.id} sin ejemplo`);
    assert.ok(isFake(entry.example), `el ejemplo de ${entry.id} no lo reconoce isFake: ${entry.example}`);
  }
});

test('el escáner NO reporta los valores falsos de un .env.ai', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bs-fakes-'));
  try {
    const vars = [];
    for (const s of SDK_CATALOG) {
      const name = `${s.id.toUpperCase().replace(/-/g, '_')}_KEY`;
      vars.push({ name, value: s.gen(name, 'tienda'), kind: 'sdk-key', comment: `# bot-secure:fake ${s.id}`, section: 'app' });
    }
    for (const kind of ['secret', 'identifier', 'url', 'host', 'email', 'guid', 'bucket', 'region', 'db-url']) {
      const name = `X_${kind.toUpperCase().replace('-', '_')}`;
      vars.push({ name, value: fakeFor(kind, name, { project: 'tienda' }), kind, comment: fakeComment(kind, name), section: 'app' });
    }
    writeFileSync(join(dir, '.env.ai'), renderEnvAi(vars));

    const report = await scanPaths({ root: dir, mode: 'scan', hmacKey: HMAC });
    assert.deepEqual(
      report.findings.map((f) => `${f.ruleId}@${f.line}`),
      [],
      'un valor falso del ambiente de IA se reportó como secreto:\n'
        + report.findings.map((f) => `${f.ruleId} ${f.file}:${f.line} ${f.masked}`).join('\n'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('el marcador del fake va en la MISMA línea (el anti-FP mira el texto de la línea)', () => {
  const text = renderEnvAi([{ name: 'STRIPE_SECRET_KEY', value: fakeFor('sdk-key', 'STRIPE_SECRET_KEY'), kind: 'sdk-key', comment: fakeComment('sdk-key', 'STRIPE_SECRET_KEY'), section: 'app' }]);
  const line = text.split('\n').find((l) => l.startsWith('STRIPE_SECRET_KEY='));
  assert.match(line, /# bot-secure:fake stripe-secret$/);
});
