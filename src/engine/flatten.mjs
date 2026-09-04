// Aplanador tolerante de configuración: YAML (indentación), JSON, TOML, INI/properties, XML/plist, .env
// → [{keyPath, value, line}]. No es un parser completo: prefiere emitir de más que fallar.

/** @typedef {{keyPath: string, value: string, line: number}} FlatEntry */

const STRONG_LAST_RE = /(password|passwd|pwd|secret|token|api[_-]?key|apikey|private[_-]?key|client[_-]?secret|access[_-]?key|credentials?|authtoken|auth[_-]?key)/i;
const WEAK_HINT_RE = /(url|uri|endpoint|file|path|name|length|size|_id$|^id$|version|type|header|field|param|regex|policy|expir|ttl|min|max|public|hash|salt|algorithm|^alg$|ring|board|store$|storetype|provider|issuer|audience|scope|format|encoding|count|enabled|required|prefix|suffix|label|title|description|list|allowed|pattern)/i;
const PARENT_KEY_HINT_RE = /(jwt|auth|signing|api|secret|encryption|hmac|token)/i;

/** Clave fuerte por su último segmento (o `key` bajo padre jwt|auth|signing|api…). */
export function isStrongKey(keyPath) {
  const segs = String(keyPath || '').split('.').filter(Boolean);
  if (!segs.length) return false;
  const last = segs[segs.length - 1];
  if (/^(key|keys)$/i.test(last)) return segs.length > 1 && PARENT_KEY_HINT_RE.test(segs[segs.length - 2]);
  if (!STRONG_LAST_RE.test(last)) return false;
  if (WEAK_HINT_RE.test(last)) return false;
  return true;
}

/** Formato a partir de la ruta/extensión. */
export function formatFor(pathOrExt) {
  const p = String(pathOrExt || '').toLowerCase();
  const base = p.split('/').pop();
  if (/^\.env(\..*)?$/.test(base) || /\.env$/.test(base)) return 'env';
  if (/\.(ya?ml)$/.test(p)) return 'yaml';
  if (/\.(json|json5|jsonc|arb)$/.test(p) || base === '.babelrc' || base === 'composer.lock') return 'json';
  if (/\.toml$/.test(p) || base === 'pipfile') return 'toml';
  if (/\.(ini|properties|cfg|conf|cnf|editorconfig|credentials|pypirc|npmrc|netrc|s3cfg|boto|pgpass)$/.test(p) || /^\.(npmrc|pypirc|netrc|s3cfg|boto|my\.cnf|pgpass|gitconfig)$/.test(base) || base === 'local.properties' || base === 'key.properties') return 'ini';
  if (/\.plist$/.test(p)) return 'plist';
  if (/\.(xml|config|csproj|resx|xaml|storyboard|pom|xsd|wsdl|xhtml)$/.test(p) || base === 'web.config' || base === 'app.config' || base === 'nlog.config') return 'xml';
  if (/\.(sh|bash|zsh|ps1|bat|cmd)$/.test(p) || base === 'dockerfile' || /^dockerfile/.test(base) || base === 'makefile' || base === 'procfile') return 'shell';
  return null;
}

