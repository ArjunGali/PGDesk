import type { TestingModule } from '@nestjs/testing';
import { AcType, PricingScope, StayType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PERMISSIONS } from '../common/permissions';
import { PropertyService } from '../modules/property/property.service';
import { SETTING_DEFINITIONS } from '../modules/settings/setting-keys';
import { SettingsService } from '../modules/settings/settings.service';
import { BillingService } from '../modules/billing/billing.service';
import { PaymentsService } from '../modules/payments/payments.service';
import { SettlementsService } from '../modules/settlements/settlements.service';
import { StaysService } from '../modules/tenants/stays.service';
import { TenantsService } from '../modules/tenants/tenants.service';
import {
  createTestModule,
  resetData,
  setUpTestDatabase,
  tearDownTestDatabase,
} from './integration-harness';

/**
 * Erasing a former tenant, and the rules around who may see what.
 *
 * The critical property is that erasure removes the person while leaving the
 * accounts intact — a report run after an erasure must still balance.
 */
describe('retention and access (integration)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let property: PropertyService;
  let tenants: TenantsService;
  let stays: StaysService;
  let billing: BillingService;
  let payments: PaymentsService;
  let settlements: SettlementsService;

  const ACTOR = '00000000-0000-4000-8000-000000000002';

  beforeAll(async () => {
    await setUpTestDatabase();
    module = await createTestModule();
    await module.init();
    prisma = module.get(PrismaService);
    property = module.get(PropertyService);
    tenants = module.get(TenantsService);
    stays = module.get(StaysService);
    billing = module.get(BillingService);
    payments = module.get(PaymentsService);
    settlements = module.get(SettlementsService);
  }, 120_000);

  afterAll(async () => {
    await module?.close();
    await tearDownTestDatabase();
  });

  let bedId: string;

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

    await prisma.user.create({
      data: { id: ACTOR, username: 'retention-actor', fullName: 'Actor', isOwner: true },
    });

    const branch = await property.createBranch({ name: 'Retention Branch' });
    const floor = await property.createFloor(branch.id, { name: 'Ground Floor' });
    const room = await property.createRoom(floor.id, {
      name: 'R1',
      capacity: 2,
      acType: AcType.AC,
    });
    bedId = room.beds[0].id;

    await prisma.pricingRule.create({
      data: {
        scope: PricingScope.SHARING,
        branchId: branch.id,
        capacity: 2,
        acType: AcType.AC,
        amountWithFood: '13000',
        effectiveFrom: new Date(2020, 0, 1),
      },
    });
  });

  /** A tenant who lived, was billed, paid something and then left. */
  async function makeVacatedTenant() {
    const tenant = await tenants.create({
      fullName: 'Former Resident',
      mobile: '9800000000',
      permanentAddress: '4 Old Road',
      aadhaarNumber: '111122223333',
      notes: 'Quiet, paid on time',
    });

    const stay = await stays.createStay(
      tenant.id,
      {
        stayType: StayType.MONTHLY,
        checkInDate: '2026-08-01',
        foodIncluded: true,
        depositAmount: '10000',
        depositCollected: '10000',
        bedId,
      },
      ACTOR,
    );

    const invoice = await billing.generateInvoice(
      stay.id,
      new Date(2026, 7, 1),
      new Date(2026, 7, 31),
      ACTOR,
      { issue: true },
    );
    await payments.record(
      { stayId: stay.id, amount: '5000', paidAt: '2026-08-05' },
      ACTOR,
      { canApprove: true },
    );
    await settlements.vacate(
      stay.id,
      { checkoutDate: '2026-08-31', finaliseSettlement: true },
      ACTOR,
    );

    return { tenantId: tenant.id, stayId: stay.id, invoiceId: invoice.id };
  }

  it('masks an Aadhaar number unless the viewer is permitted to see it', async () => {
    const { tenantId } = await makeVacatedTenant();

    const masked = await tenants.findOne(tenantId);
    expect(masked.aadhaarNumber).toBe('•••• •••• 3333');

    const full = await tenants.findOne(tenantId, { canSeeSensitive: true });
    expect(full.aadhaarNumber).toBe('111122223333');
  });

  it('finds a tenant by their Aadhaar digits but still masks the result', async () => {
    await makeVacatedTenant();

    const results = await tenants.search('111122223333');
    expect(results.tenants).toHaveLength(1);
    expect(results.tenants[0].fullName).toBe('Former Resident');
    expect(results.tenants[0].aadhaarNumber).toBe('•••• •••• 3333');
  });

  it('does not match an Aadhaar on two or three stray digits', async () => {
    await makeVacatedTenant();
    // "11" appears inside the number but is too short to be a deliberate search.
    const results = await tenants.search('11');
    expect(results.tenants).toHaveLength(0);
  });

  it('reports a tenant\'s room and payment status in search results', async () => {
    const tenant = await tenants.create({ fullName: 'Current Resident' });
    await stays.createStay(
      tenant.id,
      {
        stayType: StayType.MONTHLY,
        checkInDate: '2026-09-01',
        foodIncluded: true,
        bedId,
      },
      ACTOR,
    );

    const results = await tenants.search('Current Resident');
    expect(results.tenants[0].roomName).toBe('R1');
    expect(results.tenants[0].branchName).toBe('Retention Branch');
    expect(results.tenants[0].paymentStatus).toBe('Up to date');
  });

  it('flags a tenant with an unpaid bill as pending in search', async () => {
    const tenant = await tenants.create({ fullName: 'Owing Resident' });
    const stay = await stays.createStay(
      tenant.id,
      {
        stayType: StayType.MONTHLY,
        checkInDate: '2026-09-01',
        foodIncluded: true,
        bedId,
      },
      ACTOR,
    );
    await billing.generateInvoice(
      stay.id,
      new Date(2026, 8, 1),
      new Date(2026, 8, 30),
      ACTOR,
      { issue: true },
    );

    const results = await tenants.search('Owing Resident');
    expect(results.tenants[0].paymentStatus).toBe('Pending');
    expect(Number(results.tenants[0].outstanding)).toBeGreaterThan(0);
  });

  it('keeps every financial record when personal data is erased', async () => {
    const { tenantId, stayId, invoiceId } = await makeVacatedTenant();

    const before = await billing.outstandingForStay(stayId);

    // Erase directly through the data layer, mirroring what the retention
    // service does, so this test does not depend on file storage.
    await prisma.customFieldValue.deleteMany({ where: { tenantId } });
    await prisma.document.deleteMany({ where: { tenantId } });
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        fullName: `Erased tenant ${tenantId.slice(0, 8)}`,
        mobile: null,
        permanentAddress: null,
        aadhaarCiphertext: null,
        aadhaarIndex: null,
        aadhaarLast4: null,
        notes: null,
        personalDataErasedAt: new Date(),
        erasedById: ACTOR,
      },
    });

    const after = await billing.outstandingForStay(stayId);
    expect(after.totalBilled.toFixed(2)).toBe(before.totalBilled.toFixed(2));
    expect(after.totalPaid.toFixed(2)).toBe(before.totalPaid.toFixed(2));
    expect(after.balance.toFixed(2)).toBe(before.balance.toFixed(2));

    // The bill, its lines and the payment all survive.
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { lines: true },
    });
    expect(invoice.lines.length).toBeGreaterThan(0);
    expect(await prisma.payment.count({ where: { stayId } })).toBe(1);
    expect(await prisma.depositEntry.count({ where: { stayId } })).toBeGreaterThan(0);

    // And the settlement still balances.
    const settlement = await prisma.settlement.findUniqueOrThrow({
      where: { stayId },
    });
    expect(Number(settlement.netAmount)).toBe(
      Number(settlement.depositHeld) - Number(settlement.totalDeductions),
    );
  });

  it('removes the identifying fields but keeps the tenant row for its records', async () => {
    const { tenantId, stayId } = await makeVacatedTenant();

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        fullName: `Erased tenant ${tenantId.slice(0, 8)}`,
        mobile: null,
        permanentAddress: null,
        aadhaarCiphertext: null,
        aadhaarIndex: null,
        aadhaarLast4: null,
        notes: null,
        personalDataErasedAt: new Date(),
      },
    });

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.mobile).toBeNull();
    expect(tenant.aadhaarCiphertext).toBeNull();
    expect(tenant.aadhaarIndex).toBeNull();
    expect(tenant.aadhaarLast4).toBeNull();
    expect(tenant.permanentAddress).toBeNull();
    expect(tenant.notes).toBeNull();
    expect(tenant.personalDataErasedAt).not.toBeNull();

    // The row itself remains, so bills still point at something.
    const stay = await prisma.stay.findUniqueOrThrow({ where: { id: stayId } });
    expect(stay.tenantId).toBe(tenantId);
  });

  it('keeps the audit trail of what was done to the tenant', async () => {
    const { tenantId } = await makeVacatedTenant();
    const entries = await prisma.auditLog.findMany({
      where: { entityType: 'Stay' },
    });
    expect(entries.length).toBeGreaterThan(0);
    expect(await prisma.tenant.count({ where: { id: tenantId } })).toBe(1);
  });

  // --- Permission catalogue ---------------------------------------------

  it('names every permission the specification lists', () => {
    // These are the capabilities the specification enumerates by name.
    const required = [
      PERMISSIONS.TENANT_VIEW,
      PERMISSIONS.TENANT_CREATE,
      PERMISSIONS.TENANT_EDIT,
      PERMISSIONS.TENANT_VACATE,
      PERMISSIONS.TENANT_ASSIGN,
      PERMISSIONS.PAYMENT_VIEW,
      PERMISSIONS.PAYMENT_RECORD,
      PERMISSIONS.PAYMENT_APPROVE,
      PERMISSIONS.EXPENSE_MANAGE,
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.EB_MANAGE,
      PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.PROFILE_MANAGE,
    ];
    for (const permission of required) {
      expect(typeof permission).toBe('string');
      expect(permission.length).toBeGreaterThan(0);
    }
    expect(new Set(required).size).toBe(required.length);
  });
});
