---
description: Secretos y datos personales — aplica siempre, en todo el workspace de {{project}}.
---
# Seguridad de datos (siempre)

Esta regla no tiene excepciones ni depende de la carpeta. Si dudas, para y pregunta al humano.

## Nunca escribas un valor real
- Credenciales: contraseñas, API keys, tokens, client secrets, connection strings, certificados o llaves privadas.
- Identificadores mexicanos de persona: RFC, CURP, NSS, INE/clave de elector, pasaporte.
- Datos bancarios: CLABE, número de tarjeta (PAN), CVV, cuenta.
- Contacto de personas reales: correo, teléfono, dirección.
- Infraestructura de producción: hosts, IPs, buckets, nombres de servidores.

Aplica a código, tests, fixtures, docs, comentarios, mensajes de commit y a lo que escribas en el chat. Si un valor real aparece en un archivo, no lo copies ni lo repitas: nombra archivo y línea, propón la corrección y avisa al humano.

## Regla del campo vacío
- En la rama `{{branches.ai}}` los campos sensibles de la configuración versionada quedan `""`. **No los rellenes**, ni con un valor, ni con un ejemplo, ni con un placeholder.
- El loader de IA de cada app resuelve el valor desde `.env.ai` cuando `AI_ENV=1`; sin `AI_ENV` la app falla a propósito, nombrando el campo. Ese error es el comportamiento correcto.
- ¿Hace falta una credencial nueva? Añade la variable a `.env.ai` con un placeholder `__AI_PLACEHOLDER__<VAR>__` (o un fake marcado `# bot-secure:fake <tipo>` si el SDK valida el formato) y documéntala en `docs/RUNBOOK.md`.

## No leas archivos de secretos
- Prohibido leer, abrir, `cat`, `grep`, imprimir o mandar al chat: `.env`, `.env.*` (salvo `.env.ai` y `.env.example`), `*.pem`, `*.key`, `*.p12`, `*.jks`, `id_rsa*`, `~/.aws`, `~/.ssh`, `~/.kube`, `~/.docker/config.json`, credenciales de nube y dumps de base de datos.
- Tampoco los enmascares "para verlos": no se leen. Si necesitas saber qué variables existen, mira `.env.example` o `.env.ai`.
- No ejecutes `env`, `printenv`, `set` ni comandos que vuelquen el entorno del proceso.

## Datos de prueba: solo sintéticos
- Usa el seed del workspace (`bot-secure db seed`), marcado `bot-secure:synthetic`. Nunca dumps, exports ni filas de producción, aunque estén "anonimizados".
- Si escribes fixtures a mano: valores con formato válido pero inventados (RFC/CURP/CLABE/NSS con dígito verificador correcto pero de persona inexistente, correos `@ai.local`, tarjetas de prueba del proveedor).
- En logs y mensajes de error, los identificadores personales van enmascarados; nunca completos.

## Antes de un PR
Ejecuta `bot-secure scan` y `/revision-seguridad`. Un hallazgo nuevo se corrige; si es falso positivo, `bot-secure baseline add <id> --reason "…"` con revisión humana. Ver `docs/SECURITY.md` para la taxonomía completa y qué está garantizado frente a qué es best-effort.
