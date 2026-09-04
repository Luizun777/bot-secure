// Punto de entrada del módulo generate-env: todo lo que hace funcionar el ambiente de IA
// (.env.ai, loaders por stack, adaptadores de SDK, mocks, compose, CI, org-pack, devcontainer).
// `src/generate/index.mjs` lo carga con import dinámico y try/catch.
import { join } from 'node:path';
import { FAKE_REGISTRY, MOCK_PORTS, fakeFor, isFake } from './fakes.mjs';
import {
  appJoin, buildEnvAi, buildEnvExample, dbUrlFor, emptyFieldRule, parseEnv,
  readExampleVars, renderEnvAi, resolveVars, valueLooksSafe,
} from './env-ai.mjs';
import { STRATEGIES, STRATEGY_IDS, runCmdAi, strategyFiles, strategyFor, usesEnvFile } from './env-strategies/index.mjs';
import { adapterArtifacts, adaptersDoc, adaptersFor } from './sdk-adapters.mjs';
import { generateMocks, mocksNeeded } from './mocks.mjs';
import { generateCompose } from './compose.mjs';
import { generateCi } from './ci.mjs';
import { generateOrgPack } from './orgpack.mjs';
import { generateDevcontainer } from './devcontainer.mjs';

export { fakeFor, isFake, FAKE_REGISTRY, MOCK_PORTS, generateMocks, mocksNeeded };
export { buildEnvAi, buildEnvExample, resolveVars, renderEnvAi, parseEnv, emptyFieldRule } from './env-ai.mjs';
export { STRATEGIES, STRATEGY_IDS, strategyFor, runCmdAi, patchAngularJson } from './env-strategies/index.mjs';
export { adaptersFor, adaptersDoc } from './sdk-adapters.mjs';
export { proposeRefactors, applyRefactors, toUnifiedDiff } from './refactor.mjs';
export { generateKeys, keysStatus, MOCK_IMAGES, KEYS_DIR } from './mocks.mjs';
export { generateCompose, renderComposeAi, publishedPorts, COMPOSE_FILE } from './compose.mjs';
export { generateCi } from './ci.mjs';
export { generateOrgPack, managedSettings } from './orgpack.mjs';
export { generateDevcontainer } from './devcontainer.mjs';

/** @typedef {{path:string, content:string, mode?:string}} Artifact */

/** Apps efectivas: las de `policy.apps` fusionadas con las detectadas. */
function mergeApps(policy, apps) {
  const fromPolicy = policy?.apps ?? [];
  if (!apps?.length) return fromPolicy;
  const byName = new Map(fromPolicy.map((a) => [a.name, a]));
  for (const a of apps) byName.set(a.name, { ...(byName.get(a.name) ?? {}), ...a });
  return [...byName.values()];
}

