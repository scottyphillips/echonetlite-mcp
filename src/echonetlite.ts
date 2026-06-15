// ECHONETLite Protocol Client Wrapper
// Handles UDP communication, binary packet encoding/decoding, and multicast notifications

import dgram from 'node:dgram';
import {
  ECHONET_PORT,
  MULTICAST_ADDRESS,
  MULTICAST_PORT,
  DEFAULT_SEOJ_GROUP,
  DEFAULT_SEOJ_CLASS,
  REQUEST_TIMEOUT_MS,
  DISCOVERY_RETRIES,
  DISCOVERY_INTERVAL_MS,
} from './config.js';
import type {
  EchonetPacket,
  Eoj,
  EpcData,
  DiscoveredDevice,
  NodeProfileData,
  DiscoveredDeviceFull,
} from './types.js';

import {
  EPC_INSTANCE_LIST,
  EPC_UID,
  EPC_NAME,
  EPC_DATE_OF_MANUFACTURE,
  EPC_MANUFACTURER,
  EPC_ECOI,
  NODE_PROFILE_GROUP,
  NODE_PROFILE_CLASS,
} from './config.js';

// ============================================================================
// Binary Packet Builders / Parsers
// ============================================================================

/**
 * Build an ECHONETLite packet buffer for sending.
 * Format per pychonet buildEchonetMsg:
 *   [EHD(2)] [TID(2)] [SEOJ(3)] [DEOJ(3)] [ESV(1)] [OPC(1)] [EPC+PDC+EDT...]
 * 
 * EHD = 0x1081 (ECHONETLite v1.0, standard frame)
 * TID = Transaction ID (2 bytes, auto-incrementing per pychonet)
 * SEOJ = DEFAULT_SEOJ_GROUP/CLASS + packet.sourceEoj.instanceId
 * DEOJ = Destination EOJ
 * ESV = Execution Status Value (operation type)
 * OPC = Operation Data Count (number of EPC entries)
 */
let nextTid = 0x0001;

function buildPacketBuffer(packet: EchonetPacket): Buffer {
  // Calculate EPC data size: for each entry: EPC(1) + PDC(1) + PV(pv.length)
  const epcDataSize = packet.epcData.reduce((sum, e) => sum + 2 + e.pv.length, 0);

  // Header: EHD(2) + TID(2) + srcEOJ(3) + dstEOJ(3) + esv(1) + opc(1) = 12
  const headerSize = 12;
  const totalSize = headerSize + epcDataSize;
  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // EHD (Header): 0x10 0x81
  buffer.writeUInt8(0x10, offset++);
  buffer.writeUInt8(0x81, offset++);

  // Transaction ID (TID) - 2 bytes big-endian, auto-incrementing per pychonet spec
  const tid = nextTid++;
  if (nextTid > 0xFFFF) nextTid = 0x0001;
  buffer.writeUInt16BE(tid, offset);
  offset += 2;

  // Source EOJ (SEOJ - 3 bytes): pychonet default group/class + packet's instance
  buffer.writeUInt8(DEFAULT_SEOJ_GROUP, offset++);
  buffer.writeUInt8(DEFAULT_SEOJ_CLASS, offset++);
  buffer.writeUInt8(packet.sourceEoj.instanceId, offset++);

  // Destination EOJ (DEOJ - 3 bytes)
  buffer.writeUInt8(packet.destinationEoj.groupCode, offset++);
  buffer.writeUInt8(packet.destinationEoj.classCode, offset++);
  buffer.writeUInt8(packet.destinationEoj.instanceId, offset++);

  // ESV (Execution Status Value) - operation type per pychonet spec
  // GET=0x62, SETC/SET=0x61, SETI_SNA=0x50, GET_SNA=0x52, etc.
  const esvMap: Record<string, number> = { 
    get: 0x62, set: 0x61, getmap: 0x63, infreq: 0x63,
    getres: 0x72, setres: 0x71, seti: 0x50, setc: 0x61,
    inf: 0x73, infc: 0x74, setget: 0x6e, instance_list: 0xd6,
    // SNA (Sequence Number Ack) response codes
    get_sna: 0x52, setc_snd: 0x51, inf_sna: 0x53,
    setget_res: 0x7e, infc_res: 0x7a, seti_sna: 0x50,
  };
  buffer.writeUInt8(esvMap[packet.operation] || 0x02, offset++);

  // OPC (Operation Data Count) - number of EPC entries
  buffer.writeUInt8(packet.epcData.length, offset++);

  // EPC data items: [EPC(1) + PDC(n) + EDT(PDC bytes)]...
  for (const epc of packet.epcData) {
    buffer.writeUInt8(epc.epc, offset++);
    const pdc = epc.pv.length;
    buffer.writeUInt8(pdc, offset++); // PDC = number of PV/EDT bytes
    if (pdc > 0) {
      buffer.set(epc.pv, offset);
      offset += pdc;
    }
  }

  return buffer;
}

