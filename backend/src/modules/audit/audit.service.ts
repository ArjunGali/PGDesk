import { Injectable, Logger } from '@nestjs/common';
import { Db, PrismaService } from '../../common/prisma/prisma.service';

export interface AuditRecordInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  /** Pass the transaction client so the audit row commits with the change. */
  tx?: Db;
}

/**
 * Append-only audit trail. Every operation that moves money, changes
 * permissions, or rewrites occupancy calls this.
 *
 * Auditing never throws into the caller: losing an audit line is bad, but
 * failing a rent payment because the audit insert hiccuped is worse. Failures
 * outside a transaction are logged loudly instead.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<void> {
    const db = input.tx ?? this.prisma;
    const data = {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: serialise(input.before),
      after: serialise(input.after),
      reason: input.reason ?? null,
      ipAddress: input.ipAddress ?? null,
    };

    if (input.tx) {
      // Inside a transaction the audit row is part of the atomic unit; if it
      // fails the whole operation should fail.
      await db.auditLog.create({ data });
      return;
    }

    try {
      await this.prisma.auditLog.create({ data });
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry for ${input.action} on ${input.entityType}:${input.entityId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async list(params: {
    entityType?: string;
    entityId?: string;
    actorId?: string;
    action?: string;
    from?: Date;
    to?: Date;
    skip?: number;
    take?: number;
  }) {
    const where = {
      entityType: params.entityType,
      entityId: params.entityId,
      actorId: params.actorId,
      action: params.action ? { contains: params.action } : undefined,
      createdAt:
        params.from || params.to
          ? { gte: params.from, lte: params.to }
          : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take: params.take ?? 50,
        include: { actor: { select: { id: true, fullName: true, username: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }
}

function serialise(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value, (_key, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
  } catch {
    return String(value);
  }
}
