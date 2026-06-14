# ECHONETLite MCP Server — Implementation Plan & Enhancement Roadmap

## Overview

MCP (Model Context Protocol) server in NodeJS/TypeScript for ECHONETLite home automation. Controls air conditioners and reads sensors via the Model Context Protocol.

**Version:** 1.0.0  
**First ECHONETLite MCP Server** — worlds first implementation of ECHONETLite via MCP

---

## Current Architecture

```
echonetlite-mcp/
├── package.json              # @modelcontextprotocol/sdk, zod, typescript
├── tsconfig.json
├── PLAN.md                   # This file
├── README.md                 # Usage documentation
├── src/
│   ├── index.ts              # MCP server entry point (stdio transport) — ~1150 lines
│   ├── echonetlite.ts        # ECHONETLite client wrapper (UDP, binary encoding)
│   ├── mra.ts                # MRA property enrichment & value decoding
│   ├── types.ts              # TypeScript type definitions
│   ├── config.ts             # Configuration constants
│   └── devices/
│       └── homeAirConditioner.ts  # HVAC device handler (status, controls, notifications)
├── mra/
│   ├── mraData/
│   │   ├── devices/0x0130.json    # Home air conditioner MRA rules
│   │   ├── superClass/0x0000.json # Common properties (all devices)
│   │   ├── definitions/definitions.json  # JSON Schema definitions
│   │   └── metaData.json
│   │   └── MCRules/
├── test-integration.mjs
├── test-discover.mjs
├── test-discover-device.mjs
└── test-probe.mjs
```

---

## Device Specification (from pychonet source)

**EOJ (ECHONET Object) Identification:**
- **EOJGC**: `0x01` — Air conditioner-related device group
- **EOJCC**: `0x30` — Home air conditioner class
- **EOJCI**: `0x01` — Instance ID

**Network:**
- **Protocol**: UDP port 3610
- **Multicast Address**: `224.0.23.0` (for device discovery and notifications)

---

## Supported EPC Codes (Properties)

| EPC | Property Name | Access | Type | Values |
|-----|--------------|--------|------|--------|
| `0x80` | Operation status | Set/Get | u_char | `0x30`=ON, `0x31`=OFF |
| `0x8F` | Power-saving operation setting | Set/Get | u_char | `0x41`=Saving, `0x42`=Normal |
| `0xA0` | Air flow rate setting | Set/Get | u_char | `0x41`=Auto, `0x31-0x38`=Levels 1-8 |
| `0xA1` | Automatic control of air flow direction | Set/Get | u_char | `0x41`=Auto, `0x42`=Non-auto, `0x43`=Vert, `0x44`=Horiz |
| `0xA3` | Automatic swing of air flow setting | Set/Get | u_char | `0x31`=Not-used, `0x41`=Vert, `0x42`=Horiz, `0x43`=Vert-Horiz |
| `0xA4` | Air flow direction (vertical) | Set/Get | u_char | `0x41`=Upper, `0x42`=Lower, `0x43`=Central, `0x44`=Upper-Central, `0x45`=Lower-Central |
| `0xA5` | Air flow direction (horizontal) | Set/Get | u_char | 28 positions: rc-right, left-lc, lc-center-rc, etc. |
| `0xB0` | Operation mode setting | Set/Get | u_char | `0x41`=Auto, `0x42`=Cool, `0x43`=Heat, `0x44`=Dry, `0x45`=Fan-only |
| `0xB1` | Automatic temperature control | Set/Get | u_char | Auto/Non-auto |
| `0xB2` | Normal/High-speed/Silent operation | Set/Get | u_char | `0x41`=Normal, `0x42`=High-speed, `0x43`=Silent |
| `0xB3` | Set temperature value | Set/Get | s_char | 0-50°C (signed int) |
| `0xB4` | Set humidity in dehumidifying mode | Set/Get | s_char | Signed int |
| `0xBA` | Measured room relative humidity | Get | u_char | Unsigned int |
| `0xBB` | Measured room temperature | Get | s_char | -127 to 125°C (signed int) |
| `0xBE` | Measured outdoor air temperature | Get | s_char | Signed int |
| `0xC0` | Ventilation function setting | Set/Get | u_char | ON/OFF |
| `0xC1` | Humidifier function setting | Set/Get | u_char | Auto, Levels 1-8 |
| `0xCC` | Special function setting | Set/Get | u_char | No-setting(0x40), clothes-dryer(0x41), etc. |
| `0xCF` | Air purification mode setting | Set/Get | u_char | ON/OFF |

