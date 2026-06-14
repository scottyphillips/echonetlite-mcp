// Test discover_device against 192.168.1.234
import { EchonetLiteClient } from './dist/echonetlite.js';

const TEST_HOST = '192.168.1.234';

async function runTest() {
  console.log('=== discover_device Test ===');
  console.log(`Target: ${TEST_HOST}\n`);

  const client = new EchonetLiteClient();
  client.initialize();

  // Wait for socket to initialize
  await new Promise(r => setTimeout(r, 500));

  try {
    console.log('Starting Node Profile discovery...');
    const device = await client.discoverDevice(TEST_HOST, 15000);
    
    console.log('\n=== Discovery Result ===');
    console.log(`Host: ${device.host}`);
    console.log(`Method: ${device.discoveryMethod}`);
    
    if (device.nodeProfile) {
      console.log('\nNode Profile:');
      const buf = device.nodeProfile.manufacturer;
      console.log(`  Manufacturer: ${buf ? '0x' + Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join(' ') : '(not set)'}`);
      
      const ecoi = device.nodeProfile.productCode;
      console.log(`  Product Code: ${ecoi ? '0x' + Array.from(ecoi).map(b => b.toString(16).padStart(2, '0')).join(' ') : '(not set)'}`);
      
      const uid = device.nodeProfile.uid;
      console.log(`  UID: ${uid ? '0x' + Array.from(uid).map(b => b.toString(16).padStart(2, '0')).join(' ') : '(not set)'}`);
      
      const instList = device.nodeProfile.instanceList;
      if (instList) {
        console.log(`  Instance List: 0x${Array.from(instList).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
        const edtnum = instList[0];
        console.log(`    ${edtnum} EOJ entries:`);
        for (let x = 0; x < edtnum; x++) {
          const baseOffset = 1 + (3 * x);
          if (baseOffset + 2 >= instList.length) break;
          console.log(`      Entry ${x}: 0x${instList[baseOffset].toString(16).padStart(2, '0')}-0x${instList[baseOffset+1].toString(16).padStart(2, '0')}-0x${instList[baseOffset+2].toString(16).padStart(2, '0')}`);
        }
      }
    }

    console.log(`\nEOJ Instances (${device.eojInstances.length}):`);
    for (const eoj of device.eojInstances) {
      console.log(`  ${eoj.groupCode.toString(16).toUpperCase().padStart(2, '0')}-${eoj.classCode.toString(16).toUpperCase().padStart(2, '0')}-${eoj.instanceId.toString(16).toUpperCase().padStart(2, '0')} ${eoj.isPrimary ? '(primary)' : ''}`);
    }

  } catch (err) {
    console.error(`\n❌ Discovery failed: ${err.message}`);
  } finally {
    client.destroy();
  }

  console.log('\n=== Test Complete ===');
}

runTest();