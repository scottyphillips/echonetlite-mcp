/**
 * Bundles all MRA data files into a single JSON file for embedding in the MCP server.
 * This eliminates runtime file reads that break when process.cwd() != project root.
 * 
 * Run: node bundler.mjs [--watch]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MRA_SRC_DIR = path.join(__dirname, 'mra', 'mraData');
const BUNDLED_FILE = path.join(__dirname, 'src', 'mra-bundled.json');

/** Recursively walk a directory and bundle all JSON files into a flat object */
function bundleDirectory(dirPath, baseDir) {
  const result = {};
  
  function walk(dir, prefix) {
    if (!fs.existsSync(dir)) return;
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      
      if (entry.isDirectory()) {
        walk(fullPath, path.join(prefix, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
          // Normalize to forward slashes for cross-platform consistency
          result[relativePath.replace(/\\/g, '/')] = content;
        } catch (e) {
          console.error(`Warning: Failed to parse ${fullPath}: ${e.message}`);
        }
      }
    }
  }
  
  walk(dirPath, '');
  return result;
}

/** Bundle all MRA data */
function bundleMraData() {
  console.log('Bundling MRA data from:', MRA_SRC_DIR);
  console.log('Output file:', BUNDLED_FILE);
  
  if (!fs.existsSync(MRA_SRC_DIR)) {
    console.error(`Error: MRA source directory not found: ${MRA_SRC_DIR}`);
    process.exit(1);
  }
  
  const bundled = {};
  
  // Walk all subdirectories and bundle their JSON files
  const subdirs = fs.readdirSync(MRA_SRC_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
  
  for (const subdir of subdirs) {
    const subdirPath = path.join(MRA_SRC_DIR, subdir);
    const files = bundleDirectory(subdirPath, MRA_SRC_DIR);
    
    for (const [filePath, content] of Object.entries(files)) {
      // filePath already contains subdir prefix from relative path, so just prepend mraData/
      bundled[`mraData/${filePath}`] = content;
    }
  }
  
  // Also bundle metaData.json at the root level
  const metaFile = path.join(MRA_SRC_DIR, 'metaData.json');
  if (fs.existsSync(metaFile)) {
    try {
      bundled['mraData/metaData.json'] = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    } catch {}
  }
  
  const output = JSON.stringify({ version: '1.0', files: bundled }, null, 2);
  fs.writeFileSync(BUNDLED_FILE, output);
  
  // Also copy to dist/ for compiled TypeScript output
  const distFile = path.join(__dirname, 'dist', 'mra-bundled.json');
  const distDir = path.dirname(distFile);
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }
  fs.writeFileSync(distFile, output);
  
  // Bundle manufacturers.json into the same output file
  const manufacturersPath = path.join(__dirname, 'src', 'manufactorers.json');
  if (fs.existsSync(manufacturersPath)) {
    try {
      const manufacturersContent = JSON.parse(fs.readFileSync(manufacturersPath, 'utf-8'));
      bundled['manufactorers.json'] = manufacturersContent;
      
      // Rewrite output with embedded manufacturers data
      const newOutput = JSON.stringify({ version: '1.0', files: bundled }, null, 2);
      fs.writeFileSync(BUNDLED_FILE, newOutput);
      fs.writeFileSync(distFile, newOutput);
      
      console.log(`Bundled ${Object.keys(bundled).length} files -> ${Math.round(newOutput.length / 1024)}KB`);
    } catch (e) {
      console.error(`Warning: Failed to bundle manufacturers.json: ${e.message}`);
      const fileCount = Object.keys(bundled).length;
      console.log(`Bundled ${fileCount} files -> ${Math.round(output.length / 1024)}KB`);
    }
  } else {
    const fileCount = Object.keys(bundled).length;
    console.log(`Bundled ${fileCount} files -> ${Math.round(output.length / 1024)}KB`);
  }
  
  return bundled;
}

/** Watch mode for development */
function watchMode() {
  console.log('Starting bundler in watch mode...');
  
  let timeout = null;
  
  const onChange = () => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      console.log('MRA data changed, rebuilding...');
      bundleMraData();
    }, 200);
  };
  
  fs.watch(MRA_SRC_DIR, { recursive: true }, (eventType, filename) => {
    if (filename && filename.endsWith('.json')) {
      console.log(`Change detected: ${filename}`);
      onChange();
    }
  });
  
  console.log('Watching for changes in:', MRA_SRC_DIR);
}

// Main
const watch = process.argv.includes('--watch');
bundleMraData();

if (watch) {
  watchMode();
} else {
  console.log('Done.');
}