---

## MCP Tools Exposed (Full Mode — 18 tools)

### Device Discovery

| Tool Name | Description | Parameters | Status |
|-----------|-------------|------------|--------|
| `discover_devices` | Discover all ECHONETLite devices on network via multicast | None | ✅ Complete |
| `discover_nodes` | Active Node Profile probing — manufacturer, product code, UID, EOJ instances | `host`, `timeout` | ✅ Complete |

### HVAC Control (Bespoke)

| Tool Name | Description | Parameters | Status |
|-----------|-------------|------------|--------|
| `get_device_status` | Get full status of the HVAC device | `host` (optional) | ✅ Complete |
| `set_operation` | Turn HVAC on or off | `host`, `operation` ("on"/"off") | ✅ Complete |
| `set_operating_mode` | Set operating mode | `host`, `mode` ("auto"/"cool"/"heat"/"dry"/"fan_only") | ✅ Complete |
| `set_temperature` | Set target temperature (0-50°C) | `host`, `temperature` (number) | ✅ Complete |
| `set_fan_speed` | Set air flow rate | `host`, `speed` ("auto"/"level1"-"level8") | ✅ Complete |
| `set_airflow_vertical` | Set vertical vane position | `host`, `position` (5 positions) | ✅ Complete |
| `set_airflow_horizontal` | Set horizontal vane position | `host`, `position` (28 positions) | ✅ Complete |
| `set_swing_mode` | Set swing mode function | `host`, `mode` ("not-used"/"vert"/"horiz"/"vert-horiz") | ✅ Complete |
| `set_auto_direction` | Set automatic direction mode | `host`, `mode` ("auto"/"non-auto"/"auto-vert"/"auto-horiz") | ✅ Complete |
| `set_silent_mode` | Set silent operation mode | `host`, `mode` ("normal"/"high-speed"/"silent") | ✅ Complete |
| `set_power_saving` | Set power-saving mode | `host`, `state` ("saving"/"normal") | ✅ Complete |

### Sensor Readings

| Tool Name | Description | Parameters | Status |
|-----------|-------------|------------|--------|
| `get_temperatures` | Get room + outdoor temperatures | `host` (optional) | ✅ Complete |
| `get_humidity` | Get room humidity | `host` (optional) | ✅ Complete |

### EPC Introspection & MRA Lookup

| Tool Name | Description | Parameters | Status |
|-----------|-------------|------------|--------|
| `get_property_maps` | Query STATMAP/SETMAP/GETMAP with MRA-based property names and descriptions | `host`, `eojgc`, `eojcc`, `eojInstance` | ✅ Complete |
| `query_epc` | Query EPC codes from device with MRA decoding (raw + human-readable) | `epcs[]`, `host`, `eojgc`, `eojcc`, `eojInstance` | ✅ Complete |
| `get_epc_definition` | Get EPC metadata, enum values, bitmaps, $ref-resolved definitions from MRA | `epcs[]`, `host`, `eojgc`, `eojcc`, `eojInstance` | ✅ Complete |
| `set_epc` | Generic EPC setter — set any writable property on any EOJ instance | `host`, `eojgc`, `eojcc`, `eojInstance`, `epc`, `value` | ✅ Complete |

---

## MCP Resources Exposed

| Resource URI | Description |
|-------------|-------------|
| `device://status` | Current HVAC status (updated via async notifications from multicast listener) |
| `device://capabilities` | Device property map (GETMAP, SETMAP, NTFMAP) |

---

## MRA Data Architecture Note

**MRA Integration Complete:** The server includes full MRA (Machine Readable Index) data integration:

