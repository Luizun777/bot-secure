@AGENTS.md

## Claude Code
- IMPORTANT: este repo es el propio bot. Verifica con evidencia: tras cada cambio corre el test del archivo tocado y muestra la salida.
- Cambio multi-archivo o de contrato (`CONTRACTS.md`) → plan primero. Cambio de una frase → directo.
- Exploración amplia → subagente Explore; devuelve rutas + resumen.
- No cambies `bin/`, `src/lib/` ni `CONTRACTS.md` sin decirlo explícitamente: otros módulos dependen de ellos.

## Lecciones aprendidas
- `echo` en zsh interpreta escapes: usar `printf '%s'` o Node para volcar JSON.
- `SessionStart` de Claude Code NO bloquea; la guarda de rama vive en `UserPromptSubmit`/`PreToolUse`.

## Al compactar
- Preservar: archivos modificados, comandos de test usados, decisiones de diseño y lecciones nuevas.
