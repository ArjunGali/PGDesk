import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DepositStatus,
  InvoiceStatus,
  NotificationKind,
  NotificationSeverity,
  SettlementStatus,
  StayStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { addDaysTo, dayStart, inclusiveDays } from '../../common/utils/dates';
import { money, sum } from '../../common/utils/money';
import { SETTING_KEYS } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';

/**
 * Everything behind the bell icon.
 *
 * Home deliberately stays clean: pending payments, incomplete profiles and
 * upcoming checkouts are surfaced here instead of being duplicated on the
 * overview. Each condition has a stable dedupe key, so a recurring situation
 * updates one row rather than producing a new alert every night.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async list(options: { unreadOnly?: boolean; limit?: number } = {}) {
    const items = await this.prisma.notification.findMany({
      where: {
        resolvedAt: null,
        readAt: options.unreadOnly ? null : undefined,
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: options.limit ?? 100,
      include: { tenant: { select: { id: true, fullName: true } } },
    });

    const unreadCount = await this.prisma.notification.count({
      where: { resolvedAt: null, readAt: null },
    });

    const byKind = new Map<NotificationKind, number>();
    for (const item of items) {
      byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
    }

    return {
      items,
      unreadCount,
      counts: Object.fromEntries(byKind.entries()),
    };
  }

  async markRead(ids: string[]) {
    await this.prisma.notification.updateMany({
      where: { id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async markAllRead() {
    await this.prisma.notification.updateMany({
      where: { readAt: null, resolvedAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  /** Runs nightly, and on demand from the bell's refresh action. */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async refreshAll(): Promise<{ generated: number; resolved: number }> {
    const seen = new Set<string>();
    let generated = 0;

    generated += await this.refreshPaymentPending(seen);
    generated += await this.refreshIncompleteProfiles(seen);
    generated += await this.refreshUpcomingCheckouts(seen);
    generated += await this.refreshNoticeExpiring(seen);
    generated += await this.refreshDepositRefunds(seen);

    // Anything previously raised that no longer holds is resolved, so the bell
    // reflects reality instead of accumulating stale alerts.
    const stale = await this.prisma.notification.updateMany({
      where: {
        resolvedAt: null,
        dedupeKey: { notIn: [...seen] },
        kind: {
          in: [
            NotificationKind.PAYMENT_PENDING,
            NotificationKind.INCOMPLETE_PROFILE,
            NotificationKind.UPCOMING_CHECKOUT,
            NotificationKind.NOTICE_EXPIRING,
            NotificationKind.DEPOSIT_REFUND_PENDING,
          ],
        },
      },
      data: { resolvedAt: new Date() },
    });

    this.logger.log(
      `Notifications refreshed: ${generated} active, ${stale.count} resolved`,
    );
    return { generated, resolved: stale.count };
  }

  private async upsert(input: {
    dedupeKey: string;
    kind: NotificationKind;
    severity: NotificationSeverity;
    title: string;
    body?: string;
    tenantId?: string | null;
    stayId?: string | null;
    branchId?: string | null;
    actionPath?: string | null;
  }): Promise<void> {
    await this.prisma.notification.upsert({
      where: { dedupeKey: input.dedupeKey },
      create: {
        dedupeKey: input.dedupeKey,
        kind: input.kind,
        severity: input.severity,
        title: input.title,
        body: input.body,
        tenantId: input.tenantId ?? null,
        stayId: input.stayId ?? null,
        branchId: input.branchId ?? null,
        actionPath: input.actionPath ?? null,
      },
      update: {
        severity: input.severity,
        title: input.title,
        body: input.body,
        actionPath: input.actionPath ?? null,
        resolvedAt: null,
      },
    });
  }

  private async refreshPaymentPending(seen: Set<string>): Promise<number> {
    const graceDays = await this.settings.getInt(
      SETTING_KEYS.NOTIFY_PAYMENT_GRACE_DAYS,
    );
    const cutoff = addDaysTo(dayStart(new Date()), -graceDays);

    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
        dueDate: { lte: cutoff },
      },
      include: {
        stay: {
          include: {
            tenant: { select: { id: true, fullName: true } },
            assignments: {
              where: { endDate: null },
              take: 1,
              include: { bed: { include: { room: { include: { floor: true } } } } },
            },
          },
        },
      },
    });

    const byStay = new Map<string, typeof invoices>();
    for (const invoice of invoices) {
      const list = byStay.get(invoice.stayId) ?? [];
      list.push(invoice);
      byStay.set(invoice.stayId, list);
    }

    let count = 0;
    for (const [stayId, list] of byStay) {
      const balance = sum(
        list.map((i) => money(i.totalAmount).minus(money(i.paidAmount))),
      );
      if (balance.lessThanOrEqualTo(0)) continue;

      const first = list[0];
      const oldestDue = list.reduce(
        (min, i) => (i.dueDate < min ? i.dueDate : min),
        list[0].dueDate,
      );
      const daysOverdue = inclusiveDays(oldestDue, new Date()) - 1;
      const room = first.stay.assignments[0]?.bed.room;
      const key = `payment_pending:${stayId}`;

      await this.upsert({
        dedupeKey: key,
        kind: NotificationKind.PAYMENT_PENDING,
        severity:
          daysOverdue > 15
            ? NotificationSeverity.CRITICAL
            : NotificationSeverity.WARNING,
        title: `${first.stay.tenant.fullName} — ₹${balance.toFixed(2)} pending`,
        body: `${list.length} bill${list.length === 1 ? '' : 's'} outstanding${
          daysOverdue > 0 ? `, oldest ${daysOverdue} day(s) overdue` : ''
        }${room ? ` · Room ${room.name}` : ''}`,
        tenantId: first.stay.tenantId,
        stayId,
        branchId: room?.floor.branchId ?? null,
        actionPath: `/tenants/${first.stay.tenantId}`,
      });
      seen.add(key);
      count += 1;
    }
    return count;
  }

  private async refreshIncompleteProfiles(seen: Set<string>): Promise<number> {
    const requiredFieldsRaw = await this.settings.getString(
      SETTING_KEYS.TENANT_REQUIRED_FIELDS,
    );
    let requiredFields: string[] = [];
    try {
      const parsed: unknown = JSON.parse(requiredFieldsRaw);
      if (Array.isArray(parsed)) requiredFields = parsed.map(String);
    } catch {
      requiredFields = [];
    }

    const [requiredDocs, tenants] = await Promise.all([
      this.prisma.documentType.findMany({ where: { required: true, isActive: true } }),
      this.prisma.tenant.findMany({
        where: {
          archivedAt: null,
          stays: {
            some: { status: { in: [StayStatus.ACTIVE, StayStatus.NOTICE_GIVEN] } },
          },
        },
        include: { documents: { select: { documentTypeId: true } } },
      }),
    ]);

    let count = 0;
    for (const tenant of tenants) {
      const missingFields = requiredFields.filter((field) => {
        const value = (tenant as unknown as Record<string, unknown>)[field];
        return value === null || value === undefined || value === '';
      });
      const providedDocs = new Set(tenant.documents.map((d) => d.documentTypeId));
      const missingDocs = requiredDocs.filter((d) => !providedDocs.has(d.id));

      if (missingFields.length === 0 && missingDocs.length === 0) continue;

      const missing = [
        ...missingFields.map((f) => humanise(f)),
        ...missingDocs.map((d) => d.name),
      ];
      const key = `incomplete_profile:${tenant.id}`;

      await this.upsert({
        dedupeKey: key,
        kind: NotificationKind.INCOMPLETE_PROFILE,
        severity: NotificationSeverity.INFO,
        title: `${tenant.fullName} — incomplete profile`,
        body: `Missing: ${missing.join(', ')}`,
        tenantId: tenant.id,
        actionPath: `/tenants/${tenant.id}?complete=1`,
      });
      seen.add(key);
      count += 1;
    }
    return count;
  }

  private async refreshUpcomingCheckouts(seen: Set<string>): Promise<number> {
    const days = await this.settings.getInt(
      SETTING_KEYS.NOTIFY_UPCOMING_CHECKOUT_DAYS,
    );
    const today = dayStart(new Date());
    const horizon = addDaysTo(today, days);

    const stays = await this.prisma.stay.findMany({
      where: {
        status: { in: [StayStatus.ACTIVE, StayStatus.NOTICE_GIVEN] },
        expectedCheckoutDate: { gte: today, lte: horizon },
      },
      include: {
        tenant: { select: { id: true, fullName: true } },
        assignments: {
          where: { endDate: null },
          take: 1,
          include: { bed: { include: { room: { include: { floor: true } } } } },
        },
      },
    });

    let count = 0;
    for (const stay of stays) {
      const room = stay.assignments[0]?.bed.room;
      const daysLeft = inclusiveDays(today, stay.expectedCheckoutDate!) - 1;
      const key = `upcoming_checkout:${stay.id}`;

      await this.upsert({
        dedupeKey: key,
        kind: NotificationKind.UPCOMING_CHECKOUT,
        severity:
          daysLeft <= 2 ? NotificationSeverity.WARNING : NotificationSeverity.INFO,
        title: `${stay.tenant.fullName} checks out in ${daysLeft} day${
          daysLeft === 1 ? '' : 's'
        }`,
        body: room
          ? `Room ${room.name}, bed ${stay.assignments[0].bed.label}`
          : undefined,
        tenantId: stay.tenantId,
        stayId: stay.id,
        branchId: room?.floor.branchId ?? null,
        actionPath: `/tenants/${stay.tenantId}`,
      });
      seen.add(key);
      count += 1;
    }
    return count;
  }

  private async refreshNoticeExpiring(seen: Set<string>): Promise<number> {
    const warnDays = await this.settings.getInt(
      SETTING_KEYS.NOTIFY_NOTICE_EXPIRY_DAYS,
    );
    const today = dayStart(new Date());
    const horizon = addDaysTo(today, warnDays);

    const notices = await this.prisma.vacateNotice.findMany({
      where: {
        requiredUntilDate: { gte: today, lte: horizon },
        stay: { status: StayStatus.NOTICE_GIVEN },
      },
      include: { stay: { include: { tenant: { select: { id: true, fullName: true } } } } },
    });

    let count = 0;
    for (const notice of notices) {
      const key = `notice_expiring:${notice.stayId}`;
      await this.upsert({
        dedupeKey: key,
        kind: NotificationKind.NOTICE_EXPIRING,
        severity: NotificationSeverity.INFO,
        title: `${notice.stay.tenant.fullName} — notice period ends soon`,
        body: `Notice period runs to ${notice.requiredUntilDate.toDateString()}${
          notice.shortfallDays > 0
            ? `; leaving ${notice.shortfallDays} day(s) early`
            : ''
        }`,
        tenantId: notice.stay.tenantId,
        stayId: notice.stayId,
        actionPath: `/tenants/${notice.stay.tenantId}`,
      });
      seen.add(key);
      count += 1;
    }
    return count;
  }

  private async refreshDepositRefunds(seen: Set<string>): Promise<number> {
    const settlements = await this.prisma.settlement.findMany({
      where: {
        status: SettlementStatus.FINALISED,
        depositStatus: {
          in: [DepositStatus.REFUND_PENDING, DepositStatus.PARTIALLY_REFUNDED],
        },
      },
      include: {
        stay: {
          include: {
            tenant: { select: { id: true, fullName: true } },
            depositLedger: true,
          },
        },
      },
    });

    let count = 0;
    for (const settlement of settlements) {
      const held = sum(settlement.stay.depositLedger.map((e) => e.amount));
      if (held.lessThanOrEqualTo(0)) continue;

      const key = `deposit_refund:${settlement.stayId}`;
      await this.upsert({
        dedupeKey: key,
        kind: NotificationKind.DEPOSIT_REFUND_PENDING,
        severity: NotificationSeverity.WARNING,
        title: `Refund ₹${held.toFixed(2)} to ${settlement.stay.tenant.fullName}`,
        body: `Checked out on ${settlement.checkoutDate.toDateString()}`,
        tenantId: settlement.stay.tenantId,
        stayId: settlement.stayId,
        actionPath: `/tenants/${settlement.stay.tenantId}`,
      });
      seen.add(key);
      count += 1;
    }
    return count;
  }
}

function humanise(field: string): string {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
