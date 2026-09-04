#!/usr/bin/env node
// Dispatcher del CLI. Descubre comandos en src/cli/*.mjs. Sin dependencias.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from '../src/lib/args.mjs';
import { BotSecureError, EXIT } from '../src/lib/errors.mjs';
import { detectLang, makeT } from '../src/lib/i18n.mjs';
import { makeLog, color } from '../src/lib/log.mjs';
import { COMMANDS } from '../src/cli/_registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_DIR = join(HERE, '..', 'src', 'cli');
const GLOBAL_BOOLEANS = ['json', 'dry-run', 'yes', 'help', 'version', 'quiet'];

async function loadCommands() {
  // El registro estático es la fuente: funciona igual desde el repo y desde dist/.
  const registrados = COMMANDS.filter((c) => c && c.name && typeof c.run === 'function');
  if (registrados.length) return registrados;
  // Respaldo solo para desarrollo, si alguien añadió un comando sin regenerar el registro.
  const cmds = [];
  for (const f of readdirSync(CLI_DIR).sort()) {
    if (!f.endsWith('.mjs') || f.startsWith('_')) continue;
    const mod = await import(pathToFileURL(join(CLI_DIR, f)).href);
    const def = mod.default;
    if (def && def.name && typeof def.run === 'function') cmds.push(def);
  }
  return cmds;
}

function resolveCommand(cmds, name) {
  return cmds.find((c) => c.name === name || (c.aliases || []).includes(name)) || null;
}

function suggest(cmds, name) {
  const names = cmds.flatMap((c) => [c.name, ...(c.aliases || [])]);
  const dist = (a, b) => { const m = []; for (let i = 0; i <= a.length; i++) { m[i] = [i]; for (let j = 1; j <= b.length; j++) m[i][j] = i === 0 ? j : Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); } return m[a.length][b.length]; };
  return names.map((n) => [n, dist(n, name)]).sort((x, y) => x[1] - y[1]).find(([, d]) => d <= 2)?.[0] || null;
}

function printHelp(cmds, t, lang, log) {
  const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
  log.info(`${color.bold('bot-secure')} ${pkg.version} — ${t('cli.tagline')}\n`);
  log.info(t('cli.usage'));
  log.info(color.cyan(t('cli.startHere')) + '\n');
  const visible = cmds.filter((c) => !c.hidden);
  const basic = visible.filter((c) => !c.advanced), adv = visible.filter((c) => c.advanced);
  const line = (c) => `  ${c.name.padEnd(16)} ${(c.summary?.[lang] ?? c.summary?.es ?? '')}${c.aliases?.length ? color.dim(`  (${c.aliases.join(', ')})`) : ''}`;
  log.info(color.bold(t('cli.commands')));
  basic.forEach((c) => log.info(line(c)));
  if (adv.length) { log.info('\n' + color.bold(t('cli.advanced'))); adv.forEach((c) => log.info(line(c))); }
  log.info('\n' + t('cli.globalFlags'));
  log.info(t('cli.moreHelp'));
}

export async function main(argv = process.argv.slice(2)) {
  const { flags, positional } = parseArgs(argv, { booleans: GLOBAL_BOOLEANS });
  const lang = detectLang(flags.lang);
  const t = makeT(lang);
  const log = makeLog({ json: !!flags.json, quiet: !!flags.quiet });
  const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
  if (flags.version) { log.info(t('cli.version', { version: pkg.version })); return EXIT.OK; }
  const cmds = await loadCommands();
  const name = positional[0] ?? 'menu';
  if (flags.help && !positional[0]) { printHelp(cmds, t, lang, log); return EXIT.OK; }
  const cmd = resolveCommand(cmds, name);
  if (!cmd) {
    const s = suggest(cmds, name);
    log.error(t('cli.unknownCommand', { command: name }));
    if (s) log.info(t('cli.didYouMean', { suggestion: s }));
    log.info(t('cli.fix', { fix: 'bot-secure --help' }));
    return EXIT.ERROR;
  }
  const ctx = { args: positional.slice(1), flags, cwd: process.cwd(), lang, t, log, pkg, version: pkg.version, dryRun: !!flags['dry-run'], yes: !!flags.yes };
  if (flags.help) { log.info(cmd.usage?.[lang] ?? cmd.usage?.es ?? `bot-secure ${cmd.name}`); return EXIT.OK; }
  try {
    const code = await cmd.run(ctx);
    return typeof code === 'number' ? code : EXIT.OK;
  } catch (e) {
    if (e instanceof BotSecureError) {
      log.error(t(e.key, e.vars));
      if (e.fix) log.info(t('cli.fix', { fix: e.fix }));
      return e.exitCode;
    }
    log.error(t('cli.internalError', { message: e?.stack || e?.message || String(e) }));
    return EXIT.ERROR;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href || process.argv[1]?.endsWith('bot-secure')) {
  main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(EXIT.ERROR); });
}
