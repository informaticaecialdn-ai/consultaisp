/**
 * ERP Connector Engine — Connector Registry
 *
 * Dynamic registry where each ERP connector registers itself on import.
 * Connectors call registerConnector() at module load time.
 * Route handlers use getConnector() / getAllConnectors() to dispatch.
 */

import type { ErpConnector } from "./types.js";

/** Internal registry — keyed by connector name (erp source identifier) */
const connectors = new Map<string, ErpConnector>();

/** Register a connector. Called by each connector module at import time. */
export function registerConnector(connector: ErpConnector): void {
  connectors.set(connector.name, connector);
}

/** Retrieve a connector by its source name (e.g. "ixc", "mk", "hubsoft") */
export function getConnector(source: string): ErpConnector | undefined {
  return connectors.get(source);
}

/** Get all registered connectors */
export function getAllConnectors(): ErpConnector[] {
  return Array.from(connectors.values());
}

/** Get list of all registered source names */
export function getSupportedSources(): string[] {
  return Array.from(connectors.keys());
}
