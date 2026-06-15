/**
 * MRA (Mandatory Requirements for All) Property Lookup
 * Uses bundled MRA data loaded at build time via __dirname-relative path.
 * This eliminates runtime file reads that break when process.cwd() != project root.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use createRequire to get require() in ES module context
const require = createRequire(import.meta.url);

// ============================================================================
// Bundled MRA Data - loaded once at module initialization via __dirname-relative path
// ============================================================================

let bundledData: { version: string; files: Record<string, any> } | null = null;

function loadBundledMraData(): { version: string; files: Record<string, any> } | null {
  if (bundledData) return bundledData;
  
  try {
    // Load from bundled JSON file using __dirname-relative path (always works regardless of cwd)
    const bundledPath = path.join(__dirname, 'mra-bundled.json');
    bundledData = require(bundledPath);
  } catch (e: any) {
    console.error(`Error loading bundled MRA data: ${e.message}`);
    bundledData = { version: '1.0', files: {} };
  }
  
  return bundledData;
}

// Helper to get a file from the bundled data by EOJ key and path pattern
function getBundledFile(eojKey: string, subDir: string): any {
  const bundled = loadBundledMraData();
  if (!bundled) return null;
  // Try exact match first (e.g., "mraData/devices/0x0288.json")
  const exactPath = `mraData/${subDir}/${eojKey}.json`;
  if (bundled.files[exactPath]) return bundled.files[exactPath];
  
  // Try with leading zero variations
  for (const key of Object.keys(bundled.files)) {
    if (key.endsWith(`/${subDir}/${eojKey}.json`)) return bundled.files[key];
  }
  
  return null;
}

function getBundledFileByPath(relativePath: string): any {
  const bundled = loadBundledMraData();
  if (!bundled) return null;
  // Normalize path separators
  const normalizedPath = relativePath.replace(/\\/g, '/');
  if (bundled.files[normalizedPath]) return bundled.files[normalizedPath];
  
  // Try with forward slashes
  const fsPath = `mraData/${normalizedPath}`;
  if (bundled.files[fsPath]) return bundled.files[fsPath];
  
  return null;
}

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

/** Lookup table: EOJ key (e.g., "0x0130") → property map by EPC */
interface PropertyLookup {
  eoJName: string;
  shortName?: string;
  properties: Map<number, { name: string; shortName: string; accessRule: MraProperty['accessRule']; description?: string }>;
}

// ============================================================================
// Coefficient Rule Types
// ============================================================================

/** Represents a coefficient relationship between EPCs */
export interface CoefficientRule {
  /** The EPC code that requires coefficient application */
  sourceEpc: number;
  /** Source property short name for context */
  sourceShortName: string;
  /** Source property name for context */
  sourcePropertyName: string;
  /** List of coefficient EPCs to multiply by */
  coefficientEpcs: number[];
  /** Coefficient property details */
  coefficientDetails: {
    epc: number;
    shortName: string;
    propertyName: string;
  }[];
  /** Human-readable instruction for LLMs */
  instruction: string;
  /** The note from the MRA definition explaining the coefficient relationship */
  note?: string;
}

/** Represents a complex property rule that requires additional context */
export interface ComplexPropertyRule {
  epc: number;
  shortName: string;
  propertyName: string;
  ruleType: 'coefficient' | 'atomic' | 'conditional' | 'array';
  metadata: Record<string, any>;
  hints: string[];
}

// Cache for superclass properties (loaded once from bundled data)
let superClassPropsCache: Map<number, { name: string; shortName: string; accessRule: MraProperty['accessRule']; description?: string }> | null = null;

let propertyCache: Map<string, PropertyLookup> | null = null;
let definitionsCache: any = null;

// ============================================================================
// Embedded Manufacturer Data (for EPC 0x8A enrichment)
// ============================================================================

/** Manufacturer code lookup map: hex key → company name */
export interface ManufacturerMap {
  [key: string]: string;
}

let manufacturersCache: ManufacturerMap | null = null;

