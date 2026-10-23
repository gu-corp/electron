'use strict';

// Prepare the npm wrapper only after downloading all three production archives
// and their build-*.json records from the draft runtime release. Never executes
// Electron. The caller packs this directory with npm pack --ignore-scripts.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const runtime = Object.freeze({
  release: '43.8.3+lunascape.1',
  source: '1b5cb16d2ad1ee4ae231b69a3cd94f742c28f0f6',
  node: '24.22.1'
});
const targets = ['darwin-arm64', 'darwin-x64', 'win32-x64'];

function replaceOnce(text, original, replacement) {
  assert.equal(text.split(original).length, 2, 'Unexpected upstream npm wrapper');
  return text.replace(original, replacement);
}

function preparePackage(packageDir, evidenceDir) {
  const pkgPath = path.join(packageDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.equal(pkg.name, 'electron');
  assert.equal(pkg.version, '43.8.3');
  assert.equal(pkg.lunascapeRuntime, undefined, 'Use a fresh upstream npm package');
  const checksums = {};
  for (const target of targets) {
    const evidence = JSON.parse(fs.readFileSync(path.join(evidenceDir, `build-${target}.json`), 'utf8'));
    assert.equal(evidence.source, runtime.source, target);
    assert.equal(evidence.node, runtime.node, target);
    assert.equal(evidence.electron, pkg.version, target);
    assert.equal(evidence.configuration, 'release.gn', target);
    assert.equal(`${evidence.platform}-${evidence.arch}`, target);
    const name = `electron-v${runtime.release}-${target}.zip`;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(evidenceDir, name))).digest('hex');
    assert.equal(hash, evidence.sha256, target);
    checksums[name] = hash;
  }

  let install = fs.readFileSync(path.join(packageDir, 'install.js'), 'utf8');
  install = replaceOnce(install,
    "  checksums:\n    process.env.electron_use_remote_checksums || process.env.npm_config_electron_use_remote_checksums\n      ? undefined\n      : require('./checksums.json'),",
    `  checksums: require('./checksums.json'),
  mirrorOptions: {
    mirror: 'https://github.com/gu-corp/electron/releases/download/',
    customDir: 'v${runtime.release}',
    customVersion: '${runtime.release}'
  },`);
  install = replaceOnce(install, 'function isInstalled() {\n  try {',
    `function isInstalled() {
  try {
    if (fs.readFileSync(path.join(__dirname, 'dist', 'lunascape-runtime'), 'utf8') !== '${runtime.release}') return false;`);
  install = replaceOnce(install, '    // Write a "path.txt" file.',
    `    fs.writeFileSync(path.join(__dirname, 'dist', 'lunascape-runtime'), '${runtime.release}');
    // Write a "path.txt" file.`);

  let index = fs.readFileSync(path.join(packageDir, 'index.js'), 'utf8');
  index = replaceOnce(index, '  if (fs.existsSync(pathFile)) {',
    `  const marker = path.join(__dirname, 'dist', 'lunascape-runtime');
  const patched = fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === '${runtime.release}';
  if (patched && fs.existsSync(pathFile)) {`);

  pkg.description = 'Electron 43.8.3 with upstream Node.js 24.22.1 security fixes for Lunascape';
  pkg.lunascapeRuntime = runtime;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(path.join(packageDir, 'checksums.json'), JSON.stringify(checksums, null, 2) + '\n');
  fs.writeFileSync(path.join(packageDir, 'install.js'), install);
  fs.writeFileSync(path.join(packageDir, 'index.js'), index);
  fs.appendFileSync(path.join(packageDir, 'README.md'), `
## Lunascape security distribution

This package uses production builds of electron/electron@${runtime.source}
(upstream #55161), including Node.js ${runtime.node}. Only macOS arm64/x64 and
Windows x64 are distributed. The npm package keeps version 43.8.3 and ABI 148
for compatibility with the corresponding native-module headers. The source,
build configuration and SHA-256 evidence accompany the runtime release:
https://github.com/gu-corp/electron/releases/tag/v${runtime.release}

The embedded checksums and mirror are mandatory. A standalone Node.js update
does not update Electron's embedded Node.js runtime.
`);
  return checksums;
}

module.exports = { preparePackage, runtime, targets };
if (require.main === module) {
  assert.equal(process.argv.length, 4, 'Usage: node lunascape-npm-package.cjs <unpacked-npm-package> <runtime-assets>');
  console.log(JSON.stringify(preparePackage(process.argv[2], process.argv[3]), null, 2));
}
