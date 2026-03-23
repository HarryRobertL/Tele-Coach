#!/usr/bin/env node

/**
 * Verification script for Whisper assets
 * 
 * This script validates that Whisper assets are properly installed and not placeholders.
 * It checks:
 * - Binary exists and is executable
 * - Model exists and has correct size
 * - No placeholder content remains
 * - Checksums match expected values
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getWhisperPolicy } = require('./whisper_delivery_policy');

const projectRoot = path.resolve(__dirname, '..');
const WHISPER_DIR = path.join(projectRoot, 'engine', 'stt', 'whisper');
const BIN_DIR = path.join(WHISPER_DIR, 'bin');
const MODELS_DIR = path.join(WHISPER_DIR, 'models');

const MIN_BINARY_SIZE = 500 * 1024; // 500KB minimum; matches practical whisper-cli builds
const MODEL_CONFIG = {
  'tiny.en': {
    files: ['ggml-tiny.en.bin'],
    minSize: 70 * 1024 * 1024,
    checksum: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f'
  },
  'base.en': {
    files: ['ggml-base.en.bin', 'ggml_base_en.bin'],
    minSize: 130 * 1024 * 1024
  },
  'small.en': {
    files: ['ggml-small.en.bin', 'ggml_small_en.bin'],
    minSize: 430 * 1024 * 1024
  }
};

function inferSelectedModel() {
  const dbPath = path.join(projectRoot, 'data', 'app.sqlite');
  if (!fs.existsSync(dbPath)) return 'tiny.en';
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'stt_model'").get();
    db.close();
    if (!row || typeof row.value !== 'string') return 'tiny.en';
    const parsed = JSON.parse(row.value);
    return parsed === 'base.en' || parsed === 'small.en' ? parsed : 'tiny.en';
  } catch {
    return 'tiny.en';
  }
}

function resolveBinaryPath() {
  const policy = getWhisperPolicy();
  const names = [policy.platformConfig.runtime_binary_name];
  for (const name of names) {
    const full = path.join(BIN_DIR, name);
    if (fs.existsSync(full)) return full;
  }
  return path.join(BIN_DIR, names[0]);
}

function resolveModelPath(modelKey) {
  const meta = MODEL_CONFIG[modelKey] || MODEL_CONFIG['tiny.en'];
  for (const name of meta.files) {
    const full = path.join(MODELS_DIR, name);
    if (fs.existsSync(full)) return full;
  }
  return path.join(MODELS_DIR, meta.files[0]);
}

function calculateSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function checkExecutable(filePath) {
  try {
    if (process.platform === 'win32') {
      return true; // Windows doesn't have executable bits in the same way
    }
    
    const stats = fs.statSync(filePath);
    // Check if executable bit is set for user
    return (stats.mode & 0o100) !== 0;
  } catch {
    return false;
  }
}

function verifyBinaryFormat(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (process.platform === 'darwin') {
      const magic = buf.readUInt32BE(0);
      const machoMagics = new Set([0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcffaedfe]);
      return machoMagics.has(magic);
    }
    if (process.platform === 'win32') {
      return buf[0] === 0x4d && buf[1] === 0x5a; // MZ
    }
    return true;
  } catch {
    return false;
  }
}

function isPlaceholderFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const placeholderIndicators = [
      'placeholder',
      'Please run:',
      'npm run setup-whisper',
      'Whisper binary is not installed',
      'Whisper model placeholder'
    ];
    
    return placeholderIndicators.some(indicator => 
      content.toLowerCase().includes(indicator.toLowerCase())
    );
  } catch {
    // If we can't read as UTF-8, it's likely a binary file (good!)
    return false;
  }
}

async function verifyBinary(binaryPath) {
  console.log('🔍 Verifying Whisper binary...');

  if (!fs.existsSync(binaryPath)) {
    console.error('❌ Binary not found:', binaryPath);
    return false;
  }
  
  const stats = fs.statSync(binaryPath);
  
  if (stats.size < MIN_BINARY_SIZE) {
    console.error(`❌ Binary too small: ${stats.size} bytes (minimum: ${MIN_BINARY_SIZE} bytes)`);
    return false;
  }
  
  if (isPlaceholderFile(binaryPath)) {
    console.error('❌ Binary appears to be a placeholder file');
    return false;
  }
  
  if (!checkExecutable(binaryPath)) {
    console.error('❌ Binary is not executable');
    return false;
  }

  if (!verifyBinaryFormat(binaryPath)) {
    console.error('❌ Binary format does not match expected platform executable format');
    return false;
  }
  
  console.log(`✅ Binary verified: ${binaryPath} (${stats.size} bytes)`);
  return true;
}

async function verifyModel(modelPath, modelKey) {
  console.log('🔍 Verifying Whisper model...');
  const meta = MODEL_CONFIG[modelKey] || MODEL_CONFIG['tiny.en'];
  
  if (!fs.existsSync(modelPath)) {
    console.error('❌ Model not found:', modelPath);
    return false;
  }
  
  const stats = fs.statSync(modelPath);
  
  if (stats.size < meta.minSize) {
    console.error(`❌ Model too small: ${stats.size} bytes (minimum: ${meta.minSize} bytes)`);
    return false;
  }
  
  // Don't check placeholder status for binary model files
  // Binary files should be validated by size and checksum only
  
  if (meta.checksum) {
    console.log('🔐 Calculating model checksum...');
    const actualSha256 = await calculateSha256(modelPath);
    if (actualSha256 !== meta.checksum) {
      console.error(`❌ Model checksum mismatch:`);
      console.error(`   Expected: ${meta.checksum}`);
      console.error(`   Actual:   ${actualSha256}`);
      return false;
    }
    console.log(`✅ Model checksum verified: ${actualSha256.substring(0, 8)}...`);
  } else {
    console.log('ℹ️ Model checksum not pinned for this model; size validation only.');
  }
  
  console.log(`✅ Model verified: ${modelPath} (${stats.size} bytes)`);
  return true;
}

function checkForPlaceholderFiles() {
  console.log('🔍 Checking for placeholder files...');
  
  const placeholderFiles = [];
  
  // Check binary
  const binaryPath = resolveBinaryPath();
  if (fs.existsSync(binaryPath) && isPlaceholderFile(binaryPath)) {
    placeholderFiles.push(binaryPath);
  }
  
  // Check model - don't check placeholder for binary model files
  // Model validation is handled by size and checksum checks
  
  if (placeholderFiles.length > 0) {
    console.error('❌ Found placeholder files:');
    placeholderFiles.forEach(file => console.error(`   ${file}`));
    return false;
  }
  
  console.log('✅ No placeholder files found');
  return true;
}

async function main() {
  console.log('🚀 Whisper Asset Verification Script');
  console.log('=====================================\n');
  const policy = getWhisperPolicy();
  const selectedModel = inferSelectedModel();
  const binaryPath = resolveBinaryPath();
  const modelPath = resolveModelPath(selectedModel);
  console.log(`Delivery mode: ${policy.mode}`);
  console.log(`Platform key: ${policy.platformKey}`);
  console.log(`Pinned binary release: ${policy.config.binary.release_tag}`);
  console.log(`Selected model: ${selectedModel}`);
  console.log(`Binary candidate: ${binaryPath}`);
  console.log(`Model candidate: ${modelPath}`);
  
  let allPassed = true;
  
  // Check directories exist
  if (!fs.existsSync(BIN_DIR)) {
    console.error('❌ Binary directory not found:', BIN_DIR);
    allPassed = false;
  }
  
  if (!fs.existsSync(MODELS_DIR)) {
    console.error('❌ Models directory not found:', MODELS_DIR);
    allPassed = false;
  }
  
  if (!allPassed) {
    console.log('\n💡 Run "npm run setup-whisper" to download the required assets.');
    process.exit(1);
  }
  
  // Run verifications
  const binaryOk = await verifyBinary(binaryPath);
  const modelOk = await verifyModel(modelPath, selectedModel);
  const noPlaceholders = checkForPlaceholderFiles();
  
  console.log('\n📋 Summary:');
  console.log(`   Binary: ${binaryOk ? '✅' : '❌'}`);
  console.log(`   Model:  ${modelOk ? '✅' : '❌'}`);
  console.log(`   No placeholders: ${noPlaceholders ? '✅' : '❌'}`);
  
  if (binaryOk && modelOk && noPlaceholders) {
    console.log('\n🎉 All Whisper assets are properly installed!');
    process.exit(0);
  } else {
    console.log('\n❌ Whisper asset verification failed.');
    console.log('\n💡 To fix:');
    console.log('   1. Run "npm run setup-whisper" to download missing assets');
    console.log('   2. Or manually download from:');
    console.log('      - Binary: https://github.com/ggml-org/whisper.cpp/releases');
    console.log('      - Model: https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Verification script failed:', error.message);
  process.exit(1);
});
