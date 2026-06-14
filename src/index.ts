// ECHONETLite MCP Server
// Main entry point - creates the MCP server with tools and resources for HVAC control

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { EchonetLiteClient } from './echonetlite.js';
import { HomeAirConditioner } from './devices/homeAirConditioner.js';
import { DEFAULT_HOST, HVAC_EOJGC, HVAC_EOJCC, HVAC_EOJ_INSTANCE } from './config.js';
import type { HvacStatus, DiscoveredDevice, Eoj, NodeProfileData, DiscoveredDeviceFull } from './types.js';
import { loadMraData, buildEojKey, getEojName, decodeEpcValue, getPropertyInfo, getRawMraPropertyData, loadDefinitions, resolveRef } from './mra.js';

// ============================================================================
// Global State
// ============================================================================

const client = new EchonetLiteClient();
let hvac: HomeAirConditioner | null = null;
let cachedStatus: HvacStatus | null = null;

// ============================================================================
// MCP Server Definition
// ============================================================================

const server = new McpServer({
  name: 'echonetlite-mcp',
  version: '1.0.0',
});

// ============================================================================
// Tool Definitions
// ============================================================================

/** Discover all ECHONETLite devices on the network */
server.registerTool(
  'discover_devices',
  {
    description: 'Discover all ECHONETLite devices on the local network via multicast',
    inputSchema: {
      timeout: z.number().optional().describe('Discovery timeout in milliseconds (default: 3000)'),
    },
  },
  async ({ timeout }) => {
    try {
      const devices = await client.discoverDevices(timeout || 3000);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(devices.map(d => ({
            host: d.host,
            eojgc: `0x${d.eoj.groupCode.toString(16)}`,
            eojcc: `0x${d.eoj.classCode.toString(16)}`,
            eojInstance: `0x${d.eoj.instanceId.toString(16)}`,
          })), null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Discovery failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/**
 * Discover nodes on a specific device by IP address using active Node Profile probing.
 * 
 * Based on pychonet's discover() logic from the MRA test harness (MoekadenRoom):
 * https://github.com/SonyCSL/MoekadenRoom
 * 
 * DISCOVERY PACKET:
 * - Targets the Node Profile Class (0x0E 0xF0 0x01) which every ECHONETLite device implements
 * - Requests these EPCs per pychonet ENL_* constants:
 *   - 0x8A (ENL_MANUFACTURER): Device manufacturer info
 *   - 0x8C (ENL_ECOI/PRODUCT_CODE): Product code / Extended Class Definition
 *   - 0x83 (ENL_UID): Unique device identifier  
 *   - 0xD6 (INSTANCE_LIST): All instance classes on the device
 * 
 * RESPONSE PROCESSING:
 * - Responses come as Node Profile Class Response (SEOJGC=0x0E, SEOJCC=0xF0)
 * - Each response contains EPC/EDT pairs with discovered data
 * - INSTANCE_LIST is parsed to extract all EOJ instances on the device
 * - This enables discovery of complex devices with multiple device classes
 * 
 * The instance list is enriched with MRA device definitions from mra/mraData/devices,
 * including class names (EN/JA), short names, and property definitions.
 */
server.registerTool(
  'discover_nodes',
  {
    description: 'Discover all ECHONETLite nodes on a specific device by IP address using active Node Profile probing. Sends GET requests for manufacturer, product code, UID, and instance list to the Node Profile Class (0x0E 0xF0). Returns full device profile including all EOJ instances enriched with MRA device definitions (class names, short names, property definitions). Based on pychonet discover() logic.',
    inputSchema: {
      host: z.string().describe('IP address of the device to discover (e.g., "192.168.1.234")'),
      timeout: z.number().optional().describe('Discovery timeout in milliseconds (default: 5000)'),
    },
  },
  async ({ host, timeout }) => {
    try {
      const targetHost = host;
      const discoveryTimeout = timeout || 5000;
      
      // Perform active Node Profile discovery per pychonet logic
      const device: DiscoveredDeviceFull = await client.discoverDevice(targetHost, discoveryTimeout);
      
      // Load MRA data for enriching instance information
      const mraData = loadMraData();
      
      // Format the result for readability with enriched instance data
      const formattedResult = {
        host: device.host,
        discoveryMethod: device.discoveryMethod,
        timestamp: device.timestamp.toISOString(),
        nodeProfile: device.nodeProfile ? {
          manufacturer: device.nodeProfile.manufacturer 
            ? `0x${Array.from(device.nodeProfile.manufacturer).map(b => b.toString(16).padStart(2, '0')).join(' ')}`
            : undefined,
          productCode: device.nodeProfile.productCode
            ? `0x${Array.from(device.nodeProfile.productCode).map(b => b.toString(16).padStart(2, '0')).join(' ')}`
            : undefined,
          uid: device.nodeProfile.uid
            ? `0x${Array.from(device.nodeProfile.uid).map(b => b.toString(16).padStart(2, '0')).join(' ')}`
            : undefined,
          name: device.nodeProfile.name
            ? decodeUtf8Bytes(device.nodeProfile.name)
            : undefined,
          dateOfManufacture: device.nodeProfile.dateOfManufacture
            ? `0x${Array.from(device.nodeProfile.dateOfManufacture).map(b => b.toString(16).padStart(2, '0')).join(' ')}`
            : undefined,
          instanceList: device.nodeProfile.instanceList
            ? `0x${Array.from(device.nodeProfile.instanceList).map(b => b.toString(16).padStart(2, '0')).join(' ')}`
            : undefined,
        } : undefined,
        eojInstances: device.eojInstances.map(e => {
          // Build EOJ key from group code and class code
          const eojKey = buildEojKey(e.groupCode, e.classCode);
          
          // Look up MRA definition for this EOJ
          const mraEntry = mraData.get(eojKey);
          
          const enrichedInstance: any = {
            groupCode: `0x${e.groupCode.toString(16).toUpperCase()}`,
            classCode: `0x${e.classCode.toString(16).toUpperCase()}`,
            instanceId: `0x${e.instanceId.toString(16).toUpperCase()}`,
            isPrimary: e.isPrimary,
          };
          
          // Add MRA definition names if available
          if (mraEntry) {
            enrichedInstance.className = mraEntry.eoJName;
            enrichedInstance.shortName = mraEntry.shortName;
          } else {
            enrichedInstance.className = `Unknown (${eojKey})`;
          }
          
          return enrichedInstance;
        }),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(formattedResult, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Device discovery failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/**
 * Helper function to decode UTF-8 bytes from Node Profile name data.
 */
function decodeUtf8Bytes(bytes: Uint8Array): string {
  try {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
  } catch {
    // Fallback: manual ASCII/UTF-8 decoding
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      if (byte < 0x80) {
        result += String.fromCharCode(byte);
      } else if (byte >= 0xc0 && byte < 0xe0) {
        // 2-byte sequence
        if (i + 1 < bytes.length) {
          result += String.fromCharCode(
            ((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f)
          );
          i++;
        }
      } else if (byte >= 0xe0 && byte < 0xf0) {
        // 3-byte sequence
        if (i + 2 < bytes.length) {
          result += String.fromCharCode(
            ((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
          );
          i += 2;
        }
      }
    }
    return result;
  }
}

/** Get full status of the HVAC device */
server.registerTool(
  'get_device_status',
  {
    description: 'Get full status of the home air conditioner device',
    inputSchema: {
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
    },
  },
  async ({ host }) => {
    try {
      const targetHost = host || DEFAULT_HOST;
      const tempHvac = new HomeAirConditioner(client, targetHost);
      const status = await tempHvac.getFullStatus();
      cachedStatus = status;

      // Operation status is already converted to "ON"/"OFF" by HomeAirConditioner
      const formatted = { ...status };

      return {
        content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to get status: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Turn HVAC on or off */
server.registerTool(
  'set_operation',
  {
    description: 'Turn the home air conditioner ON or OFF',
    inputSchema: {
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
      operation: z.enum(['on', 'off']).describe('Operation: "on" or "off"'),
    },
  },
  async ({ host, operation }) => {
    try {
      const targetHost = host || DEFAULT_HOST;
      const tempHvac = new HomeAirConditioner(client, targetHost);
      await tempHvac.setOperation(operation === 'on');

      // Refresh cached status
      cachedStatus = await tempHvac.getFullStatus();

      return {
        content: [{ type: 'text', text: `HVAC operation set to ${operation.toUpperCase()}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to set operation: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Set EPC on any EOJ instance (generic, instance-type agnostic) */
server.registerTool(
  'set_epc',
  {
    description: 'Set an EPC (EPC Property Code) value on any ECHONETLite device node. This is a generic tool that works with any EOJ (ECHONET Object) instance regardless of device type. Specify the target EOJ by group code, class code, and instance ID, then provide the EPC code and value as hex bytes. Example: set operating mode (0xB0) to "heat" (0x31) on a HVAC (0x01 0x30 0x01).',
    inputSchema: {
      host: z.string().describe('IP address of the device'),
      eojgc: z.string().describe('EOJ Group Code in hex (e.g., "0x01" for HVAC)'),
      eojcc: z.string().describe('EOJ Class Code in hex (e.g., "0x30" for home air conditioner)'),
      eojInstance: z.string().optional().describe('EOJ Instance ID in hex (default: "0x01")'),
      epc: z.string().describe('EPC code in hex (e.g., "0xB0" for operating mode)'),
      value: z.string().describe('Value to set as hex bytes (e.g., "31" for heat, "41" for auto). Multiple bytes can be concatenated (e.g., "0032" for a 2-byte value).'),
    },
  },
  async ({ host, eojgc, eojcc, eojInstance, epc, value }) => {
    try {
      // Parse EOJ components from hex strings
      const destinationEoj: Eoj = {
        groupCode: parseInt(eojgc.replace('0x', ''), 16),
        classCode: parseInt(eojcc.replace('0x', ''), 16),
        instanceId: eojInstance ? parseInt(eojInstance.replace('0x', ''), 16) : 0x01,
      };

      // Parse EPC code from hex string
      const epcNum = parseInt(epc.replace('0x', ''), 16);
      if (isNaN(epcNum)) {
        return {
          content: [{ type: 'text', text: `Invalid EPC code: ${epc}` }],
          isError: true,
        };
      }

      // Parse value hex string to Uint8Array
      const valueHex = value.replace('0x', '');
      if (valueHex.length === 0) {
        return {
          content: [{ type: 'text', text: `Empty value provided` }],
          isError: true,
        };
      }

      if (valueHex.length % 2 !== 0) {
        return {
          content: [{ type: 'text', text: `Value hex string must have even length (byte-aligned): ${value}` }],
          isError: true,
        };
      }

      const pvBytes: number[] = [];
      for (let i = 0; i < valueHex.length; i += 2) {
        const byteVal = parseInt(valueHex.substring(i, i + 2), 16);
        if (isNaN(byteVal)) {
          return {
            content: [{ type: 'text', text: `Invalid hex byte at position ${i}: ${value}` }],
            isError: true,
          };
        }
        pvBytes.push(byteVal);
      }

      // Send the SET request to the device
      await client.set(host, [{ epc: epcNum, pv: new Uint8Array(pvBytes) }], destinationEoj);

      return {
        content: [{ 
          type: 'text', 
          text: JSON.stringify({
            status: 'success',
            message: `EPC 0x${epcNum.toString(16).toUpperCase()} set to ${value} on EOJ 0x${destinationEoj.groupCode.toString(16).toUpperCase()} 0x${destinationEoj.classCode.toString(16).toUpperCase()} 0x${destinationEoj.instanceId.toString(16).toUpperCase()}`,
            details: {
              host,
              eoj: destinationEoj,
              epc: `0x${epcNum.toString(16).toUpperCase()}`,
              value: value,
              rawBytes: pvBytes.map(b => `0x${b.toString(16).padStart(2, '0').toUpperCase()}`).join(' '),
            }
          }, null, 2) 
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to set EPC: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Set operating mode */
server.registerTool(
  'set_operating_mode',
  {
    description: 'Set the HVAC operating mode (auto, cool, heat, dry, fan_only)',
    inputSchema: {
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
      mode: z.enum(['auto', 'cool', 'heat', 'dry', 'fan_only']).describe('Operating mode'),
    },
  },
  async ({ host, mode }) => {
    try {
      const targetHost = host || DEFAULT_HOST;
      const tempHvac = new HomeAirConditioner(client, targetHost);
      await tempHvac.setOperatingMode(mode);

      cachedStatus = await tempHvac.getFullStatus();

      return {
        content: [{ type: 'text', text: `HVAC mode set to ${mode}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to set mode: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Set target temperature */
server.registerTool(
  'set_temperature',
  {
    description: 'Set the target temperature (0-50°C)',
    inputSchema: {
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
      temperature: z.number().min(0).max(50).describe('Target temperature in °C (0-50)'),
    },
  },
  async ({ host, temperature }) => {
    try {
      const targetHost = host || DEFAULT_HOST;
      const tempHvac = new HomeAirConditioner(client, targetHost);
      await tempHvac.setTemperature(temperature);

      cachedStatus = await tempHvac.getFullStatus();

      return {
        content: [{ type: 'text', text: `Temperature set to ${temperature}°C` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to set temperature: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Set fan speed */
server.registerTool(
  'set_fan_speed',
  {
    description: 'Set the air flow rate (fan speed)',
    inputSchema: {
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
      speed: z.enum(['auto', 'level1', 'level2', 'level3', 'level4', 'level5', 'level6', 'level7', 'level8']).describe('Fan speed'),
    },
  },
  async ({ host, speed }) => {
    try {
      const targetHost = host || DEFAULT_HOST;
      const tempHvac = new HomeAirConditioner(client, targetHost);
      await tempHvac.setFanSpeed(speed);

      cachedStatus = await tempHvac.getFullStatus();

      return {
        content: [{ type: 'text', text: `Fan speed set to ${speed}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to set fan speed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Set vertical airflow position */
server.registerTool(
  'set_airflow_vertical',
  {
    description: 'Set the vertical vane/airflow position',
    inputSchema: {
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
      position: z.enum(['upper', 'upper-central', 'central', 'lower-central', 'lower']).describe('Vertical position'),
    },
  },
  async ({ host, position }) => {
    try {
      const targetHost = host || DEFAULT_HOST;
      const tempHvac = new HomeAirConditioner(client, targetHost);
      await tempHvac.setAirflowVertical(position);

      cachedStatus = await tempHvac.getFullStatus();

      return {
        content: [{ type: 'text', text: `Vertical airflow set to ${position}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to set vertical airflow: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Set horizontal airflow position */
server.registerTool(
  'set_airflow_horizontal',
  {
    description: 'Set the horizontal vane/airflow position (28 positions available)',
    inputSchema: {
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
      position: z.enum(['rc-right', 'left-lc', 'lc-center-rc', 'left-lc-rc-right', 'right', 'rc', 'center', 'center-right', 'center-rc', 'center-rc-right', 'lc', 'lc-right', 'lc-rc', 'lc-rc-right', 'lc-center', 'lc-center-right', 'lc-center-rc-right', 'left', 'left-right', 'left-rc', 'left-rc-right', 'left-center', 'left-center-right', 'left-center-rc', 'left-center-rc-right', 'left-lc-right', 'left-lc-rc']).describe('Horizontal position'),
    },
  },
  async ({ host, position }) => {
    try {
      const targetHost = host || DEFAULT_HOST;
      const tempHvac = new HomeAirConditioner(client, targetHost);
      await tempHvac.setAirflowHorizontal(position);

      cachedStatus = await tempHvac.getFullStatus();

      return {
        content: [{ type: 'text', text: `Horizontal airflow set to ${position}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to set horizontal airflow: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Set swing mode */
server.registerTool(
  'set_swing_mode',
  {
    description: 'Set the air swing/swing mode function',
    inputSchema: {
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
      mode: z.enum(['not-used', 'vert', 'horiz', 'vert-horiz']).describe('Swing mode'),
    },
  },
  async ({ host, mode }) => {
    try {
      const targetHost = host || DEFAULT_HOST;
      const tempHvac = new HomeAirConditioner(client, targetHost);
      await tempHvac.setSwingMode(mode);

      cachedStatus = await tempHvac.getFullStatus();

      return {
        content: [{ type: 'text', text: `Swing mode set to ${mode}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to set swing mode: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Set automatic direction mode */
server.registerTool(
  'set_auto_direction',
  {
    description: 'Set the automatic airflow direction mode',
    inputSchema: {
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
      mode: z.enum(['auto', 'non-auto', 'auto-vert', 'auto-horiz']).describe('Auto direction mode'),
    },
  },
  async ({ host, mode }) => {
    try {
      const targetHost = host || DEFAULT_HOST;
      const tempHvac = new HomeAirConditioner(client, targetHost);
      await tempHvac.setAutoDirection(mode);

      cachedStatus = await tempHvac.getFullStatus();

      return {
        content: [{ type: 'text', text: `Auto direction set to ${mode}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to set auto direction: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Set silent mode */
server.registerTool(
  'set_silent_mode',
  {
    description: 'Set the silent operation mode',
    inputSchema: {
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
      mode: z.enum(['normal', 'high-speed', 'silent']).describe('Silent mode'),
    },
  },
  async ({ host, mode }) => {
    try {
      const targetHost = host || DEFAULT_HOST;
      const tempHvac = new HomeAirConditioner(client, targetHost);
      await tempHvac.setSilentMode(mode);

      cachedStatus = await tempHvac.getFullStatus();

      return {
        content: [{ type: 'text', text: `Silent mode set to ${mode}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to set silent mode: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Set power-saving mode */
server.registerTool(
  'set_power_saving',
  {
    description: 'Set the power-saving operation mode',
    inputSchema: {
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
      state: z.enum(['saving', 'normal']).describe('Power saving state'),
    },
  },
  async ({ host, state }) => {
    try {
      const targetHost = host || DEFAULT_HOST;
      const tempHvac = new HomeAirConditioner(client, targetHost);
      await tempHvac.setPowerSaving(state);

      cachedStatus = await tempHvac.getFullStatus();

      return {
        content: [{ type: 'text', text: `Power saving set to ${state}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to set power saving: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Get room and outdoor temperatures */
server.registerTool(
  'get_temperatures',
  {
    description: 'Get both room temperature and outdoor temperature readings',
    inputSchema: {
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
    },
  },
  async ({ host }) => {
    try {
      const targetHost = host || DEFAULT_HOST;
      const tempHvac = new HomeAirConditioner(client, targetHost);
      const temps = await tempHvac.getTemperatures();

      return {
        content: [{ type: 'text', text: JSON.stringify({ room: temps.room, outdoor: temps.outdoor }, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to get temperatures: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Get room humidity */
server.registerTool(
  'get_humidity',
  {
    description: 'Get the current room relative humidity reading',
    inputSchema: {
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
    },
  },
  async ({ host }) => {
    try {
      const targetHost = host || DEFAULT_HOST;
      const tempHvac = new HomeAirConditioner(client, targetHost);
      const humidity = await tempHvac.getHumidity();

      return {
        content: [{ type: 'text', text: JSON.stringify({ humidity }, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to get humidity: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ============================================================================
/** Query all property maps (STATMAP, SETMAP, GETMAP) of an ECHONETLite object */
server.registerTool(
  'get_property_maps',
  {
    description: 'Query all property maps (STATMAP/SETMAP/GETMAP) of an ECHONETLite object using standardized EPCs 0x9D, 0x9E, 0x9F. Returns the access capability map (STATMAP), settable properties (SETMAP), and readable properties (GETMAP) with MRA-based property names and descriptions.',
    inputSchema: {
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
      eojgc: z.string().optional().describe('EOJ Group Code in hex (e.g., "0x01")'),
      eojcc: z.string().optional().describe('EOJ Class Code in hex (e.g., "0x30")'),
      eojInstance: z.string().optional().describe('EOJ Instance ID in hex (e.g., "0x01")'),
    },
  },
  async ({ host, eojgc, eojcc, eojInstance }) => {
    try {
      const targetHost = host || DEFAULT_HOST;
      
      // Parse EOJ from hex strings or use default HVAC EOJ
      const destinationEoj: Eoj = {
        groupCode: eojgc ? parseInt(eojgc.replace('0x', ''), 16) : 0x01,
        classCode: eojcc ? parseInt(eojcc.replace('0x', ''), 16) : 0x30,
        instanceId: eojInstance ? parseInt(eojInstance.replace('0x', ''), 16) : 0x01,
      };

      const result = await client.getAllPropertyMaps(targetHost, destinationEoj);
      
      // Build EOJ key for MRA lookup
      const eojKey = buildEojKey(destinationEoj.groupCode, destinationEoj.classCode);
      const eoJName = getEojName(eojKey);

      /**
       * Parse SETMAP/GETMAP bitmap data using pychonet's _009X format.
       * Each byte (after the first) represents 8 EPCs as bit flags:
       * - Byte at index i (code = i-1): bit j → EPC = (j + 8) * 16 + code
       */
      const parsePropertyMap = (epcDataItem: { epc: number; pv: Uint8Array }): { epc: string; epcNum: number; name?: string; shortName?: string; description?: string }[] => {
        if (epcDataItem.pv.length === 0) return [];
        const bytes = Array.from(epcDataItem.pv);
        const props: { epc: string; epcNum: number; name?: string; shortName?: string; description?: string }[] = [];

        // Load MRA lookup for this EOJ once (shared by all EPCs)
        const mraCache = loadMraData();
        const mraLookup = mraCache.get(eojKey);

        if (bytes.length < 17) {
          // Short format: each byte after index 0 is a direct EPC code
          for (let i = 1; i < bytes.length; i++) {
            const epcNum = bytes[i];
            const epcHex = `0x${epcNum.toString(16).toUpperCase()}`;
            
            // Enrich with MRA property info if available
            let propInfo: { name: string; shortName: string; accessRule: any; description?: string } | undefined;
            if (mraLookup) {
              propInfo = mraLookup.properties.get(epcNum);
            }

            props.push({ 
              epc: epcHex, 
              epcNum,
              name: propInfo?.name || undefined,
              shortName: propInfo?.shortName || undefined,
              description: propInfo?.description || undefined,
            });
          }
        } else {
          // Bitmap format (_009X): each byte encodes 8 EPCs
          for (let i = 1; i < bytes.length; i++) {
            const code = i - 1;
            const byteVal = bytes[i];
            for (let j = 0; j < 8; j++) {
              if (byteVal & (1 << j)) {
                const epcNum = (j + 8) * 16 + code;
                const epcHex = `0x${epcNum.toString(16).toUpperCase()}`;
                
                // Enrich with MRA property info if available
                let propInfo: { name: string; shortName: string; accessRule: any; description?: string } | undefined;
                if (mraLookup) {
                  propInfo = mraLookup.properties.get(epcNum);
                }

                props.push({ 
                  epc: epcHex, 
                  epcNum,
                  name: propInfo?.name || undefined,
                  shortName: propInfo?.shortName || undefined,
                  description: propInfo?.description || undefined,
                });
              }
            }
          }
        }

        return props;
      };

      // Extract each map by EPC code (0x9d=STATMAP, 0x9e=SETMAP, 0x9f=GETMAP)
      const statmapData = result.find(r => r.epc === 0x9d);
      const setmapData = result.find(r => r.epc === 0x9e);
      const getmapData = result.find(r => r.epc === 0x9f);

      return {
        content: [{ type: 'text', text: JSON.stringify({ 
          eoJ: destinationEoj, 
          eoJName,
          statmap: parsePropertyMap(statmapData || { epc: 0x9d, pv: new Uint8Array([]) }),
          setmap: parsePropertyMap(setmapData || { epc: 0x9e, pv: new Uint8Array([]) }),
          getmap: parsePropertyMap(getmapData || { epc: 0x9f, pv: new Uint8Array([]) }),
          description: 'STATMAP(0x9D)=access capability, SETMAP(0x9E)=settable props, GETMAP(0x9F)=readable props. Properties include MRA-based names and decoded values where possible.'
        }, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Property maps query failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Query one or more EPC codes from device and return raw + human-readable values */
server.registerTool(
  'query_epc',
  {
    description: 'Query one or more EPC (EPC Property Code) codes from an actual ECHONETLite device and return the current raw value and human-readable decoded value. Sends a GET request to the device with all requested EPCs, receives the actual values, then decodes each using MRA enrichment data. Returns property name, short name, description, access rules, decoded human-readable value, and raw hex value for each EPC.',
    inputSchema: {
      epcs: z.array(z.string()).describe('EPC codes in hex format (e.g., ["0xBB", "0xB3"] for temperatures, ["0x80"] for operation status). Supports multiple EPCs in a single query.'),
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
      eojgc: z.string().optional().describe('EOJ Group Code in hex (e.g., "0x01") (default: 0x01 for HVAC)'),
      eojcc: z.string().optional().describe('EOJ Class Code in hex (e.g., "0x30") (default: 0x30 for home air conditioner)'),
      eojInstance: z.string().optional().describe('EOJ Instance ID in hex (e.g., "0x01") (default: 0x01)'),
    },
  },
  async ({ epcs, host, eojgc, eojcc, eojInstance }) => {
    try {
      const targetHost = host || DEFAULT_HOST;

      // Parse EPCs from hex strings and validate
      const epcNums: number[] = [];
      const invalidEpcs: string[] = [];
      for (const epc of epcs) {
        const epcNum = parseInt(epc.replace('0x', ''), 16);
        if (isNaN(epcNum)) {
          invalidEpcs.push(epc);
        } else {
          epcNums.push(epcNum);
        }
      }

      if (invalidEpcs.length > 0) {
        return {
          content: [{ type: 'text', text: `Invalid EPC codes: ${invalidEpcs.join(', ')}` }],
          isError: true,
        };
      }

      // Parse EOJ components or use default HVAC
      const gc = eojgc ? parseInt(eojgc.replace('0x', ''), 16) : 0x01;
      const cc = eojcc ? parseInt(eojcc.replace('0x', ''), 16) : 0x30;
      const inst = eojInstance ? parseInt(eojInstance.replace('0x', ''), 16) : 0x01;
      const eojKey = buildEojKey(gc, cc);
      
      const destinationEoj: Eoj = {
        groupCode: gc,
        classCode: cc,
        instanceId: inst,
      };

      // Query the actual device for all EPC values in one request
      const epcData = await client.get(targetHost, epcNums, destinationEoj);
      
      if (!epcData || epcData.length === 0) {
        return {
          content: [{ type: 'text', text: `No response from device for EPCs: ${epcs.join(', ')}` }],
          isError: true,
        };
      }

      // Build results for each requested EPC
      const results = epcNums.map((epcNum) => {
        // Find the response for this EPC
        const responseData = epcData.find(d => d.epc === epcNum);
        
        if (!responseData) {
          return {
            epc: `0x${epcNum.toString(16).toUpperCase()}`,
            error: 'No response from device',
          };
        }

        const pv = responseData.pv; // The actual value bytes from device

        // Get property info from MRA
        const propInfo = getPropertyInfo(eojKey, epcNum);
        
        if (!propInfo) {
          return {
            epc: `0x${epcNum.toString(16).toUpperCase()}`,
            error: `EPC not found in MRA for EOJ ${eojKey}`,
            eoJName: getEojName(eojKey),
            deviceResponse: {
              accessCapability: responseData.ac ? `0x${responseData.ac.toString(16).toUpperCase()}` : 'unknown',
              rawValue: Array.from(pv).map(b => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`).join(' '),
            }
          };
        }

        // Decode the value using MRA as source of truth
        let humanReadableValue = '(decode failed)';
        let rawHexValue = '';
        
        if (pv && pv.length > 0) {
          const decoded = decodeEpcValue(epcNum, pv, eojKey);
          if (decoded) {
            humanReadableValue = decoded.humanReadableValue;
            rawHexValue = decoded.rawValue;
          } else {
            rawHexValue = Array.from(pv).map(b => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`).join(' ');
          }
        }

        return {
          epc: `0x${epcNum.toString(16).toUpperCase()}`,
          propertyName: propInfo.name,
          shortName: propInfo.shortName,
          description: propInfo.description,
          accessRule: propInfo.accessRule,
          value: {
            rawHex: rawHexValue || '(no data)',
            humanReadable: humanReadableValue,
            accessCapability: responseData.ac ? `0x${responseData.ac.toString(16).toUpperCase()}` : 'unknown',
          },
        };
      });

      const output = {
        device: {
          host: targetHost,
          eoj: destinationEoj,
          eojKey: eojKey,
          eoJName: getEojName(eojKey),
        },
        requestedEpcs: epcs,
        results,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `EPC query failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Get EPC definition from MRA - returns property metadata and full definition with all possible values/settings */
server.registerTool(
  'get_epc_definition',
  {
    description: 'Get the ECHONETLite MRA (Machine Readable Index) definition for one or more EPC codes without querying the device. Returns property name, short name, description, access rules (GET/SET/INF capabilities), and the full MRA definition data including all possible enum values, bitmaps, level ranges, number formats, units, and $ref-resolved definitions. Useful for discovering what settings are available for a given EPC.',
    inputSchema: {
      epcs: z.array(z.string()).describe('EPC codes in hex format (e.g., ["0xB0"] for operating mode, ["0xA0"] for air flow rate). Supports multiple EPCs.'),
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST}) - used to determine EOJ type`),
      eojgc: z.string().optional().describe('EOJ Group Code in hex (e.g., "0x01") (default: 0x01 for HVAC)'),
      eojcc: z.string().optional().describe('EOJ Class Code in hex (e.g., "0x30") (default: 0x30 for home air conditioner)'),
      eojInstance: z.string().optional().describe('EOJ Instance ID in hex (e.g., "0x01") (default: 0x01)'),
    },
  },
  async ({ epcs, host, eojgc, eojcc, eojInstance }) => {
    try {
      const targetHost = host || DEFAULT_HOST;

      // Parse EPCs from hex strings and validate
      const epcNums: number[] = [];
      const invalidEpcs: string[] = [];
      for (const epc of epcs) {
        const epcNum = parseInt(epc.replace('0x', ''), 16);
        if (isNaN(epcNum)) {
          invalidEpcs.push(epc);
        } else {
          epcNums.push(epcNum);
        }
      }

      if (invalidEpcs.length > 0) {
        return {
          content: [{ type: 'text', text: `Invalid EPC codes: ${invalidEpcs.join(', ')}` }],
          isError: true,
        };
      }

      // Parse EOJ components or use default HVAC
      const gc = eojgc ? parseInt(eojgc.replace('0x', ''), 16) : 0x01;
      const cc = eojcc ? parseInt(eojcc.replace('0x', ''), 16) : 0x30;
      const inst = eojInstance ? parseInt(eojInstance.replace('0x', ''), 16) : 0x01;
      const eojKey = buildEojKey(gc, cc);
      
      // Build results for each requested EPC - MRA lookup only (no device query)
      const results = epcNums.map((epcNum) => {
        // Get property info from MRA
        const propInfo = getPropertyInfo(eojKey, epcNum);
        
        if (!propInfo) {
          return {
            epc: `0x${epcNum.toString(16).toUpperCase()}`,
            error: `EPC not found in MRA for EOJ ${eojKey}`,
            eoJName: getEojName(eojKey),
          };
        }

        // Get raw MRA data for value decoding (includes $ref, type, oneOf, bitmaps, etc.)
        const rawData = getRawMraPropertyData(epcNum, eojKey);

        // Resolve the full definition from definitions.json if $ref exists
        let resolvedDefinition: any = null;
        if (rawData?.$ref) {
          resolvedDefinition = resolveRef(rawData.$ref);
        }

        return {
          epc: `0x${epcNum.toString(16).toUpperCase()}`,
          propertyName: propInfo.name,
          shortName: propInfo.shortName,
          description: propInfo.description,
          accessRule: propInfo.accessRule,
          mraEnrichment: {
            propertyData: rawData || null,
            ref: rawData?.$ref || null,
            definition: resolvedDefinition || null,
          },
        };
      });

      const output = {
        device: {
          host: targetHost,
          eojKey: eojKey,
          eoJName: getEojName(eojKey),
        },
        requestedEpcs: epcs,
        results,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `EPC definition lookup failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ============================================================================
// Resource Definitions
// ============================================================================

/** Device status resource - updated via async notifications */
server.registerResource(
  'device://status',
  'device://status',
  {},
  async () => {
    const status = cachedStatus || await (hvac?.getFullStatus());
    if (!status) {
      return {
        contents: [{
          uri: 'device://status',
          mimeType: 'application/json',
          text: JSON.stringify({ error: 'No status available. Device may be unreachable.' }, null, 2),
        }],
      };
    }

    // Operation status is already "ON"/"OFF" from HomeAirConditioner.parseEpcData
    const formatted = { ...status };

    return {
      contents: [{
        uri: 'device://status',
        mimeType: 'application/json',
        text: JSON.stringify(formatted, null, 2),
      }],
    };
  }
);

/** Device capabilities resource */
server.registerResource(
  'device://capabilities',
  'device://capabilities',
  {},
  async () => {
    try {
      const targetHost = hvac?.getHost() || DEFAULT_HOST;
      const tempHvac = new HomeAirConditioner(client, targetHost);
      const capabilities = await tempHvac.getCapabilities();

      return {
        contents: [{
          uri: 'device://capabilities',
          mimeType: 'application/json',
          text: JSON.stringify(capabilities.map(c => ({
            epc: `0x${c.epc.toString(16).toUpperCase()}`,
            ac: c.ac,
          })), null, 2),
        }],
      };
    } catch (err) {
      return {
        contents: [{
          uri: 'device://capabilities',
          mimeType: 'application/json',
          text: JSON.stringify({ error: `Failed to get capabilities: ${(err as Error).message}` }, null, 2),
        }],
      };
    }
  }
);

// ============================================================================
// Notification Listener for Real-Time Updates
// ============================================================================

function setupNotificationListener(): void {
  client.onNotification((packet, info) => {
    // Check if this is from our HVAC device (EOJGC=0x01, EOJCC=0x30)
    if (packet.sourceEoj.groupCode === HVAC_EOJGC && packet.sourceEoj.classCode === HVAC_EOJCC) {
      const tempHvac = new HomeAirConditioner(client, info.address);
      tempHvac.updateFromNotification(packet);

      // Update cached status and notify MCP clients of resource change
      cachedStatus = tempHvac.getStatus();
    }
  });
}

// ============================================================================
// Server Startup
// ============================================================================

async function main() {
  // Initialize the ECHONETLite client (creates UDP sockets)
  client.initialize();

  // Create default HVAC handler
  hvac = new HomeAirConditioner(client, DEFAULT_HOST);

  // Set up notification listener for real-time updates
  setupNotificationListener();

  console.error(`ECHONETLite MCP Server starting...`);
  console.error(`Default host: ${DEFAULT_HOST}`);
  console.error(`UDP port: 3610`);
  console.error(`Multicast: 224.0.23.0:3610`);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('ECHONETLite MCP Server running on stdio');
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});