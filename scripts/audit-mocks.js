#!/usr/bin/env node

/**
 * Complete Frontend Audit Script
 * Identifies all mock data, fake APIs, and hardcoded values
 */

const fs = require('fs');
const path = require('path');

const issues = {
  mockData: [],
  fakeAPIs: [],
  hardcodedValues: [],
  storageUsage: [],
  duplicateMethods: [],
};

// Patterns to search for
const patterns = {
  mockData: [
    /const\s+\w+\s*=\s*\[\s*\{/, // Array initialization with objects
    /TODO|FIXME|HACK|XXX/, // Code comments indicating work
    /dummy|mock|fake|test[\s_-]*data/i,
    /placeholder|stub/i,
  ],
  localStorage: [
    /localStorage\.setItem/,
    /localStorage\.getItem/,
    /localStorage\.removeItem/,
  ],
  hardcoded: [
    /["']http:\/\/localhost:\d+/,
    /["']ws:\/\/localhost:\d+/,
    /projectId\s*=\s*["'][^"']+["']/,
    /userId\s*=\s*["'][^"']+["']/,
  ],
};

function walkDir(dir, callback) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filepath = path.join(dir, file);
    const stat = fs.statSync(filepath);
    
    if (file.startsWith('.') || file === 'node_modules') return;
    
    if (stat.isDirectory()) {
      walkDir(filepath, callback);
    } else if (file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.ts') || file.endsWith('.tsx')) {
      callback(filepath);
    }
  });
}

function analyzeFile(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    const lines = content.split('\n');
    const relativePath = path.relative('/vercel/share/v0-project', filepath);
    
    lines.forEach((line, index) => {
      // Check for mock data patterns
      patterns.mockData.forEach(pattern => {
        if (pattern.test(line)) {
          issues.mockData.push({
            file: relativePath,
            line: index + 1,
            content: line.trim().substring(0, 80),
          });
        }
      });
      
      // Check for localStorage usage
      patterns.localStorage.forEach(pattern => {
        if (pattern.test(line)) {
          issues.storageUsage.push({
            file: relativePath,
            line: index + 1,
            content: line.trim().substring(0, 80),
          });
        }
      });
      
      // Check for hardcoded values
      patterns.hardcoded.forEach(pattern => {
        if (pattern.test(line)) {
          issues.hardcodedValues.push({
            file: relativePath,
            line: index + 1,
            content: line.trim().substring(0, 80),
          });
        }
      });
    });
  } catch (err) {
    console.error(`Error analyzing ${filepath}:`, err.message);
  }
}

// Check for duplicate methods in API client
function checkAPIClientDuplicates() {
  const apiClientPath = '/vercel/share/v0-project/lib/api-client.js';
  try {
    const content = fs.readFileSync(apiClientPath, 'utf8');
    const methods = content.match(/async\s+(\w+)\s*\(/g) || [];
    const methodNames = methods.map(m => m.match(/(\w+)\s*\(/)[1]);
    const duplicates = new Set();
    
    methodNames.forEach((name, idx) => {
      if (methodNames.indexOf(name) !== idx && !duplicates.has(name)) {
        duplicates.add(name);
        issues.duplicateMethods.push({
          method: name,
          file: 'lib/api-client.js',
        });
      }
    });
  } catch (err) {
    console.error('Error checking API client:', err.message);
  }
}

console.log('Starting frontend audit...\n');

walkDir('/vercel/share/v0-project/app', analyzeFile);
walkDir('/vercel/share/v0-project/components', analyzeFile);
walkDir('/vercel/share/v0-project/hooks', analyzeFile);
walkDir('/vercel/share/v0-project/lib', analyzeFile);
walkDir('/vercel/share/v0-project/store', analyzeFile);
checkAPIClientDuplicates();

console.log('='.repeat(80));
console.log('FRONTEND AUDIT RESULTS');
console.log('='.repeat(80));

console.log(`\n📊 SUMMARY:`);
console.log(`  Mock Data Patterns: ${issues.mockData.length}`);
console.log(`  Storage Usage: ${issues.storageUsage.length}`);
console.log(`  Hardcoded Values: ${issues.hardcodedValues.length}`);
console.log(`  Duplicate Methods: ${issues.duplicateMethods.length}`);

if (issues.duplicateMethods.length > 0) {
  console.log(`\n⚠️  DUPLICATE METHODS IN API CLIENT:`);
  issues.duplicateMethods.forEach(dup => {
    console.log(`   - ${dup.method}()`);
  });
}

if (issues.hardcodedValues.length > 0) {
  console.log(`\n⚠️  HARDCODED VALUES:`);
  issues.hardcodedValues.slice(0, 10).forEach(item => {
    console.log(`   ${item.file}:${item.line} - ${item.content}`);
  });
  if (issues.hardcodedValues.length > 10) {
    console.log(`   ... and ${issues.hardcodedValues.length - 10} more`);
  }
}

console.log(`\n💾 LOCAL STORAGE USAGE: ${issues.storageUsage.length} references`);
console.log('   Action: Use secure HTTP-only cookies via backend instead');

console.log('\n' + '='.repeat(80));
console.log('✅ AUDIT COMPLETE');
console.log('='.repeat(80));