const stripQuotes = (v) => {
  let s = String(v ?? '').trim();
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) || (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) s = s.slice(1, -1);
  return s;
};
const stripInlineComment = (v) => {
  const s = String(v ?? '');
  if (s.startsWith('"') || s.startsWith("'")) { const q = s[0]; const end = s.indexOf(q, 1); return end > 0 ? s.slice(0, end + 1) : s; }
  const i = s.search(/\s[#;]/); return (i >= 0 ? s.slice(0, i) : s).trim();
};

/* ---------- YAML ---------- */
function flattenYaml(text) {
  const out = []; const stack = []; // {indent, key}
  const lines = text.split('\n');
  const indentOf = (l) => l.match(/^ */)[0].length;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '');
    if (!raw.trim() || /^\s*#/.test(raw) || /^\s*(---|\.\.\.)\s*$/.test(raw)) continue;
    let indent = indentOf(raw);
    let body = raw.slice(indent);
    let listItem = false;
    if (/^-\s+/.test(body) || body === '-') { listItem = true; const m = body.match(/^-\s*/); indent += m[0].length; body = body.slice(m[0].length); }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parentPath = stack.map((s) => s.key).join('.');
    // `- VAR=value` (listas de entorno de compose)
    const envItem = listItem && body.match(/^([A-Za-z_][\w.-]*)=(.*)$/);
    if (envItem) { out.push({ keyPath: join(parentPath, envItem[1]), value: stripQuotes(envItem[2]), line: i + 1 }); continue; }
    const kv = body.match(/^("[^"]*"|'[^']*'|[^\s#][^:]*?)\s*:(?:\s+(.*)|$)/);
    if (!kv) continue;
    const key = stripQuotes(kv[1]);
    let value = (kv[2] ?? '').trim();
    if (value === '' || value === '|' || value === '>' || /^[|>][-+]?\d*$/.test(value)) {
      if (value !== '') { // escalar en bloque: junta las líneas más indentadas
        const parts = []; let j = i + 1;
        while (j < lines.length && (!lines[j].trim() || indentOf(lines[j]) > indent)) { if (lines[j].trim()) parts.push(lines[j].trim()); j++; }
        if (parts.length) out.push({ keyPath: join(parentPath, key), value: parts.join('\n'), line: i + 1 });
        continue;
      }
      stack.push({ indent, key }); continue;
    }
    value = stripQuotes(stripInlineComment(value));
    out.push({ keyPath: join(parentPath, key), value, line: i + 1 });
    if (listItem) stack.push({ indent, key: '' }); // hermanos del mismo ítem
  }
  return out;
}

const join = (a, b) => (a ? `${a}.${b}` : String(b)).replace(/\.+/g, '.').replace(/^\.|\.$/g, '');

/* ---------- JSON (tokenizador mínimo) ---------- */
function flattenJson(text) {
  const out = []; const stack = []; // {type:'obj'|'arr', key, index}
  let i = 0, line = 1, pendingKey = null;
  const n = text.length;
  const readString = () => { // i apunta a la comilla de apertura
    let j = i + 1; let s = '';
    while (j < n) {
      const c = text[j];
      if (c === '\\') { const nx = text[j + 1]; if (nx === 'n') s += '\n'; else if (nx === 'u') { s += String.fromCharCode(parseInt(text.slice(j + 2, j + 6), 16) || 0); j += 4; } else s += nx; j += 2; continue; }
      if (c === '"') break;
      if (c === '\n') line++;
      s += c; j++;
    }
    i = j + 1; return s;
  };
  const currentPath = () => stack.map((s) => s.key).filter((k) => k !== '' && k != null).join('.');
  while (i < n) {
    const c = text[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === ',') { i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); const seg = text.slice(i, e < 0 ? n : e + 2); line += (seg.match(/\n/g) || []).length; i = e < 0 ? n : e + 2; continue; }
    if (c === '{') { stack.push({ type: 'obj', key: pendingKey ?? (stack.length && stack[stack.length - 1].type === 'arr' ? `${stack[stack.length - 1].index++}` : '') }); pendingKey = null; i++; continue; }
    if (c === '[') { stack.push({ type: 'arr', key: pendingKey ?? '', index: 0 }); pendingKey = null; i++; continue; }
    if (c === '}' || c === ']') { stack.pop(); pendingKey = null; i++; continue; }
    if (c === '"') {
      const startLine = line; const s = readString();
      let k = i; while (k < n && (text[k] === ' ' || text[k] === '\t' || text[k] === '\r' || text[k] === '\n')) k++;
      const top = stack[stack.length - 1];
      if (text[k] === ':' && top && top.type === 'obj') { pendingKey = s; i = k + 1; continue; }
      if (pendingKey != null) { out.push({ keyPath: join(currentPath(), pendingKey), value: s, line: startLine }); pendingKey = null; }
      else if (top && top.type === 'arr') { out.push({ keyPath: join(currentPath(), `${top.index++}`), value: s, line: startLine }); }
      continue;
    }
    // literal (número, true, false, null)
    let j = i; while (j < n && !/[\s,\]}]/.test(text[j])) j++;
    const lit = text.slice(i, j);
    if (pendingKey != null) { out.push({ keyPath: join(currentPath(), pendingKey), value: lit, line }); pendingKey = null; }
    i = j > i ? j : i + 1;
  }
  return out;
}

