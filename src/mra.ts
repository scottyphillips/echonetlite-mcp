/**
 * MRA (Mandatory Requirements for All) Property Lookup
 * Loads ECHONETLite MRA JSON files to provide readable property names and descriptions
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MraProperty {
  epc: number;
  propertyName: string;
  shortName: string;
  accessRule: { get?: string; set?: string; inf?: string };
  descriptions?: { ja?: string; en?: string };
  data?: any;
}

interface MraDeviceClass {
  eoj: string;
  className: { ja: string; en: string };
  shortName: string;
  elProperties: MraProperty[];
}

interface MraSuperClass {
  eoj: string;
  className: { ja: string; en: string };
  elProperties: MraProperty[];
}

/** Lookup table: EOJ key (e.g., "0x0130") → property map by EPC */
interface PropertyLookup {
  eoJName: string;
  properties: Map<number, { name: string; shortName: string; accessRule: MraProperty['accessRule']; description?: string }>;
}

let propertyCache: Map<string, PropertyLookup> | null = null;
let definitionsCache: any = null;

/** Build EOJ key from components */
export function buildEojKey(gc: number, cc: number, inst?: number): string {
  return `0x${gc.toString(16).padStart(2, '0').toUpperCase()}${cc.toString(16).padStart(2, '0').toUpperCase()}`;
}

/** Load all MRA data from disk */
export function loadMraData(mraDir?: string): Map<string, PropertyLookup> {
  if (propertyCache) return propertyCache;
  
  const dir = mraDir || path.join(__dirname, '..', 'mra', 'mraData');
  const result = new Map<string, PropertyLookup>();

  // Load device-specific classes
  const devicesDir = path.join(dir, 'devices');
  if (fs.existsSync(devicesDir)) {
    const files = fs.readdirSync(devicesDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(devicesDir, file), 'utf-8'));
        if (content.elProperties && Array.isArray(content.elProperties)) {
          const props = new Map<number, { name: string; shortName: string; accessRule: MraProperty['accessRule']; description?: string }>();
          for (const p of content.elProperties) {
            if (p.epc != null && p.shortName) {
              // Handle multiple validRelease entries for same EPC - later ones override
              const propInfo = {
                name: p.propertyName?.en || p.propertyName?.ja || '',
                shortName: p.shortName,
                accessRule: p.accessRule || {},
                description: p.descriptions?.en || p.descriptions?.ja || ''
              };
              props.set(parseInt(p.epc, 16), propInfo);
            }
          }
          result.set(content.eoj, {
            eoJName: content.className?.en || content.className?.ja || content.eoj,
            properties: props
          });
        }
      } catch (e) {
        // Skip invalid files
      }
    }
  }

  // Load super classes (common properties inherited by all devices)
  const superClassDir = path.join(dir, 'superClass');
  if (fs.existsSync(superClassDir)) {
    const files = fs.readdirSync(superClassDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(superClassDir, file), 'utf-8'));
        if (content.elProperties && Array.isArray(content.elProperties)) {
          // Super class properties are shared - store separately for merging
          const superProps: Map<number, { name: string; shortName: string; accessRule: MraProperty['accessRule']; description?: string }> = new Map();
          for (const p of content.elProperties) {
            if (p.epc != null && p.shortName) {
              const propInfo = {
                name: p.propertyName?.en || p.propertyName?.ja || '',
                shortName: p.shortName,
                accessRule: p.accessRule || {},
                description: p.descriptions?.en || p.descriptions?.ja || ''
              };
              superProps.set(parseInt(p.epc, 16), propInfo);
            }
          }
          // Merge super class props into each device that exists
          for (const [eojKey, lookup] of result.entries()) {
            for (const [epc, info] of superProps) {
              if (!lookup.properties.has(epc)) {
                lookup.properties.set(epc, info);
              }
            }
          }
        }
      } catch (e) {
        // Skip invalid files
      }
    }
  }

  propertyCache = result;
  return result;
}

/** Load definitions from definitions.json */
export function loadDefinitions(mraDir?: string): any {
  if (definitionsCache) return definitionsCache;
  
  const dir = mraDir || path.join(__dirname, '..', 'mra', 'mraData');
  const defsFile = path.join(dir, 'definitions', 'definitions.json');
  
  try {
    if (fs.existsSync(defsFile)) {
      definitionsCache = JSON.parse(fs.readFileSync(defsFile, 'utf-8'));
    } else {
      definitionsCache = { definitions: {} };
    }
  } catch {
    definitionsCache = { definitions: {} };
  }
  
  return definitionsCache;
}