/**
 * Parse an ECHONETLite packet from a Buffer.
 * Format per pychonet:
 *   [EHD(2)] [TID(2)] [SEOJ(3)] [DEOJ(3)] [ESV(1)] [OPC(1)] [EPC+PDC+EDT...]
 */
function parsePacket(buffer: Buffer): EchonetPacket | null {
  // Minimum size: EHD(2) + TID(2) + SEOJ(3) + DEOJ(3) + ESV(1) + OPC(1) = 12
  if (buffer.length < 12) return null;

  let offset = 0;

  // EHD (Header): validate ECHONETLite format
  const ehd1 = buffer.readUInt8(offset++); // Version byte: should be 0x10
  const ehd2 = buffer.readUInt8(offset++); // Frame format byte: should be 0x81

  if (ehd1 !== 0x10) return null; // Only support ECHONET Lite v1.x
  if (ehd2 !== 0x81) return null; // Standard frame format required

  // Transaction ID (TID) - 2 bytes big-endian (NOT a timestamp!)
  const tid = buffer.readUInt16BE(offset);
  offset += 2;

  // Source EOJ (SEOJ - 3 bytes: groupCode, classCode, instanceId)
  const sourceEoj: Eoj = {
    groupCode: buffer.readUInt8(offset++),
    classCode: buffer.readUInt8(offset++),
    instanceId: buffer.readUInt8(offset++),
  };

  // Destination EOJ (DEOJ - 3 bytes)
  const destinationEoj: Eoj = {
    groupCode: buffer.readUInt8(offset++),
    classCode: buffer.readUInt8(offset++),
    instanceId: buffer.readUInt8(offset++),
  };

  // ESV (Execution Status Value) - identifies request type AND response type
  const esv = buffer.readUInt8(offset++);

  // Map ESV to operation string (both requests and responses) per pychonet spec
  // Full ESV table from pychonet echonetlite.py:
  const allMap: Record<number, string> = {
    // Request codes
    0x62: 'get',       // GET
    0x61: 'setc',      // SETC (Set with response)
    0x63: 'infreq',    // INFREQ
    0x6e: 'setget',    // SETGET
    0xd6: 'instance_list',  // INSTANCE_LIST
    // Response codes (SNA - Sequence Number Ack)
    0x52: 'get_sna',   // GET_SNA — ack for SETC/GET requests
    0x51: 'setc_snd',  // SETC_SND
    0x53: 'inf_sna',   // INF_SNA
    0x5e: 'setget_res',// SETGET_RES
    0x7a: 'infc_res',  // INFC_RES
    0x50: 'seti_sna',  // SETI_SNA
    // Execution response codes
    0x71: 'setres',    // SETRES (Set response)
    0x72: 'getres',    // GETRES (Get response)
    0x73: 'inf',       // INF (Notification)
    0x74: 'infc',      // INFC (Notification confirm)
    // Deprecated/alias codes
    0x65: 'seti',      // SETI (deprecated, use seti_sna)
    0x60: 'seti',      // GETC/SETI (deprecated)
    // Error response codes
    0x64: 'access_denied', 0x66: 'not_supported', 0x67: 'error',
    0x75: 'setres_error',
  };
  const opStr = allMap[esv];
  if (!opStr) {
    console.error(`parsePacket: Unknown ESV=0x${esv.toString(16)}, buffer length=${buffer.length}`);
    return null;
  }

  // OPC (Operation Data Count) - number of EPC entries
  const epcCount = buffer.readUInt8(offset++);

  // Parse EPC data items with proper PDC-based length reading
  const epcData: EpcData[] = [];
  for (let i = 0; i < epcCount && offset < buffer.length; i++) {
    const epc = buffer.readUInt8(offset++);

    // Read PDC (Property Data Count) - number of bytes following
    let pdc = 0;
    if (offset < buffer.length) {
      pdc = buffer.readUInt8(offset++);
    }

    // Read EDT/EVD data
    const pvLen = Math.max(0, Math.min(pdc, buffer.length - offset));
    const pv = buffer.subarray(offset, offset + pvLen);
    offset += pvLen;

    epcData.push({ epc, pv, ac: pdc });
  }

  return {
    header: { echonetVersion: [ehd1, ehd2], tid },
    sourceEoj,
    destinationEoj,
    operation: opStr as any,
    epcData,
    esv: esv,
  };
}

