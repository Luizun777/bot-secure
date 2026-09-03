// Salida al usuario. En modo --json solo se imprime JSON en stdout; el resto va a stderr.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const color = { ok: c('32'), warn: c('33'), err: c('31'), dim: c('2'), bold: c('1'), cyan: c('36') };

export function makeLog({ json = false, quiet = false } = {}) {
  const out = (s) => { if (!json) process.stdout.write(s + '\n'); };
  const err = (s) => process.stderr.write(s + '\n');
  return {
    json,
    info: (s) => { if (!quiet) out(s); },
    ok: (s) => out(`${color.ok('✅')} ${s}`),
    warn: (s) => err(`${color.warn('⚠️ ')} ${s}`),
    error: (s) => err(`${color.err('⛔')} ${s}`),
    step: (s) => { if (!quiet) out(`${color.cyan('▸')} ${s}`); },
    dim: (s) => { if (!quiet) out(color.dim(s)); },
    table: (rows) => { if (!json) for (const r of rows) out(r.map((x, i) => String(x).padEnd(i === r.length - 1 ? 0 : 28)).join(' ')); },
    data: (obj) => { if (json) process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); },
  };
}
