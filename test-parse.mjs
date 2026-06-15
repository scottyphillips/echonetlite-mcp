import { parseEpcElementsResult, getRawMraPropertyData } from './dist/mra.js';
import fs from 'fs';
import path from 'path';

const mraDir = path.join(process.cwd(), 'mra', 'mraData');
const eojKey = '0x0288';
const rawData = getRawMraPropertyData(0xE2, eojKey, mraDir);

// day=15 (0x00 0x0F), then 48 items of 4 bytes each
let hexBytes = ['0x00', '0x0F']; // day = 15 (uint16 BE)
for (let i = 0; i < 48; i++) {
  hexBytes.push('0x00', '0x00', '0x00', '0x13'); // 19 kWh each
}
const pv = new Uint8Array(hexBytes.map(h => parseInt(h.replace('0x', ''), 16)));

console.log('Total bytes:', pv.length);

const result = parseEpcElementsResult(0xE2, pv, rawData, '', 'normalDirectionCumulativeElectricEnergyLog1', mraDir);
fs.writeFileSync('parse-test.json', JSON.stringify(result, null, 2));
console.log('Written to parse-test.json');