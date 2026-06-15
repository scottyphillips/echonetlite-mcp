// ECHONETLite MCP Server Type Definitions

// ============================================================================
// EOJ (ECHONET Object) Identifiers
// ============================================================================

/** Operation status values - strings for MCP tools */
export const HVAC_OPERATION_STATUS = {
  ON: 'ON' as const,
  OFF: 'OFF' as const,
} as const;

// Raw byte values for encoding
export const HVAC_OPERATION_STATUS_RAW = {
  ON: 0x30,
  OFF: 0x31,
} as const;

export type HvacOperationStatus = typeof HVAC_OPERATION_STATUS[keyof typeof HVAC_OPERATION_STATUS];

/** Operation mode values */
export const HVAC_MODE = {
  AUTO: 'auto' as const,
  COOL: 'cool' as const,
  HEAT: 'heat' as const,
  DRY: 'dry' as const,
  FAN_ONLY: 'fan_only' as const,
} as const;

export type HvacMode = typeof HVAC_MODE[keyof typeof HVAC_MODE];

/** Fan speed (air flow rate) values */
export const HVAC_FANSPEED = {
  AUTO: 'auto' as const,
  LEVEL_1: 'level1' as const,
  LEVEL_2: 'level2' as const,
  LEVEL_3: 'level3' as const,
  LEVEL_4: 'level4' as const,
  LEVEL_5: 'level5' as const,
  LEVEL_6: 'level6' as const,
  LEVEL_7: 'level7' as const,
  LEVEL_8: 'level8' as const,
} as const;

export type HvacFanSpeed = typeof HVAC_FANSPEED[keyof typeof HVAC_FANSPEED];

/** Vertical airflow positions */
export const HVAC_AIR_VERT_POSITIONS = {
  UPPER: 'upper' as const,
  UPPER_CENTRAL: 'upper-central' as const,
  CENTRAL: 'central' as const,
  LOWER_CENTRAL: 'lower-central' as const,
  LOWER: 'lower' as const,
} as const;

export type HvacAirVertPosition = typeof HVAC_AIR_VERT_POSITIONS[keyof typeof HVAC_AIR_VERT_POSITIONS];

/** Horizontal airflow positions (28 positions) */
export const HVAC_AIR_HORZ_POSITIONS = {
  RC_RIGHT: 'rc-right' as const,
  LEFT_LC: 'left-lc' as const,
  LC_CENTER_RC: 'lc-center-rc' as const,
  LEFT_LC_RC_RIGHT: 'left-lc-rc-right' as const,
  RIGHT: 'right' as const,
  RC: 'rc' as const,
  CENTER: 'center' as const,
  CENTER_RIGHT: 'center-right' as const,
  CENTER_RC: 'center-rc' as const,
  CENTER_RC_RIGHT: 'center-rc-right' as const,
  LC: 'lc' as const,
  LC_RIGHT: 'lc-right' as const,
  LC_RC: 'lc-rc' as const,
  LC_RC_RIGHT: 'lc-rc-right' as const,
  LC_CENTER: 'lc-center' as const,
  LC_CENTER_RIGHT: 'lc-center-right' as const,
  LC_CENTER_RC_RIGHT: 'lc-center-rc-right' as const,
  LEFT: 'left' as const,
  LEFT_RIGHT: 'left-right' as const,
  LEFT_RC: 'left-rc' as const,
  LEFT_RC_RIGHT: 'left-rc-right' as const,
  LEFT_CENTER: 'left-center' as const,
  LEFT_CENTER_RIGHT: 'left-center-right' as const,
  LEFT_CENTER_RC: 'left-center-rc' as const,
  LEFT_CENTER_RC_RIGHT: 'left-center-rc-right' as const,
  LEFT_LC_RIGHT: 'left-lc-right' as const,
  LEFT_LC_RC: 'left-lc-rc' as const,
} as const;

export type HvacAirHorzPosition = typeof HVAC_AIR_HORZ_POSITIONS[keyof typeof HVAC_AIR_HORZ_POSITIONS];

