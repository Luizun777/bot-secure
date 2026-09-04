// Expo / React Native: app.config.js lee .env.ai y expone los valores en `extra`.
import { aiContext, appVars, banner, docsBlock, esc, file, joinRoot, packageScripts } from './_common.mjs';
import { existsSync } from 'node:fs';
import { appJoin } from './_common.mjs';

export const id = 'expo-config';

function aiEnvConfig(c) {
  const rows = [['EXPO_PUBLIC_API_URL', c.apiUrl], ['EXPO_PUBLIC_OIDC_ISSUER', c.issuer],
    ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20).map((v) => [v.name.startsWith('EXPO_PUBLIC_') ? v.name : `EXPO_PUBLIC_${v.name}`, v.value])];
  const seen = new Set();
  const uniq = rows.filter(([k]) => (seen.has(k) ? false : seen.add(k)));
  return [
    banner('//'),
    '// withAiEnv(): envuelve tu app.config.js. Todo lo que va a `extra` viaja en el bundle,',
    '// así que aquí solo hay valores del ambiente de IA (falsos pero válidos por formato).',
    "const fs = require('node:fs');",
    '',
    'const AI_VALUES = {',
    ...uniq.map(([k, v]) => `  '${esc(k)}': '${esc(v)}',`),
    '};',
    '',
    "function readEnvAi(file = '.env.ai') {",
    '  if (!fs.existsSync(file)) return {};',
    '  const out = {};',
    "  for (const raw of fs.readFileSync(file, 'utf8').split(/\\r?\\n/)) {",
    "    const line = raw.trim();",
    "    if (!line || line.startsWith('#') || !line.includes('=')) continue;",
    "    const i = line.indexOf('=');",
    "    out[line.slice(0, i).trim()] = line.slice(i + 1).split(' #')[0].trim().replace(/^['\"]|['\"]$/g, '');",
    '  }',
    '  return out;',
    '}',
    '',
    '/** Regla del campo vacío: vacío + AI_ENV=1 → .env.ai; vacío sin AI_ENV → error claro. */',
    'function withAiEnv(config = {}) {',
    "  const isAi = process.env.EXPO_PUBLIC_AI_ENV === '1' || process.env.AI_ENV === '1';",
    '  if (!isAi) return config;',
    '  const fromFile = readEnvAi();',
    '  const extra = { ...(config.extra || {}), aiEnv: true };',
    '  for (const [k, v] of Object.entries({ ...AI_VALUES, ...fromFile })) {',
    '    if (!extra[k]) extra[k] = v;',
    '    if (!process.env[k]) process.env[k] = v;',
    '  }',
    '  return { ...config, extra };',
    '}',
    '',
    'module.exports = { withAiEnv, AI_VALUES, readEnvAi };',
    '',
  ].join('\n');
}

function appConfig(c) {
  return [
    banner('//'),
    "const { withAiEnv } = require('./ai-env.config');",
    '',
    'module.exports = withAiEnv({',
    `  name: '${esc(c.app?.name || c.project)}',`,
    `  slug: '${esc(c.projectSlug)}',`,
    '  extra: {},',
    '});',
    '',
  ].join('\n');
}

export function runCmdAi() { return 'EXPO_PUBLIC_AI_ENV=1 npx expo start'; }

export function loaderSnippet() {
  return {
    file: 'app.config.js',
    lang: 'js',
    code: ["const { withAiEnv } = require('./ai-env.config');", '', 'module.exports = withAiEnv(require("./app.json").expo);'].join('\n'),
  };
}

export function files(app, policy, ctx = {}) {
  const c = aiContext(app, policy, ctx);
  const out = [file(app, 'ai-env.config.js', aiEnvConfig(c))];
  const existing = ctx.root ? joinRoot(ctx.root, appJoin(app, 'app.config.js')) : '';
  if (!existing || !existsSync(existing)) out.push(file(app, 'app.config.js', appConfig(c)));
  const pkg = packageScripts(app, ctx, { 'start:ai': 'EXPO_PUBLIC_AI_ENV=1 AI_ENV=1 expo start' });
  if (pkg) out.push(pkg);
  return out;
}

export function docs(app) {
  return docsBlock({
    title: `Expo / React Native (${app?.name ?? 'mobile'})`,
    runCmd: runCmdAi(app),
    files: ['.env.ai', 'ai-env.config.js', 'app.config.js (si no existía)', 'package.json (script `start:ai`)'],
    notes: [
      'Todo lo que entra en `extra` viaja en el bundle del cliente: solo valores de IA.',
      'Si ya tenías `app.config.js`, envuélvelo tú con `withAiEnv(...)` (el bot no lo pisa).',
      'El emulador/dispositivo no ve `localhost` del host: usa la IP de tu máquina o `adb reverse`.',
    ],
    snippet: loaderSnippet(app),
  });
}

export default { id, files, loaderSnippet, runCmdAi, docs };
