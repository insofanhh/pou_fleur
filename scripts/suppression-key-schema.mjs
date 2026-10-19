// TiDB clustered primary keys cannot be dropped with ALTER TABLE.
export async function migrateSuppressionKey(c) {
  const [primary] = await c.query("SHOW INDEX FROM email_suppressions WHERE Key_name='PRIMARY'");
  if (primary.length !== 1) return;
  if (String(primary[0].Clustered).toUpperCase() !== 'YES') {
    await c.query("ALTER TABLE email_suppressions DROP PRIMARY KEY, ADD PRIMARY KEY(store_id,email)");
    return;
  }
  const assertEmpty = async () => {
    const [[row]] = await c.query("SELECT COUNT(*) n FROM email_suppressions");
    if (Number(row.n) !== 0)
      throw Error('TiDB email_suppressions has existing opt-outs. An offline copy with verified data preservation is required before changing its clustered key.');
  };
  await assertEmpty();
  const [[schema]] = await c.query("SHOW CREATE TABLE email_suppressions");
  const stamp = Date.now(), next = 'email_suppressions_tenant_' + stamp,
    backup = 'email_suppressions_legacy_' + stamp;
  const ddl = schema['Create Table'];
  if (!/PRIMARY KEY\s*\(`email`\)/i.test(ddl))
    throw Error('Unexpected email_suppressions primary key');
  await c.query(ddl.replace('CREATE TABLE `email_suppressions`', 'CREATE TABLE `' + next + '`')
    .replace(/PRIMARY KEY\s*\(`email`\)/i, 'PRIMARY KEY (`store_id`,`email`)'));
  // Never delete the original table. Keep it for recovery after the atomic swap.
  await assertEmpty();
  await c.query(`RENAME TABLE email_suppressions TO \`${backup}\`, \`${next}\` TO email_suppressions`);
}