/** Swing mode values */
export const HVAC_SWING_MODE = {
  NOT_USED: 'not-used' as const,
  VERT: 'vert' as const,
  HORIZ: 'horiz' as const,
  VERT_HORIZ: 'vert-horiz' as const,
} as const;

export type HvacSwingMode = typeof HVAC_SWING_MODE[keyof typeof HVAC_SWING_MODE];

/** Auto direction mode values */
export const HVAC_AUTO_DIRECTION = {
  AUTO: 'auto' as const,
  NON_AUTO: 'non-auto' as const,
  AUTO_VERT: 'auto-vert' as const,
  AUTO_HORIZ: 'auto-horiz' as const,
} as const;

export type HvacAutoDirection = typeof HVAC_AUTO_DIRECTION[keyof typeof HVAC_AUTO_DIRECTION];

/** Silent mode values */
export const HVAC_SILENT_MODE = {
  NORMAL: 'normal' as const,
  HIGH_SPEED: 'high-speed' as const,
  SILENT: 'silent' as const,
} as const;

export type HvacSilentMode = typeof HVAC_SILENT_MODE[keyof typeof HVAC_SILENT_MODE];

/** Power saving mode values */
export const HVAC_POWER_SAVING = {
  SAVING: 'saving' as const,
  NORMAL: 'normal' as const,
} as const;

export type HvacPowerSaving = typeof HVAC_POWER_SAVING[keyof typeof HVAC_POWER_SAVING];

/** Special function settings */
export const HVAC_SPECIAL_FUNCTION = {
  NO_SETTING: 0x40,
  CLOTHES_DRYER: 0x41,
  CONDENSATION_SUPPRESSOR: 0x42,
  MITE_MOLD_CONTROL: 0x43,
  ACTIVE_DEFROSTING: 0x44,
} as const;

export type HvacSpecialFunction = typeof HVAC_SPECIAL_FUNCTION[keyof typeof HVAC_SPECIAL_FUNCTION];

// ============================================================================
// EPC Code Constants (ECHONET Property Codes)
// ============================================================================

/** Operation status */
export const EPC_OPERATION_STATUS = 0x80;

/** Power-saving operation setting */
export const EPC_POWER_SAVING = 0x8f;

/** Air flow rate setting (fan speed) */
export const EPC_FAN_SPEED = 0xa0;

/** Automatic control of air flow direction */
export const EPC_AUTO_DIRECTION = 0xa1;

/** Automatic swing of air flow setting */
export const EPC_SWING_MODE = 0xa3;

/** Air flow direction (vertical) */
export const EPC_AIR_VERT = 0xa4;

/** Air flow direction (horizontal) */
export const EPC_AIR_HORZ = 0xa5;

/** Operation mode setting */
export const EPC_HVAC_MODE = 0xb0;

/** Automatic temperature control */
export const EPC_AUTO_TEMPERATURE = 0xb1;

/** Normal/High-speed/Silent operation */
export const EPC_SILENT_MODE = 0xb2;

/** Set temperature value */
export const EPC_SET_TEMP = 0xb3;

/** Set humidity in dehumidifying mode */
export const EPC_SET_HUMIDITY = 0xb4;

/** Measured room relative humidity */
export const EPC_ROOM_HUMIDITY = 0xba;

/** Measured room temperature */
export const EPC_ROOM_TEMP = 0xbb;

/** Measured outdoor air temperature */
export const EPC_OUTDOOR_TEMP = 0xbe;

/** Ventilation function setting */
export const EPC_VENTILATION = 0xc0;

/** Humidifier function setting */
export const EPC_HUMIDIFIER = 0xc1;

/** Special function setting */
export const EPC_SPECIAL_FUNCTION = 0xcc;

/** Air purification mode setting */
export const EPC_PURIFICATION = 0xcf;

// ============================================================================
// Device Status Types
// ============================================================================

