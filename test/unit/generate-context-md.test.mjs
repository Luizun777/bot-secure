// Pruebas del módulo generate-context: artefactos MD que Claude carga (AGENTS, CLAUDE, docs, rules, skills, agentes, HU, ADR, README).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { generateAll, generateContext, lineBudgetIssues, writeArtifacts } from '../../src/generate/index.mjs';
import { CLAUDE_MAX_LINES, APP_CLAUDE_MAX_LINES } from '../../src/generate/claude.mjs';
import { AGENTS_MAX_LINES } from '../../src/generate/agents.mjs';
import { parseFrontmatter } from '../../src/generate/skills.mjs';
import { yamlList } from '../../src/generate/rules.mjs';
import { huFileName } from '../../src/generate/hu.mjs';
import { adrFileName, nextAdrNumber } from '../../src/generate/adr.mjs';
import { lineCount, toPosix, extractSection } from '../../src/generate/md-helpers.mjs';

/** Policy de prueba: tienda con backend spring :8080, frontend angular :4200 y postgres :5433. */
function policyTienda() {
  return {
    version: 1, project: 'tienda', profile: 'sensitive', level: 1, lang: 'es',
    branches: { ai: 'ai-dev', taskPrefix: 'ai/', protected: ['dev', 'qa', 'prd', 'main'] },
    apps: [
      { name: 'backend', path: 'backend', kind: 'backend', stack: 'spring', envStrategy: 'spring-profile', packageManager: 'maven', runCmd: './mvnw spring-boot:run', testCmd: './mvnw -q test', buildCmd: './mvnw -q package', port: 8080, dependsOn: ['db'] },
      { name: 'frontend', path: 'frontend', kind: 'frontend', stack: 'angular', envStrategy: 'angular-env', packageManager: 'npm', runCmd: 'npx ng serve', testCmd: 'npx ng test', port: 4200 },
    ],
    db: { engine: 'postgres', port: 5433, database: 'app_ai', user: 'app' },
    owners: { repoOwner: '@org/tienda', infosec: '@org/infosec' },
    scan: { failOn: 'HIGH' },
  };
}

const byPath = (arts) => new Map(arts.map((a) => [toPosix(a.path), a.content]));
const tmpRoot = () => mkdtempSync(path.join(tmpdir(), 'bot-secure-gen-'));

