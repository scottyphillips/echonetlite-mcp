# echonetlite-mcp

[![npm version](https://img.shields.io/npm/v/echonetlite-mcp.svg)](https://www.npmjs.com/package/echonetlite-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

An MCP (Model Context Protocol) server for **ECHONETLite** home automation — control air conditioners and read sensors via the Model Context Protocol.

> ECHONETLite is a Japanese IoT protocol widely used in smart home devices, particularly HVAC systems by major manufacturers like Daikin, Panasonic, Mitsubishi Electric, and Toshiba.

## Features

- 🌡️ **Real-time HVAC monitoring** — temperature, humidity, operating status
- ❄️ **Full climate control** — mode, fan speed, airflow direction, swing
- 🔍 **Network device discovery** — find ECHONETLite devices via multicast UDP
- ⚡ **Real-time notifications** — async updates from device multicast listeners
- 📦 **TypeScript-first** — full type definitions included
- 🔌 **MCP compatible** — works with any MCP client (Claude Desktop, LM Studio, VS Code extensions, etc.)

## Prerequisites

- Node.js 18+ 
- An ECHONETLite-compatible device on the same local network

## Installation

```bash
npm install echonetlite-mcp
```

Or use it as an MCP server directly:

```bash
git clone https://github.com/scottyphillips/echonetlite-mcp.git
cd echonetlite-mcp
npm install
npm run build
```

## Configuration

The server defaults to communicating with a device at `192.168.1.6` on UDP port 3610, using multicast address `224.0.23.0:3610` for discovery and notifications.

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

## Running the Server

```bash
# Build first
npm run build

# Run (stdio transport)
node dist/index.js
```

The server communicates via stdio, making it compatible with any MCP client.

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
      "args": ["C:\\path\\to\\echonetlite-mcp\\dist\\index.js"],
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

## Available Tools

### Device Discovery

| Tool | Description | Parameters |
|------|-------------|------------|
| `discover_devices` | Discover all ECHONETLite devices on the local network | `timeout` (optional) - Discovery timeout in ms (default: 3000) |

### HVAC Control

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_device_status` | Get full status of the HVAC device | `host` (optional) - IP address |
| `set_operation` | Turn HVAC ON or OFF | `host`, `operation` ("on" / "off") |
| `set_operating_mode` | Set operating mode | `host`, `mode` ("auto" / "cool" / "heat" / "dry" / "fan_only") |
| `set_temperature` | Set target temperature | `host`, `temperature` (0-50°C) |
| `set_fan_speed` | Set air flow rate | `host`, `speed` ("auto" / "level1"-"level8") |
| `set_airflow_vertical` | Set vertical vane position | `host`, `position` ("upper" / "upper-central" / "central" / "lower-central" / "lower") |
| `set_airflow_horizontal` | Set horizontal vane position | `host`, `position` (28 positions: rc-right, left-lc, lc-center-rc, ...) |
| `set_swing_mode` | Set swing mode function | `host`, `mode` ("not-used" / "vert" / "horiz" / "vert-horiz") |
| `set_auto_direction` | Set automatic direction mode | `host`, `mode` ("auto" / "non-auto" / "auto-vert" / "auto-horiz") |
| `set_silent_mode` | Set silent operation mode | `host`, `mode` ("normal" / "high-speed" / "silent") |
| `set_power_saving` | Set power-saving mode | `host`, `state` ("saving" / "normal") |

### Sensor Readings

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_temperatures` | Get room + outdoor temperatures | `host` (optional) |
| `get_humidity` | Get room humidity | `host` (optional) |

## Available Resources

| Resource URI | Description |
|-------------|-------------|
| `device://status` | Current HVAC status (updated via async notifications from multicast listener) |
| `device://capabilities` | Device property map (GETMAP, SETMAP, NTFMAP) |

## EPC Reference Table

| EPC | Property | Access | Values |
|-----|----------|--------|--------|
| 0x80 | Operation status | Set/Get | 0x30=ON, 0x31=OFF |
| 0xA0 | Air flow rate | Set/Get | Auto=0x41, Levels=0x31-0x38 |
| 0xB0 | Operation mode | Set/Get | Auto=0x41, Cool=0x42, Heat=0x43, Dry=0x44, Fan-only=0x45 |
| 0xB3 | Set temperature | Set/Get | 0-50°C (signed int) |
| 0xBB | Room temperature | Get | -127 to 125°C (signed int) |
| 0xBE | Outdoor temperature | Get | Signed int |

## Example Prompts

Try these natural language prompts with your MCP client:

- `"Turn on my air conditioner"` → calls `set_operation` with `operation="on"`
- `"Set temperature to 23 degrees"` → calls `set_temperature` with `temperature=23`
- `"Switch to cooling mode"` → calls `set_operating_mode` with `mode="cool"`
- `"What are the current temperatures?"` → calls `get_temperatures`
- `"Find all ECHONET devices on my network"` → calls `discover_devices`
- `"Set fan speed to level 3"` → calls `set_fan_speed` with `speed="level3"`

## Project Structure

```
echonetlite-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── echonetlite.ts        # ECHONETLite client wrapper
│   ├── devices/
│   │   └── homeAirConditioner.ts  # HVAC device handler
│   ├── types.ts              # TypeScript type definitions
│   └── config.ts             # Configuration constants
├── package.json
├── tsconfig.json
├── LICENSE
└── README.md
```

## Development

```bash
# Clone and install dependencies
git clone https://github.com/scottyphillips/echonetlite-mcp.git
cd echonetlite-mcp
npm install

# Build TypeScript
npm run build

# Watch mode for development
npm run dev

# Run the server
node dist/index.js
```

## References

- [ECHONETLite Standard Spec](https://echonet.jp/)
- [MCP Specification](https://modelcontextprotocol.io/)
- [node-echonet-lite](https://github.com/futomi/node-echonet-lite)
- [pychonet](https://github.com/scottyphillips/pychonet)

## License

MIT License — see [LICENSE](LICENSE) for details.

## Support

For issues, questions, or contributions, please open an issue on [GitHub](https://github.com/scottyphillips/echonetlite-mcp/issues).

[![Buy Me A Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://www.buymeacoffee.com/rgkwqyt)
