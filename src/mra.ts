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

/** Decode simple state values based on MRA definitions */
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