- **Property names & descriptions** — human-readable labels for each EPC code
- **Value decoding** — raw hex values decoded to meaningful strings/numbers using MRA type schemas
- **Enum/bitmap support** — full enumeration of possible values with $ref resolution
- **Level ranges & number formats** — signed/unsigned integers, fixed-point decimals
- **$ref resolution** — external definition references from definitions.json resolved automatically

The current pruned MRA is HVAC-focused (devices/0x0130.json) but can be expanded to support the full 200+ device group/class combinations in the complete ECHONETLite MRA specification.

---

## Enhancement Roadmap

### ✅ PHASE 1: Core Features — COMPLETE

All Phase 1 features implemented including:
- Full HVAC control tools (11 bespoke tools)
- Sensor readings (temperature, humidity)
- Device discovery via multicast UDP
- Real-time notification listener for async updates
- Generic EPC tools (`set_epc`, `query_epc`)
- MRA integration with property enrichment
- Node Profile probing (`discover_nodes`)
- Property maps with MRA-based names

### PHASE 2: Core Architecture Improvements (High Priority)

| # | Feature | Description | Status | Files |
|---|---------|-------------|--------|-------|
| 2.1 | Device Registry & Caching | Singleton device handlers with TTL expiration discovered via multicast | 🔲 TODO | `src/deviceRegistry.ts` (new), modify `index.ts` |
| 2.2 | Configuration System | JSON config file (~/.echonetlite-mcp/config.json) with multi-device profiles + zod validation | 🔲 TODO | Extend `config.ts`, new `configFile.ts` |
| 2.3 | Abstract Device Base Class | Extract shared patterns: EOJ identification, status caching, notification handling | 🔲 TODO | `src/devices/baseDevice.ts` (new) |

### PHASE 3: Device Type Expansion (High Priority)

Add handlers for common ECHONETLite device types using MRA data:

| # | Device Type | EOJ Codes | New Tools | Status | MRA File Needed |
|---|-------------|-----------|-----------|--------|-----------------|
| 3.1 | Lighting & Brightness | GC=0x02/0x0A, CC=0x80/0x8B | `set_brightness`, `set_color_temperature`, `set_color` | 🔲 TODO | devices/0x0280.json, devices/0x0A80.json |
| 3.2 | Energy Monitor | GC=0x16, CC=0xE0 | `get_power_consumption`, `get_voltage`, `get_current`, `get_energy_total` | 🔲 TODO | devices/0x16E0.json |
| 3.3 | Air Purifier | GC=0x19, CC=0xB0 | `set_purification_mode`, `get_air_quality`, `set_timer` | 🔲 TODO | devices/0x19B0.json |
| 3.4 | Bathroom Device | GC=0x03, CC=0x80 | `set_bath_heater`, `set_fan`, `set_dehumidify` | 🔲 TODO | devices/0x0380.json |
| 3.5 | Door Lock | GC=0x14, CC=0xA0 | `get_lock_status`, `lock`, `unlock` | 🔲 TODO | devices/0x14A0.json |
| 3.6 | Water Sensor | GC=0x18, CC=0x80 | `get_water_leak_status`, `get_temperature` | 🔲 TODO | devices/0x1880.json |

### PHASE 4: Protocol Enhancements (Medium Priority)

| # | Feature | Description | Status |
|---|---------|-------------|--------|
| 4.1 | SETGET Operation | Atomic set+get via ESV 0x6E — reduces round-trips when setting params and reading back | 🔲 TODO |
| 4.2 | INSTANCE_LIST Discovery | Support ESV 0xD6 for discovering EOJ instances on devices (partially done in discover_nodes) | 🔄 Partial |
| 4.3 | Sequence Number Handling | Proper SNA (Sequence Number Ack) tracking for ordered operations | 🔲 TODO |
| 4.4 | Retry with Backoff | Configurable exponential backoff: 500ms → 1s → 2s → 4s | 🔲 TODO |

### PHASE 5: MCP Feature Expansion (Medium Priority)

