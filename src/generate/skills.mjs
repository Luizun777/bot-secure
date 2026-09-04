// .claude/skills/<nombre>/SKILL.md: procedimientos invocables (/hu, /adr, /bootstrap-contexto, /sync-docs, /revision-seguridad).
import { artifact, renderTemplate } from './md-helpers.mjs';

/** Skills con efectos secundarios → disable-model-invocation: true. revision-seguridad la puede invocar el modelo. */
export const SKILLS = ['hu', 'adr', 'bootstrap-contexto', 'sync-docs', 'revision-seguridad'];

/** @returns {import('./md-helpers.mjs').Artifact[]} */
export function generateSkills(view) {
  return SKILLS.map((name) => artifact(['.claude', 'skills', name, 'SKILL.md'], renderTemplate('claude', `skills/${name}/SKILL.md`, view)));
}

/** Parsea el frontmatter YAML plano de un SKILL.md/agente: {clave: valor}. null si no hay frontmatter. */
export function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(String(text));
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
