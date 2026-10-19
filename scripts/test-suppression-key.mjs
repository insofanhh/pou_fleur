import assert from 'node:assert/strict';
import { migrateSuppressionKey } from './suppression-key-schema.mjs';
const schema = 'CREATE TABLE `email_suppressions` (`email` varchar(190) NOT NULL, `store_id` int NOT NULL DEFAULT 1, PRIMARY KEY (`email`) /*T![clustered_index] CLUSTERED */)';
function fixture(clustered, counts = [0, 0], done = false) {
  const calls = [];
  return { calls, async query(sql) {
    calls.push(sql);
    if (sql.startsWith('SHOW INDEX')) return [done ? [{Column_name:'store_id'},{Column_name:'email'}] : [{Column_name:'email', Clustered:clustered}]];
    if (sql.startsWith('SELECT COUNT')) return [[{n:counts.shift()}]];
    if (sql.startsWith('SHOW CREATE')) return [[{'Create Table':schema}]];
    return [{}];
  }};
}
const mysql = fixture(undefined);
await migrateSuppressionKey(mysql);
assert(mysql.calls.some(s => s.startsWith('ALTER TABLE email_suppressions DROP PRIMARY')));
const tidb = fixture('YES');
await migrateSuppressionKey(tidb);
assert(!tidb.calls.some(s => s.startsWith('ALTER TABLE')));
assert(tidb.calls.some(s => s.startsWith('CREATE TABLE `email_suppressions_tenant_') && s.includes('PRIMARY KEY (`store_id`,`email`)')));
assert(tidb.calls.some(s => s.startsWith('RENAME TABLE email_suppressions TO `email_suppressions_legacy_')));
const populated = fixture('YES', [1]);
await assert.rejects(() => migrateSuppressionKey(populated), /existing opt-outs/);
assert(!populated.calls.some(s => /^(CREATE|ALTER|RENAME|DROP)/.test(s)));
const changed = fixture('YES', [0, 1]);
await assert.rejects(() => migrateSuppressionKey(changed), /existing opt-outs/);
assert(!changed.calls.some(s => s.startsWith('RENAME')));
const done = fixture('YES', [], true);
await migrateSuppressionKey(done);
assert.equal(done.calls.length, 1);
console.log('PASS MySQL key update, TiDB empty-table swap, opt-out preservation, concurrent-write guard and idempotent retry');
