// Unit tests for MRA (Mandatory Runtime Attributes) parsing
import { resolveRef, getRawMraPropertyData, parseEpcElementsResult } from '../dist/mra.js';
import path from 'path';
import { createTest, assert, delay, printSummary, TEST_CONFIG } from './config.mjs';

const mraDir = path.join(process.cwd(), 'mra', 'mraData');

async function runTests() {
  const results = [];

  // === Test: resolveRef ===
  const testResolveRef = createTest('MRA: resolveRef tests');
  
  // Test resolving a number type definition (format is "uint16", not "u16")
  const numResult = resolveRef('#/definitions/number_0-99_u16', mraDir);
  assert(numResult !== null && numResult.format === 'uint16', 
    'Resolves number_0-99_u16 with correct format (uint16)', { test: testResolveRef });
  
  // Test resolving a DefaultValue definition (has "type" and "enum", not "subType")
  const defResult = resolveRef('#/definitions/state_DefaultValue_00FF', mraDir);
  assert(defResult !== null && defResult.type === 'state' && defResult.enum.length > 0,
    'Resolves state_DefaultValue_00FF with enum values', { test: testResolveRef });

  results.push(testResolveRef);

  // === Test: getRawMraPropertyData ===
  const testGetPropertyData = createTest('MRA: getRawMraPropertyData tests');
  
  // Test getting property data for smart meter EPC 0xE2
  const rawData = getRawMraPropertyData(0xE2, '0x0288');
  assert(rawData !== null,
    'Gets raw property data for EPC 0xE2 on EOJ 0x0288', { test: testGetPropertyData });
  
  // Test getting non-existent property data
  const missingData = getRawMraPropertyData(0xFF, '0x0288');
  assert(missingData === null || missingData.error !== undefined,
    'Returns null/error for non-existent EPC', { test: testGetPropertyData });

  results.push(testGetPropertyData);

  // === Test: parseEpcElementsResult with simulated data ===
  const testParseElements = createTest('MRA: parseEpcElementsResult tests');
  
  // Simulate smart meter energy log data (day=15, 48 items of 4 bytes each)
  let hexBytes = ['0x00', '0x0F']; // day = 15 (uint16 BE)
  for (let i = 0; i < 48; i++) {
    hexBytes.push('0x00', '0x00', '0x00', '0x13'); // 19 kWh each
  }
  const pv = new Uint8Array(hexBytes.map(h => parseInt(h.replace('0x', ''), 16)));
  
  const parseResult = parseEpcElementsResult(
    0xE2, pv, rawData, 
    'Historical data of measured cumulative amounts',
    'normalDirectionCumulativeElectricEnergyLog1',
    mraDir
  );
  
  assert(parseResult.elements.length >= 2,
    `Parses multiple elements (got ${parseResult.elements.length})`, { test: testParseElements });
  
  // Check day element
  const dayElem = parseResult.elements.find(e => e.name === 'day');
  assert(dayElem !== undefined && dayElem.values.length === 2,
    'Day element has correct byte count (2)', { test: testParseElements });
  
  // Check electricEnergy element alignment
  const energyElem = parseResult.elements.find(e => e.name === 'electricEnergy');
  if (energyElem) {
    const expectedItems = (pv.length - 2) / 4;
    assert(energyElem.values.length === 48,
      `Electric energy has correct item count (${expectedItems})`, { test: testParseElements });
    
    // Check first item values
    if (energyElem.values[0]) {
      assert(energyElem.values[0][0] === '0x00' && energyElem.values[0][1] === '0x00',
        'First energy item has correct byte alignment', { test: testParseElements });
    }
  }

  // Test with real-world data pattern (from test-parse-full.mjs)
  const realWorldHex = "0x00 0x00 0x00 0x00 0x13 0x82 0x00 0x00 0x13 0x95";
  const realBytes = new Uint8Array(realWorldHex.trim().split(/\s+/).map(h => 
    parseInt(h.replace(/^0x/i, ''), 16)
  ));
  
  const realResult = parseEpcElementsResult(0xE2, realBytes, rawData, '', 'normalDirectionCumulativeElectricEnergyLog1', mraDir);
  assert(Array.isArray(realResult.elements),
    'Handles partial data without errors', { test: testParseElements });

  results.push(testParseElements);

  // === Test: getTypeByteSize logic ===
  const testGetTypeByteSize = createTest('MRA: getTypeByteSize logic tests');
  
  function getTypeByteSize(typeDef) {
    if (!typeDef) return 1;
    if (typeDef.$ref) {
      const resolved = resolveRef(typeDef.$ref, mraDir);
      if (resolved) return getTypeByteSize(resolved);
    }
    if (typeDef.oneOf && Array.isArray(typeDef.oneOf)) {
      for (const option of typeDef.oneOf) {
        if (option?.$ref && option.$ref.includes('DefaultValue')) continue;
        const size = getTypeByteSize(option);
        if (size > 1) return size;
      }
    }
    if (typeDef.format) {
      const fmt = typeDef.format.toLowerCase();
      if (fmt.includes('int8') || fmt.includes('uint8')) return 1;
      if (fmt.includes('int16') || fmt.includes('uint16')) return 2;
      if (fmt.includes('int32') || fmt.includes('uint32')) return 4;
      if (fmt.includes('int64') || fmt.includes('uint64')) return 8;
    }
    if (typeDef.levelCount !== undefined) return 1;
    return 1;
  }

  // Test uint16 type (format is "uint16", not "u16")
  const u16Size = getTypeByteSize({ format: 'uint16' });
  assert(u16Size === 2, `uint16 returns 2 bytes (got ${u16Size})`, { test: testGetTypeByteSize });
  
  // Test uint8 type
  const u8Size = getTypeByteSize({ format: 'uint8' });
  assert(u8Size === 1, `uint8 returns 1 byte (got ${u8Size})`, { test: testGetTypeByteSize });
  
  // Test oneOf with DefaultValue skip
  const oneOfSize = getTypeByteSize({
    oneOf: [
      { $ref: '#/definitions/number_0-99_u16' },
      { $ref: '#/definitions/state_DefaultValue_00FF' }
    ]
  });
  assert(oneOfSize === 2, `oneOf with u16 returns 2 bytes (got ${oneOfSize})`, { test: testGetTypeByteSize });

  results.push(testGetTypeByteSize);

  // Print summary and exit
  const summary = printSummary(results);
  process.exit(summary.totalFailed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test error:', err.message);
  console.error(err.stack);
  process.exit(1);
});