/** Load embedded manufacturer data from bundled JSON */
export function loadManufacturers(): ManufacturerMap {
  if (manufacturersCache !== null) {
    return manufacturersCache;
  }
  
  manufacturersCache = {};
  
  try {
    const bundled = loadBundledMraData();
    if (!bundled) return manufacturersCache;
    
    // Check for embedded manufacturers.json in bundled data
    const embeddedManufacturers = bundled.files['manufactorers.json'];
    if (embeddedManufacturers && typeof embeddedManufacturers === 'object') {
      manufacturersCache = embeddedManufacturers as ManufacturerMap;
      return manufacturersCache;
    }
  } catch {
    // Fall back to empty map
  }
  
  return manufacturersCache;
}

/** Build EOJ key from components */
export function buildEojKey(gc: number, cc: number, inst?: number): string {
  return `0x${gc.toString(16).padStart(2, '0').toUpperCase()}${cc.toString(16).padStart(2, '0').toUpperCase()}`;
}

/** Load superclass properties from bundled data */
function loadSuperClassProperties(): Map<number, { name: string; shortName: string; accessRule: MraProperty['accessRule']; description?: string }> | null {
  if (superClassPropsCache) return superClassPropsCache;
  
  // Try the main superclass file first (0x0000.json)
  const superClassFile = getBundledFile('0x0000', 'superClass');
  if (!superClassFile) {
    // Also try by path pattern
    const data = getBundledFileByPath('superClass/0x0000.json');
    if (!data) return null;
    
    superClassPropsCache = new Map();
    if (data.elProperties && Array.isArray(data.elProperties)) {
      for (const p of data.elProperties) {
        if (p.epc != null && p.shortName) {
          const propInfo = {
            name: p.propertyName?.en || p.propertyName?.ja || '',
            shortName: p.shortName,
            accessRule: p.accessRule || {},
            description: p.descriptions?.en || p.descriptions?.ja || ''
          };
          superClassPropsCache.set(parseInt(p.epc, 16), propInfo);
        }
      }
    }
    return superClassPropsCache;
  }
  
  superClassPropsCache = new Map();
  if (superClassFile.elProperties && Array.isArray(superClassFile.elProperties)) {
    for (const p of superClassFile.elProperties) {
      if (p.epc != null && p.shortName) {
        const propInfo = {
          name: p.propertyName?.en || p.propertyName?.ja || '',
          shortName: p.shortName,
          accessRule: p.accessRule || {},
          description: p.descriptions?.en || p.descriptions?.ja || ''
        };
        superClassPropsCache.set(parseInt(p.epc, 16), propInfo);
      }
    }
  }
  
  return superClassPropsCache;
}

/** Load all MRA data from bundled data */
export function loadMraData(mraDir?: string): Map<string, PropertyLookup> | null {
  if (propertyCache) return propertyCache;
  
  const result = new Map<string, PropertyLookup>();
  
  // Load superclass properties FIRST (common properties inherited by ALL devices)
  superClassPropsCache = loadSuperClassProperties();
  
  // Get all device files from bundled data
  const bundled = loadBundledMraData();
  if (!bundled) return null;
  
  for (const [filePath, content] of Object.entries(bundled.files)) {
    // Load both device files and node profile files
    const isDeviceFile = filePath.startsWith('mraData/devices/');
    const isNodeProfileFile = filePath.startsWith('mraData/nodeProfile/');
    if (!isDeviceFile && !isNodeProfileFile) continue;
    
    try {
      const fileContent = content as any;
      if (fileContent.elProperties && Array.isArray(fileContent.elProperties) && fileContent.eoj) {
        // Start with superclass properties as the base
        const props: Map<number, { name: string; shortName: string; accessRule: MraProperty['accessRule']; description?: string }> = new Map();
        
        // First add all superclass properties (shared by all devices)
        if (superClassPropsCache) {
          for (const [epc, info] of superClassPropsCache) {
            props.set(epc, info);
          }
        }
        
        // Then overlay device-specific properties (may override superclass for same EPC)
        for (const p of fileContent.elProperties) {
          if (p.epc != null && p.shortName) {
            const propInfo = {
              name: p.propertyName?.en || p.propertyName?.ja || '',
              shortName: p.shortName,
              accessRule: p.accessRule || {},
              description: p.descriptions?.en || p.descriptions?.ja || ''
            };
            props.set(parseInt(p.epc, 16), propInfo);
          }
        }
        
        // Node Profile files use "eoj" field for the EOJ key (0x0EF0)
        const eojKey = isNodeProfileFile ? fileContent.eoj : fileContent.eoj;
        result.set(eojKey, {
          eoJName: fileContent.className?.en || fileContent.className?.ja || fileContent.eoj,
          shortName: fileContent.shortName,
          properties: props
        });
      }
    } catch (e) {
      // Skip invalid files
    }
  }
  
  propertyCache = result;
  return result;
}