/** `.bot-secure/fakes.json`: el registro de fakes que usan el escáner y el hook pre-commit. */
export function fakesRegistryArtifact() {
  // Cada entrada va en UNA línea y lleva su propio `marker`: el anti-falsos-positivos del motor
  // mira el texto de la línea del hallazgo, así que el ejemplo debe compartir línea con la marca.
  const filas = FAKE_REGISTRY.map((e) => `    ${JSON.stringify({ ...e, marker: `bot-secure:fake ${e.id}` })}`);
  const content = [
    '{',
    '  "version": 1,',
    '  "comment": "Formas de los valores FALSOS del ambiente de IA. No son secretos: no hay nada que rotar.",',
    '  "marker": "# bot-secure:fake <tipo>",',
    '  "registry": [',
    filas.join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
  return { path: join('.bot-secure', 'fakes.json'), content };
}

/** Documento `docs/AI-ENV.md`: cómo entra `.env.ai` en cada app y con qué comando se arranca. */
export function envDoc(policy, apps) {
  const lines = [
    '# El ambiente de IA en este workspace',
    '',
    'Una sola regla: **en `ai-dev` los campos sensibles de la configuración van vacíos**.',
    'Con `AI_ENV=1`, el cargador de cada stack los rellena con los valores de `.env.ai`',
    '(base de datos de pruebas, IdP simulado, backend local). Sin `AI_ENV`, un campo vacío',
    'hace fallar el arranque nombrando el campo: exactamente lo que quieres en `dev`, `qa` y `prd`.',
    '',
    '## Apps',
    '',
    '| App | Ruta | Stack | Estrategia | Arranque en modo IA |',
    '|---|---|---|---|---|',
    ...apps.map((a) => `| ${a.name} | \`${a.path || '.'}\` | ${a.stack} | \`${a.envStrategy || 'manual'}\` | \`${runCmdAi(a)}\` |`),
    '',
    '## Puertos del ambiente de IA',
    '',
    '| Servicio | Puerto |',
    '|---|---|',
    `| Base de datos | ${policy?.db?.port ?? 5433} |`,
    `| IdP (OIDC) | ${MOCK_PORTS.idp} |`,
    `| WireMock | ${MOCK_PORTS.wiremock} |`,
    `| Mailpit (UI) | ${MOCK_PORTS.mailpitUi} |`,
    '',
    'Todos escuchan **solo** en `127.0.0.1`.',
    '',
    '## Detalle por app',
    '',
  ];
  for (const a of apps) {
    lines.push(strategyFor(a).docs(a), '', emptyFieldRule(a.stack, policy?.lang || 'es'), '');
  }
  return lines.join('\n');
}

/**
 * Todo lo que genera el módulo generate-env.
 * @param {string} root raíz del workspace
 * @param {object} policy policy.json
 * @param {object[]} [apps] apps detectadas (se fusionan con policy.apps)
 * @returns {Promise<Artifact[]>}
 */
export async function generateEnvAll(root, policy, apps) {
  const list = mergeApps(policy, apps);
  const dbUrl = await dbUrlFor(policy);
  const out = [];

  // 1. .env.ai y .env.example de la raíz del workspace.
  const rootVars = resolveVars(null, policy, { root, apps: list, dbUrl });
  out.push({ path: '.env.ai', content: renderEnvAi(rootVars, { title: '.env.ai (workspace)' }) });
  out.push({ path: '.env.example', content: buildEnvExample(rootVars) });

  // 2. Por app: .env.ai + .env.example + artefactos de su estrategia de entorno.
  for (const app of list) {
    const exampleVars = readExampleVars(root, app);
    const vars = resolveVars(app, policy, { root, apps: list, dbUrl, exampleVars });
    const ctx = { root, apps: list, dbUrl, vars };
    if (usesEnvFile(app) || exampleVars.length) {
      out.push({ path: appJoin(app, '.env.ai'), content: renderEnvAi(vars, { title: appJoin(app, '.env.ai') }) });
      out.push({ path: appJoin(app, '.env.example'), content: buildEnvExample(vars) });
    }
    out.push(...strategyFiles(app, policy, ctx));
  }

  // 3. Adaptadores de SDK (archivos nuevos: nunca pisan código existente).
  out.push(...adapterArtifacts(list, { project: policy?.project }));
  out.push({ path: join('docs', 'ADAPTERS.md'), content: adaptersDoc(list, { project: policy?.project }) });

  // 4. Mocks, compose de amarre, CI y paquete de organización.
  out.push(...generateMocks(root, policy, list));
  out.push(...generateCompose(policy, list));
  out.push(...generateCi(policy));
  out.push(...generateOrgPack(policy));

  // 5. Devcontainer solo en nivel ≥ 2 (Docker no es base).
  if ((policy?.level ?? 1) >= 2) out.push(...generateDevcontainer(policy));

  // 6. Registro de fakes y documento del ambiente de IA.
  out.push(fakesRegistryArtifact());
  out.push({ path: join('docs', 'AI-ENV.md'), content: envDoc(policy, list) });

  return dedupe(out);
}

/** Un artefacto por ruta (gana el último: las estrategias pueden refinar un archivo base). */
function dedupe(artifacts) {
  const byPath = new Map();
  for (const a of artifacts) byPath.set(String(a.path).split('\\').join('/'), a);
  return [...byPath.values()];
}

/** Comprobación de seguridad: ningún `.env.ai` generado puede llevar un valor que no sea fake. */
export function verifyGeneratedEnv(artifacts = []) {
  const problems = [];
  for (const a of artifacts) {
    if (!/(^|\/)\.env\.ai$/.test(String(a.path).split('\\').join('/'))) continue;
    for (const v of parseEnv(a.content)) {
      if (!valueLooksSafe(v.name, v.value)) problems.push({ path: a.path, name: v.name });
    }
  }
  return problems;
}

export { strategyFiles, usesEnvFile, adapterArtifacts };
