// Walker: never-skip, exclusiones por defecto, symlinks, tamaño/streaming, submódulos y LFS.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, isNeverSkip, DEFAULT_EXCLUDES, NEVER_SKIP } from '../../src/engine/walker.mjs';

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'bot-secure-walker-'));
  const w = (rel, text) => { const p = join(dir, ...rel.split('/')); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text); };
  return { dir, w, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test('recorre el árbol y excluye node_modules, .git y lockfiles', () => {
  const r = repo();
  try {
    r.w('src/app.js', 'const a = 1;');
    r.w('node_modules/lib/index.js', 'x');
    r.w('.git/config', '[core]');
    r.w('package-lock.json', '{}');
    r.w('dist/bundle.js', 'x');
    const out = collect({ root: r.dir });
    const rels = out.files.map((f) => f.rel);
    assert.ok(rels.includes('src/app.js'));
    assert.ok(!rels.some((p) => p.startsWith('node_modules/')), 'node_modules no debe recorrerse');
    assert.ok(!rels.includes('package-lock.json'), 'los lockfiles se excluyen');
    assert.ok(!rels.some((p) => p.startsWith('dist/')), 'dist se excluye sin --build');
    assert.ok(out.skipped.some((s) => s.reason === 'excluded' && s.path === 'package-lock.json'));
  } finally { r.clean(); }
});

test('never-skip: .env y certificados se escanean aunque estén excluidos', () => {
  const r = repo();
  try {
    r.w('.env', 'DB_PASSWORD=Secreto12345');
    r.w('certs/server.pem', '-----BEGIN RSA PRIVATE KEY-----');
    r.w('logo.png', 'binario');
    const out = collect({ root: r.dir, exclude: ['**/.env', '**/*.pem'] });
    const rels = out.files.map((f) => f.rel);
    assert.ok(rels.includes('.env'), '.env nunca se salta');
    assert.ok(rels.includes('certs/server.pem'), '*.pem nunca se salta');
    assert.ok(!rels.includes('logo.png'), 'las imágenes se excluyen por defecto');
  } finally { r.clean(); }
});

test('la lista never-skip cubre los archivos del plan', () => {
  for (const rel of ['.env', '.env.production', 'backend/.npmrc', '.netrc', '.git-credentials',
    'infra/kubeconfig', 'infra/main.tfstate', 'compose.yml', 'docker-compose.override.yml',
    'api/appsettings.Production.json', 'api/application.yml', '.mcp.json', '.vscode/launch.json',
    '.idea/workspace.xml', 'Jenkinsfile', '.gitlab-ci.yml', 'android/local.properties',
    'android/key.properties', 'android/app/google-services.json', 'ios/GoogleService-Info.plist',
    'captura.har', 'app.log', 'llaves.kdbx', 'vpn.ovpn', '.pgpass', '.my.cnf', '.s3cfg',
    'certs/ca.pem', 'ssh/id_rsa', 'store.jks', 'auth.p8', 'perfil.mobileprovision']) {
    assert.ok(isNeverSkip(rel), `${rel} debería estar en never-skip`);
  }
  assert.ok(NEVER_SKIP.length > 30);
  assert.ok(DEFAULT_EXCLUDES.includes('**/*.min.js'));
});

test('no sigue symlinks y marca los que apuntan fuera de la raíz', () => {
  const r = repo();
  const outside = mkdtempSync(join(tmpdir(), 'bot-secure-outside-'));
  try {
    writeFileSync(join(outside, 'credentials'), 'aws_secret_access_key = x');
    r.w('src/app.js', 'x');
    symlinkSync(join(outside, 'credentials'), join(r.dir, 'escape'));
    symlinkSync(join(r.dir, 'src'), join(r.dir, 'link-interno'));
    const out = collect({ root: r.dir });
    assert.ok(!out.files.some((f) => f.rel === 'escape'), 'no se sigue el symlink');
    const escape = out.symlinks.find((s) => s.rel === 'escape');
    assert.ok(escape && escape.outside === true, 'el symlink fuera de la raíz se marca');
    const interno = out.symlinks.find((s) => s.rel === 'link-interno');
    assert.ok(interno && interno.outside === false);
    assert.ok(out.skipped.some((s) => s.reason === 'symlink'));
  } finally { r.clean(); rmSync(outside, { recursive: true, force: true }); }
});

test('archivos grandes: los de datos se marcan para streaming y el resto se registra en skipped', () => {
  const r = repo();
  try {
    r.w('datos/export.csv', 'a,b\n' + 'x,y\n'.repeat(300_000));
    r.w('bin/blob.bin2', 'z'.repeat(2 * 1024 * 1024));
    const out = collect({ root: r.dir, maxFileSizeMB: 1 });
    const csv = out.files.find((f) => f.rel === 'datos/export.csv');
    assert.ok(csv?.stream === true, 'los csv grandes se escanean por chunks');
    assert.ok(!out.files.some((f) => f.rel === 'bin/blob.bin2'));
    assert.ok(out.skipped.some((s) => s.path === 'bin/blob.bin2' && s.reason === 'size' && s.size > 0),
      'nada se salta en silencio: el archivo grande queda registrado');
  } finally { r.clean(); }
});

test('detecta submódulos y punteros LFS', () => {
  const r = repo();
  try {
    r.w('sub/.git', 'gitdir: ../.git/modules/sub');
    r.w('sub/README.md', 'no debería escanearse');
    r.w('assets/video.psd2', 'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 123456\n');
    const out = collect({ root: r.dir });
    assert.ok(out.warnings.some((w) => w === 'submodule:sub'));
    assert.ok(!out.files.some((f) => f.rel.startsWith('sub/')));
    assert.ok(out.skipped.some((s) => s.path === 'assets/video.psd2' && s.reason === 'lfs'));
  } finally { r.clean(); }
});

test('include limita el recorrido y paths acota a subcarpetas', () => {
  const r = repo();
  try {
    r.w('a/uno.txt', '1');
    r.w('b/dos.txt', '2');
    const soloA = collect({ root: r.dir, include: ['a/**'] });
    assert.deepEqual(soloA.files.map((f) => f.rel), ['a/uno.txt']);
    const soloB = collect({ root: r.dir, paths: ['b'] });
    assert.deepEqual(soloB.files.map((f) => f.rel), ['b/dos.txt']);
  } finally { r.clean(); }
});
