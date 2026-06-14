// HomeAirConditioner Device Handler
// Implements ECHONETLite communication for home air conditioner devices

import { EchonetLiteClient, encodeUChar, decodeSChar, decodeUChar } from '../echonetlite.js';
import {
  DEFAULT_HOST,
  HVAC_EOJGC,
  HVAC_EOJCC,
  HVAC_EOJ_INSTANCE,
} from '../config.js';
import type {
  HvacStatus,
  HvacMode,
  HvacFanSpeed,
  HvacAirVertPosition,
  HvacAirHorzPosition,
  HvacSwingMode,
  HvacAutoDirection,
  HvacSilentMode,
  HvacPowerSaving,
  EpcData,
  Eoj,
} from '../types.js';

// ============================================================================
// EPC Code Constants (re-exported for convenience)
// ============================================================================
export const EPC_OPERATION_STATUS = 0x80;
export const EPC_POWER_SAVING = 0x8f;
export const EPC_FAN_SPEED = 0xa0;
export const EPC_AUTO_DIRECTION = 0xa1;
export const EPC_SWING_MODE = 0xa3;
export const EPC_AIR_VERT = 0xa4;
export const EPC_AIR_HORZ = 0xa5;
export const EPC_HVAC_MODE = 0xb0;
export const EPC_AUTO_TEMPERATURE = 0xb1;
export const EPC_SILENT_MODE = 0xb2;
export const EPC_SET_TEMP = 0xb3;
export const EPC_SET_HUMIDITY = 0xb4;
export const EPC_ROOM_HUMIDITY = 0xba;
export const EPC_ROOM_TEMP = 0xbb;
export const EPC_OUTDOOR_TEMP = 0xbe;
export const EPC_VENTILATION = 0xc0;
export const EPC_HUMIDIFIER = 0xc1;
export const EPC_SPECIAL_FUNCTION = 0xcc;
export const EPC_PURIFICATION = 0xcf;

// ============================================================================
// Value Mappings
// ============================================================================

/** Operation status: ON=0x30, OFF=0x31 */
const STATUS_ON = 0x30;
const STATUS_OFF = 0x31;

/** Fan speed: Auto=0x41, Levels 1-8 = 0x31-0x38 */
const FANSPEED_AUTO = 0x41;
const fanspeedLevelMap: Record<string, number> = {
  level1: 0x31,
  level2: 0x32,
  level3: 0x33,
  level4: 0x34,
  level5: 0x35,
  level6: 0x36,
  level7: 0x37,
  level8: 0x38,
};

/** HVAC modes: Auto=0x41, Cool=0x42, Heat=0x43, Dry=0x44, Fan-only=0x45 */
const modeMap: Record<string, number> = {
  auto: 0x41,
  cool: 0x42,
  heat: 0x43,
  dry: 0x44,
  fan_only: 0x45,
};

const reverseModeMap: Record<number, HvacMode> = {
  0x41: 'auto',
  0x42: 'cool',
  0x43: 'heat',
  0x44: 'dry',
  0x45: 'fan_only',
};

/** Vertical positions: Upper=0x41, Lower-Central=0x45 */
const vertPositionMap: Record<string, number> = {
  upper: 0x41,
  'upper-central': 0x42,
  central: 0x43,
  'lower-central': 0x44,
  lower: 0x45,
};

const reverseVertPositionMap: Record<number, HvacAirVertPosition> = {
  0x41: 'upper',
  0x42: 'upper-central',
  0x43: 'central',
  0x44: 'lower-central',
  0x45: 'lower',
};