| # | Feature | Description | Status |
|---|---------|-------------|--------|
| 5.1 | MCP Prompts | `comfort-setup`, `sleep-mode`, `away-mode` workflow templates | 🔲 TODO |
| 5.2 | Resource Batching | Per-device resources: `device://{host}/status`, subscription notifications | 🔲 TODO |
| 5.3 | Roots Capability | Project context awareness for multi-room configurations | 🔲 TODO |

### PHASE 6: Observability & Testing (Important)

| # | Feature | Description | Status |
|---|---------|-------------|--------|
| 6.1 | Structured Logging | Winston/pino with debug mode for UDP packet tracing | 🔲 TODO |
| 6.2 | Health Check | `server_health` tool + `network_diagnostic` | 🔲 TODO |
| 6.3 | Test Suite | Unit tests for encoding/decoding, mock UDP server, integration tests | 🔄 Partial (test-*.mjs files exist) |
| 6.4 | CI/CD | GitHub Actions for build/test/lint/publish | 🔲 TODO |

### PHASE 7: Advanced Features (Future)

- 🔲 **Energy Tracking** — historical usage, cost estimation, time-of-use rates
- 🔲 **Automation Rules Engine** — "If temp > 26 → cool + set 24°C"
- 🔲 **Web Dashboard** — HTTP server with real-time UI
- 🔲 **ECHONETLite Gateway** — TCP/WebSocket tunneling for remote control

---

## Priority Matrix

| Priority | Phase | Effort | Impact | Status |
|----------|-------|--------|--------|--------|
| ✅ Done | 1. Core Features | Medium | High | **COMPLETE** |
| 🟠 High | 2. Core Architecture | Medium | High — enables everything else | 🔲 Next |
| 🟠 High | 3. Device Expansion | High | High — expands ecosystem coverage | 🔲 Future |
| 🟡 Medium | 4. Protocol Enhancements | Low-Medium | Medium — improves reliability | 🔲 Future |
| 🟡 Medium | 5. MCP Feature Expansion | Low | Medium — better AI integration | 🔲 Future |
| 🟢 Important | 6. Observability & Testing | Medium | High — production readiness | 🔲 Future |
| 🔵 Future | 7. Advanced Features | High | Variable — demand-driven | 🔲 Future |

---

## Quick Wins (Completed)

1. ✅ **Add MRA enrichment** to all EPC tools (~completed)
2. ✅ **Add discover_nodes tool** for Node Profile probing (~completed)
3. ✅ **Add set_epc generic setter** for cross-device control (~completed)
4. ✅ **Property maps with MRA-based names** (~completed)

---

## Configuration

### Setting the Default Device IP

**Option A: Environment variable (recommended)**
```bash
# Windows CMD
set ECHONET_DEFAULT_HOST=192.168.1.10 && node dist/index.js

# PowerShell
$env:ECHONET_DEFAULT_HOST="192.168.1.10"; node dist/index.js

# Linux/macOS
ECHONET_DEFAULT_HOST=192.168.1.10 node dist/index.js
```

**Option B: Edit config.ts**
```typescript
export const DEFAULT_HOST = '192.168.1.10';  // Change to your device IP
```

### Per-Tool Override

Every tool accepts an optional `host` parameter to override the default for that specific call:
```json
{ "name": "get_device_status", "arguments": { "host": "192.168.1.20" } }
```

---

## Running the Server

```bash
# Build first
npm run build

# Run (stdio transport)
node dist/index.js
```

The server communicates via stdio, making it compatible with any MCP client.

---

## Integration with AI Clients

### Claude Desktop

