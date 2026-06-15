# ECHONETLite MCP Test Suite

## Structure

```
tests/
├── config.mjs          # Shared configuration, helpers, and utilities
├── mra.test.mjs        # Unit tests for MRA parsing (resolveRef, parseEpcElementsResult)
├── device.test.mjs     # Integration tests for device communication (discovery, EPC queries, HVAC)
├── mcp.test.mjs        # Tests for MCP server tools via IPC
└── README.md           # This file
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run individual test suites
```bash
npm run test:mra      # MRA parsing unit tests
npm run test:device   # Device integration tests (requires real devices)
npm run test:mcp      # MCP server tool tests
```

## Configuration

Update device addresses in `tests/config.mjs`:

```javascript
export const TEST_CONFIG = {
  devices: {
    energyMeter: '192.168.1.234',  // Update to your energy meter IP
    hvac: '192.168.1.6'            // Update to your HVAC IP
  },
  // ... other settings
};
```

## Test Categories

### MRA Tests (`mra.test.mjs`)
- Unit tests that don't require network access
- Test MRA definition resolution (`resolveRef`)
- Test EPC element parsing (`parseEpcElementsResult`)
- Test type byte size calculations

### Device Tests (`device.test.mjs`)
- Integration tests requiring connected ECHONETLite devices
- Device discovery tests
- EPC property query tests
- HVAC control tests (read-only)

### MCP Tests (`mcp.test.mjs`)
- Tests for the MCP server's JSON-RPC interface
- Server initialization
- Tools listing
- Resources listing