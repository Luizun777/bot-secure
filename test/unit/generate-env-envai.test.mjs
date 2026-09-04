// .env.ai: el valor de cada variable se deduce del SUFIJO de su nombre y la BD apunta SIEMPRE
// a la del workspace. Si esto se rompe, el desarrollador arranca contra algo que no es el mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEnvAi, buildEnvExample, buildDbUrl, envAiLooksSafe, parseEnv, readExampleVars, resolveVars, toJdbc, valueLooksSafe } from '../../src/generate/env-ai.mjs';
import { isFake } from '../../src/generate/fakes.mjs';

const POLICY = {
  version: 1,
  project: 'tienda',
  db: { engine: 'postgres', port: 5433, database: 'app_ai', user: 'app' },
  apps: [
    { name: 'backend', path: 'backend', kind: 'backend', stack: 'spring', envStrategy: 'spring-profile', port: 8080 },
    { name: 'frontend', path: 'frontend', kind: 'frontend', stack: 'angular', envStrategy: 'angular-environments', port: 4200 },
  ],
};

/** Workspace temporal con .env.example en cada app. */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'bs-envai-'));
  mkdirSync(join(root, 'backend'), { recursive: true });
  mkdirSync(join(root, 'frontend'), { recursive: true });
  writeFileSync(join(root, 'backend', '.env.example'), [
    'PAYMENTS_API_URL=',
    'REDIS_HOST=',
    'AWS_STORAGE_BUCKET_NAME=',
    'SOPORTE_EMAIL=',
    'AZURE_TENANT_ID=',
    'CLIENT_ID=',
    'SESSION_PASSWORD=',
    'STRIPE_SECRET_KEY=',
    'PORT=8080',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'frontend', '.env.example'), 'NG_APP_TITLE=\nSENTRY_DSN=\n');
  return root;
}

const valueOf = (text, name) => parseEnv(text).find((v) => v.name === name)?.value;

test('el .env.ai de la app spring toma el fake correcto por el sufijo del nombre', async () => {
  const root = workspace();
  try {
    const app = POLICY.apps[0];
    const text = await buildEnvAi(app, POLICY, { root, apps: POLICY.apps });

    assert.equal(valueOf(text, 'AI_ENV'), '1');
    assert.equal(valueOf(text, 'PAYMENTS_API_URL'), 'http://localhost:8080');
    assert.equal(valueOf(text, 'REDIS_HOST'), 'localhost', 'el sufijo _HOST da un host local');
    assert.equal(valueOf(text, 'AWS_STORAGE_BUCKET_NAME'), 'ai-tienda-aws-storage');
    assert.equal(valueOf(text, 'SOPORTE_EMAIL'), 'noreply@ai.local');
    assert.equal(valueOf(text, 'AZURE_TENANT_ID'), '00000000-0000-4000-8000-000000000000');
    assert.equal(valueOf(text, 'CLIENT_ID'), 'ai-tienda-client-id');
    assert.equal(valueOf(text, 'SESSION_PASSWORD'), '__AI_PLACEHOLDER__SESSION_PASSWORD__');
    assert.match(valueOf(text, 'STRIPE_SECRET_KEY'), /^sk_test_AIPLACEHOLDER/);
    assert.equal(valueOf(text, 'PORT'), '8080', 'PORT no es sensible: se conserva');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('el .env.ai de la app spring apunta a la BD del workspace (URL y JDBC)', async () => {
  const root = workspace();
  try {
    const text = await buildEnvAi(POLICY.apps[0], POLICY, { root, apps: POLICY.apps });
    const url = valueOf(text, 'DATABASE_URL');
    assert.match(url, /^postgres(ql)?:\/\/app:__AI_PLACEHOLDER__DB_PASSWORD__@127\.0\.0\.1:5433\/app_ai$/, url);
    assert.equal(valueOf(text, 'DB_PORT'), '5433');
    assert.equal(valueOf(text, 'DB_NAME'), 'app_ai');
    assert.equal(valueOf(text, 'DB_PASSWORD'), '__AI_PLACEHOLDER__DB_PASSWORD__');
    assert.equal(valueOf(text, 'JDBC_DATABASE_URL'), toJdbc(url));
    assert.equal(valueOf(text, 'OIDC_ISSUER'), 'http://localhost:8081/default');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('el .env.ai de la app angular apunta al backend del workspace y NO trae la BD', async () => {
  const root = workspace();
  try {
    const text = await buildEnvAi(POLICY.apps[1], POLICY, { root, apps: POLICY.apps });
    assert.equal(valueOf(text, 'API_URL'), 'http://localhost:8080');
    assert.equal(valueOf(text, 'DATABASE_URL'), undefined, 'el front no debe conocer la BD');
    assert.equal(valueOf(text, 'DB_PASSWORD'), undefined);
    assert.equal(valueOf(text, 'NG_APP_TITLE'), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('todo valor del .env.ai generado es falso, placeholder o local', async () => {
  const root = workspace();
  try {
    for (const app of [null, ...POLICY.apps]) {
      const text = await buildEnvAi(app ?? root, POLICY, { root, apps: POLICY.apps });
      assert.ok(envAiLooksSafe(text), `hay un valor que no es del ambiente de IA en ${app?.name ?? 'raíz'}:\n${text}`);
      for (const v of parseEnv(text)) {
        assert.ok(valueLooksSafe(v.name, v.value), `${v.name}=${v.value} no es un valor del ambiente de IA`);
      }
      // Ningún valor puede tener forma de secreto real fuera del catálogo de fakes.
      for (const v of parseEnv(text)) {
        if (!v.value || isFake(v.value)) continue;
        assert.ok(!/^[A-Za-z0-9+/_-]{32,}$/.test(v.value), `${v.name} tiene forma de token`);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('.env.example lleva los nombres SIN valores', () => {
  const vars = resolveVars(POLICY.apps[0], POLICY, { apps: POLICY.apps });
  const text = buildEnvExample(vars);
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    assert.match(line, /^[A-Za-z_][A-Za-z0-9_]*=$/, `"${line}" no debería llevar valor`);
  }
});

test('readExampleVars encuentra el .env.example de la app', () => {
  const root = workspace();
  try {
    const names = readExampleVars(root, POLICY.apps[0]).map((v) => v.name);
    assert.ok(names.includes('STRIPE_SECRET_KEY'), names.join(', '));
    assert.equal(readExampleVars(root, { path: 'no-existe' }).length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('buildDbUrl usa el placeholder como contraseña en todos los motores', () => {
  for (const engine of ['postgres', 'mysql', 'mongo', 'mssql', 'oracle']) {
    const url = buildDbUrl({ engine, port: 1234, database: 'app_ai', user: 'app' });
    assert.match(url, /__AI_PLACEHOLDER__DB_PASSWORD__/, `${engine}: ${url}`);
    assert.match(url, /127\.0\.0\.1:1234/, `${engine}: ${url}`);
  }
});

test('parseEnv descarta el comentario final de una línea sin comillas', () => {
  const vars = parseEnv('A=valor   # bot-secure:fake url\nB="con espacio"\n# comentario\nC=\n');
  assert.deepEqual(vars, [{ name: 'A', value: 'valor' }, { name: 'B', value: 'con espacio' }, { name: 'C', value: '' }]);
});
