// Punto de entrada del módulo generate: contexto MD (este módulo) + artefactos de entorno (módulo generate-env, opcional).
import path from 'node:path';
import { generateEnvAll } from './env-index.mjs';
import { writeGenerated } from '../lib/fsx.mjs';
import { buildView, lineCount, toPosix } from './md-helpers.mjs';
import { generateClaude, CLAUDE_MAX_LINES, APP_CLAUDE_MAX_LINES } from './claude.mjs';
import { generateAgentsMd, generateSubagents, AGENTS_MAX_LINES } from './agents.mjs';
import { generateRules } from './rules.mjs';
import { generateSkills } from './skills.mjs';
import { generateDocs } from './docs.mjs';
import { generateHu } from './hu.mjs';
import { generateAdrs } from './adr.mjs';
import { generateReadme, generateGithub } from './readme.mjs';

/** @typedef {import('./md-helpers.mjs').Artifact} Artifact */

/** Importa un módulo opcional; null si no existe o falla al cargar. */
async function optional(spec) {
  try { return await import(spec); } catch { return null; }
}

/**
 * Construye la vista, usando workspace.appMap(policy) si el módulo workspace existe.
 * @returns {Promise<ReturnType<typeof buildView>>}
 */
export async function contextView(root, policy, apps) {
  const view = buildView(root, policy, apps);
  const ws = await optional('../workspace/index.mjs');
  if (typeof ws?.appMap === 'function') {
    try { const block = ws.appMap(policy); if (typeof block === 'string' && block.trim()) view.appMap = block.trim(); } catch { /* fallback local */ }
  }
  return view;
}

/**
 * Artefactos de contexto MD (solo este módulo): AGENTS, CLAUDE (raíz y apps), README, docs/**, .claude/{rules,skills,agents}, .github/*.
 * @param {string} root raíz del workspace
 * @param {object} policy policy.json
 * @param {object[]} [apps] apps detectadas (opcional; se fusionan con policy.apps)
 * @returns {Promise<Artifact[]>}
 */
export async function generateContext(root, policy, apps) {
  const view = await contextView(root, policy, apps);
  return [
    ...generateAgentsMd(view), ...generateClaude(view), ...generateReadme(view), ...generateGithub(view),
    ...generateRules(view), ...generateSkills(view), ...generateSubagents(view),
    ...generateDocs(view), ...generateAdrs(view), ...generateHu(view),
  ];
}

/**
 * Todo lo que genera `init`: contexto MD + (si existe el módulo generate-env) .env.ai, loaders por stack, mocks, compose, CI.
 * Nunca falla por ausencia de generate-env; `warnings` indica qué se omitió.
 * @returns {Promise<Artifact[] & { warnings: string[] }>}
 */
export async function generateAll(root, policy, apps) {
  const out = await generateContext(root, policy, apps);
  const warnings = [];
  // Importación ESTÁTICA: con un import dinámico de especificador variable, esbuild no
  // puede incluir el módulo y el binario se quedaba sin los archivos de entorno (.env.ai,
  // application-ai.yml, environment.ai.ts) avisando 'generate.envSkipped'.
  try {
    const extra = await generateEnvAll(root, policy, apps);
    if (Array.isArray(extra)) out.push(...extra);
  } catch (e) { warnings.push(`generate.envFailed:${e?.message ?? e}`); }
  return Object.assign(out, { warnings });
}

/** Presupuestos de líneas por archivo (clave i18n `generate.lineBudget`). */
export function lineBudgetIssues(artifacts) {
  const issues = [];
  for (const a of artifacts) {
    const p = toPosix(a.path);
    let max = null;
    if (p === 'AGENTS.md') max = AGENTS_MAX_LINES;
    else if (p === 'CLAUDE.md') max = CLAUDE_MAX_LINES;
    else if (p.endsWith('/CLAUDE.md')) max = APP_CLAUDE_MAX_LINES;
    if (max !== null && lineCount(a.content) > max) issues.push({ path: p, max, lines: lineCount(a.content) });
  }
  return issues;
}

/**
 * Escribe artefactos de forma idempotente con writeGenerated (respeta ediciones humanas → .new).
 * @param {string} root
 * @param {Artifact[]} artifacts
 * @param {{ known?: Record<string,string>, force?: boolean }} [opts] known: path posix → sha256 de la última generación (lock.json)
 * @returns {{ results: object[], summary: {created:number, updated:number, unchanged:number, pending:number} }}
 */
export function writeArtifacts(root, artifacts, { known = {}, force = false } = {}) {
  const results = [];
  const summary = { created: 0, updated: 0, unchanged: 0, pending: 0 };
  for (const a of artifacts) {
    const rel = toPosix(a.path);
    const r = writeGenerated(path.join(root, a.path), a.content, { known: known[rel] ?? null, force });
    results.push({ ...r, rel, mode: a.mode });
    if (r.action === 'created') summary.created++;
    else if (r.action === 'updated') summary.updated++;
    else if (r.action === 'unchanged') summary.unchanged++;
    else summary.pending++;
  }
  return { results, summary };
}
