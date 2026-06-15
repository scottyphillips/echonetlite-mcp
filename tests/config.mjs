// Shared test configuration for ECHONETLite test suite
export const TEST_CONFIG = {
  // Device addresses - update these to match your network
  devices: {
    energyMeter: '192.168.1.234',
    hvac: '192.168.1.6'
  },

  // Test timeouts (in milliseconds)
  timeouts: {
    discovery: 15000,
    deviceQuery: 10000,
    integration: 30000,
    mcpTool: 20000
  },

  // ECHONETLite settings
  echonet: {
    multicastAddress: '224.0.23.0',
    defaultPort: 20000,
    probePort: 3610
  },

  // EOJ (Echonet Object) addresses
  eoj: {
    energyMeter: { groupCode: 0x02, classCode: 0x88, instanceId: 0x01 }, // Electric meter
    hvac: { groupCode: 0x0b, classCode: 0xe0, instanceId: 0x01 } // Home air conditioner
  },

  // Common EPC codes
  epc: {
    operationStatus: 0xE0,
    operatingMode: 0xE1,
    setTemperature: 0xE2,
    roomTemperature: 0xE3,
    humiditySensor: 0xB7,
    cumulativeEnergy: 0xE2 // Used by smart meter for cumulative energy
  }
};

// Helper to get formatted EOJ string
export function formatEoj(eoj) {
  return `0x${eoj.groupCode.toString(16).padStart(2, '0')}-0x${eoj.classCode.toString(16).padStart(2, '0')}-0x${eoj.instanceId.toString(16).padStart(2, '0')}`;
}

// Helper for delayed promises
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Simple assertion helper
export function assert(condition, message, { test } = {}) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    if (test) test.passed = (test.passed || 0) + 1;
  } else {
    console.error(`  ✗ ${message}`);
    if (test) test.failed = (test.failed || 0) + 1;
  }
}

// Test runner helper
export function createTest(name) {
  const result = { name, passed: 0, failed: 0 };
  console.log(`\n${name}`);
  return result;
}

export function printSummary(results) {
  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  
  console.log('\n=== Test Summary ===');
  for (const r of results) {
    const status = r.failed > 0 ? '✗ FAILED' : '✓ PASSED';
    console.log(`  ${status}: ${r.name} (${r.passed}/${r.passed + r.failed})`);
  }
  console.log(`\nTotal: ${totalPassed} passed, ${totalFailed} failed`);
  
  return { totalPassed, totalFailed };
}