// Go: cargador mínimo en internal/aienv (sin dependencias externas).
import { aiContext, appVars, banner, docsBlock, esc, file } from './_common.mjs';

export const id = 'go-loader';

function aienvGo(c) {
  const rows = [['DATABASE_URL', c.dbUrl], ['API_URL', c.apiUrl], ['OIDC_ISSUER', c.issuer],
    ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20).map((v) => [v.name, v.value])];
  const seen = new Set();
  const uniq = rows.filter(([k]) => (seen.has(k) ? false : seen.add(k)));
  return [
    banner('//'),
    '// Package aienv carga .env.ai y aplica la regla del campo vacío.',
    'package aienv',
    '',
    'import (',
    '\t"bufio"',
    '\t"fmt"',
    '\t"os"',
    '\t"strings"',
    ')',
    '',
    '// Values son los valores del ambiente de IA (falsos pero válidos por formato).',
    'var Values = map[string]string{',
    ...uniq.map(([k, v]) => `\t"${esc(k)}": "${esc(v)}",`),
    '}',
    '',
    '// IsAIEnv indica si estamos en el ambiente de IA.',
    'func IsAIEnv() bool {',
    '\treturn os.Getenv("AI_ENV") == "1"',
    '}',
    '',
    '// Load lee .env.ai sin pisar variables que ya vengan del entorno real.',
    'func Load(path string) error {',
    '\tif !IsAIEnv() {',
    '\t\treturn nil',
    '\t}',
    '\tf, err := os.Open(path)',
    '\tif err != nil {',
    '\t\tif os.IsNotExist(err) {',
    '\t\t\treturn nil',
    '\t\t}',
    '\t\treturn err',
    '\t}',
    '\tdefer f.Close()',
    '',
    '\tsc := bufio.NewScanner(f)',
    '\tfor sc.Scan() {',
    '\t\tline := strings.TrimSpace(sc.Text())',
    '\t\tif line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {',
    '\t\t\tcontinue',
    '\t\t}',
    '\t\tparts := strings.SplitN(line, "=", 2)',
    '\t\tname := strings.TrimSpace(parts[0])',
    '\t\tvalue := strings.TrimSpace(strings.SplitN(parts[1], " #", 2)[0])',
    '\t\tvalue = strings.Trim(value, "\\"\'")',
    '\t\tif _, ok := os.LookupEnv(name); !ok {',
    '\t\t\tif err := os.Setenv(name, value); err != nil {',
    '\t\t\t\treturn err',
    '\t\t\t}',
    '\t\t}',
    '\t}',
    '\treturn sc.Err()',
    '}',
    '',
    '// Get aplica la regla del campo vacío: vacío + AI_ENV → valor de IA; vacío sin AI_ENV → error claro.',
    'func Get(name, current string) (string, error) {',
    '\tif current != "" {',
    '\t\treturn current, nil',
    '\t}',
    '\tif v := os.Getenv(name); v != "" {',
    '\t\treturn v, nil',
    '\t}',
    '\tif IsAIEnv() {',
    '\t\tif v, ok := Values[name]; ok {',
    '\t\t\treturn v, nil',
    '\t\t}',
    '\t}',
    '\treturn "", fmt.Errorf(',
    '\t\t"[bot-secure] falta %s: en el ambiente de IA viene de .env.ai (AI_ENV=1 go run .); en dev/qa/prd, del entorno",',
    '\t\tname,',
    '\t)',
    '}',
    '',
  ].join('\n');
}

export function runCmdAi() { return 'AI_ENV=1 go run .'; }

export function loaderSnippet() {
  return {
    file: 'main.go',
    lang: 'go',
    code: ['import "yourmodule/internal/aienv"', '', 'if err := aienv.Load(".env.ai"); err != nil {', '\tlog.Fatal(err)', '}', 'dsn, err := aienv.Get("DATABASE_URL", cfg.DatabaseURL)'].join('\n'),
  };
}

export function files(app, policy, ctx = {}) {
  return [file(app, 'internal/aienv/aienv.go', aienvGo(aiContext(app, policy, ctx)))];
}

export function docs(app) {
  return docsBlock({
    title: `Go (${app?.name ?? 'backend'})`,
    runCmd: 'AI_ENV=1 go run .',
    files: ['.env.ai', 'internal/aienv/aienv.go'],
    notes: ['Sin dependencias externas: solo la librería estándar.', 'El cargador nunca pisa una variable del entorno real (`os.LookupEnv`).'],
    snippet: loaderSnippet(app),
  });
}

export default { id, files, loaderSnippet, runCmdAi, docs };