/** Load definitions from bundled data */
export function loadDefinitions(mraDir?: string): any {
  if (definitionsCache) return definitionsCache;
  
  const defsFile = getBundledFileByPath('definitions/definitions.json');
  
  if (defsFile) {
    definitionsCache = defsFile;
  } else {
    definitionsCache = { definitions: {} };
  }
  
  return definitionsCache;
}

/** Resolve a $ref to its definition */
export function resolveRef(ref: string, mraDir?: string): any {
  if (!ref) return null;
  
  // Strip leading '#' from JSON pointers (e.g., "#/definitions/state_ON-OFF_3031" -> "/definitions/state_ON-OFF_3031")
  const normalizedRef = ref.startsWith('#') ? ref.slice(1) : ref;
  
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
  if (!cache) return null;
  const lookup = cache.get(eojKey);
  if (!lookup) return null;
  return lookup.properties.get(epc) || null;
}

/** Get all property info for a specific EOJ */
export function getAllPropertyInfo(eojKey: string, mraDir?: string): Map<number, { name: string; shortName: string; accessRule: MraProperty['accessRule']; description?: string }> | null {
  const cache = loadMraData(mraDir);
  if (!cache) return null;
  const lookup = cache.get(eojKey);
  return lookup ? lookup.properties : null;
}

/** Get EOJ class name */
export function getEojName(eojKey: string, mraDir?: string): string {
  const cache = loadMraData(mraDir);
  if (!cache) return eojKey;
  const lookup = cache.get(eojKey);
  return lookup ? lookup.eoJName : eojKey;
}

// ============================================================================
// Coefficient Extraction Functions
// ============================================================================

/**
 * Extract coefficient EPCs from raw data definition.
 * Scans the data structure for "coefficient" arrays at any nesting level.
 * Returns unique coefficient EPC values as numbers.
 */
function extractCoefficientEpcs(data: any, mraDir?: string): number[] {
  const coefficients = new Set<number>();
  
  if (!data) return Array.from(coefficients);
  
  // Helper recursive function to scan data structures
  function scanForCoefficients(obj: any): void {
    if (!obj || typeof obj !== 'object') return;
    
    // Check for direct coefficient array
    if (Array.isArray(obj.coefficient)) {
      for (const coeff of obj.coefficient) {
        const epcNum = parseInt(coeff.replace('0x', ''), 16);
        if (!isNaN(epcNum)) {
          coefficients.add(epcNum);
        }
      }
    }
    
    // Recurse into nested objects and arrays
    for (const key of Object.keys(obj)) {
      scanForCoefficients(obj[key]);
    }
  }
  
  scanForCoefficients(data);
  
  return Array.from(coefficients);
}

/**
 * Parse an object-type EPC value into named elements based on MRA definition.
 * 
 * Returns a clean structure where each element contains:
 * - The data definition (type, itemSize, minItems, maxItems, etc.)
 * - A proper-sized array of hex values (one per byte)
 * 
 * Example output for EPC 0xE2:
 * {
 *   "elements": [
 *     {
 *       "name": "day",
 *       "definition": { "type": "number", "format": "uint16" },
 *       "values": ["0x00", "0x00"]
 *     },
 *     {
 *       "name": "electricEnergy",
 *       "definition": { "type": "array", "itemSize": 4, "minItems": 48, "maxItems": 48 },
 *       "values": ["0x00", "0x00", "0x00", "0x13", ...]  // 192 hex values for 48 items × 4 bytes
 *     }
 *   ]
 * }
 */
