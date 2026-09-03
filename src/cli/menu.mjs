// `bot-secure` sin argumentos: menú de estado + acciones probables. Se completa en F0 (doctor) y F4.
import { findWorkspaceRoot, findGitRoot, currentBranch } from '../lib/paths.mjs';
import { color } from '../lib/log.mjs';

export default {
  name: 'menu',
  aliases: [],
  hidden: true,
  summary: { es: 'Menú de estado (se muestra al ejecutar bot-secure sin argumentos)', en: 'Status menu (shown when running bot-secure with no arguments)' },
  usage: { es: 'bot-secure', en: 'bot-secure' },
  async run(ctx) {
    const { log, t, cwd } = ctx;
    const root = findWorkspaceRoot(cwd);
    const gitRoot = findGitRoot(cwd);
    log.info(`${color.bold('bot-secure')} ${ctx.version} — ${t('cli.tagline')}\n`);
    if (!root) {
      log.info(t('menu.noWorkspace'));
      log.info(`  ${color.cyan('bot-secure start')}   ${t('menu.actionStart')}`);
      log.info(`  ${color.cyan('bot-secure --help')} ${t('menu.actionHelp')}`);
      if (gitRoot) log.dim(t('menu.gitDetected', { root: gitRoot, branch: currentBranch(gitRoot) ?? '?' }));
      return 0;
    }
    log.info(t('menu.workspace', { root }));
    log.info(`  ${color.cyan('bot-secure claude')}  ${t('menu.actionClaude')}`);
    log.info(`  ${color.cyan('bot-secure status')}  ${t('menu.actionStatus')}`);
    log.info(`  ${color.cyan('bot-secure up')}      ${t('menu.actionUp')}`);
    log.info(`  ${color.cyan('bot-secure --help')}  ${t('menu.actionHelp')}`);
    return 0;
  },
};
