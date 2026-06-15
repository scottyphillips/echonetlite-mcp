import { EchonetLiteClient } from './dist/echonetlite.js';
import * as mra from './dist/mra.js';

async function test() {
  const e = new EchonetLiteClient({ host: '192.168.1.234', port: 20000, timeout: 5000 });
  
  try {
    // Query EPC 0xE2 from energy meter (EOJ 0x0288)
    const result = await e.getEpc({ 
      eojgc: 0x02, 
      eojcc: 0x88, 
      eojinst: 1, 
      epc: 0xE2 
    });
    
    console.log('Raw EPC 0xE2 result:', JSON.stringify(result, null, 2));
    
    // Get MRA property data for EPC 0xE2
    const eojKey = '0x0288';
    const rawData = mra.getRawMraPropertyData(0xE2, eojKey);
    console.log('\n=== MRA property data for EPC 0xE2 ===');
    console.log(JSON.stringify(rawData, null, 2));
    
    if (result && result.pv) {
      // Parse the PV bytes
      const hexBytes = result.pv.replace(/,/g, '');
      const pv = Buffer.from(hexBytes, 'hex');
      console.log('\n=== Raw PV bytes ===');
      console.log('Hex:', Array.from(pv).map(b => b.toString(16).padStart(2, '0')).join(' '));
      console.log('Total bytes:', pv.length);
      
      // Try element parsing if rawData is an object type
      if (rawData && rawData.type === 'object' && rawData.properties) {
        console.log('\n=== Element-level parsing ===');
        const parsed = mra.parseEpcElementsResult(0xE2, new Uint8Array(pv), rawData);
        console.log(JSON.stringify(parsed, null, 2));
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
    if (err.stack) {
      console.error(err.stack);
    }
  } finally {
    e.close();
  }
}

test();