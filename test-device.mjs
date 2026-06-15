// Test query_epc + parse_epc_elements against real device 192.168.1.234
import { spawn } from 'child_process';

const mcpProcess = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
let step = 0;
let availableTools = [];

mcpProcess.stderr.on('data', (d) => process.stderr.write(d));

function send(id, method, params) {
  mcpProcess.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + '\n');
}

// Initialize with proper schema
send(0, 'initialize', { 
  protocolVersion: "2024-11-05", 
  capabilities: {}, 
  clientInfo: { name: "test", version: "1.0" } 
});
setTimeout(() => mcpProcess.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + '\n'), 100);

mcpProcess.stdout.on('data', (data) => {
  output += data.toString();
  const lines = data.toString().split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      
      // Step 0: After initialize, list tools
      if (msg.id === 0 && step === 0) {
        step = 1;
        console.log('=== List available tools ===');
        setTimeout(() => send(1, 'tools/list', {}), 50);
        return;
      }
      
      // Step 1: After tools list, show available tools and query device
      if (msg.id === 1 && step === 1) {
        availableTools = msg.result?.tools || [];
        
        const queryTool = availableTools.find(t => t.name === 'query_epc') || availableTools.find(t => t.name.startsWith('query_'));
        if (!queryTool) {
          console.log('No EPC query tool found!');
          process.exit(1);
          return;
        }
        
        setTimeout(() => send(2, 'tools/call', {
          name: queryTool.name,
          arguments: { epcs: ["0xE2"], host: "192.168.1.234", eojgc: "0x02", eojcc: "0x88" }
        }), 50);
        return;
      }
      
      // Step 2: After query, parse the result
      if (msg.id === 2 && step === 2) {
        const content = msg.result?.content?.[0]?.text;
        if (!content) { 
          console.log('No content in response');
          process.exit(1); 
          return; 
        }
        
        const qr = JSON.parse(content);
        const rawHex = qr.results?.[0]?.value?.rawHex;
        if (!rawHex) {
          console.log('No rawHex in result');
          process.exit(1);
          return;
        }
        
        // Now parse the elements
        const parseTool = availableTools.find(t => t.name.includes('parse'));
        
        if (!parseTool) {
          console.log('No parse tool found!');
          process.exit(1);
          return;
        }
        
        step = 3;
        setTimeout(() => send(3, 'tools/call', {
          name: parseTool.name,
          arguments: {
            epc: "0xE2",
            host: "192.168.1.234",
            eojgc: "0x02",
            eojcc: "0x88",
            rawHex,
            propertyName: qr.results?.[0]?.propertyName || "",
            shortName: qr.results?.[0]?.shortName || ""
          }
        }), 50);
        return;
      }
      
      // Step 3: After parse, show result
      if (msg.id === 3 && step === 3) {
        const content = msg.result?.content?.[0]?.text;
        if (!content) { console.log('No parse content'); process.exit(1); return; }
        
        const pr = JSON.parse(content);
        console.log(`\ntotalBytes: ${pr.totalBytes}`);
        console.log(`day values: ${JSON.stringify(pr.elements?.[0]?.values)}`);
        console.log(`energy itemCount from definition: ${pr.elements?.[1]?.definition?.itemCount}`);
        console.log(`energy array length: ${pr.elements?.[1]?.values?.length}`);
        
        // Check correctness
        const dayBytes = pr.elements?.[0]?.values?.length || 0;
        const energyItems = pr.elements?.[1]?.values?.length || 0;
        const expectedEnergyItems = (pr.totalBytes - dayBytes) / 4;
        
        console.log(`\nExpected energy items: ${expectedEnergyItems}`);
        console.log(`Actual energy items: ${energyItems}`);
        
        if (dayBytes === 2 && energyItems === expectedEnergyItems && Number.isInteger(expectedEnergyItems)) {
          console.log('\n✓ SUCCESS: day=2 bytes, energy array correctly aligned');
        } else {
          console.log(`\n✗ ISSUE: day=${dayBytes} bytes (expected 2), energy=${energyItems} items (expected ${expectedEnergyItems})`);
        }
        
        process.exit(0);
      }
    } catch(e) {}
  }
});

setTimeout(() => { console.log('Timeout'); mcpProcess.kill(); process.exit(1); }, 20000);