/** Complete HVAC device status snapshot */
export interface HvacStatus {
  /** Whether the unit is ON or OFF */
  operation: HvacOperationStatus | null;
  /** Operating mode (auto, cool, heat, dry, fan_only) */
  mode: HvacMode | null;
  /** Target temperature in °C */
  setTemperature: number | null;
  /** Current room temperature in °C */
  roomTemperature: number | null;
  /** Outdoor temperature in °C */
  outdoorTemperature: number | null;
  /** Room humidity percentage */
  roomHumidity: number | null;
  /** Fan speed setting */
  fanSpeed: HvacFanSpeed | null;
  /** Vertical airflow position */
  airVertPosition: HvacAirVertPosition | null;
  /** Horizontal airflow position */
  airHorzPosition: HvacAirHorzPosition | null;
  /** Swing mode */
  swingMode: HvacSwingMode | null;
  /** Auto direction mode */
  autoDirection: HvacAutoDirection | null;
  /** Silent mode setting */
  silentMode: HvacSilentMode | null;
  /** Power-saving mode */
  powerSaving: HvacPowerSaving | null;
  /** Special function (if any) */
  specialFunction: number | null;
  /** Air purification mode */
  purification: boolean | null;
  /** Ventilation function */
  ventilation: boolean | null;
  /** Humidifier setting */
  humidifier: number | null;
}

/** ECHONETLite property data structure */
export interface EpcData {
  /** EPC code */
  epc: number;
  /** Property value as raw bytes */
  pv: Uint8Array;
  /** Whether the property is settable */
  ac: number; // access capability: 1=set, 2=get, 4=set/get
}

/** EOJ (ECHONET Object) identifier */
export interface Eoj {
  /** Event Object Group Code */
  groupCode: number;
  /** Event Object Class Code */
  classCode: number;
  /** Instance ID */
  instanceId: number;
}

/** ECHONETLite operation type (full pychonet ESV mapping) */
export type OperationType = 
  // Request types
  | 'get' | 'set' | 'setc' | 'getmap' | 'infreq' | 'setget' | 'instance_list'
  // Response types (SNA - Sequence Number Ack)
  | 'get_sna' | 'setc_snd' | 'inf_sna' | 'setget_res' | 'infc_res' | 'seti_sna'
  // Execution response codes
  | 'setres' | 'getres' | 'inf' | 'infc'
  // Deprecated/alias
  | 'seti'
  // Error responses
  | 'access_denied' | 'not_supported' | 'error' | 'setres_error';

// ============================================================================
// Network Packet Types
// ============================================================================

/** Base ECHONETLite packet header */
export interface EchonetPacketHeader {
  /** ECHONET Lite version (major, minor) */
  echonetVersion: [number, number];
  /** Transaction ID (2 bytes, auto-incrementing per pychonet spec) */
  tid: number;
}

/** Full ECHONETLite request/response packet */
export interface EchonetPacket {
  header: EchonetPacketHeader;
  /** Source EOJ */
  sourceEoj: Eoj;
  /** Destination EOJ */
  destinationEoj: Eoj;
  /** Operation type (GET, SET, GETMAP) */
  operation: OperationType;
  /** Property data items */
  epcData: EpcData[];
  /** Raw ESV byte for response matching (0x02=GET, 0x64=GETRES, 0x61=SET, 0x62=SETRES, etc.) */
  esv?: number;
}

// ============================================================================
// Discovery Types
// ============================================================================

/** Discovered device information */
export interface DiscoveredDevice {
  /** IP address of the device */
  host: string;
  /** Device name/description (if available) */
  name?: string;
  /** EOJ identifier */
  eoj: Eoj;
  /** Class-specific details */
  classDetail?: number;
  /** Timestamp when device was discovered */
  timestamp: Date;
}

/**
 * Node Profile discovery data from 0x0E 0xF0 xx class responses.
 * Contains the basic identity information of an ECHONETLite device.
 * 
 * Based on pychonet's Node Profile Class (SEOJGC=0x0E, ESV=0xF0) handling:
 * - INSTANCE_LIST (0xE0): Configuration of instances disclosed to network
 * - MANUFACTURER (0xFE): Device manufacturer string/bytes
 * - PRODUCT_CODE (0xFD): Extended Class Definition (ECOI)
 * - UID (0xFC): Unique device identifier
 */
