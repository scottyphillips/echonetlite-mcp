# ECHONETLite MCP Server - Implementation Plan

## Overview
Build an MCP (Model Context Protocol) server in NodeJS/TypeScript that communicates with ECHONETLite devices on the local network. Target device: HomeAirConditioner at `192.168.1.6`.

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
| `0xA5` | Air flow direction (horizontal) | Set/Get | u_char | 28 positions: rc-right, left-lc, lc-center-rc, left-lc-rc-right, right, rc, center, center-right, center-rc, center-rc-right, lc, lc-right, lc-rc, lc-rc-right, lc-center, lc-center-right, lc-center-rc-right, left, left-right, left-rc, left-rc-right, left-center, left-center-right, left-center-rc, left-center-rc-right, left-lc-right, left-lc-rc |
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
| `0xCC` | Special function setting | Set/Get | u_char | No-setting(0x40), clothes-dryer(0x41), condensation-suppressor(0x42), mite-mold-control(0x43), active-defrosting(0x44) |
| `0xCF` | Air purification mode setting | Set/Get | u_char | ON/OFF |

---

## MCP Tools Exposed

| Tool Name | Description | Parameters |
|-----------|-------------|------------|
| `discover_devices` | Discover all ECHONETLite devices on network | None |
| `get_device_status` | Get full status of the HVAC device | `host` (optional, default: 192.168.1.6) |
| `set_operation` | Turn HVAC on or off | `host`, `operation` ("on"/"off") |
| `set_operating_mode` | Set operating mode | `host`, `mode` ("auto"/"cool"/"heat"/"dry"/"fan_only") |
| `set_temperature` | Set target temperature (0-50°C) | `host`, `temperature` (number) |
| `set_fan_speed` | Set air flow rate | `host`, `speed` ("auto"/"level1"-"level8") |
| `set_airflow_vertical` | Set vertical vane position | `host`, `position` ("upper"/"upper-central"/"central"/"lower-central"/"lower") |
| `set_airflow_horizontal` | Set horizontal vane position | `host`, `position` (28 positions) |
| `set_swing_mode` | Set swing mode function | `host`, `mode` ("not-used"/"vert"/"horiz"/"vert-horiz") |
| `set_auto_direction` | Set automatic direction mode | `host`, `mode` ("auto"/"non-auto"/"auto-vert"/"auto-horiz") |
| `set_silent_mode` | Set silent operation mode | `host`, `mode` ("normal"/"high-speed"/"silent") |
| `set_power_saving` | Set power-saving mode | `host`, `state` ("saving"/"normal") |
| `get_temperatures` | Get room + outdoor temperatures | `host` (optional) |
| `get_humidity` | Get room humidity | `host` (optional) |

---

## MCP Resources Exposed

| Resource URI | Description |
|-------------|-------------|
| `device://status` | Current HVAC status (updated via async notifications from multicast listener) |
| `device://capabilities` | Device property map (GETMAP, SETMAP, NTFMAP) |

---

## Project Structure

```
echonetlite-mcp/
├── package.json              # @modelcontextprotocol/sdk, echonet-lite, typescript
├── tsconfig.json
├── PLAN.md                   # This file
├── src/
│   ├── index.ts              # MCP server entry point (stdio transport)
│   ├── echonetlite.ts        # ECHONETLite client wrapper (async/await over UDP port 3610)
│   ├── devices/
│   │   └── homeAirConditioner.ts  # HomeAirConditioner handler with all EPC mappings
│   ├── types.ts              # TypeScript type definitions for EPC codes, modes, etc.
│   └── config.ts             # Configuration (host: 192.168.1.6, port: 3610, multicast: 224.0.23.0)
├── README.md
└── .gitignore
```

---

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework for NodeJS
- `echonet-lite` — ECHONETLite protocol library (by Futomi Hatano, basis of pychonet)
- `typescript` — Type-safe development

---

## Implementation Steps

### 1. Initialize Project with TypeScript and MCP SDK
```bash
npm init -y
npm install typescript @types/node @modelcontextprotocol/sdk echonet-lite
npx tsc --init
```

### 2. Create ECHONETLite Client Wrapper (`src/echonetlite.ts`)
- Wrap the `echonet-lite` library's callback-based API in async/await promises
- Handle UDP socket creation on port 3610
- Support unicast (direct device communication) and multicast (discovery + notifications)

### 3. Implement HomeAirConditioner Device Handler (`src/devices/homeAirConditioner.ts`)
- Class with EOJGC=0x01, EOJCC=0x30, Instance=0x01
- Map all EPC codes with value encoders/decoders matching pychonet:
  - `ENL_STATUS = 0x80` — Operation status (ON=0x30, OFF=0x31)
  - `ENL_FANSPEED = 0xA0` — Air flow rate (Auto=0x41, Levels=0x31-0x38)
  - `ENL_AUTO_DIRECTION = 0xA1` — Auto direction control
  - `ENL_SWING_MODE = 0xA3` — Swing mode
  - `ENL_AIR_VERT = 0xA4` — Vertical airflow
  - `ENL_AIR_HORZ = 0xA5` — Horizontal airflow (28 positions)
  - `ENL_HVAC_MODE = 0xB0` — Operation mode (Auto=0x41, Cool=0x42, Heat=0x43, Dry=0x44, Fan-only=0x45)
  - `ENL_HVAC_SILENT_MODE = 0xB2` — Silent mode (Normal=0x41, High-speed=0x42, Silent=0x43)
  - `ENL_HVAC_SET_TEMP = 0xB3` — Set temperature (signed int, 0-50°C)
  - `ENL_HVAC_ROOM_TEMP = 0xBB` — Room temperature (signed int)
  - `ENL_HVAC_OUT_TEMP = 0xBE` — Outdoor temperature (signed int)
  - And all other EPCs from the table above

### 4. Build MCP Server (`src/index.ts`)
- Create MCP server using `@modelcontextprotocol/sdk` with stdio transport
- Register all tools listed in "MCP Tools Exposed" section
- Each tool maps to corresponding HomeAirConditioner methods
- Handle errors gracefully (network timeouts, device unreachable)

### 5. Add MCP Resources (`src/index.ts`)
- `device://status` — Stream current HVAC status
- `device://capabilities` — Return property map from device
- Use async notification listener for real-time updates

### 6. Set Up Async Notification Listener
- Bind UDP socket to multicast address `224.0.23.0:3610`
- Parse incoming ECHONETLite notifications (SEJ with EPC data)
- Update device state in memory when notifications arrive
- Push updates to MCP clients via resource subscriptions

### 7. Create README with Usage Documentation
- Setup instructions
- Configuration options
- Tool usage examples
- EPC reference table

---

## Key Design Decisions

1. **TypeScript** for type safety with binary ECHONETLite protocol encoding/decoding
2. **Async/Await** wrapper around callback-based `echonet-lite` library
3. **Configurable host** — default 192.168.1.6, overridable per-tool call
4. **Notification listener** runs continuously to capture unsolicited device updates via multicast
5. **Error handling** with descriptive messages for network timeouts and device unreachability

---

## Reference Sources
- pychonet: https://github.com/scottyphillips/pychonet
- echonet-lite (NodeJS): https://github.com/futomi/node-echonet-lite
- ECHONETLite Standard Spec: https://echonet.jp/