export function parseEpcElements(
  pv: Uint8Array,
  propertyData: any,
  mraDir?: string
): {
  elements: Array<{
    name: string;
    label?: string;
    definition: Record<string, any>;
    values: any[];
  }>;
} {
  const elements: Array<{
    name: string;
    label?: string;
    definition: Record<string, any>;
    values: any[];
  }> = [];
  
  if (!propertyData || propertyData.type !== 'object' || !propertyData.properties) {
    return { elements };
  }
  
  let offset = 0;
  
  for (const propDef of propertyData.properties) {
    const elementName = propDef.shortName || '';
    const label = propDef.elementName?.en || propDef.elementName?.ja || elementName;
    
    if (!elementName) continue;
    
    const values: any[] = [];
    
    if (propDef.element?.type === 'array') {
      // Array type - extract each item as a separate array element
      const itemSize = propDef.element.itemSize || 1;
      const effectiveItemSize = itemSize;
      const calculatedCount = Math.floor((pv.length - offset) / effectiveItemSize);
      const itemCount = calculatedCount;
      
      for (let i = 0; i < itemCount; i++) {
        const itemStart = offset + i * effectiveItemSize;
        const itemBytes: string[] = [];
        
        for (let j = 0; j < effectiveItemSize && itemStart + j < pv.length; j++) {
          itemBytes.push(`0x${pv[itemStart + j].toString(16).toUpperCase().padStart(2, '0')}`);
        }
        
        values.push(itemBytes);
      }
      
      offset += itemCount * effectiveItemSize;
      
      // Build enriched item definition from MRA data
      const itemsDef = propDef.element.items;
      let itemDefinition: any = null;
      
      if (itemsDef) {
        // Resolve $ref values in the items definition
        function resolveRefs(obj: any): any {
          if (!obj || typeof obj !== 'object') return obj;
          
          if (Array.isArray(obj)) {
            return obj.map(resolveRefs);
          }
          
          if (Array.isArray(obj.oneOf)) {
            const resolvedOneOf = obj.oneOf.map((option: any) => {
              if (option?.$ref) {
                const resolved = resolveRef(option.$ref, mraDir);
                // Merge the original metadata (coefficient, overflowCode, etc.) with the resolved definition
                return resolved ? { ...resolved, ...(option.coefficient && { coefficient: option.coefficient }), ...(option.overflowCode != null && { overflowCode: option.overflowCode }), ...(option.underflowCode != null && { underflowCode: option.underflowCode }) } : option;
              }
              return resolveRefs(option);
            });
            return { oneOf: resolvedOneOf };
          }
          
          if (obj.$ref) {
            const resolved = resolveRef(obj.$ref, mraDir);
            return resolved ? { ...resolved, ...(obj.coefficient && { coefficient: obj.coefficient }), ...(obj.overflowCode != null && { overflowCode: obj.overflowCode }), ...(obj.underflowCode != null && { underflowCode: obj.underflowCode }) } : obj;
          }
          
          // Recurse into remaining object properties
          const result: any = {};
          for (const [key, value] of Object.entries(obj)) {
            if (key !== '$ref') {
              result[key] = resolveRefs(value);
            }
          }
          return result;
        }
        
        itemDefinition = resolveRefs(itemsDef);
      }
      
      elements.push({
        name: elementName,
        label: label || undefined,
        definition: {
          type: 'array',
          itemSize,
          minItems: propDef.element.minItems,
          maxItems: propDef.element.maxItems,
          itemCount,
          items: itemDefinition,
        },
        values,
      });
    } else {
      // Scalar type - get byte size from definition (pass mraDir for $ref resolution)
      const byteSize = getTypeByteSize(propDef.element, mraDir) || 1;
      
      for (let i = 0; i < byteSize && offset + i < pv.length; i++) {
        values.push(`0x${pv[offset + i].toString(16).toUpperCase().padStart(2, '0')}`);
      }
      
      offset += Math.min(byteSize, pv.length - offset);
      
      elements.push({
        name: elementName,
        label: label || undefined,
        definition: propDef.element || {},
        values,
      });
    }
  }
  
  return { elements };
}

/**
 * Main exported function: Parse an object/array-type EPC value into named elements.
 * Returns a clean structure with data definitions and proper-sized arrays of hex values.
 */
