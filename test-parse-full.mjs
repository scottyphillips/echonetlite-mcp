import { getRawMraPropertyData, parseEpcElementsResult } from './dist/mra.js';
import path from 'path';

const mraDir = path.join(process.cwd(), 'mra', 'mraData');

// Simulate what the handler does for EPC 0xE2 on smart meter (EOJ 0x0288)
const rawData = getRawMraPropertyData(0xE2, '0x0288');
console.log('=== Raw property data ===');
console.log(JSON.stringify(rawData, null, 2));

// Simulate the raw hex from device
const rawHexStr = "0x00 0x00 0x00 0x00 0x13 0x82 0x00 0x00 0x13 0x95 0x00 0x00 0x13 0xB6 0x00 0x00 0x14 0x0D 0x00 0x00 0x14 0x53 0x00 0x00 0x14 0x87 0x00 0x00 0x14 0x91 0x00 0x00 0x14 0x9C 0x00 0x00 0x14 0xB0 0x00 0x00 0x14 0xB8 0x00 0x00 0x14 0xFD 0x00 0x00 0x15 0x41 0x00 0x00 0x15 0x5E 0x00 0x00 0x15 0x71 0x00 0x00 0x15 0x83 0x00 0x00 0x15 0xB0 0x00 0x00 0x16 0x12 0x00 0x00 0x16 0x2A 0x00 0x00 0x16 0x35 0x00 0x00 0x16 0x87 0x00 0x00 0x16 0xAC 0x00 0x00 0x17 0x07 0x00 0x00 0x17 0x51 0x00 0x00 0x17 0x9B 0x00 0x00 0x17 0xBA 0x00 0x00 0x18 0x1B 0x00 0x00 0x18 0x5E 0x00 0x00 0x18 0x79 0x00 0x00 0x18 0xD8 0xFF 0xFF 0xFF 0xFE";
const hexBytes = rawHexStr.trim().split(/\s+/).map(h => {
  const cleaned = h.replace(/^0x/i, '');
  return parseInt(cleaned, 16);
});
const pv = new Uint8Array(hexBytes);

console.log(`\n=== PV length: ${pv.length} bytes ===`);
console.log(`First 10 bytes:`, Array.from(pv.slice(0, 10)).map(b => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`).join(' '));

// Parse elements using the MRA definition data (exactly as the handler does)
const result = parseEpcElementsResult(
  0xE2,
  pv,
  rawData,
  "Historical data of measured cumulative amounts of electric energy 1 (normal direction)",
  "normalDirectionCumulativeElectricEnergyLog1",
  mraDir
);

console.log('\n=== Parse result ===');
for (const elem of result.elements) {
  console.log(`Element: ${elem.name}`);
  console.log(`  Values:`, JSON.stringify(elem.values));
  console.log(`  Definition:`, JSON.stringify(elem.definition, null, 2).slice(0, 500));
}

// Check day values specifically
const dayElem = result.elements.find(e => e.name === 'day');
if (dayElem) {
  console.log(`\n=== Day element analysis ===`);
  console.log(`Day values count: ${dayElem.values.length}`);
  console.log(`Day values:`, JSON.stringify(dayElem.values));
  console.log(`Expected: ["0x00", "0x00"] (2 bytes for uint16)`);
}

// Check electricEnergy first item
const energyElem = result.elements.find(e => e.name === 'electricEnergy');
if (energyElem) {
  console.log(`\n=== Electric Energy element analysis ===`);
  console.log(`Item count: ${energyElem.values.length}`);
  if (energyElem.values.length > 0) {
    console.log(`First item:`, JSON.stringify(energyElem.values[0]));
    console.log(`Expected first item: ["0x00", "0x00", "0x13", "0x82"] (4 bytes, aligned after day)`);
  }
}