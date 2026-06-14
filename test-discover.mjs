import { EchonetLiteClient } from './dist/echonetlite.js';

async function main() {
  const client = new EchonetLiteClient();
  client.initialize();

  // Wait a moment for socket to bind
  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    console.error('=== Testing discover_device on 192.168.1.234 ===');
    const result = await client.discoverDevice('192.168.1.234', 15000);
    
    console.error('\n=== DISCOVERY RESULT ===');
    console.error(`Host: ${result.host}`);
    console.error(`EOJ Instances: ${result.eojInstances.length}`);
    for (const eoj of result.eojInstances) {
      console.error(`  - 0x${eoj.groupCode.toString(16).padStart(2, '0')}-0x${eoj.classCode.toString(16).padStart(2, '0')}-0x${eoj.instanceId.toString(16).padStart(2, '0')} ${eoj.isPrimary ? '(primary)' : ''}`);
    }
    if (result.nodeProfile) {
      console.error(`Node Profile:`);
      if (result.nodeProfile.manufacturer) {
        const bytes = Array.from(result.nodeProfile.manufacturer);
        // Try to decode as UTF-8 string
        try {
          const str = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
          console.error(`  Manufacturer: ${str}`);
        } catch {
          console.error(`  Manufacturer (raw): [${bytes.join(', ')}]`);
        }
      }
      if (result.nodeProfile.productCode) {
        console.error(`  Product Code: 0x${Array.from(result.nodeProfile.productCode).map(b => b.toString(16).padStart(2, '0')).join('')}`);
      }
      if (result.nodeProfile.uid) {
        console.error(`  UID: ${Array.from(result.nodeProfile.uid).map(b => b.toString(16).padStart(2, '0')).join(':')}`);
      }
      if (result.nodeProfile.instanceList) {
        const edtnum = result.nodeProfile.instanceList[0];
        console.error(`  Instance List: ${edtnum} entries`);
        for (let x = 0; x < edtnum; x++) {
          const baseOffset = 1 + (3 * x);
          if (baseOffset + 2 >= result.nodeProfile.instanceList.length) break;
          console.error(`    Entry ${x}: 0x${result.nodeProfile.instanceList[baseOffset].toString(16).padStart(2, '0')}-0x${result.nodeProfile.instanceList[baseOffset + 1].toString(16).padStart(2, '0')}-0x${result.nodeProfile.instanceList[baseOffset + 2].toString(16).padStart(2, '0')}`);
        }
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  } finally {
    client.destroy();
  }
}

main();