/** Horizontal positions (28 positions) */
const horzPositionMap: Record<string, number> = {
  'rc-right': 0x01,
  'left-lc': 0x02,
  'lc-center-rc': 0x03,
  'left-lc-rc-right': 0x04,
  right: 0x05,
  rc: 0x06,
  center: 0x07,
  'center-right': 0x08,
  'center-rc': 0x09,
  'center-rc-right': 0x0a,
  lc: 0x0b,
  'lc-right': 0x0c,
  'lc-rc': 0x0d,
  'lc-rc-right': 0x0e,
  'lc-center': 0x0f,
  'lc-center-right': 0x10,
  'lc-center-rc-right': 0x11,
  left: 0x12,
  'left-right': 0x13,
  'left-rc': 0x14,
  'left-rc-right': 0x15,
  'left-center': 0x16,
  'left-center-right': 0x17,
  'left-center-rc': 0x18,
  'left-center-rc-right': 0x19,
  'left-lc-right': 0x1a,
  'left-lc-rc': 0x1b,
};

const reverseHorzPositionMap: Record<number, HvacAirHorzPosition> = {
  0x01: 'rc-right',
  0x02: 'left-lc',
  0x03: 'lc-center-rc',
  0x04: 'left-lc-rc-right',
  0x05: 'right',
  0x06: 'rc',
  0x07: 'center',
  0x08: 'center-right',
  0x09: 'center-rc',
  0x0a: 'center-rc-right',
  0x0b: 'lc',
  0x0c: 'lc-right',
  0x0d: 'lc-rc',
  0x0e: 'lc-rc-right',
  0x0f: 'lc-center',
  0x10: 'lc-center-right',
  0x11: 'lc-center-rc-right',
  0x12: 'left',
  0x13: 'left-right',
  0x14: 'left-rc',
  0x15: 'left-rc-right',
  0x16: 'left-center',
  0x17: 'left-center-right',
  0x18: 'left-center-rc',
  0x19: 'left-center-rc-right',
  0x1a: 'left-lc-right',
  0x1b: 'left-lc-rc',
};

/** Swing mode: Not-used=0x31, Vert=0x41, Horiz=0x42, Vert-Horiz=0x43 */
const swingModeMap: Record<string, number> = {
  'not-used': 0x31,
  vert: 0x41,
  horiz: 0x42,
  'vert-horiz': 0x43,
};

const reverseSwingModeMap: Record<number, HvacSwingMode> = {
  0x31: 'not-used',
  0x41: 'vert',
  0x42: 'horiz',
  0x43: 'vert-horiz',
};

/** Auto direction: Auto=0x41, Non-auto=0x42, Vert=0x43, Horiz=0x44 */
const autoDirectionMap: Record<string, number> = {
  auto: 0x41,
  'non-auto': 0x42,
  'auto-vert': 0x43,
  'auto-horiz': 0x44,
};

/** Silent mode: Normal=0x41, High-speed=0x42, Silent=0x43 */
const silentModeMap: Record<string, number> = {
  normal: 0x41,
  'high-speed': 0x42,
  silent: 0x43,
};

const reverseSilentModeMap: Record<number, HvacSilentMode> = {
  0x41: 'normal',
  0x42: 'high-speed',
  0x43: 'silent',
};

/** Power saving: Saving=0x41, Normal=0x42 */
const powerSavingMap: Record<string, number> = {
  saving: 0x41,
  normal: 0x42,
};

// ============================================================================
// HomeAirConditioner Class
// ============================================================================

export class HomeAirConditioner {
  private client: EchonetLiteClient;
  private host: string;
  private eoj: Eoj;
  private currentStatus: HvacStatus | null = null;

  constructor(client: EchonetLiteClient, host?: string) {
    this.client = client;
    this.host = host || DEFAULT_HOST;
    this.eoj = {
      groupCode: HVAC_EOJGC,
      classCode: HVAC_EOJCC,
      instanceId: HVAC_EOJ_INSTANCE,
    };
  }

  /** Get the current IP host */
  getHost(): string {
    return this.host;
  }

  /** Set a new IP host */
  setHost(host: string): void {
    this.host = host;
  }

  /** Get the EOJ identifier */
  getEoj(): Eoj {
    return this.eoj;
  }

  /** Get current cached status */
  getStatus(): HvacStatus | null {
    return this.currentStatus;
  }