// ============================================================================
// Value Encoders/Decoders for specific EPC types
// ============================================================================

export function encodeUChar(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}

export function encodeSChar(value: number): Uint8Array {
  const clamped = Math.max(-127, Math.min(127, value));
  return new Uint8Array([(clamped < 0 ? clamped + 256 : clamped) & 0xff]);
}

export function encodeUInt16(value: number): Uint8Array {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value, 0);
  return new Uint8Array(buf);
}

export function encodeSInt16(value: number): Uint8Array {
  const buf = Buffer.alloc(2);
  buf.writeInt16BE(value, 0);
  return new Uint8Array(buf);
}

export function decodeUChar(pv: Uint8Array): number {
  return pv.length > 0 ? pv[0] : 0;
}

export function decodeSChar(pv: Uint8Array): number {
  if (pv.length === 0) return 0;
  const val = pv[0];
  return val > 127 ? val - 256 : val;
}

export function decodeUInt16(pv: Uint8Array): number {
  if (pv.length < 2) return 0;
  return (pv[0] << 8) | pv[1];
}

export function decodeSInt16(pv: Uint8Array): number {
  if (pv.length < 2) return 0;
  const buf = Buffer.from(pv);
  return buf.readInt16BE(0);
}

// ============================================================================
// Discovery Helper Functions
// ============================================================================

/**
 * Build DiscoveredDeviceFull from collected ECHONETLite responses.
 * 
 * Per pychonet echonetMessageReceived logic:
 * - Filter for Node Profile Class Response (SEOJGC=0x0E, ESV=0xF0)  
 * - Extract EPC data: INSTANCE_LIST, MANUFACTURER, PRODUCT_CODE, UID
 * - Also collect all EOJ instances from any class responses received
 */
function buildDiscoveredDevice(
  host: string,
  responses: EchonetPacket[]
): DiscoveredDeviceFull {
  const nodeProfile: NodeProfileData = {};
  const eojInstancesMap = new Map<string, { groupCode: number; classCode: number; instanceId: number }>();
  
  for (const packet of responses) {
    const seoJgc = packet.sourceEoj.groupCode;
    const seoJcc = packet.sourceEoj.classCode;
    const seoJci = packet.sourceEoj.instanceId;
    
    // Track all EOJ instances from any response
    const eojKey = `${seoJgc}-${seoJcc}-${seoJci}`;
    if (!eojInstancesMap.has(eojKey)) {
      eojInstancesMap.set(eojKey, {
        groupCode: seoJgc,
        classCode: seoJcc,
        instanceId: seoJci,
      });
    }
    
    // Process Node Profile Class responses (SEOJGC=0x0E, SEOJCC=0xF0)
    if (seoJgc === NODE_PROFILE_GROUP && seoJcc === NODE_PROFILE_CLASS) {
      // This is a Node Profile Class response
      for (const epcData of packet.epcData) {
        switch (epcData.epc) {
          case EPC_INSTANCE_LIST:  // 0xD6 - Instance List Notification
            nodeProfile.instanceList = epcData.pv;
            break;
          case EPC_MANUFACTURER:   // 0x8A - Manufacturer
            nodeProfile.manufacturer = epcData.pv;
            break;
          case EPC_ECOI:           // 0x8C - Extended Class Definition (Product Code)
            nodeProfile.productCode = epcData.pv;
            break;
          case EPC_UID:            // 0x83 - Unique Device Identifier
            nodeProfile.uid = epcData.pv;
            break;
          case EPC_NAME:           // 0xFB - Device Name
            nodeProfile.name = epcData.pv;
            break;
          case EPC_DATE_OF_MANUFACTURE:  // 0xFA - Date of Manufacture
            nodeProfile.dateOfManufacture = epcData.pv;
            break;
        }
      }
    }
  }
  
  // Parse INSTANCE_LIST (EPC 0xD6) to find all EOJ instances on the device.
  // Per pychonet process_discovery_data():
  //   edtnum = bytearray(edt)[0]           # Number of EOJ entries (NOT total bytes)
  //   For each entry x in range(edtnum):
  //     eojgc = edt[1 + (3 * x)]           # Group Code (3 bytes per entry)
  //     eojcc = edt[2 + (3 * x)]           # Class Code  
  //     eojci = edt[3 + (3 * x)]           # Instance ID
  //   Entries with group code 0x0F (User definition) are ignored.
  if (nodeProfile.instanceList && nodeProfile.instanceList.length > 1) {
    const instList = nodeProfile.instanceList;
    const edtnum = instList[0]; // Number of EOJ entries (each entry is 3 bytes)
    
    for (let x = 0; x < edtnum; x++) {
      const baseOffset = 1 + (3 * x);
      if (baseOffset + 2 >= instList.length) break;
      
      const eojgc = instList[baseOffset];
      const eojcc = instList[baseOffset + 1];
      const eojci = instList[baseOffset + 2];
      
      // Skip user definition class group (0x0F) per pychonet logic
      if (eojgc === 0x0f) continue;
      
      const key = `${eojgc}-${eojcc}-${eojci}`;
      if (!eojInstancesMap.has(key)) {
        eojInstancesMap.set(key, {
          groupCode: eojgc,
          classCode: eojcc,
          instanceId: eojci,
        });
      }
    }
  }
  
  const eojInstances = Array.from(eojInstancesMap.values()).map((e, i) => ({
    ...e,
    isPrimary: i === 0,
  }));
  
  return {
    host,
    nodeProfile: Object.keys(nodeProfile).length > 0 ? nodeProfile : undefined,
    eojInstances,
    timestamp: new Date(),
    discoveryMethod: 'active',
  };
}