test('generateAll produce todos los archivos de contexto esperados', async () => {
  const root = tmpRoot();
  try {
    const arts = await generateAll(root, policyTienda());
    const files = byPath(arts);
    const esperados = [
      'AGENTS.md', 'CLAUDE.md', 'README.md',
      'backend/CLAUDE.md', 'frontend/CLAUDE.md',
      '.github/PULL_REQUEST_TEMPLATE.md', '.github/CODEOWNERS',
      '.claude/rules/seguridad-datos.md', '.claude/rules/git-ramas.md', '.claude/rules/backend.md',
      '.claude/rules/frontend.md', '.claude/rules/tests.md', '.claude/rules/docs.md',
      '.claude/skills/hu/SKILL.md', '.claude/skills/adr/SKILL.md', '.claude/skills/bootstrap-contexto/SKILL.md',
      '.claude/skills/sync-docs/SKILL.md', '.claude/skills/revision-seguridad/SKILL.md',
      '.claude/agents/explorador.md', '.claude/agents/revisor-seguridad.md', '.claude/agents/docs-sync.md',
      'docs/INDEX.md', 'docs/ARCHITECTURE.md', 'docs/CONVENTIONS.md', 'docs/TESTING.md',
      'docs/RUNBOOK.md', 'docs/SECURITY.md', 'docs/GLOSSARY.md', 'docs/LESSONS.md',
      'docs/decisions/0000-plantilla-adr.md', 'docs/decisions/0001-rama-ai-dev-y-placeholders.md',
      'docs/decisions/0002-guarda-de-rama-bloquear-e-instruir.md', 'docs/decisions/0003-workspace-de-ia.md',
      'docs/user-stories/INDEX.md', 'docs/user-stories/_PLANTILLA-HU.md', 'docs/user-stories/HU-0001-ejemplo.md',
    ];
    for (const f of esperados) assert.ok(files.has(f), `falta el artefacto ${f}`);
    // No hay regla mobile porque no hay apps móviles.
    assert.ok(!files.has('.claude/rules/mobile.md'), 'no debe generarse mobile.md sin apps móviles');
    // generate-env no está en este lote: se avisa, no se rompe.
    assert.ok(Array.isArray(arts.warnings));
    assert.equal(lineBudgetIssues(arts).length, 0, 'ningún archivo debe exceder su presupuesto de líneas');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLAUDE.md raíz: ≤ 60 líneas, @AGENTS.md, ai-dev y la regla del campo vacío', async () => {
  const root = tmpRoot();
  try {
    const files = byPath(await generateContext(root, policyTienda()));
    const md = files.get('CLAUDE.md');
    assert.ok(lineCount(md) <= CLAUDE_MAX_LINES, `CLAUDE.md tiene ${lineCount(md)} líneas`);
    assert.ok(md.startsWith('@AGENTS.md'), 'CLAUDE.md debe empezar con @AGENTS.md');
    assert.match(md, /ai-dev/);
    assert.match(md, /campo vacío/);
    assert.match(md, /## Lecciones aprendidas/);
    assert.match(md, /## Al compactar/);
    assert.match(md, /⛔/);
    // La sección de lecciones empieza vacía (solo el comentario con la regla de la 2ª vez).
    assert.equal(extractSection(md, 'Lecciones aprendidas'), '');
    // IMPORTANT solo en rama y secretos: exactamente 2.
    assert.equal((md.match(/IMPORTANT:/g) || []).length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AGENTS.md: ≤ 80 líneas, ambas apps con sus puertos y el flujo de ramas', async () => {
  const root = tmpRoot();
  try {
    const md = byPath(await generateContext(root, policyTienda())).get('AGENTS.md');
    assert.ok(lineCount(md) <= AGENTS_MAX_LINES, `AGENTS.md tiene ${lineCount(md)} líneas`);
    for (const s of ['backend', 'frontend', '8080', '4200', 'spring', 'angular', '5433', 'postgres']) {
      assert.ok(md.includes(s), `AGENTS.md debe mencionar ${s}`);
    }
    assert.match(md, /ai\/<ticket>-<slug>` → `ai-dev` → `dev` → `qa` → `prd`/);
    assert.match(md, /campo vacío/i);
    assert.match(md, /\.env\.ai/);
    assert.match(md, /docs\/INDEX\.md/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cada app tiene su CLAUDE.md ≤ 25 líneas con su ruta y sus comandos', async () => {
  const root = tmpRoot();
  try {
    const files = byPath(await generateContext(root, policyTienda()));
    const back = files.get('backend/CLAUDE.md');
    assert.ok(lineCount(back) <= APP_CLAUDE_MAX_LINES, `backend/CLAUDE.md tiene ${lineCount(back)} líneas`);
    assert.match(back, /\.\/backend/);
    assert.match(back, /backend de \*\*tienda\*\*/);
    assert.match(back, /127\.0\.0\.1:5433/);
    assert.match(back, /AI_ENV=1 \.\/mvnw spring-boot:run/);
    assert.match(back, /\.\.\/docs\/INDEX\.md/);
    const front = files.get('frontend/CLAUDE.md');
    assert.ok(lineCount(front) <= APP_CLAUDE_MAX_LINES, `frontend/CLAUDE.md tiene ${lineCount(front)} líneas`);
    assert.match(front, /\.\/frontend/);
    assert.match(front, /http:\/\/localhost:8080/, 'el frontend debe saber a qué backend consume');
    assert.ok(!front.includes('5433'), 'el frontend no habla con la BD');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reglas: backend.md lleva paths: [\'backend/**\'] y las globales no llevan paths', async () => {
  const root = tmpRoot();
  try {
    const files = byPath(await generateContext(root, policyTienda()));
    const back = parseFrontmatter(files.get('.claude/rules/backend.md'));
    assert.equal(back.paths, "['backend/**']");
    const front = parseFrontmatter(files.get('.claude/rules/frontend.md'));
    assert.equal(front.paths, "['frontend/**']");
    const docs = parseFrontmatter(files.get('.claude/rules/docs.md'));
    assert.equal(docs.paths, "['docs/**', '*.md']");
    assert.match(files.get('.claude/rules/tests.md'), /^paths: \['backend\/src\/test\/\*\*', /m);
    for (const g of ['seguridad-datos', 'git-ramas']) {
      const fm = parseFrontmatter(files.get(`.claude/rules/${g}.md`));
      assert.ok(fm, `${g}.md debe tener frontmatter`);
      assert.equal(fm.paths, undefined, `${g}.md no debe llevar paths`);
      assert.ok(fm.description.length > 10);
    }
    // La regla de seguridad cubre lo obligatorio.
    const seg = files.get('.claude/rules/seguridad-datos.md');
    for (const s of ['RFC', 'CURP', 'CLABE', 'NSS', 'tarjeta', 'campo vacío', '.env']) {
      assert.ok(seg.includes(s), `seguridad-datos.md debe mencionar ${s}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('skills y subagentes: frontmatter válido y disable-model-invocation donde toca', async () => {
  const root = tmpRoot();
  try {
    const files = byPath(await generateContext(root, policyTienda()));
    for (const name of ['hu', 'adr', 'bootstrap-contexto', 'sync-docs']) {
      const fm = parseFrontmatter(files.get(`.claude/skills/${name}/SKILL.md`));
      assert.ok(fm, `${name} sin frontmatter`);
      assert.equal(fm.name, name);
      assert.ok(fm.description && fm.description.length > 20, `${name} necesita description`);
      assert.equal(fm['disable-model-invocation'], 'true', `${name} no debe autoinvocarse`);
      assert.ok(fm['argument-hint'] !== undefined, `${name} necesita argument-hint`);
    }
    const rev = parseFrontmatter(files.get('.claude/skills/revision-seguridad/SKILL.md'));
    assert.equal(rev.name, 'revision-seguridad');
    assert.equal(rev['disable-model-invocation'], undefined, 'revision-seguridad sí la puede invocar el modelo');
    // bootstrap-contexto: plan mode y la regla de no copiar valores reales.
    const boot = files.get('.claude/skills/bootstrap-contexto/SKILL.md');
    assert.match(boot, /plan mode/);
    assert.match(boot, /No copies valores, hosts ni datos reales/i);
    assert.match(boot, /\(\?\)/);
    // Subagentes con tools mínimos.
    const exp = parseFrontmatter(files.get('.claude/agents/explorador.md'));
    assert.equal(exp.tools, 'Read, Grep, Glob');
    const revAg = parseFrontmatter(files.get('.claude/agents/revisor-seguridad.md'));
    assert.ok(!/Edit|Write/.test(revAg.tools), 'el revisor no escribe');
    const sync = parseFrontmatter(files.get('.claude/agents/docs-sync.md'));
    assert.match(sync.tools, /Edit/);
    assert.match(files.get('.claude/agents/docs-sync.md'), /solo\*\* dentro de `docs\/`/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('docs: INDEX lista cada documento y la plantilla de HU trae Gherkin en español', async () => {
  const root = tmpRoot();
  try {
    const files = byPath(await generateContext(root, policyTienda()));
    const index = files.get('docs/INDEX.md');
    for (const d of ['ARCHITECTURE.md', 'CONVENTIONS.md', 'TESTING.md', 'RUNBOOK.md', 'SECURITY.md', 'GLOSSARY.md', 'LESSONS.md', 'decisions/', 'user-stories/']) {
      assert.ok(index.includes(d), `docs/INDEX.md debe listar ${d}`);
    }
    const hu = files.get('docs/user-stories/_PLANTILLA-HU.md');
    assert.match(hu, /^# language: es$/m);
    assert.match(hu, /^\s*Dado /m);
    assert.match(hu, /^\s*Cuando /m);
    assert.match(hu, /^\s*Entonces /m);
    for (const s of ['## Historia', '**Como**', '**quiero**', '**para**', '## Criterios de aceptación', '## Datos sensibles involucrados', '## Fuera de alcance', 'DoD']) {
      assert.ok(hu.includes(s), `la plantilla de HU debe tener ${s}`);
    }
    const fm = parseFrontmatter(hu);
    for (const k of ['id', 'epica', 'estado', 'prioridad', 'owner', 'datos-sensibles']) {
      assert.ok(k in fm, `la HU necesita el campo ${k} en el frontmatter`);
    }
    // ADR en MADR español.
    const adr = files.get('docs/decisions/0000-plantilla-adr.md');
    for (const s of ['## Contexto y problema', '## Factores de decisión', '## Opciones consideradas', '## Decisión', '### Consecuencias']) {
      assert.ok(adr.includes(s), `la plantilla de ADR debe tener ${s}`);
    }
    // RUNBOOK con AI_ENV=1 por app y la BD.
    const run = files.get('docs/RUNBOOK.md');
    assert.match(run, /AI_ENV=1 \.\/mvnw spring-boot:run/);
    assert.match(run, /AI_ENV=1 npx ng serve/);
    assert.match(run, /5433/);
    // TESTING con el comando de UN test por app.
    const testing = files.get('docs/TESTING.md');
    assert.match(testing, /mvnw -q test -Dtest=<Clase>/);
    assert.match(testing, /ng test --include <ruta\.spec\.ts>/);
    // SECURITY con la taxonomía y la tabla enforced vs best-effort.
    const sec = files.get('docs/SECURITY.md');
    for (const s of ['RFC', 'CURP', 'CLABE', 'NSS', 'enforced', 'best-effort', '~/.claude/projects', 'pk_test_', 'anon']) {
      assert.ok(sec.includes(s), `docs/SECURITY.md debe mencionar ${s}`);
    }
    assert.match(files.get('docs/GLOSSARY.md'), /LFPDPPP/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('README y .github: comandos reales del proyecto y CODEOWNERS con owners.infosec', async () => {
  const root = tmpRoot();
  try {
    const files = byPath(await generateContext(root, policyTienda()));
    const readme = files.get('README.md');
    for (const s of ['## ¿Qué es esta carpeta?', '## Empieza', 'bot-secure claude', '## ¿Qué comando uso?', '## Dónde está cada cosa', '## Si algo falla']) {
      assert.ok(readme.includes(s), `el README del workspace debe tener ${s}`);
    }
    assert.match(readme, /AI_ENV=1 \.\/mvnw spring-boot:run/);
    assert.match(readme, /127\.0\.0\.1:5433/);
    const co = files.get('.github/CODEOWNERS');
    assert.match(co, /^\/\.claude\/ @org\/infosec$/m);
    assert.match(co, /^\/\.env\.ai @org\/infosec$/m);
    const pr = files.get('.github/PULL_REQUEST_TEMPLATE.md');
    for (const s of ['campo vacío', 'Docs actualizadas', 'Lecciones', 'secretos']) {
      assert.ok(pr.toLowerCase().includes(s.toLowerCase()), `la plantilla de PR debe pedir ${s}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('sin owners.infosec, CODEOWNERS queda comentado con la instrucción', async () => {
  const root = tmpRoot();
  try {
    const policy = policyTienda();
    policy.owners = {};
    const co = byPath(await generateContext(root, policy)).get('.github/CODEOWNERS');
    assert.match(co, /bot-secure policy set owners\.infosec/);
    assert.ok(co.split('\n').every((l) => !l.trim() || l.trim().startsWith('#')), 'sin infosec todas las rutas van comentadas');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ningún archivo generado deja {{ sin renderizar ni la palabra undefined', async () => {
  const root = tmpRoot();
  try {
    for (const policy of [policyTienda(), { version: 1, project: 'solo', apps: [], db: {} }]) {
      const arts = await generateContext(root, policy);
      for (const a of arts) {
        assert.ok(!a.content.includes('{{'), `${toPosix(a.path)} tiene plantilla sin renderizar`);
        assert.ok(!a.content.includes('}}'), `${toPosix(a.path)} tiene plantilla sin renderizar`);
        assert.ok(!/\bundefined\b/.test(a.content), `${toPosix(a.path)} contiene 'undefined'`);
        assert.ok(!/\bnull\b/.test(a.content), `${toPosix(a.path)} contiene 'null'`);
        assert.ok(!/\[object Object\]/.test(a.content), `${toPosix(a.path)} contiene '[object Object]'`);
        assert.ok(a.content.endsWith('\n'), `${toPosix(a.path)} debe terminar en salto de línea`);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('el contexto generado pasa el escáner sin hallazgos ≥ MEDIUM', async () => {
  const root = tmpRoot();
  try {
    const arts = await generateContext(root, policyTienda());
    writeArtifacts(root, arts);
    const { scanPaths } = await import('../../src/engine/index.mjs');
    const report = await scanPaths({ root, mode: 'scan', hmacKey: 'clave-de-prueba-no-secreta' });
    const orden = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
    const graves = report.findings.filter((f) => (orden[f.severity] ?? 0) >= orden.MEDIUM);
    assert.deepEqual(graves.map((f) => `${f.file}:${f.line} ${f.ruleId}`), [], 'el contexto generado no debe contener nada que parezca un secreto o PII');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeArtifacts es idempotente y respeta las ediciones humanas', async () => {
  const root = tmpRoot();
  try {
    const arts = await generateContext(root, policyTienda());
    const first = writeArtifacts(root, arts);
    assert.equal(first.summary.created, arts.length);
    assert.ok(existsSync(path.join(root, 'backend', 'CLAUDE.md')));
    const second = writeArtifacts(root, arts);
    assert.equal(second.summary.unchanged, arts.length);
    // Edición humana → la versión nueva queda en .new, no se pisa.
    const p = path.join(root, 'docs', 'LESSONS.md');
    const { writeText } = await import('../../src/lib/fsx.mjs');
    writeText(p, '# editado a mano\n');
    const third = writeArtifacts(root, arts);
    assert.equal(third.summary.pending, 1);
    assert.equal(readFileSync(p, 'utf8'), '# editado a mano\n');
    assert.ok(existsSync(p + '.new'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('workspace sin apps: se generan igual el contexto y el aviso TODO', async () => {
  const root = tmpRoot();
  try {
    const files = byPath(await generateContext(root, { version: 1, project: 'vacio', apps: [], db: {} }));
    assert.ok(files.has('AGENTS.md') && files.has('CLAUDE.md') && files.has('docs/INDEX.md'));
    assert.match(files.get('AGENTS.md'), /bot-secure workspace add/);
    assert.ok(!files.has('.claude/rules/backend.md'));
    assert.ok(!files.has('.claude/rules/frontend.md'));
    assert.ok(files.has('.claude/rules/tests.md'), 'tests.md siempre se genera, con globs por defecto');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('helpers: yamlList, huFileName, adrFileName, nextAdrNumber y lineBudgetIssues', async () => {
  assert.equal(yamlList(['backend/**', 'apps/api/**']), "['backend/**', 'apps/api/**']");
  assert.equal(huFileName(7, 'Alta de cliente con validación de RFC'), 'HU-0007-alta-de-cliente-con-validacion-de-rfc.md');
  assert.equal(adrFileName(12, 'Usar Postgres en la BD de IA'), '0012-usar-postgres-en-la-bd-de-ia.md');
  const root = tmpRoot();
  try {
    assert.equal(nextAdrNumber(root), 1);
    writeArtifacts(root, await generateContext(root, policyTienda()));
    assert.equal(nextAdrNumber(root), 4);
    assert.deepEqual(lineBudgetIssues([{ path: 'CLAUDE.md', content: 'x\n'.repeat(61) }]), [{ path: 'CLAUDE.md', max: CLAUDE_MAX_LINES, lines: 61 }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('una app en la raíz (path .) no rompe las rutas', async () => {
  const root = tmpRoot();
  try {
    const policy = {
      version: 1, project: 'mono', apps: [{ name: 'api', path: '.', kind: 'backend', stack: 'node', packageManager: 'npm', runCmd: 'npm run dev', testCmd: 'npm test', port: 3000 }],
      db: { engine: 'postgres', port: 5433 },
    };
    const files = byPath(await generateContext(root, policy));
    assert.ok(files.has('CLAUDE.md'));
    assert.match(files.get('.claude/rules/backend.md'), /paths: \['\.\/\*\*'\]|paths: \['\.\*\*'\]|paths: \['\.\/\*\*'\]/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ruta de app inválida → BotSecureError con fix', async () => {
  const root = tmpRoot();
  try {
    await assert.rejects(
      () => generateContext(root, { version: 1, project: 'x', apps: [{ name: 'mala', path: '../fuera' }] }),
      (e) => { assert.equal(e.key ?? e.messageKey, 'generate.badAppPath'); assert.ok(e.fix); return true; });
    await assert.rejects(
      () => generateContext(root, { version: 1, apps: [] }),
      (e) => { assert.equal(e.key ?? e.messageKey, 'generate.noProject'); assert.ok(e.fix); return true; });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('las plantillas se resuelven dentro del paquete de bot-secure', async () => {
  const { TEMPLATES_DIR, loadTemplate } = await import('../../src/generate/md-helpers.mjs');
  assert.ok(existsSync(path.join(TEMPLATES_DIR, 'md', 'es', 'AGENTS.md')), `TEMPLATES_DIR inválido: ${TEMPLATES_DIR}`);
  assert.ok(existsSync(path.join(TEMPLATES_DIR, 'claude', 'rules', 'seguridad-datos.md')));
  assert.match(loadTemplate('claude', 'agents/explorador.md'), /^---\n/);
  await assert.rejects(
    async () => loadTemplate('md', 'no-existe.md'),
    (e) => { assert.equal(e.key ?? e.messageKey, 'generate.templateMissing'); assert.ok(e.fix); return true; });
});
