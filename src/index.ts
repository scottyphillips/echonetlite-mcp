// ECHONETLite MCP Server
// Main entry point - creates the MCP server with tools and resources for HVAC control

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { EchonetLiteClient } from './echonetlite.js';
import { HomeAirConditioner } from './devices/homeAirConditioner.js';
import { DEFAULT_HOST, HVAC_EOJGC, HVAC_EOJCC, HVAC_EOJ_INSTANCE, LITE_MODE } from './config.js';
import type { HvacStatus, DiscoveredDevice, Eoj, NodeProfileData, DiscoveredDeviceFull } from './types.js';
import { loadMraData, buildEojKey, getEojName, decodeEpcValue, getPropertyInfo, getRawMraPropertyData, loadDefinitions, resolveRef, getCoefficientRule, getAllCoefficientRules, getAllComplexRules, parseEpcElementsResult, DecodedEpcValue } from './mra.js';

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
// Tool Definitions - Lite Mode Tools (always registered)
// These 6 tools are available in both lite and full mode:
//   - discover_devices
//   - discover_nodes
//   - set_epc
//   - get_property_maps
//   - query_epc
//   - get_epc_definition
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
      
      const device: DiscoveredDeviceFull = await client.discoverDevice(targetHost, discoveryTimeout);
      const mraData = loadMraData() ?? new Map();
      
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
          const eojKey = buildEojKey(e.groupCode, e.classCode);
          const mraEntry = mraData.get(eojKey);
          
          const enrichedInstance: any = {
            groupCode: `0x${e.groupCode.toString(16).toUpperCase()}`,
            classCode: `0x${e.classCode.toString(16).toUpperCase()}`,
            instanceId: `0x${e.instanceId.toString(16).toUpperCase()}`,
            isPrimary: e.isPrimary,
          };
          
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
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      if (byte < 0x80) {
        result += String.fromCharCode(byte);
      } else if (byte >= 0xc0 && byte < 0xe0) {
        if (i + 1 < bytes.length) {
          result += String.fromCharCode(
            ((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f)
          );
          i++;
        }
      } else if (byte >= 0xe0 && byte < 0xf0) {
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

/** Set EPC on any EOJ instance (generic, instance-type agnostic) */
server.registerTool(
  'set_epc',
  {
    description: 'Set an EPC (EPC Property Code) value on any ECHONETLite device node. This is a generic tool that works with any EOJ (ECHONET Object) instance regardless of device type. Specify the target EOJ by group code, class code, and instance ID, then provide the EPC code and value as hex bytes.',
    inputSchema: {
      host: z.string().describe('IP address of the device'),
      eojgc: z.string().describe('EOJ Group Code in hex (e.g., "0x01" for HVAC)'),
      eojcc: z.string().describe('EOJ Class Code in hex (e.g., "0x30" for home air conditioner)'),
      eojInstance: z.string().optional().describe('EOJ Instance ID in hex (default: "0x01")'),
      epc: z.string().describe('EPC code in hex (e.g., "0xB0" for operating mode)'),
      value: z.string().describe('Value to set as hex bytes (e.g., "31" for heat, "41" for auto). Multiple bytes can be concatenated.'),
    },
  },
  async ({ host, eojgc, eojcc, eojInstance, epc, value }) => {
    try {
      const destinationEoj: Eoj = {
        groupCode: parseInt(eojgc.replace('0x', ''), 16),
        classCode: parseInt(eojcc.replace('0x', ''), 16),
        instanceId: eojInstance ? parseInt(eojInstance.replace('0x', ''), 16) : 0x01,
      };

      const epcNum = parseInt(epc.replace('0x', ''), 16);
      if (isNaN(epcNum)) {
        return {
          content: [{ type: 'text', text: `Invalid EPC code: ${epc}` }],
          isError: true,
        };
      }

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
      
      const destinationEoj: Eoj = {
        groupCode: eojgc ? parseInt(eojgc.replace('0x', ''), 16) : 0x01,
        classCode: eojcc ? parseInt(eojcc.replace('0x', ''), 16) : 0x30,
        instanceId: eojInstance ? parseInt(eojInstance.replace('0x', ''), 16) : 0x01,
      };

      const result = await client.getAllPropertyMaps(targetHost, destinationEoj);
      
      const eojKey = buildEojKey(destinationEoj.groupCode, destinationEoj.classCode);
      const eoJName = getEojName(eojKey);

      const parsePropertyMap = (epcDataItem: { epc: number; pv: Uint8Array }): { epc: string; epcNum: number; name?: string; shortName?: string; description?: string }[] => {
        if (epcDataItem.pv.length === 0) return [];
        const bytes = Array.from(epcDataItem.pv);
        const props: { epc: string; epcNum: number; name?: string; shortName?: string; description?: string }[] = [];

        const mraCache = loadMraData();
        if (!mraCache) return [];
        const mraLookup = mraCache.get(eojKey);

        if (bytes.length < 17) {
          for (let i = 1; i < bytes.length; i++) {
            const epcNum = bytes[i];
            const epcHex = `0x${epcNum.toString(16).toUpperCase()}`;
            
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
          for (let i = 1; i < bytes.length; i++) {
            const code = i - 1;
            const byteVal = bytes[i];
            for (let j = 0; j < 8; j++) {
              if (byteVal & (1 << j)) {
                const epcNum = (j + 8) * 16 + code;
                const epcHex = `0x${epcNum.toString(16).toUpperCase()}`;
                
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
          description: 'STATMAP(0x9D)=access capability, SETMAP(0x9E)=settable props, GETMAP(0x9F)=readable props.'
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
    description: 'Query one or more EPC (EPC Property Code) codes from an actual ECHONETLite device and return the current raw value and human-readable decoded value. Sends a GET request to the device with all requested EPCs, receives the actual values, then decodes each using MRA enrichment data.\n\nWORKFLOW PRIORITY: 1) First discover nodes on the device, 2) Then discover property maps (STATMAP/SETMAP/GETMAP), 3) Look up EPC definitions using get_epc_definition to understand what each property represents, 4) AFTER getting EPC definitions, use search_definitions to look up any referenced definition names (e.g., "state_ON-OFF_3031", "level_31-8", "number_-12.7-12.5Celsius") found in the $ref field or enum/value type fields - this gives you the actual enum values, bitmaps, level ranges, and number formats needed to interpret raw bytes, 5) If any properties require coefficient multiplication (check for "coefficientRule" in response), query those coefficient EPCs and multiply, 6) Calculate final values.\n\nNOTE: Coefficients are NOT needed for all devices. Simple devices like HVAC units return direct values. Check the coefficientRule field only if present in the response.',
    inputSchema: {
      epcs: z.array(z.string()).describe('EPC codes in hex format (e.g., ["0xBB", "0xB3"] for temperatures, ["0x80"] for operation status). Supports multiple EPCs.'),
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
      eojgc: z.string().optional().describe('EOJ Group Code in hex (e.g., "0x01") (default: 0x01 for HVAC)'),
      eojcc: z.string().optional().describe('EOJ Class Code in hex (e.g., "0x30") (default: 0x30 for home air conditioner)'),
      eojInstance: z.string().optional().describe('EOJ Instance ID in hex (e.g., "0x01") (default: 0x01)'),
    },
  },
  async ({ epcs, host, eojgc, eojcc, eojInstance }) => {
    try {
      const targetHost = host || DEFAULT_HOST;

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

      const gc = eojgc ? parseInt(eojgc.replace('0x', ''), 16) : 0x01;
      const cc = eojcc ? parseInt(eojcc.replace('0x', ''), 16) : 0x30;
      const inst = eojInstance ? parseInt(eojInstance.replace('0x', ''), 16) : 0x01;
      const eojKey = buildEojKey(gc, cc);
      
      const destinationEoj: Eoj = {
        groupCode: gc,
        classCode: cc,
        instanceId: inst,
      };

      const epcData = await client.get(targetHost, epcNums, destinationEoj);
      
      if (!epcData || epcData.length === 0) {
        return {
          content: [{ type: 'text', text: `No response from device for EPCs: ${epcs.join(', ')}` }],
          isError: true,
        };
      }

      const results = epcNums.map((epcNum) => {
        const responseData = epcData.find(d => d.epc === epcNum);
        
        if (!responseData) {
          return {
            epc: `0x${epcNum.toString(16).toUpperCase()}`,
            error: 'No response from device',
          };
        }

        const pv = responseData.pv;

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

        let humanReadableValue = '(decode failed)';
        let rawHexValue = '';
        let coefficientRule: any = null;
        
        if (pv && pv.length > 0) {
          const decoded = decodeEpcValue(epcNum, pv, eojKey);
          if (decoded) {
            humanReadableValue = decoded.humanReadableValue;
            rawHexValue = decoded.rawValue;
            
            // Include coefficient rule if present - this is critical for energy meters
            if (decoded.coefficientRule) {
              coefficientRule = decoded.coefficientRule;
            }
          } else {
            rawHexValue = Array.from(pv).map(b => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`).join(' ');
          }
        }

        const result: any = {
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

        // Add coefficient rule if present - LLMs need this to calculate actual values
        if (coefficientRule) {
          result.coefficientRule = {
            requiresCoefficient: true,
            sourceProperty: coefficientRule.sourceShortName,
            instruction: coefficientRule.instruction,
            coefficientEpcs: coefficientRule.coefficientEpcs.map((e: number) => `0x${e.toString(16).toUpperCase()}`),
            coefficientDetails: coefficientRule.coefficientDetails.map((d: any) => ({
              epc: `0x${d.epc.toString(16).toUpperCase()}`,
              shortName: d.shortName,
              propertyName: d.propertyName,
            })),
          };
        }

        return result;
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
    description: 'Get the ECHONETLite MRA (Machine Readable Index) definition for one or more EPC codes without querying the device. Returns property name, short name, description, access rules (GET/SET/INF capabilities), and the full MRA definition data including all possible enum values, bitmaps, level ranges, number formats, units, and $ref-resolved definitions.\n\nWORKFLOW PRIORITY: 1) Discover nodes first to identify device EOJ types, 2) Discover property maps to see which EPCs are available (STATMAP/SETMAP/GETMAP), 3) Look up EPC definitions using this tool to understand what each property represents, 4) AFTER getting the EPC definition, check if the response includes a $ref field or an inline type with enum/bitmaps/levels. If it has a $ref (e.g., "#/definitions/state_ON-OFF_3031") OR references a definition name (e.g., "state_ON-OFF_3031", "level_31-8", "number_-12.7-12.5Celsius"), you MUST use search_definitions to look up the full definition content - this contains the actual enum values, bitmap bit positions, level ranges, or number formats needed to decode raw bytes into human-readable values, 5) Only if a definition includes coefficient hints, query the coefficient EPCs and multiply raw values, 6) Otherwise interpret the value directly from the decoded definition.',
    inputSchema: {
      epcs: z.array(z.string()).describe('EPC codes in hex format (e.g., ["0xB0"] for operating mode, ["0xA0"] for air flow rate). Supports multiple EPCs.'),
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST}) - used to determine EOJ type`),
      eojgc: z.string().optional().describe('EOJ Group Code in hex (e.g., "0x01") (default: 0x01 for HVAC, omit for cross-EOJ search)'),
      eojcc: z.string().optional().describe('EOJ Class Code in hex (e.g., "0x30") (default: 0x30 for home air conditioner, omit for cross-EOJ search)'),
      eojInstance: z.string().optional().describe('EOJ Instance ID in hex (e.g., "0x01") (default: 0x01)'),
    },
  },
  async ({ epcs, host, eojgc, eojcc, eojInstance }) => {
    try {
      const targetHost = host || DEFAULT_HOST;

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

      const gc = eojgc ? parseInt(eojgc.replace('0x', ''), 16) : 0x01;
      const cc = eojcc ? parseInt(eojcc.replace('0x', ''), 16) : 0x30;
      const inst = eojInstance ? parseInt(eojInstance.replace('0x', ''), 16) : 0x01;
      const eojKey = buildEojKey(gc, cc);

      // Check if EOJ was explicitly specified or left as default
      const explicitEojSpecified = !!(eojgc && eojcc);
      
      // Perform cross-EOJ search to find all devices that use these EPCs
      const crossEojMatches = performCrossEojSearch(epcNums);

      const results = epcNums.map((epcNum) => {
        let propInfo: { name: string; shortName: string; accessRule: any; description?: string } | null = null;
        let rawData: any = null;
        let resolvedDefinition: any = null;

        if (explicitEojSpecified) {
          // EOJ explicitly specified - return only that device's definition
          propInfo = getPropertyInfo(eojKey, epcNum);
          
          if (!propInfo) {
            return {
              epc: `0x${epcNum.toString(16).toUpperCase()}`,
              error: `EPC not found in MRA for EOJ ${eojKey} (${getEojName(eojKey)})`,
              eoJName: getEojName(eojKey),
              availableInOtherEojTypes: crossEojMatches[epcNum]?.filter(m => m.eojKey !== eojKey).map(m => ({
                eojKey: m.eojKey,
                eoJName: m.eoJName,
                propertyName: m.propInfo.name,
              })) || [],
            };
          }

          rawData = getRawMraPropertyData(epcNum, eojKey);

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
        } else {
          // No EOJ specified - return all matches across all EOJ types
          const matches = crossEojMatches[epcNum] || [];
          
          if (matches.length === 0) {
            return {
              epc: `0x${epcNum.toString(16).toUpperCase()}`,
              error: `EPC not found in any MRA definition`,
            };
          }

          return {
            epc: `0x${epcNum.toString(16).toUpperCase()}`,
            matches: matches.map(match => {
              const rawDef = getRawMraPropertyData(epcNum, match.eojKey);
              let resolvedDef: any = null;
              if (rawDef?.$ref) {
                resolvedDef = resolveRef(rawDef.$ref);
              }

              // Check for coefficient rules on this EPC in this EOJ type
              const eCoeffRule = getCoefficientRule(epcNum, match.eojKey);

              const result: any = {
                eojKey: match.eojKey,
                eoJName: match.eoJName,
                propertyName: match.propInfo.name,
                shortName: match.propInfo.shortName,
                description: match.propInfo.description,
                accessRule: match.propInfo.accessRule,
                mraEnrichment: {
                  propertyData: rawDef || null,
                  ref: rawDef?.$ref || null,
                  definition: resolvedDef || null,
                },
              };

              // Add coefficient hint if present
              if (eCoeffRule) {
                result.coefficientHint = {
                  requiresCoefficient: true,
                  instruction: eCoeffRule.instruction,
                  coefficientEpcs: eCoeffRule.coefficientEpcs.map((e: number) => `0x${e.toString(16).toUpperCase()}`),
                  coefficientDetails: eCoeffRule.coefficientDetails.map((d: any) => ({
                    epc: `0x${d.epc.toString(16).toUpperCase()}`,
                    shortName: d.shortName,
                    propertyName: d.propertyName,
                  })),
                };
              }

              return result;
            }),
          };
        }
      });

      const output = explicitEojSpecified ? {
        device: {
          host: targetHost,
          eojKey: eojKey,
          eoJName: getEojName(eojKey),
        },
        requestedEpcs: epcs,
        results,
      } : {
        searchType: 'cross-eoj',
        description: 'No EOJ type specified. Showing all EPC matches across all device types.',
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

/** Search all EOJ types for the given EPC codes and return matches */
function performCrossEojSearch(epcNums: number[]): Record<number, Array<{ eojKey: string; eoJName: string; propInfo: { name: string; shortName: string; accessRule: any; description?: string } }>> {
  const cache = loadMraData();
  if (!cache) return {};
  const results: Record<number, Array<{ eojKey: string; eoJName: string; propInfo: { name: string; shortName: string; accessRule: any; description?: string } }>> = {};

  for (const epcNum of epcNums) {
    const matches: Array<{ eojKey: string; eoJName: string; propInfo: { name: string; shortName: string; accessRule: any; description?: string } }> = [];
    
    for (const [eojKey, lookup] of cache.entries()) {
      const propInfo = lookup.properties.get(epcNum);
      if (propInfo) {
        matches.push({ eojKey, eoJName: lookup.eoJName, propInfo });
      }
    }
    
    results[epcNum] = matches;
  }

  return results;
}

/** Search all definitions by pattern - find matching definition names and their details */
server.registerTool(
  'search_definitions',
  {
    description: 'Search all ECHONETLite MRA definitions by name or type pattern. Useful for finding definitions like "level_31-8", "state_ON-OFF_4142", etc. without knowing the exact EPC code. Returns matching definition names, types (state/number/level/bitmap), and their full resolved content.\n\nWORKFLOW ROLE: This tool is called AFTER get_epc_definition when the EPC definition contains a $ref field or references a definition name. For example:\n- If get_epc_definition returns "$ref": "#/definitions/state_ON-OFF_3031", use search_definitions with pattern "ON-OFF" to find and retrieve that definition\n- If the property type is "level_31-8", use search_definitions with pattern "level_31" to get the base value (0x31) and maximum level count\n- If the property type is a number like "number_-12.7-12.5Celsius", use search_definitions with pattern "Celsius" to get the format (uint8/uint16/int16), unit, and multiple factors\n\nThe definition content contains the actual enum values, bitmap bit positions, level ranges, or number formats needed to decode raw bytes into human-readable values.',
    inputSchema: {
      pattern: z.string().describe('Search pattern to match against definition names (e.g., "level_31" for fan speed levels, "ON-OFF" for on/off states, "Celsius" for temperature numbers). Supports partial matching.'),
    },
  },
  async ({ pattern }) => {
    try {
      const definitions = loadDefinitions();
      const matches: Array<{ name: string; type: string; definition: any }> = [];

      // Build a regex from the pattern for case-insensitive matching
      const searchPattern = new RegExp(pattern, 'i');

      for (const [defName, defData] of Object.entries(definitions.definitions || {})) {
        if (searchPattern.test(defName)) {
          matches.push({
            name: defName,
            type: (defData as any).type || 'unknown',
            definition: defData,
          });
        }
      }

      // Sort by type then name for consistent output
      matches.sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.name.localeCompare(b.name);
      });

      const output = {
        searchPattern: pattern,
        totalMatches: matches.length,
        matchesByType: matches.reduce((acc, m) => {
          (acc[m.type] = acc[m.type] || []).push(m);
          return acc;
        }, {} as Record<string, Array<{ name: string; type: string; definition: any }>>),
        results: matches.slice(0, 100), // Limit to first 100 results
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Definition search failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/** Query ALL coefficient rules for any EOJ type - detects coefficients dynamically from MRA device definitions */
server.registerTool(
  'query_coefficient_rules',
  {
    description: 'Query ALL coefficient rules for a specific device type (EOJ). This tool SCANS the MRA device definition JSON to find ANY properties that require coefficient multiplication.\n\nCOEFFICIENTS CAN APPEAR ON ANY DEVICE TYPE - not just meters. Any ECHONETLite device may define properties with coefficients in their MRA JSON definition. Coefficients are indicated by a "coefficient" array in the property data definition.\n\nWORKFLOW FOR LLMs (coefficients are LAST priority):\n1. First discover nodes to identify all EOJ types on the device\n2. Then discover property maps (STATMAP/SETMAP/GETMAP) to see available EPCs\n3. Look up EPC definitions using get_epc_definition to understand each property\n4. AFTER step 3, use search_definitions to look up any referenced definition names ($ref values like "state_ON-OFF_3031", "level_31-8", etc.) - this gives you enum/bitmap/level details needed to decode raw bytes\n5. ONLY IF steps 3-4 reveal coefficient requirements, use this tool or check for coefficientRule in query_epc responses\n6. For simple devices (HVAC, sensors with direct values), coefficients are NOT needed - read values directly\n7. For metering devices (energy meters, gas meters, water meters), coefficients ARE typically required\n\nUSAGE: Provide EOJ group code (eojgc) and class code (eojcc) for the device type.',
    inputSchema: {
      eojgc: z.string().describe('EOJ Group Code in hex (e.g., "0x02" for energy meter)'),
      eojcc: z.string().describe('EOJ Class Code in hex (e.g., "0x88" for low-voltage smart electric energy meter)'),
      host: z.string().optional().describe(`IP address of the device (for context, not used for querying)`),
    },
  },
  async ({ eojgc, eojcc, host }) => {
    try {
      const gc = parseInt(eojgc.replace('0x', ''), 16);
      const cc = parseInt(eojcc.replace('0x', ''), 16);
      const eojKey = buildEojKey(gc, cc);

      // Get all coefficient rules for this EOJ type
      const coeffRules = getAllCoefficientRules(eojKey);
      
      // Also get all complex rules (atomic, array, etc.)
      const allComplexRules = getAllComplexRules(eojKey);

      if (coeffRules.length === 0 && allComplexRules.length === 0) {
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
              eoJKey: eojKey,
              eoJName: getEojName(eojKey),
              hasCoefficientRules: false,
              message: `No coefficient or complex rules found for EOJ ${eojKey}. All property values can be interpreted directly without multiplication.`,
            }, null, 2) 
          }],
        };
      }

      const output = {
        eoJKey: eojKey,
        eoJName: getEojName(eojKey),
        hasCoefficientRules: coeffRules.length > 0,
        coefficientRuleCount: coeffRules.length,
        complexRuleCount: allComplexRules.length,
        coefficientRules: coeffRules.map(rule => ({
          sourceEpc: `0x${rule.sourceEpc.toString(16).toUpperCase()}`,
          sourceProperty: rule.sourceShortName,
          propertyName: rule.sourcePropertyName,
          instruction: rule.instruction,
          coefficientEpcs: rule.coefficientEpcs.map((e: number) => `0x${e.toString(16).toUpperCase()}`),
          coefficientDetails: rule.coefficientDetails.map((d: any) => ({
            epc: `0x${d.epc.toString(16).toUpperCase()}`,
            shortName: d.shortName,
            propertyName: d.propertyName,
          })),
          note: rule.note || null,
        })),
        allComplexRules: allComplexRules.map(rule => ({
          epc: `0x${rule.epc.toString(16).toUpperCase()}`,
          shortName: rule.shortName,
          propertyName: rule.propertyName,
          ruleType: rule.ruleType,
          hints: rule.hints,
        })),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Coefficient rules query failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ============================================================================
// Generic EPC Element Parsing Tool (available in all modes)
// This tool parses complex object/array-type EPC values into named elements.
// ============================================================================

server.registerTool(
  'parse_epc_elements',
  {
    description: 'Parse an object/array-type ECHONETLite EPC value into named elements based on MRA definition. Returns structured element breakdown with raw hex bytes for each element, suitable for LLM consumption.\n\nWORKFLOW: After querying EPC data (e.g., EPC 0xE2), use this tool to split the raw bytes into named elements. Provide the EOJ type and property data from get_epc_definition or get_raw_property_data.',
    inputSchema: {
      epc: z.string().describe('EPC code in hex format (e.g., "0xE2")'),
      host: z.string().optional().describe(`IP address of the device (default: ${DEFAULT_HOST})`),
      eojgc: z.string().optional().describe('EOJ Group Code in hex (e.g., "0x02"). Defaults to HVAC if not specified.'),
      eojcc: z.string().optional().describe('EOJ Class Code in hex (e.g., "0x88"). Defaults to HVAC class if not specified.'),
      eojInstance: z.string().optional().describe('EOJ Instance ID in hex (default: "0x01")'),
      rawHex: z.string().describe('Raw hex bytes as space-separated values (e.g., "0x00 0x0A 0xFF 0xFF"). This is the EDT/PV data from a query_epc response.'),
      propertyName: z.string().optional().describe('Property name for context (optional, looked up from MRA if not provided)'),
      shortName: z.string().optional().describe('Short property name for context (optional, looked up from MRA if not provided)'),
    },
  },
  async ({ epc, host, eojgc, eojcc, eojInstance, rawHex, propertyName, shortName }) => {
    try {
      // Parse raw hex string to Uint8Array
      const hexBytes = rawHex.trim().split(/\s+/).map(h => {
        const cleaned = h.replace(/^0x/i, '');
        return parseInt(cleaned, 16);
      });
      const pv = new Uint8Array(hexBytes);

      // Determine EOJ key from parameters or default to HVAC
      let eojKey: string;
      if (eojgc && eojcc) {
        const gc = parseInt(eojgc.replace('0x', ''), 16);
        const cc = parseInt(eojcc.replace('0x', ''), 16);
        eojKey = buildEojKey(gc, cc);
      } else {
        // Default to HVAC
        eojKey = buildEojKey(HVAC_EOJGC, HVAC_EOJCC);
      }

      // Get raw MRA property data for the EPC to use in element parsing
      const epcNum = parseInt(epc.replace('0x', ''), 16);
      const rawData = getRawMraPropertyData(epcNum, eojKey);

      // Look up property info from MRA for context
      const propInfo = getPropertyInfo(eojKey, epcNum);
      const targetPropertyName = propertyName || (propInfo?.name || '');
      const targetShortName = shortName || (propInfo?.shortName || '');

      // Parse elements using the MRA definition data
      // MRA data is now embedded via bundled JSON - no __dirname needed
      const result = parseEpcElementsResult(
        epcNum,
        pv,
        rawData, // propertyData - contains element definitions for object/array types
        targetPropertyName,
        targetShortName,
        undefined // MRA data is loaded from embedded bundle via loadMraData()
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `EPC element parsing failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ============================================================================
// Tool Definitions - Full Mode Tools (only when LITE_MODE is false)
// These tools are hidden in lite mode to reduce the LLM's surface area:
//   - get_device_status
//   - set_operation
//   - set_operating_mode
//   - set_temperature
//   - set_fan_speed
//   - set_airflow_vertical
//   - set_airflow_horizontal
//   - set_swing_mode
//   - set_auto_direction
//   - set_silent_mode
//   - set_power_saving
//   - get_temperatures
//   - get_humidity
// ============================================================================

if (!LITE_MODE) {
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
}

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
    if (packet.sourceEoj.groupCode === HVAC_EOJGC && packet.sourceEoj.classCode === HVAC_EOJCC) {
      const tempHvac = new HomeAirConditioner(client, info.address);
      tempHvac.updateFromNotification(packet);

      cachedStatus = tempHvac.getStatus();
    }
  });
}

// ============================================================================
// Server Startup
// ============================================================================

async function main() {
  client.initialize();

  hvac = new HomeAirConditioner(client, DEFAULT_HOST);

  setupNotificationListener();

  const modeStr = LITE_MODE ? 'LITE' : 'FULL';
  console.error(`ECHONETLite MCP Server starting... (Mode: ${modeStr})`);
  console.error(`Default host: ${DEFAULT_HOST}`);
  console.error(`UDP port: 3610`);
  console.error(`Multicast: 224.0.23.0:3610`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('ECHONETLite MCP Server running on stdio');
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});