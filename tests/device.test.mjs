// Integration tests for ECHONETLite device communication
import { EchonetLiteClient } from '../dist/echonetlite.js';
import { createTest, assert, delay, printSummary, TEST_CONFIG, formatEoj } from './config.mjs';

async function runTests() {
  const results = [];

  console.log('=== ECHONETLite Device Integration Tests ===');
  console.log(`Energy Meter: ${TEST_CONFIG.devices.energyMeter}`);
  console.log(`HVAC: ${TEST_CONFIG.devices.hvac}\n`);

  // Create a single shared client to avoid port binding conflicts
  const client = new EchonetLiteClient();
  client.initialize();
  await delay(500); // Wait for socket initialization

  try {
    // === Test 1: Device Discovery ===
    const testDiscovery = createTest('Device: Discovery tests');

    const device = await client.discoverDevice(TEST_CONFIG.devices.energyMeter, TEST_CONFIG.timeouts.discovery);
    
    assert(device.host === TEST_CONFIG.devices.energyMeter,
      'Discovery returns correct host', { test: testDiscovery });
    
    assert(device.eojInstances.length > 0,
      `Discovery finds ${device.eojInstances.length} EOJ instance(s)`, { test: testDiscovery });

    // Check for expected energy meter EOJ
    const energyMeterEOJ = device.eojInstances.find(e => 
      e.groupCode === TEST_CONFIG.eoj.energyMeter.groupCode &&
      e.classCode === TEST_CONFIG.eoj.energyMeter.classCode
    );
    assert(energyMeterEOJ !== undefined,
      `Finds expected EOJ ${formatEoj(TEST_CONFIG.eoj.energyMeter)}`, { test: testDiscovery });

    if (device.nodeProfile) {
      assert(device.nodeProfile.manufacturer !== null && device.nodeProfile.manufacturer.length > 0,
        'Node profile contains manufacturer data', { test: testDiscovery });
    }

    results.push(testDiscovery);

    // === Test 2: EPC Property Query ===
    const testEpcQuery = createTest('Device: EPC property query tests');

    await delay(1000); // Buffer between requests
    
    const destEoj = {
      groupCode: TEST_CONFIG.eoj.energyMeter.groupCode,
      classCode: TEST_CONFIG.eoj.energyMeter.classCode,
      instanceId: TEST_CONFIG.eoj.energyMeter.instanceId
    };
    
    // Result is an array of {epc, pv, ac} objects
    const result = await client.get(
      TEST_CONFIG.devices.energyMeter,
      [TEST_CONFIG.epc.cumulativeEnergy],
      destEoj
    );

    assert(Array.isArray(result), 'EPC query returns array', { test: testEpcQuery });
    
    if (result && result.length > 0) {
      assert(result[0].epc === TEST_CONFIG.epc.cumulativeEnergy,
        `First result has correct EPC 0x${TEST_CONFIG.epc.cumulativeEnergy.toString(16).toUpperCase()}`, 
        { test: testEpcQuery });
      
      // PV is a Buffer (Node.js) which has .data when serialized via JSON.stringify
      const pvRaw = result[0].pv;
      let pvBytes = null;
      if (pvRaw instanceof Uint8Array) {
        pvBytes = pvRaw.length;
      } else if (Buffer.isBuffer(pvRaw)) {
        pvBytes = pvRaw.length;
      } else if (pvRaw && typeof pvRaw === 'object' && Array.isArray(pvRaw.data)) {
        pvBytes = pvRaw.data.length;
      } else if (Array.isArray(pvRaw)) {
        pvBytes = pvRaw.length;
      }
      assert(pvBytes !== null && pvBytes > 0,
        `Result contains PV data (${pvBytes} bytes)`, { test: testEpcQuery });
    }

    results.push(testEpcQuery);

  } catch (err) {
    console.error(`Test error: ${err.message}`);
  } finally {
    client.destroy();
  }

  // Print summary and exit
  const summary = printSummary(results);
  process.exit(summary.totalFailed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test error:', err.message);
  console.error(err.stack);
  process.exit(1);
});