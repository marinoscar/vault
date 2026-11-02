/**
 * Read-only data check for the platform baseline (E2.2, docs/runbooks/database-baseline.md
 * section 8). Run it against the REHEARSAL database after `prisma:migrate`, and
 * against production after the window. It changes nothing and prints COUNTS
 * ONLY: never a secret value, a key, an email or a file name.
 *
 *   cd apps/api
 *   POSTGRES_DB=vault_rehearsal VAULT_ENCRYPTION_KEY=<64 hex> \
 *     npx ts-node --transpile-only --project prisma/tsconfig.json scripts/verify-vault-data.ts [--sample 25]
 *
 * Checks (exit 1 on any failure):
 *   1. exactly one default organization;
 *   2. no storage object or chunk without an org_id; every one in the default org;
 *   3. every user has an active membership of the default org with an org role,
 *      and user_roles holds system roles only (0024);
 *   4. every secret has exactly one current version, and a sample of current
 *      versions DECRYPTS with VAULT_ENCRYPTION_KEY (skipped, and reported as
 *      skipped, when the key is not set);
 *   5. every secret attachment resolves to a ready storage object in the default org;
 *   6. every media link points at an existing folder and object (and the old
 *      storage_objects.media_folder_id column is gone).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { CryptoService } from '../src/common/services/crypto.service';
import { buildDatabaseUrl } from '../src/common/database-url';

const sampleArg = process.argv.indexOf('--sample');
const SAMPLE = sampleArg > -1 ? Number(process.argv[sampleArg + 1]) : 25;

const prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
const failures: string[] = [];
const report = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failures.push(name);
};

async function main() {
  // The reads touch RLS tables. The tooling role is a superuser today; once the
  // API role is ordinary (E2.3) run this as that role's owner with bypass set.
  const orgs = await prisma.organization.findMany({ where: { isDefault: true }, select: { id: true } });
  report('default organization', orgs.length === 1, `${orgs.length} row(s) with is_default`);
  const orgId = orgs[0]?.id;

  const counts = await prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(`
    SELECT
      (SELECT count(*) FROM storage_objects) AS objects,
      (SELECT count(*) FROM storage_objects WHERE org_id IS DISTINCT FROM '${orgId}'::uuid) AS objects_elsewhere,
      (SELECT count(*) FROM storage_object_chunks WHERE org_id IS DISTINCT FROM '${orgId}'::uuid) AS chunks_elsewhere,
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM users u WHERE NOT EXISTS (
         SELECT 1 FROM memberships m JOIN roles r ON r.id = m.role_id
         WHERE m.user_id = u.id AND m.org_id = '${orgId}'::uuid AND m.status = 'active' AND r.scope = 'org')) AS users_without_membership,
      (SELECT count(*) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.scope = 'org') AS org_role_rows_in_user_roles,
      (SELECT count(*) FROM secrets) AS secrets,
      (SELECT count(*) FROM secrets s WHERE (SELECT count(*) FROM secret_versions v WHERE v.secret_id = s.id AND v.is_current) <> 1) AS secrets_without_one_current,
      (SELECT count(*) FROM secret_attachments) AS attachments,
      (SELECT count(*) FROM secret_attachments a LEFT JOIN storage_objects o ON o.id = a.storage_object_id
         WHERE o.id IS NULL OR o.status <> 'ready' OR o.org_id <> '${orgId}'::uuid) AS attachments_unresolved,
      (SELECT count(*) FROM media_folder_files) AS media_links,
      (SELECT count(*) FROM media_folder_files l LEFT JOIN media_folders f ON f.id = l.media_folder_id
         LEFT JOIN storage_objects o ON o.id = l.object_id WHERE f.id IS NULL OR o.id IS NULL) AS media_links_dangling,
      (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'storage_objects' AND column_name = 'media_folder_id') AS old_media_column
  `);
  const c = Object.fromEntries(Object.entries(counts[0]).map(([k, v]) => [k, Number(v)]));
  console.log(`counts: users=${c.users} secrets=${c.secrets} objects=${c.objects} attachments=${c.attachments} media_links=${c.media_links}`);

  report('storage objects in the default org', c.objects_elsewhere === 0 && c.chunks_elsewhere === 0, `${c.objects_elsewhere} object(s), ${c.chunks_elsewhere} chunk(s) elsewhere`);
  report('every user has an org membership', c.users_without_membership === 0, `${c.users_without_membership} user(s) without one`);
  report('user_roles holds system roles only', c.org_role_rows_in_user_roles === 0, `${c.org_role_rows_in_user_roles} org-role row(s)`);
  report('one current version per secret', c.secrets_without_one_current === 0, `${c.secrets_without_one_current} secret(s) off`);
  report('attachments resolve', c.attachments_unresolved === 0, `${c.attachments_unresolved} of ${c.attachments} unresolved`);
  report('media links intact', c.media_links_dangling === 0 && c.old_media_column === 0, `${c.media_links_dangling} dangling, old column ${c.old_media_column === 0 ? 'gone' : 'STILL PRESENT'}`);

  if (!process.env.VAULT_ENCRYPTION_KEY) {
    console.log('skip decryption sample: VAULT_ENCRYPTION_KEY is not set');
  } else {
    const crypto = new CryptoService({ get: (k: string) => process.env[k] } as never);
    crypto.onModuleInit();
    const versions = await prisma.secretVersion.findMany({
      where: { isCurrent: true },
      orderBy: { createdAt: 'desc' },
      take: SAMPLE,
      select: { encryptedData: true, iv: true, authTag: true },
    });
    let bad = 0;
    for (const v of versions) {
      try {
        crypto.decrypt(v.encryptedData, v.iv, v.authTag);
      } catch {
        bad++;
      }
    }
    report('current versions decrypt', bad === 0, `${versions.length - bad} of ${versions.length} sampled decrypted`);
  }
}

main()
  .catch((e) => {
    console.error('verify-vault-data error:', e instanceof Error ? e.message : e);
    failures.push('error');
  })
  .finally(async () => {
    await prisma.$disconnect();
    if (failures.length > 0) {
      console.error(`verify-vault-data: ${failures.length} check(s) failed`);
      process.exit(1);
    }
    console.log('verify-vault-data: all checks passed');
  });
