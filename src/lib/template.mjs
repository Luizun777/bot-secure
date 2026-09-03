// Plantillas mínimas tipo mustache: {{var}}, {{var.sub}}, {{#if var}}…{{/if}}, {{#unless var}}…{{/unless}}, {{#each list}}…{{/each}} con {{.}} y {{@index}}.
function get(ctx, path) {
  if (path === '.') return Object.prototype.hasOwnProperty.call(ctx, '.') ? ctx['.'] : ctx;
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
}
const truthy = (v) => Array.isArray(v) ? v.length > 0 : !!v;

export function render(tpl, ctx = {}) {
  let out = String(tpl);
  // bloques (repetir hasta que no cambie, para soportar anidación simple)
  const blockRe = /\{\{#(if|unless|each)\s+([\w.@]+)\}\}([\s\S]*?)\{\{\/\1\}\}/;
  let m;
  while ((m = blockRe.exec(out))) {
    const [whole, kind, key, body] = m;
    const v = get(ctx, key);
    let rep = '';
    if (kind === 'if') rep = truthy(v) ? render(body, ctx) : '';
    else if (kind === 'unless') rep = truthy(v) ? '' : render(body, ctx);
    else if (kind === 'each' && Array.isArray(v)) rep = v.map((item, i) => render(body, { ...ctx, ...(typeof item === 'object' && item ? item : {}), '.': item, '@index': i, '@last': i === v.length - 1 })).join('');
    out = out.slice(0, m.index) + rep + out.slice(m.index + whole.length);
  }
  return out.replace(/\{\{([\w.@]+)\}\}/g, (_, k) => { const v = get(ctx, k); return v == null ? '' : String(v); });
}