interface PendingRequest {
  resolve: (value: EchonetPacket) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class EchonetLiteClient {
  private udpSocket: dgram.Socket | null = null;
  // Match responses by TID + source address (each request gets unique TID)
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private notificationListeners: Set<(packet: EchonetPacket, info: { address: string; port: number }) => void> = new Set();

  initialize(): void {
    this.udpSocket = dgram.createSocket('udp4');

    // Bind with SO_REUSEADDR to allow sharing port with pychonet
    this.udpSocket.bind({
      port: ECHONET_PORT,
      address: '192.168.1.5',
      exclusive: false
    }, () => {
      console.error(`ECHONETLite client: Socket bound to 192.168.1.5:${ECHONET_PORT}`);

      if (this.udpSocket) {
        this.udpSocket.addMembership(MULTICAST_ADDRESS, '192.168.1.5');
        console.error(`ECHONETLite client: Joined multicast group ${MULTICAST_ADDRESS}`);
      }
    });

    this.udpSocket.on('message', (message: Buffer, rinfo: dgram.RemoteInfo) => {
      this.handleIncomingMessage(message, rinfo.address, rinfo.port);
    });

    this.udpSocket.on('error', (err: Error) => {
      console.error(`ECHONETLite client: Socket error: ${err.message}`);
      this.rejectAllRequests(new Error(`Socket error: ${err.message}`));
    });
  }

  private handleIncomingMessage(message: Buffer, address: string, port: number): void {
    const packet = parsePacket(message);
    if (!packet) {
      console.error(`ECHONETLite client: Received invalid packet from ${address}:${port}`);
      return;
    }

    // Match response by TID + source address
    const requestId = `${packet.header.tid}:${address}`;
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      pending.resolve(packet);
      return;
    }

    // Notify listeners of unsolicited notifications
    for (const listener of this.notificationListeners) {
      try {
        listener(packet, { address, port });
      } catch (err) {
        console.error(`ECHONETLite client: Notification listener error: ${(err as Error).message}`);
      }
    }
  }

  private rejectAllRequests(reason: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pendingRequests.clear();
  }

