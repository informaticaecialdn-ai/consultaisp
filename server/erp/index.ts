/**
 * ERP Connector Engine — Barrel Index
 *
 * Imports all 10 connector modules, registers those that don't self-register,
 * and re-exports the registry API + types for consumers.
 *
 * Consumers only need: import { getConnector, ErpConnectionConfig } from "../erp"
 */

// --- Import connector classes ---
// IXC, MK, SGP: export class only — need manual registration
import { IxcConnector } from "./connectors/ixc.js";
import { MkConnector } from "./connectors/mk.js";
import { SgpConnector } from "./connectors/sgp.js";
import { TopsappConnector } from "./connectors/topsapp.js";
import { RadiusnetConnector } from "./connectors/radiusnet.js";
import { GereConnector } from "./connectors/gere.js";
import { ReceitanetConnector } from "./connectors/receitanet.js";

// Hubsoft, Voalle, RBX: self-register on import (side-effect)
import "./connectors/hubsoft.js";
import "./connectors/voalle.js";
import "./connectors/rbx.js";

// --- Register connectors that don't self-register ---
import { registerConnector } from "./registry.js";

registerConnector(new IxcConnector());
registerConnector(new MkConnector());
registerConnector(new SgpConnector());
registerConnector(new TopsappConnector());
registerConnector(new RadiusnetConnector());
registerConnector(new GereConnector());
registerConnector(new ReceitanetConnector());

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

// --- Re-export rate limiter ---
export { getProviderLimiter } from "./rate-limiter.js";

// --- Re-export connector config builder ---
export { buildConnectorConfig } from "./config.js";
