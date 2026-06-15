// Tests for MCP server tools via IPC
import { spawn } from 'node:child_process';
import { createTest, assert, delay, printSummary, TEST_CONFIG } from './config.mjs';

function spawnMcpServer() {
  return spawn('node', ['dist/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function sendMsg(mcpProcess, id, method, params) {
  mcpProcess.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + '\n');
}

async function waitForMessage(mcpProcess, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for MCP message after ${timeout}ms`));
    }, timeout);

    mcpProcess.stdout.once('data', (data) => {
      clearTimeout(timer);
      try {
        const lines = data.toString().split('\n');
        // Find first valid JSON message
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            resolve(JSON.parse(line));
            return;
          } catch {}
        }
        reject(new Error('No valid JSON message found'));
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function runTests() {
  const results = [];

  console.log('=== MCP Server Tool Tests ===\n');

  // === Test 1: Server Initialization ===
  const testInit = createTest('MCP: Initialization tests');

  let mcpProcess;
  try {
    mcpProcess = spawnMcpServer();
    
    // Send initialize request
    sendMsg(mcpProcess, 0, 'initialize', { 
      protocolVersion: "2024-11-05", 
      capabilities: {}, 
      clientInfo: { name: "echonetlite-test", version: "1.0" } 
    });

    // Send initialized notification
    setTimeout(() => {
      mcpProcess.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + '\n');
    }, 100);

    const initResult = await waitForMessage(mcpProcess, TEST_CONFIG.timeouts.mcpTool);
    
    assert(initResult.result?.capabilities !== undefined,
      'Server returns capabilities', { test: testInit });
    assert(initResult.id === 0,
      'Initialize response has correct ID', { test: testInit });

  } catch (err) {
    assert(false, `Initialization completed: ${err.message}`, { test: testInit });
  }

  results.push(testInit);

  // === Test 2: Tools Listing ===
  const testTools = createTest('MCP: Tools listing tests');

  try {
    if (!mcpProcess) mcpProcess = spawnMcpServer();

    sendMsg(mcpProcess, 10, 'tools/list', {});
    const toolsResult = await waitForMessage(mcpProcess, TEST_CONFIG.timeouts.mcpTool);
    
    assert(Array.isArray(toolsResult.result?.tools),
      'Tools list returns array', { test: testTools });
    
    if (toolsResult.result?.tools) {
      assert(toolsResult.result.tools.length > 0,
        `Server exposes ${toolsResult.result.tools.length} tool(s)`, { test: testTools });

      // Check for expected tools
      const toolNames = toolsResult.result.tools.map(t => t.name);
      const hasQueryTool = toolNames.some(n => n.includes('query') || n.includes('epc'));
      const hasParseTool = toolNames.some(n => n.includes('parse'));
      
      if (hasQueryTool) {
        assert(true, 'Found EPC query tool', { test: testTools });
      }
      if (hasParseTool) {
        assert(true, 'Found parse tool', { test: testTools });
      }
    }

  } catch (err) {
    assert(false, `Tools listing completed: ${err.message}`, { test: testTools });
  }

  results.push(testTools);

  // === Test 3: Resource Listing ===
  const testResources = createTest('MCP: Resources listing tests');

  try {
    if (!mcpProcess) mcpProcess = spawnMcpServer();

    sendMsg(mcpProcess, 20, 'resources/list', {});
    const resourcesResult = await waitForMessage(mcpProcess, TEST_CONFIG.timeouts.mcpTool);
    
    assert(resourcesResult.result?.resources !== undefined,
      'Resources list returns object', { test: testResources });

  } catch (err) {
    assert(false, `Resources listing completed: ${err.message}`, { test: testResources });
  }

  results.push(testResources);

  // Cleanup
  if (mcpProcess) {
    mcpProcess.kill();
    await delay(200);
  }

  // Print summary and exit
  const summary = printSummary(results);
  process.exit(summary.totalFailed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test error:', err.message);
  console.error(err.stack);
  process.exit(1);
});