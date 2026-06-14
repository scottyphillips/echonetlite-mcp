// ECHONETLite MCP Server Configuration

/**
 * Default home air conditioner device IP address.
 * Override via environment variable: ECHONET_DEFAULT_HOST=192.168.1.10
 */
export const DEFAULT_HOST = process.env.ECHONET_DEFAULT_HOST || '192.168.1.6';

/**
 * UDP port for ECHONETLite communication
 */
export const ECHONET_PORT = 3610;

/**
 * Multicast address for ECHONETLite discovery and notifications
 */
export const MULTICAST_ADDRESS = '224.0.23.0';

/**
 * Multicast port (same as ECHONET port)
 */
export const MULTICAST_PORT = 3610;

/**
 * pychonet default SEOJ (Service Object)
 * - Group Code: 0x05 — Service group
 * - Class Code: 0xFF — Class 1 (service class)
 * - Instance: 0x01 — First instance
 */
export const DEFAULT_SEOJ_GROUP = 0x05;
export const DEFAULT_SEOJ_CLASS = 0xFF;
export const DEFAULT_SEOJ_INSTANCE = 0x01;

/**
 * HomeAirConditioner EOJ (ECHONET Object) identifiers
 * - EOJGC (Event Object Group Code): 0x01 — Air conditioner-related device group
 * - EOJCC (Event Object Class Code): 0x30 — Home air conditioner class
 * - EOJ Instance: 0x01 — First instance
 */
export const HVAC_EOJGC = 0x01;
export const HVAC_EOJCC = 0x30;
export const HVAC_EOJ_INSTANCE = 0x01;

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT_MS = 5000;

/**
 * Multicast group membership TTL
 */
export const MULTICAST_TTL = 1;

/**
 * Number of discovery request retries
 */
export const DISCOVERY_RETRIES = 3;

/**
 * Discovery request interval in milliseconds
 */
export const DISCOVERY_INTERVAL_MS = 500;