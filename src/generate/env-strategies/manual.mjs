// Stack no reconocido: el bot no inventa un cargador. Deja el pendiente por escrito.
import { aiContext, appVars, docsBlock, file } from './_common.mjs';

export const id = 'manual';

function todo(c) {
  const app = c.app;
  return [
    `# Pendientes de saneamiento — ${app?.name ?? 'app'}`,
    '',
    `Stack detectado: \`${app?.stack ?? 'unknown'}\` · estrategia de entorno: \`manual\`.`,
    '',
    'bot-secure no conoce el cargador de configuración de este stack, así que **no genera ninguno**.',
    'Lo que sí queda hecho: `.env.ai` con los valores del ambiente de IA.',
    '',
    '## Qué tienes que hacer tú',
    '',
    '1. Deja **vacíos** los campos sensibles de la configuración versionada (regla del campo vacío).',
    '2. Escribe un cargador mínimo que, con `AI_ENV=1`, rellene esos vacíos leyendo `.env.ai`.',
    '3. Sin `AI_ENV`, un campo vacío debe **fallar el arranque** nombrando el campo.',
    '',
    '## Valores del ambiente de IA',
    '',
    '| Variable | Valor |',
    '|---|---|',
    `| \`AI_ENV\` | \`1\` |`,
    `| \`API_URL\` | \`${c.apiUrl}\` |`,
    `| \`OIDC_ISSUER\` | \`${c.issuer}\` |`,
    `| \`DATABASE_URL\` | \`${c.dbUrl}\` |`,
    ...appVars(c).map((v) => `| \`${v.name}\` | \`${v.value}\` |`),
    '',
    '<!-- TODO: bórralo cuando el cargador exista y `bot-secure doctor --smoke` pase. -->',
    '',
  ].join('\n');
}

export function runCmdAi(app) { return app?.runCmd ? `AI_ENV=1 ${app.runCmd}` : 'AI_ENV=1 <tu comando de arranque>'; }

export function loaderSnippet() {
  return { file: 'SANITIZE-TODO.md', lang: '', code: '# escribe aquí el cargador de tu stack (ver la lista de valores de .env.ai)' };
}

export function files(app, policy, ctx = {}) {
  return [file(app, 'SANITIZE-TODO.md', todo(aiContext(app, policy, ctx)))];
}

export function docs(app) {
  return docsBlock({
    title: `${app?.stack ?? 'stack desconocido'} (${app?.name ?? 'app'})`,
    runCmd: runCmdAi(app),
    files: ['.env.ai', 'SANITIZE-TODO.md'],
    notes: ['Estrategia `manual`: el cargador lo escribes tú siguiendo `SANITIZE-TODO.md`.'],
  });
}

export default { id, files, loaderSnippet, runCmdAi, docs };
