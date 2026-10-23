'use strict';

// Run on CI/VMs, never on hide's work Mac. No network requests are made.
const assert = require('node:assert/strict');
const tls = require('node:tls');

console.log(JSON.stringify(process.versions, null, 2));
assert.equal(process.versions.electron, '43.8.3');
assert.equal(process.versions.node, '24.22.1');
assert.equal(process.versions.modules, '148');

for (const [host, subjectaltname] of [
  ['\uff11\uff12\uff17.0.0.1', 'DNS:127.0.0.1'],
  ['127.1', 'DNS:127.0.0.1'],
  ['0127.0.0.1', 'IP Address:87.0.0.1']
]) {
  assert.equal(tls.checkServerIdentity(host, { subject: {}, subjectaltname })?.code,
    'ERR_TLS_CERT_ALTNAME_INVALID', host);
}
assert.equal(tls.checkServerIdentity('example.com', {
  subject: {}, subjectaltname: 'DNS:example.com'
}), undefined);
assert.equal(tls.checkServerIdentity('127.0.0.1', {
  subject: {}, subjectaltname: 'IP Address:127.0.0.1'
}), undefined);
console.log('Embedded Node security checks passed.');
