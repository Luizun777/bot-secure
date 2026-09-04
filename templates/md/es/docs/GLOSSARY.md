# Glosario — {{project}}

Lee esto cuando veas una sigla que no conoces. Siglas mexicanas primero, luego términos del workspace.

## Siglas y datos mexicanos
| Sigla | Qué es | Sensibilidad |
|---|---|---|
| RFC | Registro Federal de Contribuyentes (SAT): 12 caracteres persona moral, 13 persona física, con homoclave y dígito verificador | dato personal; nunca real |
| CURP | Clave Única de Registro de Población: 18 caracteres con dígito verificador | dato personal; nunca real |
| NSS | Número de Seguridad Social (IMSS): 11 dígitos con verificador Luhn | dato personal; nunca real |
| CLABE | Clave Bancaria Estandarizada: 18 dígitos (banco + plaza + cuenta + verificador) | dato bancario; nunca real |
| INE | Credencial para votar (clave de elector, OCR, CIC) | dato personal; nunca real |
| PAN | Número de tarjeta bancaria (13-19 dígitos, Luhn) | PCI; solo números de prueba |
| CFDI | Comprobante Fiscal Digital por Internet (factura electrónica del SAT) | contiene RFC y montos |
| SAT | Servicio de Administración Tributaria | autoridad fiscal |
| IMSS | Instituto Mexicano del Seguro Social | emite el NSS |
| Banxico | Banco de México; publica el catálogo de bancos y plazas de la CLABE | catálogo público |
| LFPDPPP | Ley Federal de Protección de Datos Personales en Posesión de los Particulares | marco legal aplicable |
| CP | Código postal (5 dígitos) | dato de dirección; catálogo público |

## Términos del workspace
| Término | Significado |
|---|---|
| Workspace de IA | Carpeta `{{project}}-ai/` con las apps saneadas y todo lo que Claude lee y lo que lo protege |
| `{{branches.ai}}` | Rama de trabajo de la IA: código idéntico a `dev`, configuración saneada. Solo la actualiza CI |
| `{{branches.taskPrefix}}*` | Ramas de tarea creadas desde `{{branches.ai}}`; van por PR a `dev` |
| Campo vacío | Regla: en `{{branches.ai}}` los campos sensibles de configuración quedan `""`; el loader de IA los resuelve desde `.env.ai` con `AI_ENV=1` |
| `.env.ai` | Único archivo con valores del ambiente de IA: placeholders y fakes. Versionado |
| Placeholder | `__AI_PLACEHOLDER__<VAR>__`: valor que el consumidor acepta como cualquier string |
| Fake | Valor falso pero válido por formato (Stripe `sk_test_…`, JWT largo, GUID nulo), marcado `# bot-secure:fake <tipo>` |
| Sintético | Datos generados (nombres, RFC, CLABE… con checksum válido pero inventados), marcados `bot-secure:synthetic` |
| BD de IA | Base de datos de pruebas en contenedor, solo en `127.0.0.1`, con datos sintéticos |
| Guarda / hook | Script que Claude Code ejecuta en cada evento; bloquea rama, secretos, egreso y lectura de sensibles |
| Baseline | Lista de hallazgos aceptados del escáner, con motivo, autor y caducidad |
| ADR | Architecture Decision Record: decisión con contexto, opciones y consecuencias (`docs/decisions/`) |
| HU | Historia de usuario: Como/quiero/para + criterios en Gherkin (`docs/user-stories/`) |
| DoD | Definition of Done: lista de cierre de una HU (incluye "sin secretos ni PII real") |
| PII | Información personal identificable |
| IdP | Proveedor de identidad (OIDC/OAuth); en IA se usa un mock local |
