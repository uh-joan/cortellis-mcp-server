#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

function checkFile(filepath, name) {
  if (!fs.existsSync(filepath)) {
    console.error(`❌ Missing ${name} file: ${filepath}`);
    process.exit(1);
  }
  console.log(`✅ ${name} file exists`);
}

function checkPackageJson() {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  
  // Check required fields
  const requiredFields = ['name', 'version', 'description', 'license', 'author'];
  for (const field of requiredFields) {
    if (!pkg[field]) {
      console.error(`❌ Missing required field in package.json: ${field}`);
      process.exit(1);
    }
  }
  
  // Check version format
  if (!/^\d+\.\d+\.\d+(-[a-zA-Z]+\.\d+)?$/.test(pkg.version)) {
    console.error('❌ Invalid version format in package.json. Must be x.y.z or x.y.z-tag.n (e.g., 1.0.0 or 1.0.0-beta.0)');
    process.exit(1);
  }
  
  console.log('✅ package.json is valid');
}

function checkDistFolder() {
  const distPath = path.join(rootDir, 'dist');
  if (!fs.existsSync(distPath)) {
    console.error('❌ dist folder does not exist. Run npm run build first.');
    process.exit(1);
  }
  
  const files = fs.readdirSync(distPath);
  if (files.length === 0) {
    console.error('❌ dist folder is empty');
    process.exit(1);
  }
  
  if (!files.includes('index.js')) {
    console.error('❌ Missing index.js in dist folder');
    process.exit(1);
  }
  
  console.log('✅ dist folder is valid');
}

function checkGitIgnore() {
  const content = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
  const required = ['node_modules', 'dist', '.env'];
  
  for (const item of required) {
    if (!content.includes(item)) {
      console.error(`❌ Missing ${item} in .gitignore`);
      process.exit(1);
    }
  }
  
  console.log('✅ .gitignore is valid');
}

function main() {
  console.log('🔍 Running pre-publish checks...\n');
  
  // Check required files
  checkFile(path.join(rootDir, 'README.md'), 'README');
  checkFile(path.join(rootDir, 'LICENSE'), 'LICENSE');
  checkFile(path.join(rootDir, '.gitignore'), 'gitignore');
  checkFile(path.join(rootDir, 'package.json'), 'package.json');
  
  // Check package.json
  checkPackageJson();
  
  // Check dist folder
  checkDistFolder();
  
  // Check .gitignore
  checkGitIgnore();
  
  console.log('\n✨ All checks passed! Ready to publish.');
}

main(); 