export function parseEpcElementsResult(
  epc: number,
  pv: Uint8Array,
  propertyData: any,
  propertyName?: string,
  shortName?: string,
  mraDir?: string
): {
  epc: string;
  propertyName: string;
  shortName: string;
  totalBytes: number;
  elements: Array<{
    name: string;
    label?: string;
    definition: Record<string, any>;
    values: any[];
  }>;
} {
  const result = parseEpcElements(pv, propertyData, mraDir);
  
  return {
    epc: `0x${epc.toString(16).toUpperCase()}`,
    propertyName: propertyName || '',
    shortName: shortName || '',
    totalBytes: pv.length,
    elements: result.elements,
  };
}

/** Get raw MRA property data for a specific EPC from the device JSON (or superclass if not found in device-specific file) */
export function getRawMraPropertyData(epc: number, eojKey: string, mraDir?: string): any {
  // First try the device-specific file
  const deviceFile = getBundledFile(eojKey, 'devices');
  if (deviceFile) {
    try {
      if (deviceFile.elProperties && Array.isArray(deviceFile.elProperties)) {
        const epcHex = `0x${epc.toString(16).toUpperCase()}`;
        const prop = deviceFile.elProperties.find((p: any) => p.epc === epcHex);
        if (prop?.data !== undefined) {
          return prop.data;
        }
      }
    } catch {
      // Fall through to superclass lookup
    }
  }
  
  // If not found in device file, check superclass files for inherited properties
  const superClassData = getBundledFileByPath('superClass/0x0000.json');
  if (superClassData && superClassData.elProperties && Array.isArray(superClassData.elProperties)) {
    const epcHex = `0x${epc.toString(16).toUpperCase()}`;
    const prop = superClassData.elProperties.find((p: any) => p.epc === epcHex);
    if (prop?.data !== undefined) {
      return prop.data;
    }
  }
  
  // Also check other superclass files
  const bundled = loadBundledMraData();
  if (!bundled) return null;
  
  for (const [filePath, content] of Object.entries(bundled.files)) {
    if (!filePath.startsWith('mraData/superClass/')) continue;
    
    try {
      const fileContent = content as any;
      if (fileContent.elProperties && Array.isArray(fileContent.elProperties)) {
        const epcHex = `0x${epc.toString(16).toUpperCase()}`;
        const prop = fileContent.elProperties.find((p: any) => p.epc === epcHex);
        if (prop?.data !== undefined) {
          return prop.data;
        }
      }
    } catch {
      // Skip invalid files
    }
  }
  
  return null;
}

// ============================================================================
// Coefficient Rule Functions
// ============================================================================

/**
 * Get coefficient rule for a specific EPC from the device definition.
 * Returns coefficient information if this property requires multiplication by other EPC values.
 */
export function getCoefficientRule(epc: number, eojKey: string, mraDir?: string): CoefficientRule | null {
  const rawData = getRawMraPropertyData(epc, eojKey, mraDir);
  
  if (!rawData?.coefficient) return null;
  
  // Extract coefficient EPCs from the data definition
  const coeffEpcs = extractCoefficientEpcs(rawData, mraDir);
  
  if (coeffEpcs.length === 0) return null;
  
  // Get property info for context
  const cache = loadMraData(mraDir);
  if (!cache) return null;
  const lookup = cache.get(eojKey);
  if (!lookup) return null;
  
  const propInfo = lookup.properties.get(epc);
  
  // Get coefficient details
  const coeffDetails: CoefficientRule['coefficientDetails'] = coeffEpcs.map(coeffEpc => {
    const coeffPropInfo = lookup.properties.get(coeffEpc);
    return {
      epc: coeffEpc,
      shortName: coeffPropInfo?.shortName || `epc_0x${coeffEpc.toString(16).toUpperCase()}`,
      propertyName: coeffPropInfo?.name || 'Unknown',
    };
  });
  
  // Generate human-readable instruction for LLMs
  const coeffNames = coeffDetails.map(d => `${d.shortName} (EPC 0x${d.epc.toString(16).toUpperCase()})`).join(' × ');
  const instruction = `⚠️ COEFFICIENT RULE: The raw value for "${propInfo?.shortName || propInfo?.name}" must be multiplied by:\n   ${coeffNames}`;
  
  return {
    sourceEpc: epc,
    sourceShortName: propInfo?.shortName || `epc_0x${epc.toString(16).toUpperCase()}`,
    sourcePropertyName: propInfo?.name || 'Unknown',
    coefficientEpcs: coeffEpcs,
    coefficientDetails: coeffDetails,
    instruction,
    note: rawData.note,
  };
}

