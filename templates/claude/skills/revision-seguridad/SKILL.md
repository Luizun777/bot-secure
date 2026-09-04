---
name: revision-seguridad
description: Revisa los cambios pendientes buscando secretos, datos personales mexicanos (RFC, CURP, CLABE, NSS, tarjetas), campos sensibles rellenados y llamadas a hosts reales, antes de commitear o abrir un PR. Úsala cuando se vaya a commitear, abrir un PR o compartir código, y cuando el usuario pida una revisión de seguridad.
argument-hint: [ruta o rango de commits]
---
# Revisión de seguridad de los cambios

Puedes ejecutar esto por tu cuenta antes de un commit o un PR, o cuando te lo pidan. Es de solo lectura: reporta, no arregla sin permiso.

## Pasos
1. Delimita el alcance: `git status` y `git diff` (contra `{{branches.ai}}` o el rango indicado). Solo lo que cambió.
2. Ejecuta el escáner del bot: `bot-secure scan` (o `bot-secure scan --json` si necesitas procesarlo). Es la fuente principal.
3. Revisa a mano el diff buscando lo que el escáner no ve:
   - Credenciales: contraseñas, API keys, tokens, client secrets, connection strings, certificados o llaves privadas, incluso en comentarios, tests o docs.
   - Datos personales mexicanos reales: RFC, CURP, NSS, CLABE, INE, tarjetas (PAN/CVV), correos y teléfonos de personas.
   - **Regla del campo vacío**: un campo sensible de la configuración versionada que dejó de ser `""`. Debe volver a vacío y el valor ir a `.env.ai`.
   - Placeholders o fakes que se hayan colado hacia código de producción (`__AI_PLACEHOLDER__`, `bot-secure:fake`).
   - Hosts, IPs, buckets o endpoints de producción; llamadas de red nuevas a servicios reales.
   - Datos que parezcan de un dump real (nombres, direcciones y CURP consistentes entre sí) en fixtures o seeds.
   - Logs nuevos que impriman identificadores, cuerpos de petición o cabeceras de autorización.
4. Comprueba la rama: los commits están en `{{branches.ai}}` o `{{branches.taskPrefix}}*`, no en {{branches.protectedList}}.

## Cómo reportas
- Una tabla: archivo · línea · qué es · severidad (crítico/alto/medio) · arreglo propuesto.
- **Nunca escribas el valor encontrado**, ni completo ni "casi": di el tipo y dónde está (`.env`-style key en `<archivo>:<línea>`).
- Si hay un secreto real, además del arreglo indica que debe **rotarse**: avisar a InfoSec y `bot-secure attest --rotation-id <id>` cuando esté hecho.
- Falso positivo: propón `bot-secure baseline add <id> --reason "…"`, pero deja que lo decida el humano.
- Si no encuentras nada, dilo con la advertencia: "sin hallazgos" no es "sin secretos"; el escáner detecta patrones y entropía, no intención.
