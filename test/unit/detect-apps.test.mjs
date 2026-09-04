// detectApps: monorepo declarado, raíz-como-app, subcarpetas y re-detección desde policy.apps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectApps, describeApp, monorepoMembers } from '../../src/detect/index.mjs';

const PROJECTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'projects');
const dir = (n) => join(PROJECTS, n);

test('monorepo: dos apps con su ruta, kind y stack', () => {
  const apps = detectApps(dir('monorepo'));
  assert.equal(apps.length, 2, JSON.stringify(apps.map((a) => a.path)));
  const api = apps.find((a) => a.name === 'api');
  const web = apps.find((a) => a.name === 'web');
  assert.equal(api.path, 'apps/api');
  assert.equal(api.kind, 'backend');
  assert.equal(api.stack, 'node');
  assert.equal(api.envStrategy, 'dotenv');
  assert.equal(web.path, 'apps/web');
  assert.equal(web.kind, 'frontend');
  assert.equal(web.stack, 'vue');
  assert.equal(web.envStrategy, 'dotenv-native');
});

test('monorepoMembers lee los workspaces declarados en package.json', () => {
  assert.deepEqual(monorepoMembers(dir('monorepo')), ['apps/api', 'apps/web']);
  assert.deepEqual(monorepoMembers(dir('spring')), []);
});

test('si la raíz es la app hay una sola app con path "."', () => {
  const apps = detectApps(dir('spring'));
  assert.equal(apps.length, 1);
  assert.equal(apps[0].path, '.');
  assert.equal(apps[0].stack, 'spring');
  assert.equal(apps[0].kind, 'backend');
});

test('carpeta sin manifiesto en la raíz: se buscan subcarpetas con manifiesto', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'bs-apps-'));
  try {
    mkdirSync(join(raiz, 'backend'), { recursive: true });
    mkdirSync(join(raiz, 'frontend'), { recursive: true });
    writeFileSync(join(raiz, 'backend', 'go.mod'), 'module ejemplo/api\n\ngo 1.22\n');
    writeFileSync(join(raiz, 'backend', 'main.go'), 'package main\n\nfunc main() {}\n');
    writeFileSync(join(raiz, 'frontend', 'package.json'), JSON.stringify({ name: 'front', dependencies: { next: '^14.0.0' } }));
    const apps = detectApps(raiz).sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(apps.map((a) => [a.name, a.path, a.kind, a.stack]), [
      ['backend', 'backend', 'backend', 'go'],
      ['frontend', 'frontend', 'frontend', 'next'],
    ]);
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('con policy.apps se conservan name/kind/remote/branch y se re-detecta el resto', () => {
  const apps = detectApps(dir('monorepo'), {
    apps: [{ name: 'servicio', path: 'apps/api', kind: 'backend', remote: 'git@servidor:equipo/api.git', branch: 'ai-dev', dependsOn: ['db'] }],
  });
  assert.equal(apps.length, 1);
  assert.equal(apps[0].name, 'servicio');
  assert.equal(apps[0].remote, 'git@servidor:equipo/api.git');
  assert.equal(apps[0].branch, 'ai-dev');
  assert.deepEqual(apps[0].dependsOn, ['db']);
  assert.equal(apps[0].stack, 'node', 'el stack se vuelve a detectar');
});

test('describeApp devuelve el contrato completo de App', () => {
  const app = describeApp(dir('node-express'), { name: 'backend', path: 'backend', kind: 'backend' });
  for (const k of ['name', 'path', 'kind', 'stack', 'envStrategy', 'packageManager', 'manifests', 'registries', 'sdks', 'secretManagers', 'hasDockerfile']) {
    assert.ok(k in app, `falta ${k}`);
  }
  assert.deepEqual(app.manifests, ['package.json']);
  assert.equal(app.hasDockerfile, false);
  assert.equal(app.orm, 'knex');
});
