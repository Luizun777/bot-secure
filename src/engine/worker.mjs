// Worker de escaneo: aísla el pipeline de reglas para poder matarlo por timeout (defensa ReDoS).
// Protocolo: postMessage({ready:true}) al terminar de cargar → el padre arranca el reloj;
// después postMessage({ok:true, findings}) o {ok:false, error}.
import { parentPort, workerData } from 'node:worker_threads';
import { scanContent, finalize } from './rules.mjs';

async function main() {
  const { text, path = '', mode = 'guard', lang = 'es', hmacKey } = workerData ?? {};
  const raw = await scanContent(text, { path, mode, lang });
  return finalize(raw, { hmacKey: Buffer.from(hmacKey), lang });
}

if (parentPort) {
  parentPort.postMessage({ ready: true });
  main().then(
    (findings) => parentPort.postMessage({ ok: true, findings }),
    (err) => parentPort.postMessage({ ok: false, error: { key: err?.key ?? null, message: String(err?.message ?? err), fix: err?.fix ?? null } }),
  );
}
