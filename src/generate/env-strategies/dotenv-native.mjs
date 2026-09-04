// Vite / CRA / Vue / Next / Nuxt / SvelteKit: leen .env nativamente con prefijo público.
// El bot genera .env.ai (en env-index) + un resolutor con la regla del campo vacío.
import { aiContext, appVars, banner, docsBlock, esc, file, packageScripts } from './_common.mjs';

export const id = 'dotenv-native';

const MODE_CMD = {
  vite: 'vite --mode ai', svelte: 'vite --mode ai',
  next: 'next dev', nuxt: 'nuxt dev', cra: 'react-scripts start', vue: 'vue-cli-service serve',
};
const ENV_ACCESS = {
  vite: 'import.meta.env', svelte: 'import.meta.env',
  next: 'process.env', nuxt: 'process.env', cra: 'process.env', vue: 'process.env',
};

function aiEnvTs(c) {
  const prefix = c.prefix || '';
  const access = ENV_ACCESS[c.app?.stack] || 'process.env';
  const rows = [
    [`${prefix}API_URL`, c.apiUrl],
    ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20).map((v) => [v.name.startsWith(prefix) ? v.name : `${prefix}${v.name}`, v.value]),
  ];
  const seen = new Set();
  const uniq = rows.filter(([k]) => (seen.has(k) ? false : seen.add(k)));
  return [
    banner('//'),
    '// Las variables con prefijo público TERMINAN EN EL BUNDLE: aquí solo hay valores del',
    '// ambiente de IA (falsos pero válidos por formato). Nunca pongas un valor real.',
    'const AI_VALUES: Readonly<Record<string, string>> = {',
    ...uniq.map(([k, v]) => `  '${esc(k)}': '${esc(v)}',`),
    '};',
    '',
    `export const IS_AI_ENV = String(${access}.${prefix}AI_ENV ?? '') === '1';`,
    '',
    '/**',
    ' * Regla del campo vacío: vacío + AI_ENV → valor de .env.ai (o del respaldo de arriba);',
    ' * vacío sin AI_ENV → error claro con el nombre de la variable.',
    ' */',
    'export function aiEnv(name: string): string {',
    `  const fromEnv = String((${access} as Record<string, unknown>)[name] ?? '');`,
    '  if (fromEnv) return fromEnv;',
    '  if (IS_AI_ENV && AI_VALUES[name] !== undefined) return AI_VALUES[name];',
    '  throw new Error(',
    "    `[bot-secure] Falta ${name}. En el ambiente de IA viene de .env.ai; en dev/qa/prd, del entorno. ` +",
    `    'Arreglo: npm run start:ai',`,
    '  );',
    '}',
    '',
    `export const API_URL = aiEnv('${esc(prefix)}API_URL');`,
    '',
  ].join('\n');
}

export function runCmdAi() { return 'npm run start:ai'; }

export function loaderSnippet(app) {
  const prefix = { vite: 'VITE_', svelte: 'PUBLIC_', next: 'NEXT_PUBLIC_', nuxt: 'NUXT_PUBLIC_', cra: 'REACT_APP_', vue: 'VUE_APP_' }[app?.stack] || '';
  return {
    file: 'src/ai-env.ts',
    lang: 'ts',
    code: [
      "import { API_URL, IS_AI_ENV } from './ai-env';",
      '',
      `// ${prefix}API_URL sale de .env.ai cuando arrancas con npm run start:ai`,
      'fetch(`${API_URL}/health`);',
      'if (IS_AI_ENV) console.info("[bot-secure] ambiente de IA: mocks locales, datos sintéticos");',
    ].join('\n'),
  };
}

export function files(app, policy, ctx = {}) {
  const c = aiContext(app, policy, ctx);
  const out = [file(app, 'src/ai-env.ts', aiEnvTs(c))];
  const base = MODE_CMD[app?.stack] || 'vite --mode ai';
  const withEnv = app?.stack === 'vite' || app?.stack === 'svelte'
    ? base
    : `node --env-file=.env.ai ./node_modules/.bin/${base}`;
  const pkg = packageScripts(app, ctx, { 'start:ai': withEnv });
  if (pkg) out.push(pkg);
  return out;
}

export function docs(app) {
  return docsBlock({
    title: `${app?.stack ?? 'front'} (${app?.name ?? 'frontend'})`,
    runCmd: 'npm run start:ai',
    files: ['.env.ai', 'src/ai-env.ts', 'package.json (script `start:ai`)'],
    notes: [
      'Solo las variables con el prefijo público del framework llegan al navegador: `VITE_`, `NEXT_PUBLIC_`, `REACT_APP_`, `NUXT_PUBLIC_`, `PUBLIC_`, `VUE_APP_`.',
      'Una llave "pública" no es inocua: si es real, viaja en el bundle. En el ambiente de IA siempre es falsa.',
      '`*_AI_ENV=1` es la prueba de que el build usó `.env.ai` (lo verifica `scan --build`).',
    ],
    snippet: loaderSnippet(app),
  });
}

export default { id, files, loaderSnippet, runCmdAi, docs };
