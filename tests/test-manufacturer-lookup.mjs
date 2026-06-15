import { readFileSync } from 'fs';

const data = JSON.parse(readFileSync('src/manufactorers.json', 'utf-8'));

function lookupManufacturerName(pv) {
  if (!pv || pv.length === 0) return null;
  // Generate UPPERCASE hex key to match manufacturers.json format (e.g., "0x00000B")
  const hexKey = '0x' + Array.from(pv).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
  console.log('Looking up key:', hexKey);
  return data[hexKey] || null;
}

const tests = [
  ['Hitachi', [0x00, 0x00, 0x01]],
  ['Sharp', [0x00, 0x00, 0x05]],
  ['Panasonic', [0x00, 0x00, 0x0B]],
  ['Fujitsu General (0x8A)', [0x00, 0x00, 0x8A]],
  ['Chofu Seisakusho (0x88)', [0x00, 0x00, 0x88]],
  ['Unknown', [0xFF, 0xFF, 0xFF]]
];

console.log('=== Manufacturer Lookup Tests ===');
for (const [name, bytes] of tests) {
  const result = lookupManufacturerName(new Uint8Array(bytes));
  console.log(`${name}: ${result}`);
}