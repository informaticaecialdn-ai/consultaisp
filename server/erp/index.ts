/**
 * ERP Connector Engine — Barrel Index
 *
 * Imports all connector modules, registers them, and re-exports the registry API.
 * Consumers only need: import { getConnector, ErpConnectionConfig } from "../erp"
 *
 * Duas convencoes convivem aqui: conector importado como classe e registrado
 * logo abaixo, e conector que se registra sozinho no fim do proprio arquivo
 * (importado so pelo efeito colateral). O voalle passou meses caindo entre as
 * duas — estava no grupo de baixo sem nunca chamar registerConnector(), e nada
 * acusava. Quem acusa agora e conectores-implementados.test.ts, que compara o
 * que este arquivo importa com o que o registry contem.
 */

// --- Import connector classes (manual registration) ---
import { IxcConnector } from "./connectors/ixc.js";
import { MkConnector } from "./connectors/mk.js";
import { SgpConnector } from "./connectors/sgp.js";

// --- Self-registering connectors (side-effect imports) ---
import "./connectors/hubsoft.js";
import "./connectors/voalle.js";
import "./connectors/rbx.js";
import "./connectors/topsapp.js";
import "./connectors/radiusnet.js";
import "./connectors/gere.js";
import "./connectors/receitanet.js";
// O conector de demonstracao le a propria base do Consulta ISP no lugar de um
// ERP de verdade (server/demo/mundo-base.ts semeia o mundo que ele le). Import
// incondicional, IGUAL a qualquer outro conector desta lista: so a classe e
// carregada, sem efeito colateral fora do registro. A condicao (`emModoDemo()`)
// mora DENTRO de connectors/demo.ts, na propria linha do `registerConnector` —
// nao aqui, e nao como `await import()` dinamico: um import dinamico
// condicionado no topo deste modulo exigiria top-level await, que quebra o
// esbuild `format: "cjs"` do build de producao (script/build.ts). Fora do modo
// demo, `getConnector("demo")` continua `undefined` — nenhum provedor real
// pode configurar um "ERP" que responde como se fosse o dele.
import "./connectors/demo.js";

// --- Register connectors ---
import { registerConnector } from "./registry.js";

registerConnector(new IxcConnector());
registerConnector(new MkConnector());
registerConnector(new SgpConnector());

// --- Re-export registry API ---
export { getConnector, getAllConnectors, getSupportedSources } from "./registry.js";

// --- Re-export types ---
export type {
  ErpConnector,
  ErpConnectionConfig,
  ErpTestResult,
  ErpFetchResult,
  NormalizedErpCustomer,
  ErpConfigField,
} from "./types.js";

export { ERP_CONFIG_FIELDS } from "./types.js";
export { getProviderLimiter } from "./rate-limiter.js";
export { buildConnectorConfig } from "./config.js";