/** Resolve a $ref to its definition */
export function resolveRef(ref: string, mraDir?: string): any {
  if (!ref) return null;
  
  // Strip leading '#' from JSON pointers (e.g., "#/definitions/state_ON-OFF_3031" -> "/definitions/state_ON-OFF_3031")
  const normalizedRef = ref.startsWith('#') ? ref.slice(1) : ref;
  
  // Handle both formats:
  // - "#/definitions/state_ON-OFF_3031" or "/definitions/state_ON-OFF_3031" (JSON pointer)
  // - "definitions/number_-12.7-12.5Celsius" (relative path without leading slash)
  let current: any;
  if (normalizedRef.startsWith('/')) {
    // JSON pointer format - navigate from the root definitions object
    current = loadDefinitions(mraDir);
  } else {
    // Relative format - extract just the definition name and look it up directly
    const parts = normalizedRef.split('/');
    current = loadDefinitions(mraDir);
    // Navigate through any nested paths
    for (const part of parts) {
      if (part === '' || part === 'definitions') continue;
      if (current && typeof current === 'object') {
        current = current[part];
      } else {
        return null;
      }
    }
    return current;
  }
  
  // Split by '/' and navigate (skip first empty string from leading '/')
  const parts = normalizedRef.split('/').slice(1);
  
  for (const part of parts) {
    if (current && typeof current === 'object') {
      current = current[part];
    } else {
      return null;
    }
  }
  
  return current;
}

/** Get property info for a specific EOJ and EPC */
export function getPropertyInfo(eojKey: string, epc: number, mraDir?: string): { name: string; shortName: string; accessRule: MraProperty['accessRule']; description?: string } | null {
  const cache = loadMraData(mraDir);
  const lookup = cache.get(eojKey);
  if (!lookup) return null;
  return lookup.properties.get(epc) || null;
}

/** Get all property info for a specific EOJ */
export function getAllPropertyInfo(eojKey: string, mraDir?: string): Map<number, { name: string; shortName: string; accessRule: MraProperty['accessRule']; description?: string }> | null {
  const cache = loadMraData(mraDir);
  const lookup = cache.get(eojKey);
  return lookup ? lookup.properties : null;
}

/** Get EOJ class name */
export function getEojName(eojKey: string, mraDir?: string): string {
  const cache = loadMraData(mraDir);
  const lookup = cache.get(eojKey);
  return lookup ? lookup.eoJName : eojKey;
}

/** Get raw MRA property data for a specific EPC from the device JSON (or superclass if not found in device-specific file) */
export function getRawMraPropertyData(epc: number, eojKey: string, mraDir?: string): any {
  const dir = mraDir || path.join(__dirname, '..', 'mra', 'mraData');
  
  // First try the device-specific file
  const deviceFile = path.join(dir, 'devices', `${eojKey}.json`);
  if (fs.existsSync(deviceFile)) {
    try {
      const content = JSON.parse(fs.readFileSync(deviceFile, 'utf-8'));
      if (content.elProperties && Array.isArray(content.elProperties)) {
        const epcHex = `0x${epc.toString(16).toUpperCase()}`;
        const prop = content.elProperties.find((p: any) => p.epc === epcHex);
        if (prop?.data !== undefined) {
          return prop.data;
        }
      }
    } catch {
      // Fall through to superclass lookup
    }
  }
  
  // If not found in device file, check superclass files for inherited properties
  const superClassDir = path.join(dir, 'superClass');
  if (fs.existsSync(superClassDir)) {
    const files = fs.readdirSync(superClassDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(superClassDir, file), 'utf-8'));
        if (content.elProperties && Array.isArray(content.elProperties)) {
          const epcHex = `0x${epc.toString(16).toUpperCase()}`;
          const prop = content.elProperties.find((p: any) => p.epc === epcHex);
          if (prop?.data !== undefined) {
            return prop.data;
          }
        }
      } catch {
        // Skip invalid files
      }
    }
  }
  
  return null;
}

/**
 * Decode an EPC value using MRA enrichment data.
 * Returns a human-readable value by combining the property definition (enum values, data types)
 * with the actual value bytes. Uses the MRA as the source of truth.
 */