/** Get all coefficient rules for a specific EOJ type */
export function getAllCoefficientRules(eojKey: string, mraDir?: string): CoefficientRule[] {
  const cache = loadMraData(mraDir);
  if (!cache) return [];
  const lookup = cache.get(eojKey);
  
  if (!lookup) return [];
  
  const rules: CoefficientRule[] = [];
  
  for (const [epc] of lookup.properties.entries()) {
    const rule = getCoefficientRule(epc, eojKey, mraDir);
    if (rule) {
      rules.push(rule);
    }
  }
  
  return rules;
}

/** Get coefficient details for a source EPC */
function getCoefficientDetails(
  sourceEpc: number,
  coeffEpcs: number[],
  eojKey: string,
  mraDir?: string
): CoefficientRule['coefficientDetails'] {
  const cache = loadMraData(mraDir);
  if (!cache) return [];
  const lookup = cache.get(eojKey);
  if (!lookup) return [];
  
  return coeffEpcs.map(coeffEpc => {
    const propInfo = lookup.properties.get(coeffEpc);
    return {
      epc: coeffEpc,
      shortName: propInfo?.shortName || `epc_0x${coeffEpc.toString(16).toUpperCase()}`,
      propertyName: propInfo?.name || 'Unknown',
    };
  });
}

/** Generate coefficient instruction string */
function generateCoefficientInstruction(
  sourceShortName: string,
  coeffDetails: CoefficientRule['coefficientDetails'],
  note?: string
): string {
  const coeffNames = coeffDetails.map(d => `${d.shortName} (EPC 0x${d.epc.toString(16).toUpperCase()})`).join(' × ');
  return `⚠️ COEFFICIENT RULE: The raw value for "${sourceShortName}" must be multiplied by:\n   ${coeffNames}${note ? `\n   Note: ${note}` : ''}`;
}

/**
 * Result of decoding an EPC value with MRA enrichment data.
 * Includes coefficient hints for complex properties that require additional processing.
 */
export interface DecodedEpcValue {
  propertyName: string;
  shortName: string;
  description: string;
  humanReadableValue: string;
  rawValue: string;
  /** Coefficient rule if this property requires multiplication by other EPC values */
  coefficientRule?: CoefficientRule | null;
  /** Complex property rules (coefficient, atomic, array, etc.) */
  complexRules?: ComplexPropertyRule[] | null;
}

/**
 * Decode an EPC value using MRA enrichment data.
 * Returns a human-readable value by combining the property definition (enum values, data types)
 * with the actual value bytes. Uses the MRA as the source of truth.
 * 
 * For complex properties like 0x0288's energy meter readings, this function automatically
 * detects coefficient relationships and returns hints about how to properly calculate
 * the final value by multiplying with other EPC values.
 */
