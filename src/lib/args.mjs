// Parser de argumentos mínimo: --flag, --key value, --key=value, -h; el resto son posicionales.
export function parseArgs(argv, { booleans = [] } = {}) {
  const flags = {}; const positional = [];
  const bool = new Set(booleans);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) flags[k] = v;
      else if (bool.has(k) || i + 1 >= argv.length || argv[i + 1].startsWith('-')) flags[k] = true;
      else flags[k] = argv[++i];
    } else if (a === '-h') flags.help = true;
    else if (a === '-v') flags.version = true;
    else if (a === '-y') flags.yes = true;
    else positional.push(a);
  }
  return { flags, positional };
}
