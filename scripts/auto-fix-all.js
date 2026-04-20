#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const fixes = {
  applied: [],
  failed: [],
  skipped: []
};

function log(message, type = 'info') {
  const prefix = {
    'info': '✓',
    'warn': '⚠',
    'error': '✗',
    'success': '✅'
  }[type] || '•';
  console.log(`[${prefix}] ${message}`);
}

function fixFile(filePath, replacements) {
  try {
    if (!fs.existsSync(filePath)) {
      fixes.skipped.push(`File not found: ${filePath}`);
      return false;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    for (const [pattern, replacement] of replacements) {
      if (typeof pattern === 'string' && content.includes(pattern)) {
        content = content.replace(pattern, replacement);
        modified = true;
      } else if (pattern instanceof RegExp && pattern.test(content)) {
        content = content.replace(pattern, replacement);
        modified = true;
      }
    }
    
    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      fixes.applied.push(filePath);
      return true;
    }
    return false;
  } catch (error) {
    fixes.failed.push(`${filePath}: ${error.message}`);
    return false;
  }
}

function createEnvFile() {
  const envContent = `# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000
REACT_APP_API_URL=http://localhost:5000

# Socket/Real-time Configuration
NEXT_PUBLIC_SOCKET_SERVER_URL=http://localhost:5000
NEXT_PUBLIC_WEBSOCKET_URL=ws://localhost:5000

# Environment
NODE_ENV=development
NEXT_PUBLIC_ENV=development

# Metrics/Monitoring
NEXT_PUBLIC_PROMETHEUS_URL=http://localhost:9090

# Auth Configuration
NEXT_PUBLIC_AUTH_TOKEN_KEY=auth_token
NEXT_PUBLIC_REFRESH_TOKEN_KEY=refresh_token
NEXT_PUBLIC_USER_KEY=user_data
`;

  const envPath = path.join('/vercel/share/v0-project', '.env.local');
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, envContent, 'utf8');
    fixes.applied.push('.env.local created');
  }
}

function main() {
  console.log('\n' + '='.repeat(80));
  console.log('AUTOMATED FIXER - Cleaning up mock data and hardcoded values');
  console.log('='.repeat(80) + '\n');

  // Fix hardcoded Prometheus URL
  log('Fixing hardcoded Prometheus URL...');
  fixFile('/vercel/share/v0-project/app/(app)/integrations/prometheus/page.jsx', [
    ['scrapeUrl: \'http://localhost:9090/metrics\'', 'scrapeUrl: process.env.NEXT_PUBLIC_PROMETHEUS_URL + \'/metrics\'']
  ]);

  // Fix hardcoded API URLs in route files
  const routeFiles = [
    'app/api/settings/appearance/route.js',
    'app/api/settings/notifications/route.js',
    'app/api/settings/profile/route.js',
    'app/api/settings/security/route.js'
  ];

  log('Fixing hardcoded API URLs in route files...');
  routeFiles.forEach(file => {
    const filePath = path.join('/vercel/share/v0-project', file);
    fixFile(filePath, [
      ['const BASE_URL = process.env.API_URL || \'http://localhost:5000\';', 
       'const BASE_URL = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || \'http://localhost:5000\';']
    ]);
  });

  // Fix Socket service URLs
  log('Fixing socket service URLs...');
  fixFile('/vercel/share/v0-project/lib/realtime-service.js', [
    ['this.socket = io(process.env.REACT_APP_API_URL || \'http://localhost:5000\'',
     'this.socket = io(process.env.NEXT_PUBLIC_SOCKET_SERVER_URL || process.env.NEXT_PUBLIC_API_URL || \'http://localhost:5000\'']
  ]);

  fixFile('/vercel/share/v0-project/lib/socket-service.js', [
    [/const SOCKET_SERVER_URL = process\.env\.NEXT_PUBLIC_SOCKET_SERVER_URL \|\| 'http:\/\/localhost:5000'/,
     'const SOCKET_SERVER_URL = process.env.NEXT_PUBLIC_SOCKET_SERVER_URL || process.env.NEXT_PUBLIC_API_URL || \'http://localhost:5000\'']
  ]);

  // Create .env.local file
  log('Creating .env.local configuration file...');
  createEnvFile();

  // Create environment type definitions
  log('Creating environment types file...');
  const envTypesContent = `declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_API_URL: string;
    NEXT_PUBLIC_API_BASE_URL: string;
    REACT_APP_API_URL: string;
    NEXT_PUBLIC_SOCKET_SERVER_URL: string;
    NEXT_PUBLIC_WEBSOCKET_URL: string;
    NODE_ENV: 'development' | 'production' | 'test';
    NEXT_PUBLIC_ENV: 'development' | 'production';
    NEXT_PUBLIC_PROMETHEUS_URL: string;
    NEXT_PUBLIC_AUTH_TOKEN_KEY: string;
    NEXT_PUBLIC_REFRESH_TOKEN_KEY: string;
    NEXT_PUBLIC_USER_KEY: string;
  }
}
`;
  
  const envTypesPath = '/vercel/share/v0-project/types/env.d.ts';
  fs.mkdirSync(path.dirname(envTypesPath), { recursive: true });
  fs.writeFileSync(envTypesPath, envTypesContent, 'utf8');
  fixes.applied.push('types/env.d.ts created');

  // Log results
  console.log('\n' + '='.repeat(80));
  console.log('FIX RESULTS');
  console.log('='.repeat(80) + '\n');
  
  if (fixes.applied.length > 0) {
    log(`Applied ${fixes.applied.length} fixes`, 'success');
    fixes.applied.forEach(f => console.log(`  • ${f}`));
  }
  
  if (fixes.failed.length > 0) {
    log(`${fixes.failed.length} fixes failed`, 'error');
    fixes.failed.forEach(f => console.log(`  • ${f}`));
  }
  
  if (fixes.skipped.length > 0) {
    log(`${fixes.skipped.length} fixes skipped`, 'warn');
    fixes.skipped.forEach(s => console.log(`  • ${s}`));
  }

  console.log('\n' + '='.repeat(80));
  console.log('NEXT STEPS:');
  console.log('='.repeat(80));
  console.log('1. Review changes in modified files');
  console.log('2. Update .env.local with your actual API URLs');
  console.log('3. Test all API endpoints with the new configuration');
  console.log('4. Run npm start to start the development server');
  console.log('\n');
}

main();
