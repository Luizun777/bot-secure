// `bot-secure guard <evento>`: ejecuta la guarda desde el código fuente (útil en desarrollo,
// en CI y para diagnosticar). El JSON del hook de Claude Code se lee de stdin.
import { readFileSync } from 'node:fs';
import { BotSecureError, EXIT } from '../lib/errors.mjs';
import { EVENTS, main as guardMain } from '../guard/guard.mjs';

function readStdin() {
  if (process.stdin.isTTY) return '';
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

export default {
  name: 'guard',
  aliases: [],
  advanced: true,
  hidden: false,
  summary: { es: 'Ejecuta un hook de Claude Code desde el código fuente', en: 'Run a Claude Code hook from source' },
  usage: {
    es: 'bot-secure guard <session-start|prompt|pre-tool|post-tool|stop|session-end|config-change|statusline|git-pre-commit|git-pre-push|git-post-checkout>',
    en: 'bot-secure guard <session-start|prompt|pre-tool|post-tool|stop|session-end|config-change|statusline|git-pre-commit|git-pre-push|git-post-checkout>',
  },
  async run(ctx) {
    const event = ctx.args[0];
    if (!event || !EVENTS.includes(event)) {
      throw new BotSecureError('guard.unknownEvent', { vars: { event: event ?? '—' }, fix: `bot-secure guard ${EVENTS[0]}`, exitCode: EXIT.ERROR });
    }
    const stdin = ctx.flags.input ? String(ctx.flags.input) : readStdin();
    return await guardMain(event, stdin);
  },
};
