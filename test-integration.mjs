// ECHONETLite Integration Test - Tests against real HVAC device at 192.168.1.6
import { EchonetLiteClient } from './dist/echonetlite.js';
import { HomeAirConditioner } from './dist/devices/homeAirConditioner.js';

const TEST_HOST = '192.168.1.6';
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

// Small delay helper
const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function runTests() {
  console.log('=== ECHONETLite Integration Test ===');
  console.log(`Target: ${TEST_HOST}\n`);

  const client = new EchonetLiteClient();
  client.initialize();

  // Wait for socket to fully initialize
  await delay(500);

  try {
    // Test 1: Get full status
    console.log('Test 1: get_device_status...');
    const hvac = new HomeAirConditioner(client, TEST_HOST);
    const status = await hvac.getFullStatus();
    assert(status.operation !== null, 'operation is set');
    assert(status.mode !== null, `mode is "${status.mode}"`);
    assert(status.setTemperature !== null, `setTemperature is ${status.setTemperature}°C`);
    assert(status.roomTemperature !== null, `roomTemperature is ${status.roomTemperature}°C`);
    console.log('');

    // Test 2: Get temperatures only
    console.log('Test 2: get_temperatures...');
    const temps = await hvac.getTemperatures();
    assert(temps !== null, 'temperatures response is not null');
    if (temps) {
      assert(typeof temps.room === 'number', `room temperature is ${temps.room}°C`);
      assert(typeof temps.outdoor === 'number', `outdoor temperature is ${temps.outdoor}°C`);
    }
    console.log('');

    // Test 3: Set temperature (then revert)
    console.log('Test 3: set_temperature...');
    const originalTemp = status.setTemperature;
    if (originalTemp !== null) {
      await hvac.setTemperature(23);
      await delay(3000); // Wait for device to process SET command
      const newStatus = await hvac.getFullStatus();
      assert(newStatus.setTemperature === 23, `temperature set to 23°C (got ${newStatus.setTemperature})`);
      
      // Revert to original
      await hvac.setTemperature(originalTemp);
      console.log(`  ℹ️  Reverted temperature to ${originalTemp}°C`);
    }
    console.log('');

    // Test 4: Set operation OFF then back (device is currently ON)
    console.log('Test 4: set_operation...');
    if (status.operation === 'ON') {
      await hvac.setOperation(false);
      await delay(3000); // Wait for device to process SET command
      const newStatus = await hvac.getFullStatus();
      assert(newStatus.operation === 'OFF', `operation is OFF (got ${newStatus.operation})`);
      
      // Revert to ON
      await hvac.setOperation(true);
      console.log(`  ℹ️  Reverted operation to ON`);
    } else {
      await hvac.setOperation(true);
      await delay(3000);
      const newStatus = await hvac.getFullStatus();
      assert(newStatus.operation === 'ON', `operation is ON (got ${newStatus.operation})`);
      
      // Revert to OFF
      await hvac.setOperation(false);
      console.log(`  ℹ️  Reverted operation to OFF`);
    }
    console.log('');

    // Test 5: Get humidity (may return null if not supported)
    console.log('Test 5: get_humidity...');
    await delay(1000); // Buffer between requests
    const humidity = await hvac.getHumidity();
    assert(humidity !== undefined, 'humidity response is defined (may be null)');
    console.log(`  Humidity value: ${humidity ?? 'not supported'}`);
    console.log('');

  } catch (err) {
    console.error(`  ❌ Test error: ${err.message}`);
    failed++;
  } finally {
    client.destroy();
  }

  console.log('=== Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests();