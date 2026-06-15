// ECHONETLite MCP Server Configuration

/**
 * Default home air conditioner device IP address.
 * Override via environment variable: ECHONET_DEFAULT_HOST=192.168.1.10
 */
export const DEFAULT_HOST = process.env.ECHONET_DEFAULT_HOST || '192.168.1.6';

/**
 * Enable "Lite Mode" - restricts exposed tools to a minimal subset.
 * When enabled, only the following tools are available:
 *   - discover_devices
 *   - discover_nodes
 *   - set_epc
 *   - get_property_maps
 *   - query_epc
 *   - get_epc_definition
 * 
 * Override via environment variable: ECHONET_LITE_MODE=true
 */
export const LITE_MODE = process.env.ECHONET_LITE_MODE === 'true';

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

// ============================================================================
// ECHONETLite Node Profile Class EPC Codes (for device discovery)
// ============================================================================

/**
 * These EPC codes are used in the Node Profile Class (0x0E 0xF0 xx) 
 * to discover device metadata during active discovery probes.
 * Based on pychonet ENL_* constants:
 */

/** Instance List Notification (EPC 0xD6) — Configuration of instances at startup */
export const EPC_INSTANCE_LIST = 0xd6;

/** Unique ID (EPC 0x83) - Device unique identifier */
export const EPC_UID = 0x83;

/** Name (EPC 0xFB) - Device name */
export const EPC_NAME = 0xfb;

/** Date of Manufacture (EPC 0xFA) - Manufacturing date */
export const EPC_DATE_OF_MANUFACTURE = 0xfa;

/** Manufacturer (EPC 0x8A) - Device manufacturer */
export const EPC_MANUFACTURER = 0x8a;

/** ECOI (EPC 0x8C) - Extended Class Definition (Product Code) */
export const EPC_ECOI = 0x8c;

/**
 * Node Profile Class Group/Class codes for discovery.
 * SEOJ = 0x0E (Node Profile group), ESV = 0xF0 (Response), EOC = instance
 */
export const NODE_PROFILE_GROUP = 0x0e;
export const NODE_PROFILE_CLASS = 0xf0;

/**
 * Default broadcast/multicast destination for discovery.
 * Uses the ECHONETLite default device class group (0x01 0x30 ff) 
 * and broadcast (0x01 0xff ff) for maximum reach.
 */
export const DISCOVERY_MULTICAST_ADDRESS = '224.0.23.0';
export const DISCOVERY_BROADCAST_ADDRESS = '255.255.255.255';