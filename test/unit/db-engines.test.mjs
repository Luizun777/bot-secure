// El compose de la BD de pruebas es la superficie de riesgo: si un puerto se publicase en 0.0.0.0
// la BD de IA quedaría expuesta en la red de la empresa. Se valida el YAML generado con un parser
// mínimo propio (cero dependencias) y se comprueban el esquema y las URLs de cada motor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, ENGINE_NAMES, getEngine } from '../../src/db/engines/index.mjs';
import { DB_PASSWORD_PLACEHOLDER } from '../../src/db/engines/_common.mjs';
import { renderCompose, toYaml } from '../../src/db/compose.mjs';
import { TABLES } from '../../src/db/schema-generic.mjs';
import { connectionUrl } from '../../src/db/index.mjs';

const policy = { version: 1, project: 'tienda', profile: 'standard', db: { rows: 5, seed: 42 } };

/* ------------------------- parser YAML mínimo (subconjunto generado) ------------------------- */

function parseYaml(text) {
  const lines = text.split('\n').filter((l) => l.trim() && !/^\s*#/.test(l));
  let i = 0;
  const scalar = (s) => {
    const v = s.trim();
    if (v.startsWith('"')) return JSON.parse(v);
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+$/.test(v)) return Number(v);
    return v;
  };
  const indentOf = (l) => l.length - l.trimStart().length;
  function block(indent) {
    const isList = lines[i] !== undefined && indentOf(lines[i]) === indent && lines[i].trim().startsWith('- ');
    if (isList) {
      const arr = [];
      while (i < lines.length && indentOf(lines[i]) === indent && lines[i].trim().startsWith('- ')) {
        arr.push(scalar(lines[i++].trim().slice(2)));
      }
      return arr;
    }
    const obj = {};
    while (i < lines.length && indentOf(lines[i]) === indent) {
      const line = lines[i];
      const m = /^\s*([A-Za-z0-9_.\-]+):\s*(.*)$/.exec(line);
      assert.ok(m, `línea YAML no reconocida: ${line}`);
      i++;
      obj[m[1]] = m[2] === '' ? block(indentOf(lines[i] ?? '')) : scalar(m[2]);
    }
    return obj;
  }
  return block(0);
}

test('el parser de la prueba entiende el YAML que genera el bot', () => {
  const doc = parseYaml(toYaml({ a: 1, b: { c: 'x', d: ['p', 'q'] }, e: true }));
  assert.deepEqual(doc, { a: 1, b: { c: 'x', d: ['p', 'q'] }, e: true });
});

for (const name of ENGINE_NAMES) {
  const engine = ENGINES[name];

  test(`compose de ${name}: YAML parseable con imagen fija, healthcheck y red interna`, () => {
    const doc = parseYaml(renderCompose(engine, policy));
    const svc = doc.services.db;
    assert.equal(svc.image, engine.image);
    assert.match(svc.image, /:[^:]+$/, 'la imagen debe llevar tag fijo');
    assert.equal(svc.container_name, 'tienda-ai-db');
    assert.ok(Array.isArray(svc.healthcheck.test) && svc.healthcheck.test[0] === 'CMD-SHELL');
    assert.deepEqual(svc.networks, ['ai-internal']);
    assert.equal(doc.networks['ai-internal'].internal, true);
    assert.ok(doc.volumes['tienda-ai-db'], 'volumen <proyecto>-ai-db');
    assert.ok(svc.volumes.some((v) => v.startsWith('tienda-ai-db:')), 'el volumen se monta en el contenedor');
  });

  test(`compose de ${name}: los puertos SOLO se publican en 127.0.0.1`, () => {
    const doc = parseYaml(renderCompose(engine, policy));
    for (const p of doc.services.db.ports) {
      assert.match(String(p), /^127\.0\.0\.1:\d+:\d+$/, `puerto expuesto fuera de loopback: ${p}`);
      assert.equal(Number(String(p).split(':')[1]), engine.altPort, 'debe usar el puerto alternativo');
      assert.equal(Number(String(p).split(':')[2]), engine.defaultPort);
    }
  });

  test(`${name}: la contraseña del contenedor es el placeholder literal de .env.ai`, () => {
    const yaml = renderCompose(engine, policy);
    assert.ok(yaml.includes(DB_PASSWORD_PLACEHOLDER), 'la contraseña debe ser el placeholder');
    assert.equal(connectionUrl(policy, { engine: name }).includes(DB_PASSWORD_PLACEHOLDER), true);
  });

  test(`${name}: connectionUrl apunta a 127.0.0.1 y al puerto alternativo`, () => {
    const url = connectionUrl(policy, { engine: name });
    assert.match(url, new RegExp(`127\\.0\\.0\\.1[:,]${engine.altPort}`), url);
    assert.ok(!/localhost/.test(url), 'siempre 127.0.0.1, nunca localhost');
  });
}

test('los puertos alternativos son los del plan y no chocan con los de desarrollo', () => {
  const esperado = { postgres: [5433, 5432], mysql: [3307, 3306], mongo: [27018, 27017], redis: [6380, 6379], mssql: [14330, 1433], oracle: [15210, 1521] };
  for (const [name, [alt, def]] of Object.entries(esperado)) {
    assert.equal(getEngine(name).altPort, alt, name);
    assert.equal(getEngine(name).defaultPort, def, name);
  }
});

for (const name of ['postgres', 'mysql', 'mongo']) {
  test(`el esquema genérico de ${name} declara las 8 tablas`, () => {
    const sql = ENGINES[name].schemaGeneric(policy);
    for (const t of TABLES) assert.ok(sql.includes(t), `falta la tabla ${t} en ${name}`);
    assert.equal(TABLES.length, 8);
  });
}

test('motor desconocido: getEngine devuelve null y resolveEngine explica el arreglo', async () => {
  assert.equal(getEngine('cassandra'), null);
  const { resolveEngine } = await import('../../src/db/index.mjs');
  assert.throws(() => resolveEngine(policy, { engine: 'cassandra' }), (e) => {
    assert.equal(e.key, 'db.unknownEngine');
    assert.ok(e.fix, 'todo error lleva arreglo');
    return true;
  });
});

test('Oracle y SQL Server avisan de licencia y de lentitud en Mac ARM', () => {
  assert.match(ENGINES.oracle.notes.join(' '), /LICENCIA/);
  assert.match(ENGINES.mssql.notes.join(' '), /ARM/);
});
