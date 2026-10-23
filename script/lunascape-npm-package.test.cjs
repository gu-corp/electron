'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { preparePackage, runtime, targets } = require('./lunascape-npm-package.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lunascape-runtime-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageDir = path.join(root, 'package');
  const evidenceDir = path.join(root, 'assets');
  fs.mkdirSync(packageDir);
  fs.mkdirSync(evidenceDir);
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'electron', version: '43.8.3' }));
  for (const file of ['install.js', 'index.js']) {
    fs.copyFileSync(path.join(__dirname, '..', 'npm', file), path.join(packageDir, file));
  }
  for (const target of targets) {
    const archive = Buffer.from(`test fixture for ${target}`);
    fs.writeFileSync(path.join(evidenceDir, `electron-v${runtime.release}-${target}.zip`), archive);
    const [platform, arch] = target.split('-');
    fs.writeFileSync(path.join(evidenceDir, `build-${target}.json`), JSON.stringify({
      source: runtime.source, node: runtime.node, electron: '43.8.3',
      configuration: 'release.gn', platform, arch,
      sha256: crypto.createHash('sha256').update(archive).digest('hex')
    }));
  }
  return { packageDir, evidenceDir };
}

test('requires all three production distributions with the pinned source and digest', t => {
  const { packageDir, evidenceDir } = fixture(t);
  const checksums = preparePackage(packageDir, evidenceDir);
  assert.equal(Object.keys(checksums).length, 3);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'))).lunascapeRuntime, runtime);
});

test('refuses a mismatched archive before modifying the npm package', t => {
  const { packageDir, evidenceDir } = fixture(t);
  fs.appendFileSync(path.join(evidenceDir, `electron-v${runtime.release}-win32-x64.zip`), 'changed');
  assert.throws(() => preparePackage(packageDir, evidenceDir));
  assert.equal(JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'))).lunascapeRuntime, undefined);
});

test('refuses testing builds and missing targets', t => {
  const { packageDir, evidenceDir } = fixture(t);
  const file = path.join(evidenceDir, 'build-darwin-arm64.json');
  const evidence = JSON.parse(fs.readFileSync(file));
  fs.writeFileSync(file, JSON.stringify({ ...evidence, configuration: 'testing.gn' }));
  assert.throws(() => preparePackage(packageDir, evidenceDir));
  fs.unlinkSync(file);
  assert.throws(() => preparePackage(packageDir, evidenceDir));
});

test('installer pins the custom mirror and checksums even with a remote-checksum override', t => {
  const { packageDir, evidenceDir } = fixture(t);
  const checksums = preparePackage(packageDir, evidenceDir);
  // A stale, unpatched distribution has the same Electron version. It must be
  // replaced, not accepted by the upstream version-only installation check.
  fs.mkdirSync(path.join(packageDir, 'dist'));
  fs.writeFileSync(path.join(packageDir, 'dist', 'version'), '43.8.3');
  fs.writeFileSync(path.join(packageDir, 'dist', 'electron.exe'), 'fixture');
  fs.writeFileSync(path.join(packageDir, 'path.txt'), 'electron.exe');
  let options;
  vm.runInNewContext(fs.readFileSync(path.join(packageDir, 'install.js'), 'utf8'), {
    __dirname: packageDir,
    console,
    process: { platform: 'win32', arch: 'x64', env: { electron_use_remote_checksums: '1' }, exit: () => assert.fail('Accepted an unpatched installation') },
    require: name => {
      if (name === '@electron/get') return { downloadArtifact: value => {
        options = value;
        return { then: () => ({ catch: () => {} }) };
      } };
      if (name === './package') return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json')));
      if (name === './checksums.json') return checksums;
      if (name === 'os') return { platform: () => 'win32' };
      return require(name);
    }
  });
  assert.equal(options.checksums, checksums);
  assert.equal(options.mirrorOptions.customVersion, runtime.release);
  assert.equal(options.mirrorOptions.customDir, `v${runtime.release}`);
  assert.equal(options.mirrorOptions.mirror, 'https://github.com/gu-corp/electron/releases/download/');
});

test('the npm entrypoint replaces an existing binary without the security marker', t => {
  const { packageDir, evidenceDir } = fixture(t);
  preparePackage(packageDir, evidenceDir);
  fs.mkdirSync(path.join(packageDir, 'dist'));
  fs.writeFileSync(path.join(packageDir, 'dist', 'electron.exe'), 'fixture');
  fs.writeFileSync(path.join(packageDir, 'path.txt'), 'electron.exe');
  let downloads = 0;
  const entryModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(packageDir, 'index.js'), 'utf8'), {
    __dirname: packageDir, console, module: entryModule,
    process: { execPath: 'node', env: {} },
    require: name => name === 'child_process' ? { spawnSync: () => { downloads++; return { status: 0 }; } } : require(name)
  });
  assert.equal(downloads, 1);
  assert.equal(entryModule.exports, path.join(packageDir, 'dist', 'electron.exe'));
});