  /**
   * Get full device status by reading all supported properties.
   */
  async getFullStatus(): Promise<HvacStatus> {
    // GET all readable/writable properties in one call where possible
    const epcCodes = [
      EPC_OPERATION_STATUS,
      EPC_HVAC_MODE,
      EPC_SET_TEMP,
      EPC_ROOM_TEMP,
      EPC_OUTDOOR_TEMP,
      EPC_ROOM_HUMIDITY,
      EPC_FAN_SPEED,
      EPC_AIR_VERT,
      EPC_AIR_HORZ,
      EPC_SWING_MODE,
      EPC_AUTO_DIRECTION,
      EPC_SILENT_MODE,
      EPC_POWER_SAVING,
      EPC_SPECIAL_FUNCTION,
      EPC_PURIFICATION,
      EPC_VENTILATION,
      EPC_HUMIDIFIER,
    ];

    const epcData = await this.client.get(this.host, epcCodes, this.eoj);
    this.currentStatus = this.parseEpcData(epcData);
    return this.currentStatus;
  }

  /**
   * Parse EPC data responses into a HvacStatus object.
   */
  private parseEpcData(epcData: EpcData[]): HvacStatus {
    const status: HvacStatus = {
      operation: null,
      mode: null,
      setTemperature: null,
      roomTemperature: null,
      outdoorTemperature: null,
      roomHumidity: null,
      fanSpeed: null,
      airVertPosition: null,
      airHorzPosition: null,
      swingMode: null,
      autoDirection: null,
      silentMode: null,
      powerSaving: null,
      specialFunction: null,
      purification: null,
      ventilation: null,
      humidifier: null,
    };

    for (const item of epcData) {
      const pv = item.pv;
      switch (item.epc) {
        case EPC_OPERATION_STATUS:
          // 0x30=ON, 0x31=OFF - convert to string for MCP tools
          if (pv.length > 0) {
            status.operation = pv[0] === 0x30 ? 'ON' : pv[0] === 0x31 ? 'OFF' : null;
          } else {
            status.operation = null;
          }
          break;

        case EPC_HVAC_MODE:
          status.mode = pv.length > 0 ? reverseModeMap[pv[0]] || null : null;
          break;

        case EPC_SET_TEMP:
          status.setTemperature = pv.length >= 1 ? decodeSChar(pv) : null;
          break;

        case EPC_ROOM_TEMP:
          status.roomTemperature = pv.length >= 1 ? decodeSChar(pv) : null;
          break;

        case EPC_OUTDOOR_TEMP:
          status.outdoorTemperature = pv.length >= 1 ? decodeSChar(pv) : null;
          break;

        case EPC_ROOM_HUMIDITY:
          status.roomHumidity = pv.length > 0 ? decodeUChar(pv) : null;
          break;

        case EPC_FAN_SPEED:
          status.fanSpeed = this.decodeFanSpeed(pv);
          break;

        case EPC_AIR_VERT:
          status.airVertPosition = pv.length > 0 ? reverseVertPositionMap[pv[0]] || null : null;
          break;

        case EPC_AIR_HORZ:
          status.airHorzPosition = pv.length > 0 ? reverseHorzPositionMap[pv[0]] || null : null;
          break;

        case EPC_SWING_MODE:
          status.swingMode = pv.length > 0 ? reverseSwingModeMap[pv[0]] || null : null;
          break;

        case EPC_AUTO_DIRECTION:
          // auto direction uses different encoding
          if (pv.length > 0) {
            const val = pv[0];
            if (val === 0x41) status.autoDirection = 'auto';
            else if (val === 0x42) status.autoDirection = 'non-auto';
            else if (val === 0x43) status.autoDirection = 'auto-vert';
            else if (val === 0x44) status.autoDirection = 'auto-horiz';
          }
          break;

        case EPC_SILENT_MODE:
          status.silentMode = pv.length > 0 ? reverseSilentModeMap[pv[0]] || null : null;
          break;

        case EPC_POWER_SAVING:
          // Power saving: 0x41=saving, 0x42=normal
          if (pv.length > 0) {
            status.powerSaving = pv[0] === 0x41 ? 'saving' : pv[0] === 0x42 ? 'normal' : null;
          }
          break;

        case EPC_SPECIAL_FUNCTION:
          status.specialFunction = pv.length > 0 ? pv[0] : null;
          break;

        case EPC_PURIFICATION:
          // ON=0x30, OFF=0x31 (same encoding as operation status)
          if (pv.length > 0) {
            status.purification = pv[0] === 0x30 ? true : pv[0] === 0x31 ? false : null;
          }
          break;

        case EPC_VENTILATION:
          // ON=0x30, OFF=0x31
          if (pv.length > 0) {
            status.ventilation = pv[0] === 0x30 ? true : pv[0] === 0x31 ? false : null;
          }
          break;

        case EPC_HUMIDIFIER:
          status.humidifier = pv.length > 0 ? decodeUChar(pv) : null;
          break;
      }
    }

    return status;
  }