export interface NodeProfileData {
  /** Instance list configuration - shows all classes on the device */
  instanceList?: Uint8Array;
  /** Manufacturer information (bytes or string) */
  manufacturer?: Uint8Array;
  /** Product code / Extended Class Definition */
  productCode?: Uint8Array;
  /** Unique device identifier */
  uid?: Uint8Array;
  /** Device name (if available) */
  name?: Uint8Array;
  /** Date of manufacture (if available) */
  dateOfManufacture?: Uint8Array;
}

/**
 * Full device discovery result with all EOJ classes and Node Profile data.
 * Used when discovering complex devices with multiple device classes.
 */
export interface DiscoveredDeviceFull {
  /** IP address of the device */
  host: string;
  /** Port number (typically 3610) */
  port?: number;
  /** Node Profile data from 0x0E 0xF0 xx responses */
  nodeProfile?: NodeProfileData;
  /** All EOJ instances found on this device */
  eojInstances: Array<{
    /** EOJ Group Code */
    groupCode: number;
    /** EOJ Class Code */
    classCode: number;
    /** EOJ Instance ID */
    instanceId: number;
    /** Whether this is the primary/representative instance */
    isPrimary?: boolean;
  }>;
  /** Timestamp when device was first seen */
  timestamp: Date;
  /** Whether discovery was completed via active probe or passive observation */
  discoveryMethod: 'active' | 'passive';
}

// ============================================================================
// MCP Types
// ============================================================================

/** MCP tool parameter types for HVAC operations */
export interface SetOperationParams {
  host?: string;
  operation: 'on' | 'off';
}

export interface SetOperatingModeParams {
  host?: string;
  mode: HvacMode;
}

export interface SetTemperatureParams {
  host?: string;
  temperature: number;
}

export interface SetFanSpeedParams {
  host?: string;
  speed: HvacFanSpeed;
}

export interface SetAirflowVerticalParams {
  host?: string;
  position: HvacAirVertPosition;
}

export interface SetAirflowHorizontalParams {
  host?: string;
  position: HvacAirHorzPosition;
}

export interface SetSwingModeParams {
  host?: string;
  mode: HvacSwingMode;
}

export interface SetAutoDirectionParams {
  host?: string;
  mode: HvacAutoDirection;
}

export interface SetSilentModeParams {
  host?: string;
  mode: HvacSilentMode;
}

export interface SetPowerSavingParams {
  host?: string;
  state: HvacPowerSaving;
}

// ============================================================================
// Element-Level Parsing Types (for complex object-type EPCs)
// ============================================================================

/** A single parsed element from an object/array-type property value */
export interface ParsedElement {
  /** Element name/shortName from MRA definition (e.g., "day", "electricEnergy") */
  name: string;
  /** Human-readable label for the element */
  label?: string;
  /** Raw bytes of this element as hex strings */
  rawHex: string;
  /** Individual byte values as hex strings */
  rawBytes: string[];
}

/** A single item from a parsed array-type element */
export interface ParsedArrayItem {
  /** Index in the array (0-based) */
  index: number;
  /** Time slot label for fixed-structure arrays like E2 (e.g., "00:00", "00:30") */
  timeSlot?: string;
  /** Raw bytes of this item as hex strings */
  rawHex: string;
  /** Individual byte values as hex strings */
  rawBytes: string[];
}

/** Result of parsing an object/array-type EPC value into named elements */
export interface ParsedEpcElements {
  /** The EPC code in hex format */
  epc: string;
  /** Property name from MRA */
  propertyName: string;
  /** Short name from MRA */
  shortName: string;
  /** Total raw value as hex strings (before element splitting) */
  rawHex: string[];
  /** Named elements parsed from the object structure */
  elements: ParsedElement[];
  /** For array-type elements, their individual items */
  arrayItems?: Array<{
    elementName: string;
    items: ParsedArrayItem[];
  }>;
}
