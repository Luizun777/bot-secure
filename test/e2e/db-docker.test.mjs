// E2E de la BD de pruebas en contenedor. Solo corre con BOT_SECURE_E2E_DOCKER=1 y un runtime real
// (Docker o Podman): up → status healthy → filas == rows → reset regenera idéntico → down.
// Deja evidencia real en test/e2e/evidence/db-docker.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABLES, containerRuntime, down, reset, status, up } from '../../src/db/index.mjs';
import { execInDb } from '../../src/db/runtime.mjs';
import { getEngine } from '../../src/db/engines/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, 'tmp', `db-docker-${process.pid}`);
const EVIDENCE = join(HERE, 'evidence', 'db-docker.txt');
const ENGINE = process.env.BOT_SECURE_E2E_DB_ENGINE || 'postgres';
const ROWS = 25;
const SEED = 42;

const policy = {
  version: 1, project: `e2e${process.pid}`, profile: 'standard', mode: 'clone', runtime: 'clone', lang: 'es',
  apps: [], db: { engine: ENGINE, database: 'app_ai', user: 'app', generic: true, rows: ROWS, seed: SEED },
};

/** Huella de los datos cargados: si `reset` es reproducible, no cambia. */
function huella(runtime, ctx) {
  const engine = getEngine(ENGINE);
  if (ENGINE !== 'postgres') return null;
  const r = execInDb(runtime, { ...ctx, argv: ['psql', '-U', 'app', '-d', 'app_ai', '-t', '-A', '-c', "SELECT md5(string_agg(curp || rfc || nss, ',' ORDER BY id)) FROM clientes"] });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test('db up → status → reset reproducible → down', { timeout: 600_000 }, async (t) => {
  if (process.env.BOT_SECURE_E2E_DOCKER !== '1') {
    return t.skip('E2E de Docker desactivado. Actívalo con: BOT_SECURE_E2E_DOCKER=1 npm run test:e2e');
  }
  const runtime = await containerRuntime();
  if (!runtime.kind || !runtime.compose.length) {
    return t.skip('No hay Docker ni Podman con compose en esta máquina: instala Docker Desktop, Colima, OrbStack o Podman.');
  }

  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, '.bot-secure'), { recursive: true });
  writeFileSync(join(TMP, '.bot-secure', 'policy.json'), JSON.stringify(policy, null, 2));
  const linea = [];
  const log = { step: (s) => linea.push(`  ${s}`) };
  const ctx = { file: 'compose.db.yml', project: `${policy.project}-ai-db`, cwd: join(TMP, 'mocks', 'db') };

  try {
    const arriba = await up(TMP, policy, { log });
    assert.equal(arriba.health, 'healthy', `el contenedor no llegó a healthy: ${arriba.health}`);
    assert.ok(arriba.ms <= 90_000, `tardó ${arriba.ms} ms en estar healthy (máximo 90 s)`);
    linea.push(`up: ${arriba.engine} ${arriba.health} en ${Math.round(arriba.ms / 1000)}s (${arriba.runtime})`);

    const est = await status(TMP, policy, {});
    assert.equal(est.running, true);
    for (const tabla of TABLES) assert.equal(est.rows[tabla], ROWS, `tabla ${tabla}`);
    linea.push(`status: ${est.engine} 127.0.0.1:${est.port} ${est.health} · ${TABLES.length} tablas × ${ROWS} filas`);

    const antes = huella(runtime, ctx);
    const re = await reset(TMP, policy, { log });
    assert.equal(re.health, 'healthy');
    const despues = huella(runtime, ctx);
    if (antes) assert.equal(despues, antes, 'con la misma semilla, reset debe regenerar datos idénticos');
    linea.push(`reset: datos idénticos (md5 ${String(antes).slice(0, 12)}…, semilla ${SEED})`);

    const est2 = await status(TMP, policy, {});
    for (const tabla of TABLES) assert.equal(est2.rows[tabla], ROWS, `tras reset, tabla ${tabla}`);

    const fin = await down(TMP, policy, { volumes: true });
    assert.equal(fin.stopped, true);
    linea.push(`down: contenedor apagado y volumen ${fin.volume} borrado`);
  } finally {
    try { await down(TMP, policy, { volumes: true }); } catch { /* ya estaba abajo */ }
    mkdirSync(dirname(EVIDENCE), { recursive: true });
    writeFileSync(EVIDENCE, [
      `# bot-secure db — evidencia E2E (${new Date().toISOString().slice(0, 10)})`,
      `# runtime: ${runtime.kind} (${runtime.compose.join(' ')}) · motor: ${ENGINE}`,
      ...linea, '',
    ].join('\n'));
    rmSync(TMP, { recursive: true, force: true });
  }
});