  // ========================================================================
  // Helper decoders
  // ========================================================================

  private decodeFanSpeed(pv: Uint8Array): HvacFanSpeed | null {
    if (pv.length === 0) return null;
    const val = pv[0];
    if (val === FANSPEED_AUTO) return 'auto';
    const reverseMap: Record<number, HvacFanSpeed> = {
      0x31: 'level1',
      0x32: 'level2',
      0x33: 'level3',
      0x34: 'level4',
      0x35: 'level5',
      0x36: 'level6',
      0x37: 'level7',
      0x38: 'level8',
    };
    return reverseMap[val] || null;
  }

  // ========================================================================
  // Operation Methods
  // ========================================================================

  /**
   * Set operation status (ON/OFF).
   */
  async setOperation(on: boolean): Promise<void> {
    const value = on ? STATUS_ON : STATUS_OFF;
    await this.client.set(this.host, [
      { epc: EPC_OPERATION_STATUS, pv: encodeUChar(value) },
    ], this.eoj);
  }

  /**
   * Set operating mode (auto, cool, heat, dry, fan_only).
   */
  async setOperatingMode(mode: HvacMode): Promise<void> {
    const value = modeMap[mode];
    if (value === undefined) {
      throw new Error(`Invalid HVAC mode: ${mode}`);
    }
    await this.client.set(this.host, [
      { epc: EPC_HVAC_MODE, pv: encodeUChar(value) },
    ], this.eoj);
  }

  /**
   * Set target temperature (0-50°C).
   */
  async setTemperature(temp: number): Promise<void> {
    // Clamp to valid range
    const clamped = Math.max(0, Math.min(50, temp));
    await this.client.set(this.host, [
      { epc: EPC_SET_TEMP, pv: encodeUChar(clamped) },
    ], this.eoj);
  }

  /**
   * Set fan speed (auto, level1-level8).
   */
  async setFanSpeed(speed: HvacFanSpeed): Promise<void> {
    let value: number | undefined;
    if (speed === 'auto') {
      value = FANSPEED_AUTO;
    } else {
      value = fanspeedLevelMap[speed];
    }
    if (value === undefined) {
      throw new Error(`Invalid fan speed: ${speed}`);
    }
    await this.client.set(this.host, [
      { epc: EPC_FAN_SPEED, pv: encodeUChar(value) },
    ], this.eoj);
  }

  /**
   * Set vertical airflow position.
   */
  async setAirflowVertical(position: HvacAirVertPosition): Promise<void> {
    const value = vertPositionMap[position];
    if (value === undefined) {
      throw new Error(`Invalid vertical position: ${position}`);
    }
    await this.client.set(this.host, [
      { epc: EPC_AIR_VERT, pv: encodeUChar(value) },
    ], this.eoj);
  }

  /**
   * Set horizontal airflow position.
   */
  async setAirflowHorizontal(position: HvacAirHorzPosition): Promise<void> {
    const value = horzPositionMap[position];
    if (value === undefined) {
      throw new Error(`Invalid horizontal position: ${position}`);
    }
    await this.client.set(this.host, [
      { epc: EPC_AIR_HORZ, pv: encodeUChar(value) },
    ], this.eoj);
  }

