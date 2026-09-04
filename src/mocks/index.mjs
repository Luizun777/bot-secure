// Fachada del módulo de mocks: `bot-secure up` y `bot-secure down` la cargan con import dinámico.
// La implementación vive en src/generate/mocks.mjs (mismo módulo que genera los archivos).
export {
  up, down, status, mockServices, mocksNeeded, generateMocks, generateKeys, keysStatus,
  MOCK_IMAGES, KEYS_DIR, MOCKS_DIR, PORT_OF, SERVICE_OF, THROWAWAY_HEADER,
} from '../generate/mocks.mjs';