  async sendRequest(
    targetHost: string,
    packet: EchonetPacket,
    timeoutMs: number = REQUEST_TIMEOUT_MS
  ): Promise<EchonetPacket> {
    return new Promise((resolve, reject) => {
      if (!this.udpSocket) {
        reject(new Error('ECHONETLite client not initialized'));
        return;
      }

      const buffer = buildPacketBuffer(packet);
      
      // Extract the TID we just wrote for matching responses
      const tid = buffer.readUInt16BE(2);
      
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestKey);
        reject(new Error(`ECHONETLite request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      // Match by TID + target host address
      const requestKey = `${tid}:${targetHost}`;
      this.pendingRequests.set(requestKey, { resolve, reject, timer });

      this.udpSocket.send(buffer, 0, buffer.length, ECHONET_PORT, targetHost, (err) => {
        if (err) {
          this.pendingRequests.delete(requestKey);
          clearTimeout(timer);
          reject(new Error(`ECHONETLite send error: ${err.message}`));
        }
      });
    });
  }

  async discoverDevices(timeoutMs: number = DISCOVERY_INTERVAL_MS * DISCOVERY_RETRIES + 1000): Promise<DiscoveredDevice[]> {
    if (!this.udpSocket) {
      throw new Error('ECHONETLite client not initialized');
    }

    const discovered: DiscoveredDevice[] = [];
    const seenHosts = new Set<string>();

    // Filter out responses from our own MCP server by checking the Source EOJ.
    // Our packets use DEFAULT_SEOJ_GROUP (0x05) as the source group code.
    // Any response originating from our own ECHONETLite stack will have this SEOJ.
    const discoverListener = (packet: EchonetPacket, info: { address: string; port: number }) => {
      const host = info.address;
      
      // Skip responses from our own MCP server (SEOJ group code matches DEFAULT_SEOJ_GROUP)
      if (packet.sourceEoj.groupCode === DEFAULT_SEOJ_GROUP) {
        return;
      }
      
      if (!seenHosts.has(host)) {
        seenHosts.add(host);
        discovered.push({
          host,
          eoj: packet.sourceEoj,
          timestamp: new Date(),
        });
      }
    };

    this.notificationListeners.add(discoverListener);

    // Discovery request to multicast - uses Node Profile Class (0x0E 0xF0) 
    // to discover all devices on the network via their Node Profile responses.
    // This matches the same destination EOJ used by discoverDevice/discover_nodes.
    const discoverPacket: EchonetPacket = {
      header: { echonetVersion: [0x10, 0x81], tid: 0 },
      sourceEoj: { groupCode: DEFAULT_SEOJ_GROUP, classCode: DEFAULT_SEOJ_CLASS, instanceId: 0xff },
      destinationEoj: { groupCode: NODE_PROFILE_GROUP, classCode: NODE_PROFILE_CLASS, instanceId: 0x01 },
      operation: 'get',
      epcData: [{ epc: EPC_INSTANCE_LIST, pv: new Uint8Array([]), ac: 4 }],
    };

    const buffer = buildPacketBuffer(discoverPacket);

    for (let i = 0; i < DISCOVERY_RETRIES; i++) {
      await new Promise<void>((resolve) => {
        this.udpSocket!.send(buffer, 0, buffer.length, MULTICAST_PORT, MULTICAST_ADDRESS, () => {
          resolve();
        });
      });
      if (i < DISCOVERY_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, DISCOVERY_INTERVAL_MS));
      }
    }

    // Also send to broadcast address using Node Profile Class destination
    const broadcastBuffer = buildPacketBuffer({
      ...discoverPacket,
      destinationEoj: { groupCode: NODE_PROFILE_GROUP, classCode: NODE_PROFILE_CLASS, instanceId: 0xFF },
    });

    await new Promise<void>((resolve) => {
      this.udpSocket!.send(broadcastBuffer, 0, broadcastBuffer.length, ECHONET_PORT, '255.255.255.255', () => {
        resolve();
      });
    });

    await new Promise(resolve => setTimeout(resolve, timeoutMs));

    this.notificationListeners.delete(discoverListener);
    return discovered;
  }

  async get(
    host: string,
    epcCodes: number[],
    destinationEoj?: Eoj
  ): Promise<EpcData[]> {
    const packet: EchonetPacket = {
      header: { echonetVersion: [0x10, 0x81], tid: 0 },
      sourceEoj: { groupCode: DEFAULT_SEOJ_GROUP, classCode: DEFAULT_SEOJ_CLASS, instanceId: 0xff },
      destinationEoj: destinationEoj || { groupCode: 0x01, classCode: 0x30, instanceId: 0x01 },
      operation: 'get',
      epcData: epcCodes.map(epc => ({ epc, pv: new Uint8Array([]), ac: 4 })),
    };

    const response = await this.sendRequest(host, packet);
    return response.epcData.filter(e => epcCodes.includes(e.epc));
  }

  async set(
    host: string,
    epcDataItems: { epc: number; pv: Uint8Array }[],
    destinationEoj?: Eoj
  ): Promise<void> {
    const packet: EchonetPacket = {
      header: { echonetVersion: [0x10, 0x81], tid: 0 },
      sourceEoj: { groupCode: DEFAULT_SEOJ_GROUP, classCode: DEFAULT_SEOJ_CLASS, instanceId: 0xff },
      destinationEoj: destinationEoj || { groupCode: 0x01, classCode: 0x30, instanceId: 0x01 },
      operation: 'set',
      epcData: epcDataItems.map(item => ({ ...item, ac: 4 })),
    };

    await this.sendRequest(host, packet);
  }

  async getmap(
    host: string,
    destinationEoj?: Eoj
  ): Promise<EpcData[]> {
    const packet: EchonetPacket = {
      header: { echonetVersion: [0x10, 0x81], tid: 0 },
      sourceEoj: { groupCode: DEFAULT_SEOJ_GROUP, classCode: DEFAULT_SEOJ_CLASS, instanceId: 0xff },
      destinationEoj: destinationEoj || { groupCode: 0x01, classCode: 0x30, instanceId: 0x01 },
      operation: 'getmap',
      epcData: [{ epc: 0xe0, pv: new Uint8Array([0x01]), ac: 4 }],
    };

    const response = await this.sendRequest(host, packet);
    return response.epcData;
  }

  /**
   * Parse STATMAP/SETMAP/GETMAP bitmap or raw EPC list data.
   * First byte is always a count (PDC) of following bytes.
   * 
   * For short data (< 17 total bytes including count): raw EPC hex values
   * For long data (>= 17 total bytes): bitmap format (_009X)
   *   Each byte represents 8 EPCs: bit j set → EPC = (j + 8) * 16 + code
   *   where code = byte_index - 1 (low nibble of EPC)
   */
  private parsePropertyMapData(data: Uint8Array): { epc: number; ac: number | null }[] {
    const entries: { epc: number; ac: number | null }[] = [];

    if (data.length < 2) return entries;

    // First byte is count/PDC - skip it
    const totalBytes = data.length;

    if (totalBytes < 17) {
      // Short format: each remaining byte IS an EPC value directly
      for (let i = 1; i < totalBytes; i++) {
        entries.push({ epc: data[i], ac: null });
      }
    } else {
      // Long bitmap format (_009X): each byte encodes 8 EPCs
      for (let i = 1; i < totalBytes; i++) {
        const code = i - 1; // low nibble of EPC
        const byteVal = data[i];
        for (let j = 0; j < 8; j++) {
          if (byteVal & (1 << j)) {
            const epc = (j + 8) * 16 + code;
            entries.push({ epc, ac: null });
          }
        }
      }
    }

    return entries;
  }

  /**
   * Query all property maps (STATMAP, SETMAP, GETMAP) of an ECHONETLite object.
   * Uses standardized EPCs: 0x9D=STATMAP, 0x9E=SETMAP, 0x9F=GETMAP.
   * Returns parsed property map entries for all three maps in a single request.
   */
  async getAllPropertyMaps(
    host: string,
    destinationEoj?: Eoj
  ): Promise<EpcData[]> {
    const packet: EchonetPacket = {
      header: { echonetVersion: [0x10, 0x81], tid: 0 },
      sourceEoj: { groupCode: DEFAULT_SEOJ_GROUP, classCode: DEFAULT_SEOJ_CLASS, instanceId: 0xff },
      destinationEoj: destinationEoj || { groupCode: 0x01, classCode: 0x30, instanceId: 0x01 },
      operation: 'get',
      epcData: [
        { epc: 0x9d, pv: new Uint8Array([]), ac: 4 },  // STATMAP - status change announcement EPCs
        { epc: 0x9e, pv: new Uint8Array([]), ac: 4 },  // SETMAP - settable properties
        { epc: 0x9f, pv: new Uint8Array([]), ac: 4 },  // GETMAP - readable properties
      ],
    };

    const response = await this.sendRequest(host, packet);
    return response.epcData;
  }

  /**
   * Discover a specific device by IP address using active Node Profile probing.
   * 
   * Based on pychonet's discover() and echonetMessageReceived() logic:
   * 
   * DISCOVERY PACKET STRUCTURE:
   * - When host is multicast (224.0.23.0): Only request INSTANCE_LIST (0xE0)
   * - When host is specific IP: Request full Node Profile data:
   *   - 0xFE (ENL_MANUFACTURER): Device manufacturer
   *   - 0xFD (ENL_ECOI/PRODUCT_CODE): Product code / Extended Class Definition  
   *   - 0xFC (ENL_UID): Unique device identifier
   *   - 0xE0 (INSTANCE_LIST): All instance classes on the device
   * 
   * The request targets the Node Profile Class (0x0E 0xF0 0xFF) which every
   * ECHONETLite device MUST implement according to the MRA specification.
   * 
   * RESPONSE PROCESSING:
   * - Responses come back as Node Profile Class Response (SEOJGC=0x0E, ESV=0xF0)
   * Each response contains EPC/EDT pairs with the discovered data
   - Multiple instances may be reported via INSTANCE_LIST encoding
   */
  async discoverDevice(
    host: string,
    timeoutMs: number = REQUEST_TIMEOUT_MS
  ): Promise<DiscoveredDeviceFull> {
    if (!this.udpSocket) {
      throw new Error('ECHONETLite client not initialized');
    }

    console.error(`[discover_device] Starting discovery for host=${host}, timeout=${timeoutMs}ms`);

    // Collect responses from this specific host
    const collectedResponses: EchonetPacket[] = [];
    const seenTids = new Set<number>();

    // Build discovery request packet per pychonet logic:
    // For specific host, request ALL Node Profile EPCs:
    //   0xFE (Manufacturer), 0xFD (Product Code/ECOI), 0xFC (UID), 0xE0 (Instance List)
    const discoveryPacket: EchonetPacket = {
      header: { echonetVersion: [0x10, 0x81], tid: 0 },
      sourceEoj: { 
        groupCode: DEFAULT_SEOJ_GROUP, 
        classCode: DEFAULT_SEOJ_CLASS, 
        instanceId: 0x01 
      },
      destinationEoj: { 
        groupCode: NODE_PROFILE_GROUP,       // 0x0E - Node Profile group
        classCode: NODE_PROFILE_CLASS,        // 0xF0 - Node Profile class  
        instanceId: 0x01                      // Node Profile instance (per MRA spec)
      },
      operation: 'get',
      epcData: [
        { epc: EPC_MANUFACTURER, pv: new Uint8Array([]), ac: 4 },   // 0xFE - Manufacturer
        { epc: EPC_ECOI, pv: new Uint8Array([]), ac: 4 },           // 0xFD - Product Code/ECOI
        { epc: EPC_UID, pv: new Uint8Array([]), ac: 4 },            // 0xFC - Unique ID
        { epc: EPC_INSTANCE_LIST, pv: new Uint8Array([]), ac: 4 }, // 0xD6 - Instance List (empty PV per pychonet spec)
      ],
    };

    const buffer = buildPacketBuffer(discoveryPacket);
    
    console.error(`[discover_device] Built packet, length=${buffer.length} bytes`);
    console.error(`[discover_device] Raw hex: ${buffer.toString('hex')}`);
    
    // Read the actual TID that was written by buildPacketBuffer (bytes 2-3, big-endian)
    const actualTid = buffer.readUInt16BE(2);
    console.error(`[discover_device] Assigned TID=0x${actualTid.toString(16).padStart(4, '0')} (${actualTid})`);

    // Set up listener AFTER building packet so we catch the correct TID
    const discoveryListener = (packet: EchonetPacket, info: { address: string; port: number }) => {
      console.error(`[discover_device] Listener: received from ${info.address}:${info.port}`);
      console.error(`[discover_device] Listener: packet TID=0x${packet.header.tid.toString(16).padStart(4, '0')}, SEOJ=${packet.sourceEoj.groupCode.toString(16)}-${packet.sourceEoj.classCode.toString(16)}-${packet.sourceEoj.instanceId.toString(16)}`);
      
      // Only collect from the target host
      if (info.address !== host) {
        console.error(`[discover_device] Listener: IGNORED - wrong host`);
        return;
      }

      // Filter by expected TID to only collect responses to our request
      if (packet.header.tid !== actualTid) {
        console.error(`[discover_device] Listener: IGNORED - TID mismatch`);
        return;
      }

      // Track TIDs to avoid duplicates
      if (seenTids.has(actualTid)) {
        console.error(`[discover_device] Listener: IGNORED - duplicate TID`);
        return;
      }
      
      console.error(`[discover_device] Listener: ACCEPTED!`);
      seenTids.add(actualTid);
      collectedResponses.push(packet);
    };

    this.onNotification(discoveryListener);

    // Send discovery request to the specific host
    console.error(`[discover_device] Sending first probe to ${host}:${ECHONET_PORT}`);
    await new Promise<void>((resolve, reject) => {
      this.udpSocket!.send(buffer, 0, buffer.length, ECHONET_PORT, host, (err) => {
        if (err) {
          console.error(`[discover_device] First probe send error: ${err.message}`);
          reject(new Error(`Discovery send error: ${err.message}`));
        } else {
          console.error(`[discover_device] First probe sent OK`);
          resolve();
        }
      });
    });

    // Also retry once per pychonet DISCOVERY_RETRIES pattern
    console.error(`[discover_device] Waiting ${DISCOVERY_INTERVAL_MS}ms before retry...`);
    await new Promise(resolve => setTimeout(resolve, DISCOVERY_INTERVAL_MS));
    
    console.error(`[discover_device] Sending second probe to ${host}:${ECHONET_PORT}`);
    await new Promise<void>((resolve, reject) => {
      this.udpSocket!.send(buffer, 0, buffer.length, ECHONET_PORT, host, (err) => {
        if (err) {
          console.error(`[discover_device] Second probe send error: ${err.message}`);
          reject(new Error(`Discovery send error: ${err.message}`));
        } else {
          console.error(`[discover_device] Second probe sent OK`);
          resolve();
        }
      });
    });

    // Wait for responses with the actual TID used in the packet
    console.error(`[discover_device] Waiting ${timeoutMs}ms for responses...`);
    
    const result = await new Promise<DiscoveredDeviceFull>((resolve) => {
      setTimeout(() => {
        console.error(`[discover_device] Timeout reached. Collected ${collectedResponses.length} response(s)`);
        
        // Log all collected responses
        for (let i = 0; i < collectedResponses.length; i++) {
          const pkt = collectedResponses[i];
          console.error(`[discover_device] Response #${i + 1}:`);
          console.error(`[discover_device]   SEOJ: ${pkt.sourceEoj.groupCode.toString(16).padStart(2, '0')}-${pkt.sourceEoj.classCode.toString(16).padStart(2, '0')}-${pkt.sourceEoj.instanceId.toString(16).padStart(2, '0')}`);
          console.error(`[discover_device]   ESV: 0x${pkt.esv?.toString(16) || 'N/A'}`);
          console.error(`[discover_device]   EPCs: ${pkt.epcData.map(e => `0x${e.epc.toString(16).padStart(2, '0')}(${e.pv.length} bytes)`).join(', ')}`);
          
          // Decode INSTANCE_LIST if present
          const instListEpc = pkt.epcData.find(e => e.epc === EPC_INSTANCE_LIST);
          if (instListEpc && instListEpc.pv.length > 0) {
            const edtnum = instListEpc.pv[0];
            console.error(`[discover_device]   INSTANCE_LIST: ${edtnum} entries`);
            for (let x = 0; x < edtnum; x++) {
              const baseOffset = 1 + (3 * x);
              if (baseOffset + 2 >= instListEpc.pv.length) break;
              console.error(`[discover_device]     Entry ${x}: 0x${instListEpc.pv[baseOffset].toString(16).padStart(2, '0')}-0x${instListEpc.pv[baseOffset + 1].toString(16).padStart(2, '0')}-0x${instListEpc.pv[baseOffset + 2].toString(16).padStart(2, '0')}`);
            }
          }
        }

        this.offNotification(discoveryListener);
        resolve(buildDiscoveredDevice(host, collectedResponses));
      }, timeoutMs);
    });
    
    console.error(`[discover_device] Final result: ${result.eojInstances.length} EOJ instances found`);
    return result;
  }

  /**
   * Build DiscoveredDeviceFull from collected ECHONETLite responses.
   * 
   * Per pychonet logic:
   * - Filter for Node Profile Class Response (SEOJGC=0x0E, ESV=0xF0)
   * - Extract EPC data: INSTANCE_LIST, MANUFACTURER, PRODUCT_CODE, UID
   * - Also collect all EOJ instances from any class responses received
   */
  onNotification(listener: (packet: EchonetPacket, info: { address: string; port: number }) => void): void {
    this.notificationListeners.add(listener);
  }

  offNotification(listener: (packet: EchonetPacket, info: { address: string; port: number }) => void): void {
    this.notificationListeners.delete(listener);
  }

  destroy(): void {
    if (this.udpSocket) {
      this.udpSocket.dropMembership(MULTICAST_ADDRESS);
      this.udpSocket.close();
      this.udpSocket = null;
    }
    this.rejectAllRequests(new Error('Client destroyed'));
  }
}

// Re-export types
export type { EchonetPacket, Eoj, EpcData, DiscoveredDevice, NodeProfileData, DiscoveredDeviceFull };
