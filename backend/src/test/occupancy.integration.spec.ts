import type { TestingModule } from '@nestjs/testing';
import { AcType, PricingScope, StayType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { SETTING_DEFINITIONS } from '../modules/settings/setting-keys';
import { SettingsService } from '../modules/settings/settings.service';
import { PropertyService } from '../modules/property/property.service';
import { StaysService } from '../modules/tenants/stays.service';
import { BillingService } from '../modules/billing/billing.service';
import { PaymentsService } from '../modules/payments/payments.service';
import { SettlementsService } from '../modules/settlements/settlements.service';
import {
  createTestModule,
  resetData,
  setUpTestDatabase,
  tearDownTestDatabase,
} from './integration-harness';

/**
 * The occupancy and billing rules that only hold if the database holds them:
 * bed conflicts, room history, effective-dated food, notice and settlement.
 */
describe('occupancy and billing (integration)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let property: PropertyService;
  let stays: StaysService;
  let billing: BillingService;
  let payments: PaymentsService;
  let settlements: SettlementsService;

  const ACTOR = '00000000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    await setUpTestDatabase();
    module = await createTestModule();
    await module.init();
    prisma = module.get(PrismaService);
    property = module.get(PropertyService);
    stays = module.get(StaysService);
    billing = module.get(BillingService);
    payments = module.get(PaymentsService);
    settlements = module.get(SettlementsService);
  }, 120_000);

  afterAll(async () => {
    await module?.close();
    await tearDownTestDatabase();
  });

  let branchId: string;
  let roomId: string;
  let beds: string[];

  beforeEach(async () => {
    await resetData(prisma);

    // Audited actions reference a real profile, so the tests need one.
    await prisma.user.create({
      data: {
        id: ACTOR,
        username: 'test-actor',
        fullName: 'Test Actor',
        isOwner: true,
      },
    });

    // Settings are configuration, so every test starts from the shipped
    // defaults rather than values hidden in code.
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

    const branch = await property.createBranch({ name: 'Test Branch' });
    branchId = branch.id;
    const floor = await property.createFloor(branchId, { name: 'Ground Floor' });
    const room = await property.createRoom(floor.id, {
      name: 'T1',
      capacity: 3,
      acType: AcType.AC,
    });
    roomId = room.id;
    beds = room.beds.map((b) => b.id);

    await prisma.pricingRule.create({
      data: {
        scope: PricingScope.SHARING,
        branchId,
        capacity: 3,
        acType: AcType.AC,
        amountWithFood: '12000',
        effectiveFrom: new Date(2020, 0, 1),
      },
    });
  });

  async function makeTenant(fullName: string): Promise<string> {
    const tenant = await prisma.tenant.create({ data: { fullName } });
    return tenant.id;
  }

  async function makeStay(
    tenantId: string,
    bedId: string | undefined,
    checkIn: string,
    foodIncluded = true,
  ): Promise<string> {
    const stay = await stays.createStay(
      tenantId,
      {
        stayType: StayType.MONTHLY,
        checkInDate: checkIn,
        foodIncluded,
        depositAmount: '10000',
        depositCollected: '10000',
        bedId,
      },
      ACTOR,
    );
    return stay.id;
  }

  // --- Double booking ----------------------------------------------------

  it('refuses to put two tenants in the same bed', async () => {
    const a = await makeTenant('First Tenant');
    await makeStay(a, beds[0], '2026-09-01');

    const b = await makeTenant('Second Tenant');
    await expect(makeStay(b, beds[0], '2026-09-05')).rejects.toThrow(
      /occupied by First Tenant/i,
    );
  });

  it('allows the other beds in the same room', async () => {
    const a = await makeTenant('A');
    const b = await makeTenant('B');
    await makeStay(a, beds[0], '2026-09-01');
    await expect(makeStay(b, beds[1], '2026-09-01')).resolves.toBeTruthy();

    const occupancy = await property.bedOccupancy(beds, new Date(2026, 8, 10));
    expect([...occupancy.values()].filter((o) => o.occupied)).toHaveLength(2);
  });

  it('frees the bed for a new tenant once the first has left', async () => {
    const a = await makeTenant('Leaver');
    const stayA = await makeStay(a, beds[0], '2026-09-01');
    await settlements.vacate(
      stayA,
      { checkoutDate: '2026-09-30', finaliseSettlement: true },
      ACTOR,
    );

    const b = await makeTenant('Arriver');
    await expect(makeStay(b, beds[0], '2026-10-01')).resolves.toBeTruthy();
  });

  // --- Room switching ----------------------------------------------------

  it('keeps the full room history across a switch', async () => {
    const tenantId = await makeTenant('Mover');
    const stayId = await makeStay(tenantId, beds[0], '2026-09-01');

    await stays.switchRoom(
      stayId,
      { toBedId: beds[2], effectiveDate: '2026-09-16', reason: 'Prefers the window' },
      ACTOR,
    );

    const history = await prisma.bedAssignment.findMany({
      where: { stayId },
      orderBy: { startDate: 'asc' },
    });

    expect(history).toHaveLength(2);
    // The old row is closed, not deleted.
    expect(history[0].bedId).toBe(beds[0]);
    expect(history[0].endDate?.toISOString().slice(0, 10)).toBe('2026-09-15');
    expect(history[1].bedId).toBe(beds[2]);
    expect(history[1].endDate).toBeNull();
    expect(history[1].reason).toBe('Prefers the window');
  });

  it('will not move a tenant into an occupied bed without a confirmed swap', async () => {
    const a = await makeTenant('A');
    const b = await makeTenant('B');
    const stayA = await makeStay(a, beds[0], '2026-09-01');
    await makeStay(b, beds[1], '2026-09-01');

    await expect(
      stays.switchRoom(stayA, { toBedId: beds[1], effectiveDate: '2026-09-10' }, ACTOR),
    ).rejects.toThrow(/Confirm a swap/i);
  });

  it('swaps two tenants in one transaction', async () => {
    const a = await makeTenant('A');
    const b = await makeTenant('B');
    const stayA = await makeStay(a, beds[0], '2026-09-01');
    const stayB = await makeStay(b, beds[1], '2026-09-01');

    await stays.switchRoom(
      stayA,
      { toBedId: beds[1], effectiveDate: '2026-09-10', allowSwap: true },
      ACTOR,
    );

    const current = await prisma.bedAssignment.findMany({
      where: { endDate: null },
      orderBy: { stayId: 'asc' },
    });
    const byStay = new Map(current.map((a2) => [a2.stayId, a2.bedId]));
    expect(byStay.get(stayA)).toBe(beds[1]);
    expect(byStay.get(stayB)).toBe(beds[0]);
  });

  // --- Billing history ---------------------------------------------------

  it('bills a mid-month arrival only for the days stayed', async () => {
    const tenantId = await makeTenant('Late Arrival');
    // Arrives on the 16th of a 30-day month: half the month.
    const stayId = await makeStay(tenantId, beds[0], '2026-09-16');

    const charges = await billing.computeCharges(
      stayId,
      new Date(2026, 8, 1),
      new Date(2026, 8, 30),
    );

    const rent = charges.lines
      .filter((l) => l.kind === 'RENT')
      .reduce((total, l) => total.plus(l.amount), charges.lines[0].amount.times(0));
    // 12,000 room price is inclusive of 2,000 food, so rent is 10,000/month.
    expect(rent.toFixed(2)).toBe('5000.00');
  });

  it('charges each side of a mid-month food change at its own rate', async () => {
    const tenantId = await makeTenant('Food Changer');
    const stayId = await makeStay(tenantId, beds[0], '2026-09-01', true);

    await stays.changeFood(
      stayId,
      { foodIncluded: false, effectiveFrom: '2026-09-16', reason: 'Opted out' },
      ACTOR,
    );

    const charges = await billing.computeCharges(
      stayId,
      new Date(2026, 8, 1),
      new Date(2026, 8, 30),
    );
    const food = charges.lines
      .filter((l) => l.kind === 'FOOD')
      .reduce((t, l) => t.plus(l.amount), charges.lines[0].amount.times(0));

    // Food for 15 of 30 days at 2,000/month.
    expect(food.toFixed(2)).toBe('1000.00');
  });

  it('does not change an issued bill when the food status changes afterwards', async () => {
    const tenantId = await makeTenant('History Keeper');
    const stayId = await makeStay(tenantId, beds[0], '2026-09-01', true);

    const invoice = await billing.generateInvoice(
      stayId,
      new Date(2026, 8, 1),
      new Date(2026, 8, 30),
      ACTOR,
      { issue: true },
    );
    const originalTotal = invoice.totalAmount.toString();

    await stays.changeFood(
      stayId,
      { foodIncluded: false, effectiveFrom: '2026-09-02', reason: 'Changed mind' },
      ACTOR,
    );

    const after = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(after.totalAmount.toString()).toBe(originalTotal);
  });

  it('does not change an issued bill when the room price changes afterwards', async () => {
    const tenantId = await makeTenant('Price Change');
    const stayId = await makeStay(tenantId, beds[0], '2026-09-01');

    const invoice = await billing.generateInvoice(
      stayId,
      new Date(2026, 8, 1),
      new Date(2026, 8, 30),
      ACTOR,
      { issue: true },
    );
    const before = invoice.totalAmount.toString();

    await prisma.pricingRule.create({
      data: {
        scope: PricingScope.SHARING,
        branchId,
        capacity: 3,
        acType: AcType.AC,
        amountWithFood: '20000',
        effectiveFrom: new Date(2026, 9, 1),
      },
    });

    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(after.totalAmount.toString()).toBe(before);
  });

  it('refuses to regenerate a bill that has already been issued', async () => {
    const tenantId = await makeTenant('No Regenerate');
    const stayId = await makeStay(tenantId, beds[0], '2026-09-01');

    await billing.generateInvoice(
      stayId,
      new Date(2026, 8, 1),
      new Date(2026, 8, 30),
      ACTOR,
      { issue: true },
    );

    await expect(
      billing.generateInvoice(
        stayId,
        new Date(2026, 8, 1),
        new Date(2026, 8, 30),
        ACTOR,
      ),
    ).rejects.toThrow(/already exists/i);
  });

  // --- Payments ----------------------------------------------------------

  it('leaves a bill partly paid until it is settled', async () => {
    const tenantId = await makeTenant('Part Payer');
    const stayId = await makeStay(tenantId, beds[0], '2026-09-01');
    const invoice = await billing.generateInvoice(
      stayId,
      new Date(2026, 8, 1),
      new Date(2026, 8, 30),
      ACTOR,
      { issue: true },
    );

    await payments.record(
      { stayId, amount: '5000', paidAt: '2026-09-05' },
      ACTOR,
      { canApprove: true },
    );

    const partial = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(partial.status).toBe('PARTIALLY_PAID');

    const remaining = Number(invoice.totalAmount) - 5000;
    await payments.record(
      { stayId, amount: String(remaining), paidAt: '2026-09-10' },
      ACTOR,
      { canApprove: true },
    );

    const settled = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(settled.status).toBe('PAID');
  });

  it('refuses a payment dated in the future', async () => {
    const tenantId = await makeTenant('Time Traveller');
    const stayId = await makeStay(tenantId, beds[0], '2026-09-01');
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    await expect(
      payments.record({ stayId, amount: '100', paidAt: tomorrow }, ACTOR, {
        canApprove: true,
      }),
    ).rejects.toThrow(/cannot be dated in the future/i);
  });

  it('accepts a backdated payment', async () => {
    const tenantId = await makeTenant('Late Entry');
    const stayId = await makeStay(tenantId, beds[0], '2026-09-01');

    await expect(
      payments.record({ stayId, amount: '100', paidAt: '2026-09-02' }, ACTOR, {
        canApprove: true,
      }),
    ).resolves.toBeTruthy();
  });

  it('catches the same payment being entered twice, but allows a confirmed repeat', async () => {
    const tenantId = await makeTenant('Double Entry');
    const stayId = await makeStay(tenantId, beds[0], '2026-09-01');

    await payments.record({ stayId, amount: '2500', paidAt: '2026-09-05' }, ACTOR, {
      canApprove: true,
    });

    await expect(
      payments.record({ stayId, amount: '2500', paidAt: '2026-09-05' }, ACTOR, {
        canApprove: true,
      }),
    ).rejects.toThrow(/already recorded/i);

    await expect(
      payments.record(
        { stayId, amount: '2500', paidAt: '2026-09-05', allowDuplicate: true },
        ACTOR,
        { canApprove: true },
      ),
    ).resolves.toBeTruthy();
  });

  it('holds unapproved money away from the bill until it is approved', async () => {
    const tenantId = await makeTenant('Needs Approval');
    const stayId = await makeStay(tenantId, beds[0], '2026-09-01');
    const invoice = await billing.generateInvoice(
      stayId,
      new Date(2026, 8, 1),
      new Date(2026, 8, 30),
      ACTOR,
      { issue: true },
    );

    const result = await payments.record(
      { stayId, amount: '4000', paidAt: '2026-09-05' },
      ACTOR,
      { canApprove: false },
    );
    expect(result.awaitingApproval).toBe(true);

    const untouched = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(untouched.paidAmount.toString()).toBe('0');

    await payments.verify(result.payment.id, ACTOR);

    const applied = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(Number(applied.paidAmount)).toBe(4000);
  });

  it('never applies a rejected payment', async () => {
    const tenantId = await makeTenant('Rejected');
    const stayId = await makeStay(tenantId, beds[0], '2026-09-01');
    const invoice = await billing.generateInvoice(
      stayId,
      new Date(2026, 8, 1),
      new Date(2026, 8, 30),
      ACTOR,
      { issue: true },
    );

    const result = await payments.record(
      { stayId, amount: '4000', paidAt: '2026-09-05' },
      ACTOR,
      { canApprove: false },
    );
    await payments.reject(result.payment.id, 'Tenant disputes this', ACTOR);

    const untouched = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(untouched.paidAmount.toString()).toBe('0');
    await expect(payments.verify(result.payment.id, ACTOR)).rejects.toThrow(
      /rejected/i,
    );
  });

  // --- Notice, deposit and settlement ------------------------------------

  it('charges the shortfall when a tenant leaves inside their notice period', async () => {
    const tenantId = await makeTenant('Short Notice');
    const stayId = await makeStay(tenantId, beds[0], '2026-08-01');

    // 30 days' notice given on 10 Oct runs to 9 Nov; leaving on 25 Oct is
    // 15 days short.
    await stays.giveNotice(
      stayId,
      { noticeDate: '2026-10-10', intendedCheckout: '2026-10-25' },
      ACTOR,
    );

    const notice = await prisma.vacateNotice.findUniqueOrThrow({ where: { stayId } });
    expect(notice.noticeDaysRequired).toBe(30);
    expect(notice.shortfallDays).toBe(15);

    const preview = await settlements.preview(stayId, new Date(2026, 9, 25));
    const shortfall = preview.lines.find((l) => l.kind === 'NOTICE_PERIOD');
    expect(shortfall).toBeDefined();
    expect(Number(shortfall!.amount)).toBeGreaterThan(0);
  });

  it('keeps the notice period that applied on the notice date', async () => {
    const tenantId = await makeTenant('Rule Change');
    const stayId = await makeStay(tenantId, beds[0], '2026-08-01');
    await stays.giveNotice(
      stayId,
      { noticeDate: '2026-10-10', intendedCheckout: '2026-11-09' },
      ACTOR,
    );

    // Changing the setting afterwards must not rewrite the recorded notice.
    await module
      .get(SettingsService)
      .set('stay.notice_period_days', '60', ACTOR, 'Policy change');

    const notice = await prisma.vacateNotice.findUniqueOrThrow({ where: { stayId } });
    expect(notice.noticeDaysRequired).toBe(30);
  });

  it('settles the deposit against what is owed and reports the refund', async () => {
    const tenantId = await makeTenant('Settler');
    const stayId = await makeStay(tenantId, beds[0], '2026-09-01');

    const settlement = await settlements.vacate(
      stayId,
      { checkoutDate: '2026-09-30', finaliseSettlement: true },
      ACTOR,
    );

    // 10,000 deposit, less one month's charges.
    expect(Number(settlement.depositHeld)).toBe(10000);
    expect(Number(settlement.totalDeductions)).toBeGreaterThan(0);
    expect(Number(settlement.netAmount)).toBe(
      Number(settlement.depositHeld) - Number(settlement.totalDeductions),
    );

    const ledger = await payments.depositLedger(stayId);
    // Collected 10,000 then applied part of it: the ledger must still balance.
    const entries = ledger.entries.reduce((t, e) => t + Number(e.amount), 0);
    expect(Number(ledger.held)).toBeCloseTo(entries, 2);
  });

  it('closes the bed on the checkout date so it is free the next day', async () => {
    const tenantId = await makeTenant('Departing');
    const stayId = await makeStay(tenantId, beds[0], '2026-09-01');
    await settlements.vacate(
      stayId,
      { checkoutDate: '2026-09-30', finaliseSettlement: true },
      ACTOR,
    );

    const onCheckoutDay = await property.bedOccupancy([beds[0]], new Date(2026, 8, 30));
    const dayAfter = await property.bedOccupancy([beds[0]], new Date(2026, 9, 1));

    expect(onCheckoutDay.get(beds[0])?.occupied).toBe(true);
    expect(dayAfter.get(beds[0])?.occupied).toBe(false);
  });

  it('requires a reason for a manual settlement adjustment', async () => {
    const tenantId = await makeTenant('Adjuster');
    const stayId = await makeStay(tenantId, beds[0], '2026-09-01');
    const settlement = await settlements.vacate(
      stayId,
      { checkoutDate: '2026-09-30' },
      ACTOR,
    );

    await expect(
      settlements.addManualLine(
        settlement.id,
        { description: 'Broken window', amount: '500', reason: '' },
        ACTOR,
      ),
    ).rejects.toThrow(/reason is required/i);

    const line = await settlements.addManualLine(
      settlement.id,
      { description: 'Broken window', amount: '500', reason: 'Damage on inspection' },
      ACTOR,
    );
    expect(line.isManual).toBe(true);
    expect(line.reason).toBe('Damage on inspection');
  });

  // --- Daily stays -------------------------------------------------------

  it('never gives a daily tenant food', async () => {
    const tenantId = await makeTenant('Daily Guest');

    await expect(
      stays.createStay(
        tenantId,
        {
          stayType: StayType.DAILY,
          checkInDate: '2026-09-01',
          foodIncluded: true,
          bedId: beds[0],
        },
        ACTOR,
      ),
    ).rejects.toThrow(/cannot include food/i);
  });
});
