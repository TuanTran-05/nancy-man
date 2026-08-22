export async function up({ db }) {
  await db.collection('_maintenance').doc('schemaMigrationFramework').set(
    {
      initializedAt: new Date().toISOString(),
      versionCollection: '_schema_migrations',
    },
    { merge: true }
  );
}
