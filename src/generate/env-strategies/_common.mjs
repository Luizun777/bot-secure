// Helpers compartidos por las estrategias de entorno (`envStrategy` de src/detect).
// Cada estrategia exporta { id, files(app, policy, ctx) → Artifact[], loaderSnippet(app), runCmdAi(app), docs(app) }.
// Todo el contenido vive en JS (nunca se leen plantillas del repo del bot en tiempo de ejecución:
// lo que se despliega es dist/, un bundle).
import { join } from 'node:path';
import { MOCK_PORTS, slug } from '../fakes.mjs';
import { appJoin, buildDbUrl, esc, parseDbUrl, patchPackageScripts, prefixFor, readJsonIf, resolveVars, toAdo, toJdbc } from '../env-ai.mjs';

export { appJoin, esc, patchPackageScripts, prefixFor, readJsonIf };

/** Cabecera común de todo archivo generado. */
export function banner(comment = '#', extra = '') {
  const l = (s) => `${comment} ${s}`;
  return [
    l('Generado por bot-secure para el ambiente de IA (AI_ENV=1). Versionado, sin secretos reales.'),
    l('Regla del campo vacío: si el valor de la configuración está vacío y AI_ENV=1, se toma de .env.ai;'),
    l('si está vacío y NO hay AI_ENV, el arranque falla con el nombre del campo (eso es lo correcto en dev/qa/prd).'),
    l('Regenerar: bot-secure init'),
    extra ? l(extra) : null,
    '',
  ].filter((x) => x !== null).join('\n');
}

/** Contexto de valores de IA para una app (puertos, URLs, BD, variables resueltas). */
export function aiContext(app, policy, ctx = {}) {
  const apps = ctx.apps || policy?.apps || [];
  const backend = apps.find((a) => a.kind === 'backend');
  const frontend = apps.find((a) => a.kind === 'frontend');
  const backendPort = backend?.port || 8080;
  const frontendPort = frontend?.port || 4200;
  const dbUrl = ctx.dbUrl || buildDbUrl(policy?.db);
  const vars = ctx.vars || resolveVars(app, policy, { root: ctx.root, apps, dbUrl });
  const db = parseDbUrl(dbUrl) || { host: '127.0.0.1', port: '5433', database: 'app_ai', user: 'app', password: '' };
  return {
    project: policy?.project || 'app',
    projectSlug: slug(policy?.project || 'app'),
    app, apps, backendPort, frontendPort,
    port: app?.port || (app?.kind === 'frontend' ? frontendPort : backendPort),
    dbUrl, jdbcUrl: toJdbc(dbUrl), adoUrl: toAdo(dbUrl), db,
    issuer: `http://localhost:${MOCK_PORTS.idp}/default`,
    jwks: `http://localhost:${MOCK_PORTS.idp}/default/jwks`,
    apiUrl: `http://localhost:${backendPort}`,
    frontendUrl: `http://localhost:${frontendPort}`,
    vars, ports: MOCK_PORTS,
    prefix: prefixFor(app?.stack),
  };
}

/** Variables del .env.ai que la app declara en su .env.example (sin las estructurales). */
export function appVars(c) { return (c.vars || []).filter((v) => v.section === 'app'); }

/** Artefacto dentro de la app. */
export function file(app, rel, content, mode) {
  const a = { path: appJoin(app, ...rel.split('/')), content };
  if (mode) a.mode = mode;
  return a;
}

/** Une la raíz del workspace con una ruta relativa (path.join, nunca '/' a mano). */
export function joinRoot(root, rel) { return root ? join(root, rel) : ''; }

/** Parche idempotente de scripts de package.json (devuelve el artefacto o null si no hay package.json). */
export function packageScripts(app, ctx, scripts) {
  const json = readJsonIf(joinRoot(ctx.root, appJoin(app, 'package.json')));
  if (!json) return null;
  const next = patchPackageScripts(json, scripts);
  return file(app, 'package.json', JSON.stringify(next, null, 2) + '\n');
}

/** Bloque markdown estándar de una estrategia. */
export function docsBlock({ title, runCmd, files, notes = [], snippet = null }) {
  const out = [`### ${title}`, '', `Arranque en modo IA: \`${runCmd}\``, '', 'Archivos generados:', ''];
  for (const f of files) out.push(`- \`${f}\``);
  out.push('');
  for (const n of notes) out.push(`- ${n}`);
  if (notes.length) out.push('');
  if (snippet) out.push('```' + (snippet.lang || ''), snippet.code.trimEnd(), '```', '');
  return out.join('\n');
}
