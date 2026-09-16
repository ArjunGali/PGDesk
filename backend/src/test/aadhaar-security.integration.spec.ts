import type { TestingModule } from '@nestjs/testing';
import { PrismaService } from '../common/prisma/prisma.service';
import { FieldEncryptionService } from '../common/crypto/field-encryption';
import { SETTING_DEFINITIONS } from '../modules/settings/setting-keys';
import { SettingsService } from '../modules/settings/settings.service';
import { TenantsService } from '../modules/tenants/tenants.service';
import {
  createTestModule,
  resetData,
  setUpTestDatabase,
  tearDownTestDatabase,
} from './integration-harness';

/**
 * Aadhaar must be unreadable in the database, masked by default in the API,
 * readable only to an authorised caller, searchable without being exposed, and
 * fully removable.
 */
describe('Aadhaar security (integration)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let tenants: TenantsService;
  let encryption: FieldEncryptionService;

  const AADHAAR = '567856785678';

  beforeAll(async () => {
    await setUpTestDatabase();
    module = await createTestModule();
    await module.init();
    prisma = module.get(PrismaService);
    tenants = module.get(TenantsService);
    encryption = module.get(FieldEncryptionService);
  }, 120_000);

  afterAll(async () => {
    await module?.close();
    await tearDownTestDatabase();
  });

  beforeEach(async () => {
    await resetData(prisma);
    await prisma.appSetting.createMany({
      data: SETTING_DEFINITIONS.map((d) => ({
        key: d.key,
        value: d.defaultValue,
        type: d.type,
        group: d.group,
        label: d.label,
        description: d.description,
        isSystem: d.isSystem,
      })),
    });
    await module.get(SettingsService).refreshCache();
  });

  async function makeTenant(aadhaar = AADHAAR) {
    return tenants.create({ fullName: 'Aadhaar Holder', aadhaarNumber: aadhaar });
  }

  // --- At rest -----------------------------------------------------------

  it('stores no readable Aadhaar anywhere in the tenant row', async () => {
    const created = await makeTenant();

    const row = await prisma.tenant.findUniqueOrThrow({ where: { id: created.id } });
    const serialised = JSON.stringify(row);

    expect(serialised).not.toContain(AADHAAR);
    expect(row.aadhaarCiphertext).not.toBeNull();
    expect(row.aadhaarCiphertext).not.toContain(AADHAAR);
    expect(row.aadhaarCiphertext!.startsWith('v1.')).toBe(true);
  });

  it('cannot be found by a raw SQL scan for the number', async () => {
    await makeTenant();

    // The strongest form of the claim: even with direct database access, the
    // number is not in the table.
    const hits = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "Tenant"
       WHERE COALESCE("aadhaarCiphertext",'') LIKE '%${AADHAAR}%'
          OR COALESCE("aadhaarIndex",'') LIKE '%${AADHAAR}%'
          OR COALESCE("fullName",'') LIKE '%${AADHAAR}%'
          OR COALESCE("notes",'') LIKE '%${AADHAAR}%'`,
    );
    expect(Number(hits[0].count)).toBe(0);
  });

  it('keeps only the last four digits in the clear', async () => {
    const created = await makeTenant();
    const row = await prisma.tenant.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.aadhaarLast4).toBe('5678');
  });

  it('stores the same number differently for two tenants', async () => {
    const a = await makeTenant();
    const b = await tenants.create({ fullName: 'Another Holder', aadhaarNumber: AADHAAR });

    const [rowA, rowB] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: a.id } }),
      prisma.tenant.findUniqueOrThrow({ where: { id: b.id } }),
    ]);

    // Different ciphertexts, so the database cannot be used to spot duplicates.
    expect(rowA.aadhaarCiphertext).not.toBe(rowB.aadhaarCiphertext);
    // The blind index is deterministic by design, which is what makes search work.
    expect(rowA.aadhaarIndex).toBe(rowB.aadhaarIndex);
  });

  // --- API responses -----------------------------------------------------

  it('masks the number for an ordinary viewer', async () => {
    const created = await makeTenant();
    const view = await tenants.findOne(created.id);
    expect(view.aadhaarNumber).toBe('•••• •••• 5678');
  });

  it('never returns the ciphertext or the search index through the API', async () => {
    const created = await makeTenant();
    const view = await tenants.findOne(created.id, { canSeeSensitive: true });
    const serialised = JSON.stringify(view);

    expect(serialised).not.toContain('aadhaarCiphertext');
    expect(serialised).not.toContain('aadhaarIndex');
    expect(serialised).not.toContain('aadhaarLast4');
    expect(serialised).not.toContain('v1.');
  });

  it('reveals the full number only to a caller permitted to see it', async () => {
    const created = await makeTenant();

    const masked = await tenants.findOne(created.id);
    const full = await tenants.findOne(created.id, { canSeeSensitive: true });

    expect(masked.aadhaarNumber).not.toContain(AADHAAR);
    expect(full.aadhaarNumber).toBe(AADHAAR);
  });

  it('does not leak the number through the tenant list', async () => {
    await makeTenant();
    const list = await tenants.list({});
    expect(JSON.stringify(list)).not.toContain(AADHAAR);
  });

  // --- Search ------------------------------------------------------------

  it('finds a tenant by their full number without exposing it', async () => {
    await makeTenant();

    const results = await tenants.search(AADHAAR);
    expect(results.tenants).toHaveLength(1);
    expect(results.tenants[0].fullName).toBe('Aadhaar Holder');
    expect(results.tenants[0].aadhaarNumber).toBe('•••• •••• 5678');
  });

  it('finds a tenant by the last four digits, as read off a document', async () => {
    await makeTenant();
    const results = await tenants.search('5678');
    expect(results.tenants).toHaveLength(1);
  });

  it('accepts a spaced number', async () => {
    await makeTenant();
    const results = await tenants.search('5678 5678 5678');
    expect(results.tenants).toHaveLength(1);
  });

  it('does not match a different number', async () => {
    await makeTenant();
    const results = await tenants.search('111111111111');
    expect(results.tenants).toHaveLength(0);
  });

  it('shows the full number in search only to a permitted caller', async () => {
    await makeTenant();
    const permitted = await tenants.search(AADHAAR, [], { canSeeSensitive: true });
    expect(permitted.tenants[0].aadhaarNumber).toBe(AADHAAR);
  });

  // --- Update and erasure ------------------------------------------------

  it('re-encrypts when the number is changed', async () => {
    const created = await makeTenant();
    const before = await prisma.tenant.findUniqueOrThrow({ where: { id: created.id } });

    await tenants.update(created.id, { aadhaarNumber: '999988887777' });

    const after = await prisma.tenant.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.aadhaarCiphertext).not.toBe(before.aadhaarCiphertext);
    expect(after.aadhaarIndex).not.toBe(before.aadhaarIndex);
    expect(after.aadhaarLast4).toBe('7777');
    expect(encryption.decrypt(after.aadhaarCiphertext)).toBe('999988887777');
  });

  it('does not wipe the number when an unrelated field is updated', async () => {
    const created = await makeTenant();
    await tenants.update(created.id, { mobile: '9000000000' });

    const after = await prisma.tenant.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.aadhaarCiphertext).not.toBeNull();
    expect(after.aadhaarLast4).toBe('5678');
  });

  it('clears all three columns when the field is blanked', async () => {
    const created = await makeTenant();
    await tenants.update(created.id, { aadhaarNumber: '' });

    const after = await prisma.tenant.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.aadhaarCiphertext).toBeNull();
    expect(after.aadhaarIndex).toBeNull();
    expect(after.aadhaarLast4).toBeNull();
  });

  it('leaves nothing searchable after erasure', async () => {
    const created = await makeTenant();

    await prisma.tenant.update({
      where: { id: created.id },
      data: {
        aadhaarCiphertext: null,
        aadhaarIndex: null,
        aadhaarLast4: null,
        personalDataErasedAt: new Date(),
      },
    });

    expect((await tenants.search(AADHAAR)).tenants).toHaveLength(0);
    expect((await tenants.search('5678')).tenants).toHaveLength(0);

    const view = await tenants.findOne(created.id, { canSeeSensitive: true });
    expect(view.aadhaarNumber).toBeNull();
  });
});
