// Angular: no lee .env. El ambiente de IA entra por `environment.ai.ts` + configuración `ai`
// de angular.json (fileReplacements) y un pequeño resolutor (`src/app/ai-env.ts`).
import { aiContext, appJoin, appVars, banner, docsBlock, esc, file, joinRoot, packageScripts, readJsonIf } from './_common.mjs';

export const id = 'angular-environments';

const REPLACEMENT = { replace: 'src/environments/environment.ts', with: 'src/environments/environment.ai.ts' };

/** ¿La configuración de `serve` usa `browserTarget` (Angular ≤ 16) o `buildTarget` (≥ 17)? */
function serveTargetKey(serve) {
  const configs = serve?.configurations ?? {};
  for (const c of Object.values(configs)) {
    if (c && typeof c === 'object') {
      if ('browserTarget' in c) return 'browserTarget';
      if ('buildTarget' in c) return 'buildTarget';
    }
  }
  return 'buildTarget';
}

/**
 * Añade la configuración `ai` a angular.json. PURA (no muta la entrada) e IDEMPOTENTE
 * (aplicarla dos veces da exactamente el mismo resultado).
 * @param {object} json contenido de angular.json
 * @param {{project?:string}} [opts] nombre del proyecto Angular (por defecto, el primero)
 * @returns {object} angular.json nuevo
 */
export function patchAngularJson(json, opts = {}) {
  const out = JSON.parse(JSON.stringify(json ?? {}));
  out.projects = out.projects && typeof out.projects === 'object' ? out.projects : {};
  const names = opts.project && out.projects[opts.project] ? [opts.project] : Object.keys(out.projects);
  if (!names.length) return out;

  for (const name of names) {
    const proj = out.projects[name] = { ...(out.projects[name] ?? {}) };
    const key = proj.architect ? 'architect' : (proj.targets ? 'targets' : 'architect');
    const targets = proj[key] = { ...(proj[key] ?? {}) };

    const build = targets.build = { ...(targets.build ?? {}) };
    build.configurations = { ...(build.configurations ?? {}) };
    const prev = build.configurations.ai;
    const already = Array.isArray(prev?.fileReplacements)
      && prev.fileReplacements.some((r) => r?.replace === REPLACEMENT.replace && r?.with === REPLACEMENT.with);
    build.configurations.ai = {
      ...(prev ?? {}),
      fileReplacements: already ? prev.fileReplacements : [...(prev?.fileReplacements ?? []), { ...REPLACEMENT }],
      optimization: false,
      sourceMap: true,
    };

    const serve = targets.serve = { ...(targets.serve ?? {}) };
    serve.configurations = { ...(serve.configurations ?? {}) };
    const tKey = serveTargetKey(serve);
    serve.configurations.ai = { ...(serve.configurations.ai ?? {}), [tKey]: `${name}:build:ai` };
  }
  return out;
}

/** environment.ai.ts: apiUrl VACÍO a propósito; el resolutor lo rellena con el valor de IA. */
function environmentAi(c) {
  const extra = appVars(c).filter((v) => v.kind !== 'plain').slice(0, 12);
  return [
    banner('//'),
    '// Este archivo SOLO se usa con `ng serve -c ai` / `ng build -c ai` (AI_ENV).',
    "import { aiEnv } from '../app/ai-env';",
    '',
    'export const environment = {',
    '  production: false,',
    '  aiEnv: true,',
    "  // Campo vacío: lo resuelve aiEnv() con el valor del ambiente de IA.",
    "  apiUrl: aiEnv('apiUrl', ''),",
    ...extra.map((v) => `  ${camelName(v.name)}: aiEnv('${camelName(v.name)}', ''),`),
    '};',
    '',
  ].join('\n');
}

function camelName(name) {
  return String(name).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
    .split('_').map((p, i) => (i ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join('') || 'valor';
}

/** ai-env.ts: la regla del campo vacío en TypeScript, con los valores del ambiente de IA. */
function aiEnvTs(c) {
  const entries = [
    ['apiUrl', c.apiUrl],
    ['oidcIssuer', c.issuer],
    ['oidcJwksUri', c.jwks],
    ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 12).map((v) => [camelName(v.name), v.value]),
  ];
  const seen = new Set();
  const rows = entries.filter(([k]) => (seen.has(k) ? false : seen.add(k)));
  return [
    banner('//'),
    '// Valores del ambiente de IA (falsos pero válidos por formato; mismos que .env.ai).',
    'export const AI_VALUES: Readonly<Record<string, string>> = {',
    ...rows.map(([k, v]) => `  ${k}: '${esc(v)}',`),
    '};',
    '',
    '/** ¿Estamos en el ambiente de IA? (build con `-c ai`, que sustituye environment.ts). */',
    'export const IS_AI_ENV = true;',
    '',
    '/**',
    ' * Regla del campo vacío: valor vacío + ambiente de IA → valor de AI_VALUES;',
    ' * valor vacío fuera del ambiente de IA → error claro con el nombre del campo.',
    ' */',
    'export function aiEnv(key: string, current: string): string {',
    '  if (current) return current;',
    '  const v = AI_VALUES[key];',
    '  if (v !== undefined) return v;',
    '  throw new Error(',
    "    `[bot-secure] Falta el valor de '${key}'. En el ambiente de IA se toma de environment.ai.ts; ` +",
    "    `en dev/qa/prd debe venir de la configuración del entorno. Arreglo: npm run start:ai`,",
    '  );',
    '}',
    '',
  ].join('\n');
}

export function runCmdAi() { return 'npm run start:ai'; }

export function loaderSnippet(app) {
  return {
    file: 'src/app/ai-env.ts',
    lang: 'ts',
    code: [
      "import { environment } from '../environments/environment';",
      '',
      '// Úsalo donde antes leías environment.apiUrl:',
      'const base = environment.apiUrl; // vacío en ai-dev; resuelto por aiEnv() con -c ai',
      `// App: ${app?.name ?? 'app'}`,
    ].join('\n'),
  };
}

export function files(app, policy, ctx = {}) {
  const c = aiContext(app, policy, ctx);
  const out = [
    file(app, 'src/environments/environment.ai.ts', environmentAi(c)),
    file(app, 'src/app/ai-env.ts', aiEnvTs(c)),
  ];
  const angular = ctx.root ? readAngular(ctx.root, app) : null;
  if (angular) out.push(file(app, 'angular.json', JSON.stringify(patchAngularJson(angular, { project: app?.name }), null, 2) + '\n'));
  const pkg = packageScripts(app, ctx, { 'start:ai': 'ng serve -c ai', 'build:ai': 'ng build -c ai' });
  if (pkg) out.push(pkg);
  return out;
}

function readAngular(root, app) { return readJsonIf(joinRoot(root, appJoin(app, 'angular.json'))); }

export function docs(app) {
  return docsBlock({
    title: `Angular (${app?.name ?? 'frontend'})`,
    runCmd: 'npm run start:ai',
    files: ['src/environments/environment.ai.ts', 'src/app/ai-env.ts', 'angular.json (configuración `ai`)', 'package.json (script `start:ai`)'],
    notes: [
      'Angular **no** lee `.env`: la sustitución la hace `fileReplacements` de la configuración `ai`.',
      'En `ai-dev`, `src/environments/environment.ts` deja `apiUrl: \'\'` (campo vacío). Sin `-c ai` el arranque falla con el nombre del campo.',
      'El parche de `angular.json` es idempotente: volver a ejecutar `bot-secure init` no duplica nada.',
    ],
    snippet: loaderSnippet(app),
  });
}

export default { id, files, loaderSnippet, runCmdAi, docs, patchAngularJson };