  /**
   * Set swing mode (not-used, vert, horiz, vert-horiz).
   */
  async setSwingMode(mode: HvacSwingMode): Promise<void> {
    const value = swingModeMap[mode];
    if (value === undefined) {
      throw new Error(`Invalid swing mode: ${mode}`);
    }
    await this.client.set(this.host, [
      { epc: EPC_SWING_MODE, pv: encodeUChar(value) },
    ], this.eoj);
  }

  /**
   * Set automatic direction mode.
   */
  async setAutoDirection(mode: HvacAutoDirection): Promise<void> {
    const value = autoDirectionMap[mode];
    if (value === undefined) {
      throw new Error(`Invalid auto direction mode: ${mode}`);
    }
    await this.client.set(this.host, [
      { epc: EPC_AUTO_DIRECTION, pv: encodeUChar(value) },
    ], this.eoj);
  }

  /**
   * Set silent operation mode.
   */
  async setSilentMode(mode: HvacSilentMode): Promise<void> {
    const value = silentModeMap[mode];
    if (value === undefined) {
      throw new Error(`Invalid silent mode: ${mode}`);
    }
    await this.client.set(this.host, [
      { epc: EPC_SILENT_MODE, pv: encodeUChar(value) },
    ], this.eoj);
  }

  /**
   * Set power-saving mode.
   */
  async setPowerSaving(state: HvacPowerSaving): Promise<void> {
    const value = powerSavingMap[state];
    if (value === undefined) {
      throw new Error(`Invalid power saving state: ${state}`);
    }
    await this.client.set(this.host, [
      { epc: EPC_POWER_SAVING, pv: encodeUChar(value) },
    ], this.eoj);
  }

  /**
   * Get room temperature only.
   */
  async getRoomTemperature(): Promise<number | null> {
    const data = await this.client.get(this.host, [EPC_ROOM_TEMP], this.eoj);
    for (const item of data) {
      if (item.epc === EPC_ROOM_TEMP && item.pv.length >= 1) {
        return decodeSChar(item.pv);
      }
    }
    return null;
  }

  /**
   * Get outdoor temperature only.
   */
  async getOutdoorTemperature(): Promise<number | null> {
    const data = await this.client.get(this.host, [EPC_OUTDOOR_TEMP], this.eoj);
    for (const item of data) {
      if (item.epc === EPC_OUTDOOR_TEMP && item.pv.length >= 1) {
        return decodeSChar(item.pv);
      }
    }
    return null;
  }

  /**
   * Get both room and outdoor temperatures.
   */
  async getTemperatures(): Promise<{ room: number | null; outdoor: number | null }> {
    const data = await this.client.get(this.host, [EPC_ROOM_TEMP, EPC_OUTDOOR_TEMP], this.eoj);

    let room: number | null = null;
    let outdoor: number | null = null;

    for (const item of data) {
      if (item.epc === EPC_ROOM_TEMP && item.pv.length >= 1) {
        room = decodeSChar(item.pv);
      } else if (item.epc === EPC_OUTDOOR_TEMP && item.pv.length >= 1) {
        outdoor = decodeSChar(item.pv);
      }
    }

    return { room, outdoor };
  }

  /**
   * Get room humidity.
   */
  async getHumidity(): Promise<number | null> {
    const data = await this.client.get(this.host, [EPC_ROOM_HUMIDITY], this.eoj);
    for (const item of data) {
      if (item.epc === EPC_ROOM_HUMIDITY && item.pv.length >= 1) {
        return decodeUChar(item.pv);
      }
    }
    return null;
  }

  /**
   * Get device property map (GETMAP).
   */
  async getCapabilities(): Promise<EpcData[]> {
    return this.client.getmap(this.host, this.eoj);
  }

  /**
   * Update status from a notification packet.
   */
  updateFromNotification(packet: any): void {
    // Parse incoming notification and update cached status
    if (packet && packet.epcData && packet.epcData.length > 0) {
      const parsed = this.parseEpcData(packet.epcData);
      if (this.currentStatus) {
        Object.assign(this.currentStatus, parsed);
      } else {
        this.currentStatus = parsed;
      }
    }
  }
}