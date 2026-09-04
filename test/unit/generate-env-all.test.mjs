// `generateEnvAll` es lo que ejecuta `bot-secure init`. Si algo aquí escribe un valor real,
// se filtra en un archivo VERSIONADO: por eso el escáner corre sobre todo lo generado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateEnvAll, verifyGeneratedEnv } from '../../src/generate/env-index.mjs';
import { generateAll } from '../../src/generate/index.mjs';
import { scanPaths } from '../../src/engine/index.mjs';

const HMAC = 'k'.repeat(64);

const POLICY = {
  version: 1,
  project: 'tienda',
  profile: 'sensitive',
  level: 2,
  lang: 'es',
  guard: { mode: 'block' },
  branches: { ai: 'ai-dev', taskPrefix: 'ai/', protected: ['dev', 'qa', 'prd'] },
  db: { engine: 'postgres', port: 5433, database: 'app_ai', user: 'app' },
  owners: { infosec: '@org/infosec', repoOwner: '@org/equipo', platform: '@org/plataforma' },
  network: { allowedDomains: [], registries: [], prodHosts: [] },
  mcp: { allowed: [] },
  scan: { failOn: 'HIGH', exclude: [] },
  apps: [
    { name: 'backend', path: 'backend', kind: 'backend', stack: 'spring', envStrategy: 'spring-profile', packageManager: 'maven', port: 8080, sdks: ['stripe'], secretManagers: [], dependsOn: ['db'], hasDockerfile: false },
    { name: 'frontend', path: 'frontend', kind: 'frontend', stack: 'angular', envStrategy: 'angular-environments', packageManager: 'npm', port: 4200, sdks: [], secretManagers: [], hasDockerfile: false },
  ],
};

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'bs-envall-'));
  mkdirSync(join(root, 'backend'), { recursive: true });
  mkdirSync(join(root, 'frontend'), { recursive: true });
  writeFileSync(join(root, 'backend', '.env.example'), 'STRIPE_SECRET_KEY=\nSMTP_HOST=\n');
  writeFileSync(join(root, 'frontend', 'angular.json'), JSON.stringify({ projects: { frontend: { architect: {} } } }, null, 2));
  writeFileSync(join(root, 'frontend', 'package.json'), JSON.stringify({ name: 'frontend', scripts: { start: 'ng serve' } }, null, 2));
  return root;
}

/** Escribe los artefactos en disco (como haría `init`) para poder escanearlos. */
function write(root, artifacts) {
  for (const a of artifacts) {
    const p = join(root, a.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, a.content);
  }
}

test('generateEnvAll produce el ambiente de IA completo', async () => {
  const root = workspace();
  try {
    const artifacts = await generateEnvAll(root, POLICY, POLICY.apps);
    const paths = artifacts.map((a) => a.path.split('\\').join('/'));

    for (const esperado of [
      '.env.ai', '.env.example',
      'backend/.env.ai', 'backend/src/main/resources/application-ai.yml', 'backend/src/main/java/aienv/AiEnv.java',
      'frontend/src/environments/environment.ai.ts', 'frontend/src/app/ai-env.ts', 'frontend/angular.json',
      'mocks/idp/config.json', 'mocks/README.md',
      'compose.ai.yml',
      '.github/workflows/bot-secure.yml', '.github/workflows/ai-sync.yml', '.github/workflows/ai-return.yml',
      'infosec/managed-settings.json', 'infosec/rulesets.json', 'infosec/apply.sh',
      '.devcontainer/devcontainer.json',
      '.bot-secure/fakes.json', 'docs/AI-ENV.md', 'docs/ADAPTERS.md',
    ]) {
      assert.ok(paths.includes(esperado), `falta ${esperado}\n${paths.join('\n')}`);
    }

    // Ninguna ruta duplicada: `init` escribiría dos veces el mismo archivo.
    assert.equal(new Set(paths).size, paths.length, 'hay rutas duplicadas');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('el devcontainer solo aparece en nivel ≥ 2', async () => {
  const root = workspace();
  try {
    const nivel1 = await generateEnvAll(root, { ...POLICY, level: 1 }, POLICY.apps);
    assert.ok(!nivel1.some((a) => a.path.includes('.devcontainer')), 'nivel 1 no lleva devcontainer');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('el escáner no reporta NADA en lo que genera el ambiente de IA', async () => {
  const root = workspace();
  try {
    write(root, await generateEnvAll(root, POLICY, POLICY.apps));
    const report = await scanPaths({ root, mode: 'scan', hmacKey: HMAC });
    assert.deepEqual(
      report.findings.map((f) => `${f.ruleId} ${f.file}:${f.line} (${f.severity})`),
      [],
      'lo generado por bot-secure no puede tener hallazgos',
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('verifyGeneratedEnv confirma que ningún .env.ai lleva un valor ajeno', async () => {
  const root = workspace();
  try {
    const artifacts = await generateEnvAll(root, POLICY, POLICY.apps);
    assert.deepEqual(verifyGeneratedEnv(artifacts), []);

    // Y detecta el caso contrario (valor con forma de token real en un .env.ai).
    const sucio = [{ path: 'backend/.env.ai', content: 'API_TOKEN=abcdefghijklmnopqrstuvwxyz012345\n' }];
    assert.deepEqual(verifyGeneratedEnv(sucio), [{ path: 'backend/.env.ai', name: 'API_TOKEN' }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('generateAll (contexto MD + entorno) no avisa de módulo ausente', async () => {
  const root = workspace();
  try {
    const artifacts = await generateAll(root, POLICY, POLICY.apps);
    assert.deepEqual(artifacts.warnings, [], 'generate-env debe cargar sin errores');
    const paths = artifacts.map((a) => a.path.split('\\').join('/'));
    assert.ok(paths.includes('AGENTS.md'), 'el contexto MD sigue estando');
    assert.ok(paths.includes('.env.ai'), 'y el ambiente de IA también');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('docs/AI-ENV.md documenta cada app con su comando de arranque', async () => {
  const root = workspace();
  try {
    const artifacts = await generateEnvAll(root, POLICY, POLICY.apps);
    const doc = artifacts.find((a) => a.path.split('\\').join('/') === 'docs/AI-ENV.md').content;
    assert.match(doc, /SPRING_PROFILES_ACTIVE=dev,ai/);
    assert.match(doc, /npm run start:ai/);
    assert.match(doc, /Regla del campo vacío/);
    assert.ok(!doc.includes('undefined'), doc.slice(0, 400));
    assert.ok(!doc.includes('{{'), 'plantilla sin renderizar');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('un stack desconocido queda documentado como pendiente, no inventado', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bs-manual-'));
  try {
    const policy = { ...POLICY, level: 1, apps: [{ name: 'legacy', path: 'legacy', kind: 'backend', stack: 'unknown', envStrategy: 'manual', sdks: [], secretManagers: [] }] };
    const artifacts = await generateEnvAll(root, policy, policy.apps);
    const todo = artifacts.find((a) => a.path.endsWith('SANITIZE-TODO.md'));
    assert.ok(todo, 'debe quedar el pendiente por escrito');
    assert.match(todo.content, /estrategia de entorno: `manual`/);
    assert.match(todo.content, /TODO/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
