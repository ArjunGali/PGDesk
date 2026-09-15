import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, StayStatus } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { dayStart, toDateOnlyString } from '../../common/utils/dates';
import { formatINR, money, sum } from '../../common/utils/money';
import { BillingService } from '../billing/billing.service';
import { PaymentsService } from '../payments/payments.service';
import { ReportsService } from '../reports/reports.service';
import { SETTING_KEYS } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import { TenantsService } from '../tenants/tenants.service';
import {
  createDocument,
  fieldGrid,
  footer,
  heading,
  sectionTitle,
  table,
  toBuffer,
} from './pdf.util';

/** Stay statuses that count as "currently living here". */
const OPEN_STAY_STATUSES: StayStatus[] = [
  StayStatus.ACTIVE,
  StayStatus.NOTICE_GIVEN,
];

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly billing: BillingService,
    private readonly payments: PaymentsService,
    private readonly reports: ReportsService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The A4 tenant information sheet opened from the long-press INFO action.
   * Printable, professionally aligned, and complete enough to hand to a
   * tenant or keep in a physical file.
   */
  async tenantInfoSheet(tenantId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const [tenant, orgName] = await Promise.all([
      this.tenants.findOne(tenantId),
      this.settings.getString(SETTING_KEYS.ORG_NAME),
    ]);

    const currentStay =
      tenant.stays.find((s) => OPEN_STAY_STATUSES.includes(s.status)) ??
      tenant.stays[0];

    const doc = createDocument(`${tenant.fullName} — Tenant Information`);

    heading(
      doc,
      tenant.fullName,
      `${orgName} · Tenant information sheet · Generated ${toDateOnlyString(new Date())}`,
    );

    if (!tenant.completeness.complete) {
      doc
        .fillColor('#8A6D00')
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text(
          `INCOMPLETE PROFILE — missing: ${[
            ...tenant.completeness.missingFields.map((f) => f.label),
            ...tenant.completeness.missingDocuments.map((d) => d.name),
          ].join(', ')}`,
        );
      doc.moveDown(0.5);
    }

    sectionTitle(doc, 'Personal information');
    fieldGrid(doc, [
      ['Full name', tenant.fullName],
      ['Mobile', tenant.mobile],
      ['Emergency contact name', tenant.emergencyName],
      ['Emergency contact number', tenant.emergencyContact],
    ]);

    sectionTitle(doc, 'Addresses');
    fieldGrid(
      doc,
      [
        ['Permanent address', tenant.permanentAddress],
        ['Office / college', tenant.officeName],
        ['Office address', tenant.officeAddress],
      ],
      1,
    );

    if (tenant.customFieldValues.length > 0) {
      sectionTitle(doc, 'Additional information');
      fieldGrid(
        doc,
        tenant.customFieldValues.map((v) => [v.definition.label, v.value] as [string, string]),
      );
    }

    sectionTitle(doc, 'Stay and room');
    const location = tenant.currentLocation;
    const foodNow = currentStay?.foodPeriods.find((f) => !f.effectiveTo);
    fieldGrid(doc, [
      ['Branch', location?.branchName],
      ['Floor', location?.floorName],
      ['Room', location?.roomName],
      ['Bed', location?.bedLabel],
      ['Sharing', location ? `${location.capacity} sharing (${location.acType === 'AC' ? 'AC' : 'Non-AC'})` : null],
      ['Stay type', currentStay?.stayType],
      ['Check-in', currentStay ? toDateOnlyString(currentStay.checkInDate) : null],
      [
        'Expected checkout',
        currentStay?.expectedCheckoutDate
          ? toDateOnlyString(currentStay.expectedCheckoutDate)
          : null,
      ],
      [
        'Actual checkout',
        currentStay?.actualCheckoutDate
          ? toDateOnlyString(currentStay.actualCheckoutDate)
          : null,
      ],
      ['Food', foodNow ? (foodNow.foodIncluded ? 'Included' : 'Not included') : null],
    ]);

    if (currentStay) {
      const [outstanding, deposit] = await Promise.all([
        this.billing.outstandingForStay(currentStay.id),
        this.payments.depositLedger(currentStay.id),
      ]);

      sectionTitle(doc, 'Payment position');
      fieldGrid(doc, [
        ['Total billed', formatINR(outstanding.totalBilled)],
        ['Total paid', formatINR(outstanding.totalPaid)],
        ['Balance', formatINR(outstanding.balance)],
        ['Deposit held', formatINR(deposit.held)],
      ]);

      sectionTitle(doc, 'Room history');
      table(
        doc,
        [
          { header: 'From', width: 0.16 },
          { header: 'To', width: 0.16 },
          { header: 'Branch', width: 0.22 },
          { header: 'Room', width: 0.16 },
          { header: 'Bed', width: 0.1 },
          { header: 'Reason', width: 0.2 },
        ],
        currentStay.assignments
          .slice()
          .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
          .map((a) => [
            toDateOnlyString(a.startDate),
            a.endDate ? toDateOnlyString(a.endDate) : 'Current',
            a.bed.room.floor.branch.name,
            a.bed.room.name,
            a.bed.label,
            a.reason ?? '—',
          ]),
        { emptyMessage: 'No room assignments recorded' },
      );

      sectionTitle(doc, 'Payment history');
      table(
        doc,
        [
          { header: 'Date', width: 0.18 },
          { header: 'Receipt', width: 0.24 },
          { header: 'Method', width: 0.2 },
          { header: 'Amount', width: 0.2, align: 'right' },
          { header: 'Reference', width: 0.18 },
        ],
        currentStay.payments.map((p) => [
          toDateOnlyString(p.paidAt),
          p.receiptNo,
          p.method,
          formatINR(p.amount),
          p.reference ?? '—',
        ]),
        { emptyMessage: 'No payments recorded' },
      );

      if (currentStay.ebCharges.length > 0) {
        sectionTitle(doc, 'E.B. history');
        table(
          doc,
          [
            { header: 'Period', width: 0.34 },
            { header: 'Days', width: 0.14, align: 'right' },
            { header: 'Units', width: 0.18, align: 'right' },
            { header: 'Amount', width: 0.34, align: 'right' },
          ],
          currentStay.ebCharges.map((c) => [
            `${toDateOnlyString(c.cycle.periodStart)} – ${toDateOnlyString(c.cycle.periodEnd)}`,
            String(c.occupiedDays),
            money(c.units).toFixed(2),
            formatINR(c.amount),
          ]),
        );
      }
    }

    sectionTitle(doc, 'Documents');
    table(
      doc,
      [
        { header: 'Type', width: 0.3 },
        { header: 'File', width: 0.34 },
        { header: 'Uploaded', width: 0.18 },
        { header: 'Status', width: 0.18 },
      ],
      tenant.documents.map((d) => [
        d.documentType.name,
        d.fileName,
        toDateOnlyString(d.uploadedAt),
        d.verification,
      ]),
      { emptyMessage: 'No documents on file' },
    );

    if (tenant.notes) {
      sectionTitle(doc, 'Notes');
      doc.fillColor('#333333').font('Helvetica').fontSize(9).text(tenant.notes);
    }

    footer(doc, `${orgName} · This document was generated from the PG Management system.`);

    return {
      buffer: await toBuffer(doc),
      fileName: `${slug(tenant.fullName)}-information.pdf`,
    };
  }

  /** A printable bill. */
  async invoicePdf(invoiceId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const [invoice, orgName] = await Promise.all([
      this.billing.getInvoice(invoiceId),
      this.settings.getString(SETTING_KEYS.ORG_NAME),
    ]);

    const doc = createDocument(`Bill ${invoice.number}`);
    const location = invoice.stay.assignments[0];

    heading(
      doc,
      `Bill ${invoice.number}`,
      `${orgName} · ${toDateOnlyString(invoice.periodStart)} to ${toDateOnlyString(
        invoice.periodEnd,
      )}`,
    );

    fieldGrid(doc, [
      ['Tenant', invoice.stay.tenant.fullName],
      ['Mobile', invoice.stay.tenant.mobile],
      ['Room', location ? `${location.bed.room.name} · bed ${location.bed.label}` : null],
      ['Branch', location?.bed.room.floor.branch.name],
      ['Due date', toDateOnlyString(invoice.dueDate)],
      ['Status', invoice.status],
    ]);

    sectionTitle(doc, 'Charges');
    table(
      doc,
      [
        { header: 'Description', width: 0.52 },
        { header: 'Qty', width: 0.12, align: 'right' },
        { header: 'Rate', width: 0.18, align: 'right' },
        { header: 'Amount', width: 0.18, align: 'right' },
      ],
      invoice.lines.map((l) => [
        l.description,
        money(l.quantity).toFixed(2),
        formatINR(l.unitAmount),
        formatINR(l.amount),
      ]),
    );

    doc.moveDown(0.5);
    fieldGrid(doc, [
      ['Total', formatINR(invoice.totalAmount)],
      ['Paid', formatINR(invoice.paidAmount)],
      ['Balance', formatINR(invoice.balance)],
    ]);

    footer(doc, `${orgName} · Generated ${toDateOnlyString(new Date())}`);
    return {
      buffer: await toBuffer(doc),
      fileName: `${invoice.number}.pdf`,
    };
  }

  /** Final settlement statement handed over at checkout. */
  async settlementPdf(stayId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const settlement = await this.prisma.settlement.findUnique({
      where: { stayId },
      include: {
        lines: { orderBy: { createdAt: 'asc' } },
        stay: { include: { tenant: true, notice: true } },
      },
    });
    if (!settlement) throw new NotFoundException('No settlement for this stay');

    const orgName = await this.settings.getString(SETTING_KEYS.ORG_NAME);
    const doc = createDocument(`Final settlement — ${settlement.stay.tenant.fullName}`);

    heading(
      doc,
      'Final settlement',
      `${orgName} · ${settlement.stay.tenant.fullName} · Checkout ${toDateOnlyString(
        settlement.checkoutDate,
      )}`,
    );

    if (settlement.stay.notice) {
      sectionTitle(doc, 'Notice');
      fieldGrid(doc, [
        ['Notice given on', toDateOnlyString(settlement.stay.notice.noticeDate)],
        ['Notice period', `${settlement.stay.notice.noticeDaysRequired} days`],
        ['Required until', toDateOnlyString(settlement.stay.notice.requiredUntilDate)],
        ['Actual checkout', toDateOnlyString(settlement.checkoutDate)],
        ['Short by', `${settlement.stay.notice.shortfallDays} day(s)`],
      ]);
    }

    sectionTitle(doc, 'Deductions');
    table(
      doc,
      [
        { header: 'Type', width: 0.2 },
        { header: 'Description', width: 0.55 },
        { header: 'Amount', width: 0.25, align: 'right' },
      ],
      settlement.lines.map((l) => [
        l.kind,
        l.isManual ? `${l.description} (manual — ${l.reason ?? 'no reason'})` : l.description,
        formatINR(l.amount),
      ]),
      { emptyMessage: 'No deductions' },
    );

    doc.moveDown(0.6);
    const net = money(settlement.netAmount);
    fieldGrid(doc, [
      ['Deposit held', formatINR(settlement.depositHeld)],
      ['Total deductions', formatINR(settlement.totalDeductions)],
      [
        net.isNegative() ? 'Amount payable by tenant' : 'Refund due to tenant',
        formatINR(net.abs()),
      ],
      ['Deposit status', settlement.depositStatus],
    ]);

    footer(doc, `${orgName} · Generated ${toDateOnlyString(new Date())}`);
    return {
      buffer: await toBuffer(doc),
      fileName: `settlement-${slug(settlement.stay.tenant.fullName)}.pdf`,
    };
  }

  /**
   * Everything the property holds on one tenant, as a multi-sheet workbook.
   *
   * This is what leaves the app before their personal data is erased, so it
   * has to be complete on its own: profile, stays, room history, bills with
   * their lines, payments, deposits and E.B. shares.
   */
  async tenantArchiveXlsx(
    tenantId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    // This is the copy that leaves the app before the data is erased, so it
    // carries the full Aadhaar rather than the masked form shown on screen.
    // The route behind it requires the export permission.
    const tenant = await this.tenants.findOne(tenantId, { canSeeSensitive: true });
    const orgName = await this.settings.getString(SETTING_KEYS.ORG_NAME);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = orgName;
    workbook.created = new Date();

    const addSheet = (
      name: string,
      columns: Array<{ header: string; key: string; width: number }>,
      rows: Array<Record<string, unknown>>,
      moneyKeys: string[] = [],
    ): void => {
      const sheet = workbook.addWorksheet(name);
      sheet.columns = columns;
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      rows.forEach((row) => sheet.addRow(row));
      moneyKeys.forEach((key) => {
        sheet.getColumn(key).numFmt = '#,##0.00';
      });
    };

    addSheet(
      'Profile',
      [
        { header: 'Field', key: 'field', width: 26 },
        { header: 'Value', key: 'value', width: 52 },
      ],
      [
        { field: 'Full name', value: tenant.fullName },
        { field: 'Mobile', value: tenant.mobile ?? '' },
        { field: 'Emergency contact name', value: tenant.emergencyName ?? '' },
        { field: 'Emergency contact', value: tenant.emergencyContact ?? '' },
        { field: 'Permanent address', value: tenant.permanentAddress ?? '' },
        { field: 'Office / college', value: tenant.officeName ?? '' },
        { field: 'Office address', value: tenant.officeAddress ?? '' },
        { field: 'Aadhaar number', value: tenant.aadhaarNumber ?? '' },
        { field: 'Notes', value: tenant.notes ?? '' },
        ...tenant.customFieldValues.map((v) => ({
          field: v.definition.label,
          value: v.value,
        })),
        { field: 'Exported on', value: toDateOnlyString(new Date()) },
      ],
    );

    addSheet(
      'Stays',
      [
        { header: 'Check-in', key: 'checkIn', width: 14 },
        { header: 'Expected checkout', key: 'expected', width: 18 },
        { header: 'Actual checkout', key: 'actual', width: 16 },
        { header: 'Type', key: 'type', width: 12 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Deposit agreed', key: 'deposit', width: 16 },
      ],
      tenant.stays.map((stay) => ({
        checkIn: toDateOnlyString(stay.checkInDate),
        expected: stay.expectedCheckoutDate
          ? toDateOnlyString(stay.expectedCheckoutDate)
          : '',
        actual: stay.actualCheckoutDate
          ? toDateOnlyString(stay.actualCheckoutDate)
          : '',
        type: stay.stayType,
        status: stay.status,
        deposit: Number(money(stay.depositAmount).toFixed(2)),
      })),
      ['deposit'],
    );

    addSheet(
      'Room history',
      [
        { header: 'From', key: 'from', width: 14 },
        { header: 'To', key: 'to', width: 14 },
        { header: 'Branch', key: 'branch', width: 20 },
        { header: 'Floor', key: 'floor', width: 16 },
        { header: 'Room', key: 'room', width: 12 },
        { header: 'Bed', key: 'bed', width: 8 },
        { header: 'Reason', key: 'reason', width: 30 },
      ],
      tenant.stays.flatMap((stay) =>
        stay.assignments.map((a) => ({
          from: toDateOnlyString(a.startDate),
          to: a.endDate ? toDateOnlyString(a.endDate) : 'Current',
          branch: a.bed.room.floor.branch.name,
          floor: a.bed.room.floor.name,
          room: a.bed.room.name,
          bed: a.bed.label,
          reason: a.reason ?? '',
        })),
      ),
    );

    addSheet(
      'Bills',
      [
        { header: 'Number', key: 'number', width: 20 },
        { header: 'Period start', key: 'start', width: 14 },
        { header: 'Period end', key: 'end', width: 14 },
        { header: 'Charge', key: 'kind', width: 14 },
        { header: 'Description', key: 'description', width: 42 },
        { header: 'Amount', key: 'amount', width: 14 },
        { header: 'Bill total', key: 'total', width: 14 },
        { header: 'Paid', key: 'paid', width: 14 },
        { header: 'Status', key: 'status', width: 16 },
      ],
      tenant.stays.flatMap((stay) =>
        stay.invoices.flatMap((invoice) =>
          invoice.lines.map((line) => ({
            number: invoice.number,
            start: toDateOnlyString(invoice.periodStart),
            end: toDateOnlyString(invoice.periodEnd),
            kind: line.kind,
            description: line.description,
            amount: Number(money(line.amount).toFixed(2)),
            total: Number(money(invoice.totalAmount).toFixed(2)),
            paid: Number(money(invoice.paidAmount).toFixed(2)),
            status: invoice.status,
          })),
        ),
      ),
      ['amount', 'total', 'paid'],
    );

    addSheet(
      'Payments',
      [
        { header: 'Receipt', key: 'receipt', width: 20 },
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Method', key: 'method', width: 16 },
        { header: 'Cash', key: 'cash', width: 12 },
        { header: 'UPI', key: 'upi', width: 12 },
        { header: 'Amount', key: 'amount', width: 14 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Reference', key: 'reference', width: 22 },
      ],
      tenant.stays.flatMap((stay) =>
        stay.payments.map((p) => ({
          receipt: p.receiptNo,
          date: toDateOnlyString(p.paidAt),
          method: p.method,
          cash: Number(money(p.cashAmount).toFixed(2)),
          upi: Number(money(p.upiAmount).toFixed(2)),
          amount: Number(money(p.amount).toFixed(2)),
          status: p.reversedAt ? 'REVERSED' : p.status,
          reference: p.reference ?? '',
        })),
      ),
      ['cash', 'upi', 'amount'],
    );

    addSheet(
      'Deposits',
      [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Type', key: 'type', width: 24 },
        { header: 'Amount', key: 'amount', width: 14 },
        { header: 'Reason', key: 'reason', width: 40 },
      ],
      tenant.stays.flatMap((stay) =>
        stay.depositLedger.map((entry) => ({
          date: toDateOnlyString(entry.occurredAt),
          type: entry.type,
          amount: Number(money(entry.amount).toFixed(2)),
          reason: entry.reason ?? '',
        })),
      ),
      ['amount'],
    );

    addSheet(
      'Electricity',
      [
        { header: 'Period start', key: 'start', width: 14 },
        { header: 'Period end', key: 'end', width: 14 },
        { header: 'Days', key: 'days', width: 10 },
        { header: 'Units', key: 'units', width: 12 },
        { header: 'Rate', key: 'rate', width: 12 },
        { header: 'Amount', key: 'amount', width: 14 },
      ],
      tenant.stays.flatMap((stay) =>
        stay.ebCharges.map((c) => ({
          start: toDateOnlyString(c.cycle.periodStart),
          end: toDateOnlyString(c.cycle.periodEnd),
          days: c.occupiedDays,
          units: Number(money(c.units).toFixed(2)),
          rate: Number(money(c.cycle.ratePerUnit).toFixed(2)),
          amount: Number(money(c.amount).toFixed(2)),
        })),
      ),
      ['units', 'rate', 'amount'],
    );

    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    return {
      buffer: Buffer.from(buffer),
      fileName: `${slug(tenant.fullName)}-full-record.xlsx`,
    };
  }

  // --- Spreadsheet and CSV ----------------------------------------------

  /** Tenant register as a real .xlsx workbook. */
  async tenantsXlsx(branchId?: string): Promise<{ buffer: Buffer; fileName: string }> {
    const today = dayStart(new Date());
    const stays = await this.prisma.stay.findMany({
      where: {
        status: { in: [StayStatus.ACTIVE, StayStatus.NOTICE_GIVEN] },
        ...(branchId
          ? { assignments: { some: { endDate: null, bed: { room: { floor: { branchId } } } } } }
          : {}),
      },
      include: {
        tenant: true,
        assignments: {
          where: { endDate: null },
          take: 1,
          include: { bed: { include: { room: { include: { floor: { include: { branch: true } } } } } } },
        },
        foodPeriods: {
          where: { effectiveTo: null },
          take: 1,
          orderBy: { effectiveFrom: 'desc' },
        },
        invoices: true,
        depositLedger: true,
      },
      orderBy: { tenant: { fullName: 'asc' } },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PG Management';
    workbook.created = today;
    const sheet = workbook.addWorksheet('Tenants');

    sheet.columns = [
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Mobile', key: 'mobile', width: 16 },
      { header: 'Branch', key: 'branch', width: 18 },
      { header: 'Floor', key: 'floor', width: 14 },
      { header: 'Room', key: 'room', width: 12 },
      { header: 'Bed', key: 'bed', width: 8 },
      { header: 'Sharing', key: 'sharing', width: 14 },
      { header: 'Stay type', key: 'stayType', width: 12 },
      { header: 'Food', key: 'food', width: 10 },
      { header: 'Check-in', key: 'checkIn', width: 14 },
      { header: 'Expected checkout', key: 'checkout', width: 18 },
      { header: 'Billed', key: 'billed', width: 14 },
      { header: 'Paid', key: 'paid', width: 14 },
      { header: 'Balance', key: 'balance', width: 14 },
      { header: 'Deposit held', key: 'deposit', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const stay of stays) {
      const room = stay.assignments[0]?.bed.room;
      const billed = sum(stay.invoices.map((i) => i.totalAmount));
      const paid = sum(stay.invoices.map((i) => i.paidAmount));

      sheet.addRow({
        name: stay.tenant.fullName,
        mobile: stay.tenant.mobile ?? '',
        branch: room?.floor.branch.name ?? '',
        floor: room?.floor.name ?? '',
        room: room?.name ?? '',
        bed: stay.assignments[0]?.bed.label ?? '',
        sharing: room ? `${room.capacity} sharing ${room.acType === 'AC' ? 'AC' : 'Non-AC'}` : '',
        stayType: stay.stayType,
        food: stay.foodPeriods[0]?.foodIncluded ? 'Yes' : 'No',
        checkIn: toDateOnlyString(stay.checkInDate),
        checkout: stay.expectedCheckoutDate
          ? toDateOnlyString(stay.expectedCheckoutDate)
          : '',
        billed: Number(billed.toFixed(2)),
        paid: Number(paid.toFixed(2)),
        balance: Number(billed.minus(paid).toFixed(2)),
        deposit: Number(sum(stay.depositLedger.map((d) => d.amount)).toFixed(2)),
      });
    }

    ['billed', 'paid', 'balance', 'deposit'].forEach((key) => {
      sheet.getColumn(key).numFmt = '#,##0.00';
    });

    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    return { buffer: Buffer.from(buffer), fileName: `tenants-${toDateOnlyString(today)}.xlsx` };
  }

  /** Collections workbook for an accountant. */
  async collectionsXlsx(
    from: Date,
    to: Date,
    branchId?: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const [payments, report] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          paidAt: { gte: dayStart(from), lte: dayStart(to) },
          // An accountant's collections sheet lists approved money only.
          status: PaymentStatus.VERIFIED,
          ...(branchId
            ? {
                stay: {
                  assignments: { some: { bed: { room: { floor: { branchId } } } } },
                },
              }
            : {}),
        },
        orderBy: { paidAt: 'asc' },
        include: {
          stay: {
            include: {
              tenant: true,
              assignments: {
                where: { endDate: null },
                take: 1,
                include: { bed: { include: { room: { include: { floor: { include: { branch: true } } } } } } },
              },
            },
          },
          allocations: { include: { invoice: { select: { number: true } } } },
        },
      }),
      this.reports.collections(from, to, branchId),
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PG Management';

    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
      { header: 'Measure', key: 'measure', width: 28 },
      { header: 'Value', key: 'value', width: 18 },
    ];
    summary.getRow(1).font = { bold: true };
    summary.addRows([
      { measure: 'Period start', value: toDateOnlyString(dayStart(from)) },
      { measure: 'Period end', value: toDateOnlyString(dayStart(to)) },
      { measure: 'Billed', value: Number(report.billed) },
      { measure: 'Collected', value: Number(report.collected) },
      { measure: 'Outstanding', value: Number(report.outstanding) },
      { measure: 'Expenses', value: Number(report.expenses) },
      { measure: 'Net', value: Number(report.net) },
    ]);

    const sheet = workbook.addWorksheet('Payments');
    sheet.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Receipt', key: 'receipt', width: 18 },
      { header: 'Tenant', key: 'tenant', width: 26 },
      { header: 'Branch', key: 'branch', width: 18 },
      { header: 'Room', key: 'room', width: 12 },
      { header: 'Method', key: 'method', width: 14 },
      { header: 'Amount', key: 'amount', width: 14 },
      { header: 'Applied to', key: 'applied', width: 30 },
      { header: 'Reference', key: 'reference', width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const payment of payments) {
      const room = payment.stay.assignments[0]?.bed.room;
      sheet.addRow({
        date: toDateOnlyString(payment.paidAt),
        receipt: payment.receiptNo,
        tenant: payment.stay.tenant.fullName,
        branch: room?.floor.branch.name ?? '',
        room: room?.name ?? '',
        method: payment.method,
        amount: Number(money(payment.amount).toFixed(2)),
        applied: payment.allocations.map((a) => a.invoice.number).join(', '),
        reference: payment.reference ?? '',
      });
    }
    sheet.getColumn('amount').numFmt = '#,##0.00';

    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    return {
      buffer: Buffer.from(buffer),
      fileName: `collections-${toDateOnlyString(dayStart(from))}-to-${toDateOnlyString(
        dayStart(to),
      )}.xlsx`,
    };
  }

  /** Generic CSV for anything the app lists. */
  toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
    if (rows.length === 0) return '';
    const headers = columns ?? Object.keys(rows[0]);
    const escape = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      const text = value instanceof Date ? toDateOnlyString(value) : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
    ].join('\n');
  }

  async paymentsCsv(from: Date, to: Date, branchId?: string): Promise<string> {
    const result = await this.payments.listPayments({
      from: dayStart(from),
      to: dayStart(to),
      branchId,
      pageSize: 200,
    });
    return this.toCsv(
      result.items.map((p) => ({
        date: toDateOnlyString(p.paidAt),
        receipt: p.receiptNo,
        tenant: p.stay.tenant.fullName,
        method: p.method,
        amount: money(p.amount).toFixed(2),
        reference: p.reference ?? '',
        reversed: p.reversedAt ? 'Yes' : 'No',
      })),
    );
  }
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