/* ---------- TOML / INI / properties ---------- */
function flattenIniLike(text, { toml = false } = {}) {
  const out = []; let section = '';
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, ''); const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith(';') || t.startsWith('//')) continue;
    const sec = t.match(/^\[\[?\s*([^\]]+?)\s*\]?\]$/);
    if (sec) { section = sec[1].replace(/"/g, ''); continue; }
    const kv = t.match(/^(?:export\s+)?("[^"]*"|'[^']*'|[^=:\s]+)\s*[=:]\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (toml && /^(\[|\{)/.test(value)) continue; // arrays/tablas inline: no son escalares
    if (toml && /^"""/.test(value)) { // string multilínea
      const parts = [value.slice(3)]; let j = i + 1;
      while (j < lines.length && !lines[j].includes('"""')) parts.push(lines[j].trim()), j++;
      value = parts.join('\n');
    } else value = stripQuotes(stripInlineComment(value));
    out.push({ keyPath: join(section, stripQuotes(kv[1])), value, line: i + 1 });
  }
  return out;
}

/* ---------- XML / plist ---------- */
const XML_TAG_TEXT_RE = /<([A-Za-z_][\w.:-]*)(?:\s[^>]*)?>([^<]+)<\/\1\s*>/g;
const XML_ADD_KEY_RE = /<add\s+[^>]*?key\s*=\s*"([^"]+)"[^>]*?value\s*=\s*"([^"]*)"/gi;
const XML_NAME_VALUE_RE = /<\w+\s+[^>]*?name\s*=\s*"([^"]+)"[^>]*?value\s*=\s*"([^"]*)"/gi;
const XML_ATTR_RE = /\s([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g;
const XML_RESX_DATA_RE = /<data\s+[^>]*?name\s*=\s*"([^"]+)"[^>]*>\s*<value>([^<]*)<\/value>/gi;

function flattenXml(text) {
  const out = []; const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; if (!l.includes('<')) continue;
    for (const re of [XML_ADD_KEY_RE, XML_NAME_VALUE_RE, XML_RESX_DATA_RE]) { re.lastIndex = 0; let m; while ((m = re.exec(l))) out.push({ keyPath: m[1], value: m[2], line: i + 1 }); }
    XML_TAG_TEXT_RE.lastIndex = 0; let m;
    while ((m = XML_TAG_TEXT_RE.exec(l))) { const v = m[2].trim(); if (v) out.push({ keyPath: m[1], value: v, line: i + 1 }); }
    XML_ATTR_RE.lastIndex = 0;
    while ((m = XML_ATTR_RE.exec(l))) { if (!/^(key|name|value|xmlns|version|encoding|id|type|class)$/i.test(m[1])) out.push({ keyPath: m[1], value: m[2], line: i + 1 }); }
  }
  // plist / resx sin cerrar en la misma línea: <key>X</key> seguido de <string>Y</string> (misma o siguiente línea)
  for (let i = 0; i < lines.length; i++) {
    const k = lines[i].match(/<key>([^<]+)<\/key>/); if (!k) continue;
    const rest = lines[i].slice(lines[i].indexOf('</key>') + 6);
    const same = rest.match(/<string>([^<]*)<\/string>/);
    if (same) { out.push({ keyPath: k[1], value: same[1], line: i + 1 }); continue; }
    const nx = lines[i + 1]?.match(/<string>([^<]*)<\/string>/);
    if (nx) out.push({ keyPath: k[1], value: nx[1], line: i + 2 });
    const dataOpen = lines[i + 1]?.match(/<data>\s*([^<]*)/);
    if (dataOpen) out.push({ keyPath: k[1], value: (lines.slice(i + 1, i + 6).join('').match(/<data>([^<]*)/)?.[1] || dataOpen[1]).replace(/\s+/g, ''), line: i + 2 });
  }
  return out;
}

/* ---------- .env / shell ---------- */
const ENV_LINE_RE = /^\s*(?:export\s+|set\s+|ENV\s+|ARG\s+|\$env:)?([A-Za-z_][\w.-]*)\s*=\s*(.*)$/;
function flattenEnv(text) {
  const out = []; const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, ''); if (!l.trim() || /^\s*#/.test(l)) continue;
    const m = l.match(ENV_LINE_RE); if (!m) continue;
    out.push({ keyPath: m[1], value: stripQuotes(stripInlineComment(m[2])), line: i + 1 });
  }
  return out;
}

/**
 * Aplana un texto de configuración.
 * @param {string} text
 * @param {string} ext extensión o ruta (p. ej. 'yml', 'application.yml', '.env')
 * @returns {FlatEntry[]}
 */
export function flattenConfig(text, ext) {
  const fmt = formatFor(ext) ?? (/^[.\w]+$/.test(String(ext)) ? formatFor(`x.${String(ext).replace(/^\./, '')}`) : null);
  if (!text || !fmt) return [];
  try {
    switch (fmt) {
      case 'yaml': return flattenYaml(text);
      case 'json': return flattenJson(text);
      case 'toml': return flattenIniLike(text, { toml: true });
      case 'ini': return flattenIniLike(text);
      case 'xml': case 'plist': return flattenXml(text);
      case 'env': case 'shell': return flattenEnv(text);
      default: return [];
    }
  } catch { return []; }
}