Add to your Claude Desktop MCP configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "echonetlite": {
      "command": "node",
      "args": ["/path/to/echonetlite-mcp/dist/index.js"],
      "env": {
        "ECHONET_DEFAULT_HOST": "192.168.1.6"
      }
    }
  }
}
```

### LM Studio

LM Studio supports MCP servers via stdio transport. Create or edit the MCP config file:

**Windows:** `%APPDATA%\lm-studio\mcp_config.json`  
**macOS/Linux:** `~/.config/lm-studio/mcp_config.json`

```json
{
  "mcpServers": {
    "echonetlite-mcp": {
      "command": "node",
      "args": ["C:\\path\\to\\echonetlite-mcp\\dist/index.js"],
      "env": {
        "ECHONET_DEFAULT_HOST": "192.168.1.6"
      }
    }
  }
}
```

### VS Code MCP Extension

Configure in your VS Code MCP extension settings:

```json
{
  "mcp.servers": [
    {
      "name": "echonetlite",
      "command": "node",
      "args": ["/path/to/echonetlite-mcp/dist/index.js"],
      "env": {
        "ECHONET_DEFAULT_HOST": "192.168.1.6"
      }
    }
  ]
}
```

---

## Example Prompts — Full Mode

Try these natural language prompts with your MCP client:

- `"Turn on my air conditioner"` → calls `set_operation` with `operation="on"`
- `"Set temperature to 23 degrees"` → calls `set_temperature` with `temperature=23`
- `"Switch to cooling mode"` → calls `set_operating_mode` with `mode="cool"`
- `"What are the current temperatures?"` → calls `get_temperatures`
- `"Find all ECHONET devices on my network"` → calls `discover_devices`
- `"Set fan speed to level 3"` → calls `set_fan_speed` with `speed="level3"`
- `"Discover all nodes on 192.168.1.6"` → calls `discover_nodes` for full device profile

## Example Prompts — EPC Introspection

- `"What can this device do?"` → calls `get_property_maps` to discover STATMAP/SETMAP/GETMAP
- `"Read the current temperature"` → calls `query_epc(epcs=["0xBB"])` 
- `"Turn on the AC"` → calls `set_epc(epc="0x80", value_hex="0x30")`
- `"Set cooling mode at 23°C"` → calls `set_epc(epc="0xB0", value_hex="0x42")` + `set_epc(epc="0xB3", value_hex="0x17")`
- `"What settings are available for 0xA0?"` → calls `get_epc_definition(epcs=["0xA0"])`

---

## Project Structure

```
echonetlite-mcp/
├── src/
│   ├── index.ts              # MCP server entry point (18 tools + 2 resources)
│   ├── echonetlite.ts        # ECHONETLite client wrapper (async/await over UDP)
│   ├── mra.ts                # MRA property enrichment & value decoding
│   ├── devices/
│   │   ├── baseDevice.ts          # [FUTURE] Abstract device handler base class
│   │   └── homeAirConditioner.ts  # HVAC device handler (status, controls, notifications)
│   ├── types.ts              # TypeScript type definitions
│   └── config.ts             # Configuration (host, port, multicast)
├── mra/
│   └── mraData/
│       ├── devices/          # Device-specific MRA rules (0x0130 = HVAC)
│       ├── superClass/       # Common properties inherited by all devices
│       └── definitions/      # JSON Schema definitions for value decoding
├── package.json
├── tsconfig.json
├── PLAN.md                   # This file — implementation plan + roadmap
├── README.md                 # Usage documentation
└── test-*.mjs                # Integration test files
```

---

## Key Design Decisions

1. **TypeScript** for type safety with binary ECHONETLite protocol encoding/decoding
2. **Async/Await** wrapper around callback-based UDP communication
3. **Configurable host** — default 192.168.1.6, overridable per-tool call
4. **Notification listener** runs continuously to capture unsolicited device updates via multicast
5. **MRA as source of truth** for property names, descriptions, and value decoding
6. **Generic EPC tools** (`query_epc`, `set_epc`) work across ALL device types
7. **Node Profile probing** enables full device introspection without prior knowledge

---

## Reference Sources

- pychonet: https://github.com/scottyphillips/pychonet
- echonet-lite (NodeJS): https://github.com/futomi/node-echonet-lite
- ECHONETLite Standard Spec: https://echonet.jp/
- MCP Specification: https://modelcontextprotocol.io/

---

## License

MIT License — see [LICENSE](LICENSE) for details.

## Support

For issues, questions, or contributions, please open an issue on [GitHub](https://github.com/scottyphillips/echonetlite-mcp/issues).