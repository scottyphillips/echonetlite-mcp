import { resolveRef, loadDefinitions } from './dist/mra.js';
import fs from 'fs';
import path from 'path';

const mraDir = path.join(process.cwd(), 'mra', 'mraData');

// Test resolveRef for number_0-99_u16
const refResult = resolveRef('#/definitions/number_0-99_u16', mraDir);
console.log('=== resolveRef("#/definitions/number_0-99_u16") ===');
console.log(JSON.stringify(refResult, null, 2));

// Test resolveRef for state_DefaultValue_00FF
const defaultValueRef = resolveRef('#/definitions/state_DefaultValue_00FF', mraDir);
console.log('\n=== resolveRef("#/definitions/state_DefaultValue_00FF") ===');
console.log(JSON.stringify(defaultValueRef, null, 2));

// Test the oneOf element directly
const dayElement = {
  "oneOf": [
    { "$ref": "#/definitions/number_0-99_u16" },
    { "$ref": "#/definitions/state_DefaultValue_00FF" }
  ]
};

// Inline getTypeByteSize logic
function getTypeByteSize(typeDef, mraDirLocal) {
  if (!typeDef) return 1;

  // Resolve $ref first
  if (typeDef.$ref) {
    const resolved = resolveRef(typeDef.$ref, mraDirLocal);
    console.log(`\nResolving $ref "${typeDef.$ref}" to:`, JSON.stringify(resolved));
    if (resolved) {
      return getTypeByteSize(resolved, mraDirLocal);
    }
  }

  // Handle oneOf
  if (typeDef.oneOf && Array.isArray(typeDef.oneOf)) {
    console.log('\n=== Processing oneOf with', typeDef.oneOf.length, 'options');
    for (const option of typeDef.oneOf) {
      console.log(`Processing option:`, JSON.stringify(option));
      if (option?.$ref && option.$ref.includes('DefaultValue')) {
        console.log(`  Skipping DefaultValue ref`);
        continue;
      }

      const size = getTypeByteSize(option, mraDirLocal);
      console.log(`  Size for this option: ${size}`);
      if (size > 1) return size;
    }
  }

  // Direct format specification
  if (typeDef.format) {
    const fmt = typeDef.format.toLowerCase();
    console.log(`\nFound format: ${fmt}`);
    if (fmt.includes('int8') || fmt.includes('uint8')) return 1;
    if (fmt.includes('int16') || fmt.includes('uint16')) return 2;
    if (fmt.includes('int32') || fmt.includes('uint32')) return 4;
    if (fmt.includes('int64') || fmt.includes('uint64')) return 8;
  }

  // Level-based types
  if (typeDef.levelCount !== undefined) {
    return 1;
  }

  console.log('\nDefaulting to 1 byte');
  return 1;
}

console.log('\n=== getTypeByteSize for day element ===');
const size = getTypeByteSize(dayElement, mraDir);
console.log(`\nFinal byte size: ${size}`);