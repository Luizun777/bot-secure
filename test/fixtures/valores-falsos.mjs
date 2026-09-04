// Valores INVENTADOS con la misma forma que una credencial real.
// Se arman desde trozos y no se guardan literales en el repositorio: cualquier detector
// (el nuestro, el de GitHub, el de la empresa) los confundiría con credenciales de verdad,
// y este proyecto no puede pedir a los demás algo que él mismo no cumple.
// Ninguno de estos valores pertenece a nadie ni sirve para autenticarse en ningún sitio.
const F = 'FAKE0000';
const hex32 = 'abcdef0123456789'.repeat(2);
const j = (...p) => p.join('');

export const FALSOS = {
  aws: j('AKIA', '4KJQ2ZLMNPQR7TWX'),
  awsSecret: j('wJalrXUtnFEMI', '/K7MDENG/bPxRfiCY', 'AIPLACEHOLDER'),
  stripeLive: j('sk', '_live_', F, F, F),
  stripeWebhook: j('whsec', '_', F, F, F, F),
  slackBot: j('xox', 'b-1234567890123-1234567890123-', F, F),
  slackHook: j('https://hooks.slack.com/', 'services/T0000FAKE/B0000FAKE/', F, F, F),
  mailgun: j('key', '-', hex32),
  twilioKey: j('S', 'K', hex32),
  twilioSid: j('A', 'C', hex32),
  sendgrid: j('SG', '.', 'FAKE0000FAKE0000FAKE00', '.', F, F, F, F, F, 'FAK'),
  gitlab: j('glpat', '-', F, F, 'FAKE'),
  npm: j('npm', '_', F, F, F, F, 'FAKE'),
  google: j('AIza', F, F, F, F, 'FAK'),
  anthropic: j('sk', '-ant-api03-', F, F, F, F),
  openai: j('sk', '-proj-', F, F, F, F, F, F),
  huggingface: j('hf', '_', 'abcdefghijklmnopqrstuvwxyzABCDEFGH'),
  githubPat: j('ghp', '_', 'FAKE0000FAKE0000FAKE0000FAKE0000FAKE'),
  pemInicio: j('-----BEGIN ', 'RSA PRIVATE KEY', '-----'),
  claveProduccion: j('Pr0d', '-P4ss-', '2026'),
};

/** Contenido de los ficheros de prueba que no pueden guardarse en el repositorio. */
export const FICHEROS_GENERADOS = {
  'ia-mail.txt': `MAILGUN=${FALSOS.mailgun}\nOPENAI=${FALSOS.openai}\nANTHROPIC=${FALSOS.anthropic}${F.repeat(7)}FAKE0AA\n`,
  'slack.txt': `SLACK_BOT=${FALSOS.slackBot}\nhook: ${FALSOS.slackHook}\n`,
  'twilio-sendgrid.txt': `TWILIO_API_KEY=${FALSOS.twilioKey}\nSENDGRID=${FALSOS.sendgrid}\n`,
  'gitlab-npm.txt': `GITLAB=${FALSOS.gitlab}\n//registry.npmjs.org/:_authToken=${FALSOS.npm}\n`,
  'stripe.js': `const stripe = require("stripe")("${FALSOS.stripeLive}");\nconst endpointSecret = "${FALSOS.stripeWebhook}";\n`,
};