export function decodeEpcValue(epc: number | string, pv: Uint8Array | number[], eojKey: string = '0x0130', mraDir?: string): DecodedEpcValue | null {
  // Convert EPC to number if string
  const epcNum = typeof epc === 'string' ? parseInt(epc.replace('0x', ''), 16) : epc;
  
  // Load MRA data and get property info
  const cache = loadMraData(mraDir);
  if (!cache) return null;
  const lookup = cache.get(eojKey);
  if (!lookup) return null;
  
  const propInfo = lookup.properties.get(epcNum);
  if (!propInfo) return null;
  
  // Get the raw MRA property data for enum/value decoding
  const rawData = getRawMraPropertyData(epcNum, eojKey, mraDir);
  
  // Decode the value based on MRA data structure
  const decodedValue = decodeValueFromMraData(pv, rawData, epcNum, mraDir);
  
  // Check for coefficient rules - this is critical for energy meters and other devices
  const coeffRule = getCoefficientRule(epcNum, eojKey, mraDir);
  
  // Also check for any complex property rules (atomic, array, etc.)
  let allComplexRules: ComplexPropertyRule[] | null = null;
  if (!coeffRule) {
    const atomicRule = getAtomicRule(epcNum, eojKey, mraDir);
    const arrayRule = getArrayRule(epcNum, eojKey, mraDir);
    allComplexRules = [];
    if (atomicRule) allComplexRules.push(atomicRule);
    if (arrayRule) allComplexRules.push(arrayRule);
    if (allComplexRules.length === 0) allComplexRules = null;
  }
  
  return {
    propertyName: propInfo.name || 'Unknown',
    shortName: propInfo.shortName || `epc_${epcNum.toString(16).toUpperCase()}`,
    description: propInfo.description || '',
    humanReadableValue: decodedValue,
    rawValue: Array.from(pv instanceof Uint8Array ? pv : new Uint8Array(pv)).map(b => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`).join(' '),
    coefficientRule: coeffRule || null,
    complexRules: allComplexRules,
  };
}

// ============================================================================
// Additional Complex Property Rule Functions
// ============================================================================

/** Get atomic operation rule for an EPC */
function getAtomicRule(epc: number, eojKey: string, mraDir?: string): ComplexPropertyRule | null {
  const rawData = getRawMraPropertyData(epc, eojKey, mraDir);
  
  if (!rawData?.atomic) return null;
  
  const cache = loadMraData(mraDir);
  if (!cache) return null;
  const lookup = cache.get(eojKey);
  if (!lookup) return null;
  
  const propInfo = lookup.properties.get(epc);
  const atomicEpc = parseInt(rawData.atomic.replace('0x', ''), 16);
  
  // Get the atomic partner's property info
  const atomicPropInfo = lookup.properties.get(atomicEpc);
  
  return {
    epc,
    shortName: propInfo?.shortName || `epc_0x${epc.toString(16).toUpperCase()}`,
    propertyName: propInfo?.name || 'Unknown',
    ruleType: 'atomic',
    metadata: {
      atomicEpc,
      atomicShortName: atomicPropInfo?.shortName || `epc_0x${atomicEpc.toString(16).toUpperCase()}`,
      atomicPropertyName: atomicPropInfo?.name || 'Unknown',
    },
    hints: [
      `⚠️ ATOMIC OPERATION: EPC 0x${epc.toString(16).toUpperCase()} (${propInfo?.shortName}) operates atomically with EPC 0x${atomicEpc.toString(16).toUpperCase()} (${atomicPropInfo?.shortName}). These properties must be read/written together as a pair.`,
      `When setting ${propInfo?.shortName}, you MUST also set ${atomicPropInfo?.shortName} in the same operation.`,
    ],
  };
}

/** Get array property rule for an EPC */
function getArrayRule(epc: number, eojKey: string, mraDir?: string): ComplexPropertyRule | null {
  const rawData = getRawMraPropertyData(epc, eojKey, mraDir);
  
  if (!rawData?.type || rawData.type !== 'array' || !rawData.itemSize) return null;
  
  const cache = loadMraData(mraDir);
  if (!cache) return null;
  const lookup = cache.get(eojKey);
  if (!lookup) return null;
  
  const propInfo = lookup.properties.get(epc);
  const itemSize = rawData.itemSize;
  const minItems = rawData.minItems || 0;
  const maxItems = rawData.maxItems || '*';
  
  return {
    epc,
    shortName: propInfo?.shortName || `epc_0x${epc.toString(16).toUpperCase()}`,
    propertyName: propInfo?.name || 'Unknown',
    ruleType: 'array',
    metadata: { itemSize, minItems, maxItems },
    hints: [
      `📊 ARRAY PROPERTY: ${propInfo?.shortName} contains an array of ${itemSize}-byte items.`,
      `Expected range: ${minItems === 0 ? 'zero or more' : minItems + (maxItems !== '*' ? ' to ' + maxItems : '')} items.`,
    ],
  };
}

/** Get all complex rules for a specific EOJ type */
export function getAllComplexRules(eojKey: string, mraDir?: string): ComplexPropertyRule[] {
  const cache = loadMraData(mraDir);
  if (!cache) return [];
  const lookup = cache.get(eojKey);
  
  if (!lookup) return [];
  
  const rules: ComplexPropertyRule[] = [];
  
  // Scan all properties for coefficient relationships
  for (const [epc] of lookup.properties.entries()) {
    const coeffRule = getCoefficientRule(epc, eojKey, mraDir);
    if (coeffRule) {
      rules.push({
        epc,
        shortName: coeffRule.sourceShortName,
        propertyName: coeffRule.sourcePropertyName,
        ruleType: 'coefficient',
        metadata: coeffRule,
        hints: [coeffRule.instruction],
      });
    }
    
    const atomicRule = getAtomicRule(epc, eojKey, mraDir);
    if (atomicRule) {
      rules.push(atomicRule);
    }
    
    const arrayRule = getArrayRule(epc, eojKey, mraDir);
    if (arrayRule) {
      rules.push(arrayRule);
    }
  }
  
  return rules;
}

/** Get all coefficient rules for a specific EOJ type as ComplexPropertyRule[] */
export function getAllCoefficientRulesAsComplex(eojKey: string, mraDir?: string): ComplexPropertyRule[] {
  const cache = loadMraData(mraDir);
  if (!cache) return [];
  const lookup = cache.get(eojKey);
  
  if (!lookup) return [];
  
  const rules: ComplexPropertyRule[] = [];
  
  for (const [epc] of lookup.properties.entries()) {
    const coeffRule = getCoefficientRule(epc, eojKey, mraDir);
    if (coeffRule) {
      rules.push({
        epc,
        shortName: coeffRule.sourceShortName,
        propertyName: coeffRule.sourcePropertyName,
        ruleType: 'coefficient',
        metadata: coeffRule,
        hints: [coeffRule.instruction],
      });
    }
  }
  
  return rules;
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

// ============================================================================
// Element-Level Parsing for Complex Object/Array-Type EPCs
// ============================================================================

/**
 * Get the byte size of a type definition from MRA definitions.
 * Handles format, levels, oneOf types, $ref resolution, and other type specifications.
 */
function getTypeByteSize(typeDef: any, mraDir?: string): number {
  if (!typeDef) return 1;
  
  // Resolve $ref first - look up the actual definition and get its size
  if (typeDef.$ref) {
    const resolved = resolveRef(typeDef.$ref, mraDir);
    if (resolved) {
      return getTypeByteSize(resolved, mraDir);
    }
  }
  
  // Handle oneOf - look into each option to find the byte size
  // Use the first option that has a definable size (typically the non-default value)
  if (typeDef.oneOf && Array.isArray(typeDef.oneOf)) {
    for (const option of typeDef.oneOf) {
      // Skip default value markers (e.g., state_DefaultValue_00FF, state_DefaultValue_FF)
      // These are single-byte sentinel values and should not determine the element size
      if (option?.$ref && (option.$ref.includes('DefaultValue') || option.$ref.includes('_FF$'))) continue;
      
      const size = getTypeByteSize(option, mraDir);
      if (size > 1) return size; // Prefer the option with larger size (the actual data type)
    }
    // If all options are single-byte or were skipped, fall through to default handling
  }
  
  // Direct format specification (uint8, uint16, int16, uint32, etc.)
  if (typeDef.format) {
    const fmt = typeDef.format.toLowerCase();
    if (fmt.includes('int8') || fmt.includes('uint8')) return 1;
    if (fmt.includes('int16') || fmt.includes('uint16')) return 2;
    if (fmt.includes('int32') || fmt.includes('uint32')) return 4;
    if (fmt.includes('int64') || fmt.includes('uint64')) return 8;
  }
  
  // Level-based types: byteSize = ceil(levelCount / 256) to fit max value
  if (typeDef.levelCount !== undefined) {
    // e.g., level_31-8 has 8 levels, needs 1 byte (0x31-0x38)
    return 1;
  }
  
  // Default: 1 byte
  return 1;
}

// parseEpcElements and parseEpcElementsResult are defined above (lines ~250-360)