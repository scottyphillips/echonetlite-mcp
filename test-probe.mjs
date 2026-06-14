import dgram from 'node:dgram';

const HOST = '192.168.1.234';
const PORT = 3610;
const LOCAL_ADDR = '192.168.1.5';

// Discovery probe: pychonet working format
// 1081 = EHD, 0001 = TID, 05ff01 = SEOJ, 0ef001 = DEOJ(Node Profile), 62 = GET, 04 = OPC(4)
// 8a00 8c00 8300 d600 = EPC data (pychonet working values)
const probeHex = '1081000105ff010ef00162048a008c008300d600';
const probe = Buffer.from(probeHex, 'hex');

console.error('=== ECHONETLite Discovery Probe Test ===');
console.error(`Target: ${HOST}:${PORT}`);
console.error(`Probe hex: ${probeHex}`);
console.error(`Probe length: ${probe.length} bytes`);

const socket = dgram.createSocket('udp4');
let responseCount = 0;

socket.bind({ port: PORT, address: LOCAL_ADDR, exclusive: false }, () => {
  console.error('\nSocket bound successfully to ' + LOCAL_ADDR + ':' + PORT);
  
  // Join multicast group
  try {
    socket.addMembership('224.0.23.0', LOCAL_ADDR);
    console.error('Joined multicast group 224.0.23.0');
  } catch (e) {
    console.error('Multicast join error:', e.message);
  }

  // Send probe after short delay
  setTimeout(() => {
    socket.send(probe, 0, probe.length, PORT, HOST, (err) => {
      if (err) {
        console.error('Send error:', err.message);
      } else {
        console.error('\nProbe sent successfully at', new Date().toISOString());
      }
    });
  }, 200);

  // Send second probe after delay (like discoverDevice does)
  setTimeout(() => {
    socket.send(probe, 0, probe.length, PORT, HOST, (err) => {
      if (!err) {
        console.error('Second probe sent at', new Date().toISOString());
      }
    });
  }, 700);
});

socket.on('message', (msg, rinfo) => {
  responseCount++;
  const hex = msg.toString('hex');
  
  console.error(`\n=== RESPONSE #${responseCount} from ${rinfo.address}:${rinfo.port} ===`);
  console.error(`Length: ${msg.length} bytes`);
  console.error(`Raw hex: ${hex}`);

  // Parse ECHONETLite header
  if (msg.length >= 12) {
    const ehd1 = msg.readUInt8(0);
    const ehd2 = msg.readUInt8(1);
    const tid = msg.readUInt16BE(2);
    // SEOJ starts at offset 4 (3 bytes: group, class, instance)
    const seoJgc = msg.readUInt8(4);
    const seoJcc = msg.readUInt8(5);
    const seoJci = msg.readUInt8(6);
    // DEOJ starts at offset 7 (3 bytes)
    const deoJgc = msg.readUInt8(7);
    const deoJcc = msg.readUInt8(8);
    const deoJci = msg.readUInt8(9);
    // ESV at offset 10, OPC at offset 11
    const esv = msg.readUInt8(10);
    const opc = msg.readUInt8(11);

    console.error(`\nHeader:`);
    console.error(`  EHD: 0x${ehd1.toString(16).padStart(2,'0')}${ehd2.toString(16).padStart(2,'0')} (TID=0x${tid.toString(16).padStart(4,'0')})`);
    console.error(`  SEOJ: 0x${seoJgc.toString(16).padStart(2,'0')}-0x${seoJcc.toString(16).padStart(2,'0')}-0x${seoJci.toString(16).padStart(2,'0')}`);
    console.error(`  DEOJ: 0x${deoJgc.toString(16).padStart(2,'0')}-0x${deoJcc.toString(16).padStart(2,'0')}-0x${deoJci.toString(16).padStart(2,'0')}`);
    console.error(`  ESV: 0x${esv.toString(16).padStart(2,'0')} OPC: ${opc}`);

    // Parse EPC data starting at offset 12
    let off = 12;
    for (let i = 0; i < opc && off < msg.length; i++) {
      const epc = msg.readUInt8(off++);
      const pdc = msg.readUInt8(off++);
      const edt = msg.subarray(off, off + pdc);
      const edtHex = Array.from(edt).map(b => b.toString(16).padStart(2, '0')).join(' ');

      console.error(`\n  EPC: 0x${epc.toString(16).padStart(2,'0')}`);
      console.error(`    PDC: ${pdc}`);
      console.error(`    EDT (hex): ${edtHex}`);

      // Decode INSTANCE_LIST if present
      if (epc === 0xd6 && pdc > 0) {
        const edtnum = edt[0];
        console.error(`    >>> INSTANCE_LIST: ${edtnum} EOJ entries`);
        for (let x = 0; x < edtnum; x++) {
          const baseOffset = 1 + (3 * x);
          if (baseOffset + 2 >= pdc) break;
          const gc = edt[baseOffset];
          const cc = edt[baseOffset + 1];
          const ci = edt[baseOffset + 2];
          console.error(`      Entry ${x}: 0x${gc.toString(16).padStart(2,'0')}-0x${cc.toString(16).padStart(2,'0')}-0x${ci.toString(16).padStart(2,'0')}`);
        }
      }

      // Decode manufacturer string if present
      if (epc === 0xfe && pdc > 0) {
        try {
          const decoder = new TextDecoder('shift_jis');
          const str = decoder.decode(edt);
          console.error(`    >>> Manufacturer: "${str}"`);
        } catch (e) {
          console.error(`    >>> Raw bytes: [${Array.from(edt).join(', ')}]`);
        }
      }

      off += pdc;
    }
  } else {
    console.error('Packet too short for ECHONETLite header');
  }
});

socket.on('error', (err) => {
  console.error('Socket error:', err.message);
});

// Timeout after 15 seconds
setTimeout(() => {
  console.error(`\n=== TIMEOUT: Received ${responseCount} response(s) ===`);
  socket.close();
  process.exit(0);
}, 15000);