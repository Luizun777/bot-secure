// .claude/rules/*.md: reglas sin paths (seguridad-datos, git-ramas) y con paths por tipo de app y tests/docs.
import { artifact, renderTemplate } from './md-helpers.mjs';

/** Lista YAML en flujo con comillas simples: ['backend/**', 'apps/api/**'] */
export function yamlList(items) { return `[${items.map((s) => `'${s}'`).join(', ')}]`; }

/**
 * Genera las reglas. backend/frontend/mobile solo si hay apps de ese tipo.
 * @returns {import('./md-helpers.mjs').Artifact[]}
 */
export function generateRules(view) {
  const rule = (name, extra = {}) => artifact(['.claude', 'rules', `${name}.md`], renderTemplate('claude', `rules/${name}.md`, view, extra));
  const names = (list) => list.map((a) => a.name).join(', ');
  const paths = (list) => yamlList(list.map((a) => `${a.pathPosix}/**`));
  const out = [rule('seguridad-datos'), rule('git-ramas')];
  if (view.hasBackend) out.push(rule('backend', { rulePaths: paths(view.backends), ruleNames: names(view.backends) }));
  if (view.hasFrontend) out.push(rule('frontend', { rulePaths: paths(view.frontends), ruleNames: names(view.frontends) }));
  if (view.hasMobile) out.push(rule('mobile', { rulePaths: paths(view.mobiles), ruleNames: names(view.mobiles) }));
  const testPaths = view.apps.flatMap((a) => a.testGlobs);
  out.push(rule('tests', { rulePaths: yamlList(testPaths.length ? testPaths : ['**/*.test.*', '**/*.spec.*', '**/test/**', '**/tests/**']) }));
  out.push(rule('docs', { rulePaths: yamlList(['docs/**', '*.md']) }));
  return out;
}