export function decodeEpcValue(epc: number | string, pv: Uint8Array | number[], eojKey: string = '0x0130', mraDir?: string): {
  propertyName: string;
  shortName: string;
  description: string;
  humanReadableValue: string;
  rawValue: string;
} | null {
  // Convert EPC to number if string
  const epcNum = typeof epc === 'string' ? parseInt(epc.replace('0x', ''), 16) : epc;
  
  // Load MRA data and get property info
  const cache = loadMraData(mraDir);
  const lookup = cache.get(eojKey);
  if (!lookup) return null;
  
  const propInfo = lookup.properties.get(epcNum);
  if (!propInfo) return null;
  
  // Get the raw MRA property data for enum/value decoding
  const rawData = getRawMraPropertyData(epcNum, eojKey, mraDir);
  
  // Decode the value based on MRA data structure
  const decodedValue = decodeValueFromMraData(pv, rawData, epcNum, mraDir);
  
  return {
    propertyName: propInfo.name || 'Unknown',
    shortName: propInfo.shortName || `epc_${epcNum.toString(16).toUpperCase()}`,
    description: propInfo.description || '',
    humanReadableValue: decodedValue,
    rawValue: Array.from(pv instanceof Uint8Array ? pv : new Uint8Array(pv)).map(b => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`).join(' '),
  };
}

/**
 * Decode a value based on MRA data structure.
 * This is the core function that uses MRA as the source of truth.
 */
function decodeValueFromMraData(pv: Uint8Array | number[], rawData: any, epc: number, mraDir?: string): string {
  const arr = pv instanceof Uint8Array ? Array.from(pv) : pv;
  
  if (arr.length === 0) return '(no data)';
  
  // Check for $ref in the data - resolve and decode based on referenced definition
  if (rawData?.$ref) {
    const resolvedDef = resolveRef(rawData.$ref, mraDir);
    if (resolvedDef) {
      return decodeFromDefinition(arr, resolvedDef, mraDir);
    }
  }
  
  // Check for direct type in data
  if (rawData?.type === 'state' && rawData?.enum) {
    return decodeStateEnum(arr, rawData.enum);
  }
  
  // Handle oneOf with multiple options
  if (rawData?.oneOf && Array.isArray(rawData.oneOf)) {
    for (const option of rawData.oneOf) {
      // Check for $ref in oneOf option - resolve and decode using definition
      if (option?.$ref) {
        const resolvedDef = resolveRef(option.$ref, mraDir);
        if (resolvedDef) {
          const result = decodeFromDefinition(arr, resolvedDef, mraDir);
          // Only return success if it's not raw hex (meaning we decoded something meaningful)
          const isRawHex = result === arr.map(b => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`).join(' ');
          if (!isRawHex && result !== '(unknown)') return result;
        }
      }
      // Check for inline state enum
      if (option?.type === 'state' && option?.enum) {
        const result = decodeStateEnum(arr, option.enum);
        if (result !== '(unknown)') return result;
      }
      // Check for inline level type
      if (option?.type === 'level' && option.base != null && option.maximum != null) {
        const result = decodeLevelValue(arr, option.base, option.maximum);
        if (result !== '(no data)') return result;
      }
    }
  }
  
  // Handle bitmap types
  if (rawData?.type === 'bitmap' && rawData?.bitmaps) {
    return decodeBitmap(arr, rawData.bitmaps, mraDir);
  }
  
  // Default: return raw hex value
  return arr.map(b => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`).join(' ');
}

/**
 * Decode a value from a resolved definition.
 */
function decodeFromDefinition(arr: number[], def: any, mraDir?: string): string {
  if (!def) return concatenateRawValue(arr);
  
  // State type with enum values
  if (def.type === 'state' && def.enum) {
    return decodeStateEnum(arr, def.enum);
  }
  
  // Level type - decode based on base value and maximum level
  if (def.type === 'level' && def.base != null && def.maximum != null) {
    return decodeLevelValue(arr, def.base, def.maximum);
  }
  
  // Number type - decode based on format and unit
  if (def.type === 'number') {
    return decodeNumberValue(arr, def);
  }
  
  // Raw type - concatenate all bytes into a single hex value
  if (def.type === 'raw') {
    return concatenateRawValue(arr);
  }
  
  // Fallback
  return concatenateRawValue(arr);
}

/**
 * Concatenate raw bytes into a single hex value (e.g., [0x12, 0x34, 0x56] → "0x123456").
 */
function concatenateRawValue(arr: number[]): string {
  if (arr.length === 0) return '(no data)';
  const hexString = arr.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
  return `0x${hexString}`;
}

/**
 * Decode a level value based on base and maximum level count.
 * Level values start at base (e.g., 0x31) and go up to base + maximum - 1.
 * E.g., level_31-8: base=0x31, max=8, so valid values are 0x31-0x38 = Level 1-8
 */
function decodeLevelValue(arr: number[], base: string, maximum: number): string {
  if (arr.length === 0) return '(no data)';
  
  const byteVal = arr[0];
  const baseVal = parseInt(base, 16);
  
  // Check if value is in the "auto" state (commonly 0x41)
  if (byteVal === 0x41) return 'Auto';
  
  // Calculate level: byteVal - base + 1
  const level = byteVal - baseVal + 1;
  
  if (level >= 1 && level <= maximum) {
    return `Level ${level}`;
  }
  
  // Value outside expected range
  return `0x${byteVal.toString(16).toUpperCase()} (${base} + ${level - 1})`;
}

/**
 * Decode a state enum value.
 */
function decodeStateEnum(arr: number[], enumValues: any[]): string {
  if (arr.length === 0 || !enumValues) return '(unknown)';
  
  const hexVal = `0x${arr[0].toString(16).toUpperCase()}`;
  const match = enumValues.find((e: any) => e.edt === hexVal);
  
  if (match) {
    // Return English description if available, otherwise the name
    return match.descriptions?.en || match.name || hexVal;
  }
  
  return hexVal;
}

/**
 * Decode a numeric value based on its definition.
 */
function decodeNumberValue(arr: number[], def: any): string {
  if (arr.length === 0) return '(no data)';
  
  const format = def.format || 'uint8';
  const unit = def.unit || '';
  const multiple = def.multiple || 1;
  
  let value: number;
  
  // Decode based on format
  switch (format) {
    case 'int8':
      if (arr.length >= 1) {
        // Create a buffer to properly decode signed values
        const buf = new ArrayBuffer(2);
        const view = new DataView(buf);
        view.setInt8(0, arr[0]);
        value = view.getInt8(0);
      } else {
        return '(insufficient data)';
      }
      break;
      
    case 'uint8':
      if (arr.length >= 1) {
        value = arr[0];
      } else {
        return '(insufficient data)';
      }
      break;
      
    case 'int16':
      if (arr.length >= 2) {
        const buf = Buffer.from(arr.slice(0, 2));
        value = buf.readInt16BE(0);
      } else {
        return '(insufficient data)';
      }
      break;
      
    case 'uint16':
      if (arr.length >= 2) {
        const buf = Buffer.from(arr.slice(0, 2));
        value = buf.readUInt16BE(0);
      } else {
        return '(insufficient data)';
      }
      break;
      
    case 'int32':
      if (arr.length >= 4) {
        const buf = Buffer.from(arr.slice(0, 4));
        value = buf.readInt32BE(0);
      } else {
        return '(insufficient data)';
      }
      break;
      
    case 'uint32':
      if (arr.length >= 4) {
        const buf = Buffer.from(arr.slice(0, 4));
        value = buf.readUInt32BE(0);
      } else {
        return '(insufficient data)';
      }
      break;
      
    default:
      value = arr[0] || 0;
  }
  
  // Apply multiple (scale factor)
  if (multiple !== 1) {
    value = value * multiple;
  }
  
  // Format based on unit
  if (unit === 'Celsius') {
    return `${value.toFixed(1)}°C`;
  } else if (unit === '%') {
    return `${value.toFixed(1)}%`;
  } else if (unit === 'W' || unit === 'kW' || unit === 'Wh' || unit === 'kWh') {
    return `${value.toFixed(2)} ${unit}`;
  } else if (unit === 'A' || unit === 'mA') {
    return `${value.toFixed(2)} ${unit}`;
  } else if (unit === 'degree') {
    return `${value.toFixed(1)}°`;
  } else if (unit === 'minutes' || unit === 'minute' || unit === 'second' || unit === 'second') {
    return `${Math.round(value)} ${unit}${value !== 1 ? 's' : ''}`;
  } else if (unit === 'L' || unit === 'm3' || unit === 'm3/h') {
    return `${value.toFixed(2)} ${unit}`;
  } else if (unit === 'lux' || unit === 'klux') {
    return `${value.toFixed(2)} ${unit}`;
  } else if (unit === 'r/min') {
    return `${Math.round(value)} r/min`;
  } else if (unit === 'MJ') {
    return `${value.toFixed(2)} MJ`;
  } else if (unit === 'ppm') {
    return `${Math.round(value)} ppm`;
  } else if (unit === 'V') {
    return `${value.toFixed(2)} V`;
  } else if (unit === 'digit') {
    return `${Math.round(value)} digit`;
  } else if (unit === 'A' || unit === 'm3/h') {
    return `${value.toFixed(2)} ${unit}`;
  } else if (unit) {
    return `${value.toFixed(2)} ${unit}`;
  } else {
    // No unit - just return the number
    if (multiple < 1) {
      return value.toFixed(1);
    }
    return Math.round(value).toString();
  }
}

/**
 * Decode a bitmap value.
 */
function decodeBitmap(arr: number[], bitmaps: any, mraDir?: string): string {
  const results: string[] = [];
  
  for (const bitmap of bitmaps) {
    if (!bitmap.position || !bitmap.position.index) continue;
    
    const idx = bitmap.position.index;
    if (idx >= arr.length) continue;
    
    const byteVal = arr[idx];
    
    // Parse the bit mask (can be hex like "0x01", "0x02", etc.)
    let mask = 0;
    if (bitmap.position.bitMask) {
      try {
        mask = eval(bitmap.position.bitMask); // Simple bitmask evaluation for hex literals
      } catch {
        continue;
      }
    }
    
    const bitValue = byteVal & mask;
    
    // Look up the value in enum if available
    let label = bitValue.toString();
    if (bitmap.value?.enum) {
      const hexVal = `0x${bitValue.toString(16).toUpperCase()}`;
      const match = bitmap.value.enum.find((e: any) => e.edt === hexVal);
      if (match) {
        label = match.descriptions?.en || match.name || hexVal;
      }
    }
    
    results.push(`${bitmap.name}: ${label}`);
  }
  
  return results.join(', ') || '(unknown bitmap)';
}

/** Decode simple state values based on MRA definitions (legacy function for backward compatibility) */
export function decodePropertyState(epc: number, pv: Uint8Array, mraDir?: string): string | null {
  // Common ON/OFF states (0x80)
  if (epc === 0x80 && pv.length > 0) {
    const val = pv[0];
    if (val === 0x41) return 'ON';
    if (val === 0x42) return 'OFF';
  }

  // Fault status (0x88)
  if (epc === 0x88 && pv.length > 0) {
    const val = pv[0];
    if (val === 0x41) return 'Fault occurred';
    if (val === 0x42) return 'No fault';
  }

  // Power saving (0x8F, 0xB3 for HVAC)
  if ((epc === 0x8f || epc === 0xb3) && pv.length > 0) {
    const val = pv[0];
    if (val === 0x41) return 'Power saving ON';
    if (val === 0x42) return 'Normal operation';
  }

  // Operation mode (0xB0 for HVAC)
  if (epc === 0xb0 && pv.length > 0) {
    const val = pv[0];
    const modes: Record<number, string> = {
      0x41: 'Auto', 0x42: 'Cooling', 0x43: 'Heating',
      0x44: 'Dehumidification', 0x45: 'Air circulation', 0x40: 'Other'
    };
    if (modes[val]) return modes[val];
  }

  // Temperature values - decode as Celsius
  if ((epc === 0xbb || epc === 0xbe) && pv.length >= 2) {
    const buf = Buffer.from(pv);
    const temp = buf.readInt16BE(0) / 10;
    if (pv[0] === 0x7e) return 'Unmeasurable';
    return `${temp.toFixed(1)}°C`;
  }

  // Target temperature (0xB3 for HVAC)
  if (epc === 0xb3 && pv.length >= 2) {
    const buf = Buffer.from(pv);
    const temp = buf.readInt16BE(0) / 10;
    return `${temp.toFixed(1)}°C`;
  }

  // Humidity (0xBA for HVAC)
  if (epc === 0xba && pv.length > 0) {
    const val = pv[0];
    if (val === 0xfd) return 'Unmeasurable';
    return `${(val / 2).toFixed(1)}%`;
  }

  // Fan speed/air flow level (0xA0 for HVAC)
  if (epc === 0xa0 && pv.length > 0) {
    const val = pv[0];
    if (val === 0x41) return 'Auto';
    if (val >= 0x31 && val <= 0x38) return `Level ${val - 0x30}`;
  }

  // Time values (0x91, 0x95)
  if ((epc === 0x91 || epc === 0x95) && pv.length >= 2) {
    const hours = pv[0];
    const minutes = pv[1];
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  return null; // No special decoding - return raw value
}