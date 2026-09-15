import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StayStatus } from '@prisma/client';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { dayStart } from '../../common/utils/dates';
import { SETTING_KEYS } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import type {
  CreateCustomFieldDto,
  CreateTenantDto,
  TenantQueryDto,
  UpdateTenantDto,
} from './dto';

export interface ProfileCompleteness {
  complete: boolean;
  missingFields: Array<{ key: string; label: string }>;
  missingDocuments: Array<{ key: string; name: string }>;
}

/** Stay statuses that count as "currently living here". */
const OPEN_STAY_STATUSES: StayStatus[] = [
  StayStatus.ACTIVE,
  StayStatus.NOTICE_GIVEN,
];

const BASIC_FIELD_LABELS: Record<string, string> = {
  fullName: 'Full name',
  mobile: 'Mobile number',
  emergencyContact: 'Emergency contact',
  emergencyName: 'Emergency contact name',
  permanentAddress: 'Permanent address',
  officeAddress: 'Office address',
  officeName: 'Office / college name',
  photoDocumentId: 'Profile photo',
};

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  // --- Tenants -----------------------------------------------------------

  async list(query: TenantQueryDto, branchScope: string[] = []) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 200);
    const today = dayStart(new Date());

    const where: Prisma.TenantWhereInput = {
      archivedAt: null,
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { mobile: { contains: query.search } },
              { officeName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.status === 'active'
        ? { stays: { some: { status: { in: [StayStatus.ACTIVE, StayStatus.NOTICE_GIVEN] } } } }
        : {}),
      ...(query.status === 'past'
        ? { stays: { every: { status: { in: [StayStatus.VACATED, StayStatus.CANCELLED] } } } }
        : {}),
      ...(query.branchId || branchScope.length
        ? {
            stays: {
              some: {
                assignments: {
                  some: {
                    endDate: null,
                    bed: {
                      room: {
                        floor: {
                          branchId: query.branchId
                            ? query.branchId
                            : { in: branchScope },
                        },
                      },
                    },
                  },
                },
              },
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy: { fullName: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          stays: {
            where: { status: { in: [StayStatus.ACTIVE, StayStatus.NOTICE_GIVEN] } },
            orderBy: { checkInDate: 'desc' },
            take: 1,
            include: {
              assignments: {
                where: {
                  startDate: { lte: today },
                  OR: [{ endDate: null }, { endDate: { gte: today } }],
                },
                take: 1,
                include: {
                  bed: {
                    include: {
                      room: { include: { floor: { include: { branch: true } } } },
                    },
                  },
                },
              },
              foodPeriods: {
                where: {
                  effectiveFrom: { lte: today },
                  OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
                },
                take: 1,
                orderBy: { effectiveFrom: 'desc' },
              },
            },
          },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    const items = await Promise.all(
      rows.map(async (tenant) => {
        const stay = tenant.stays[0];
        const assignment = stay?.assignments[0];
        const completeness = await this.profileCompleteness(tenant.id);
        return {
          id: tenant.id,
          fullName: tenant.fullName,
          mobile: tenant.mobile,
          photoDocumentId: tenant.photoDocumentId,
          profileComplete: completeness.complete,
          missingCount:
            completeness.missingFields.length + completeness.missingDocuments.length,
          stay: stay
            ? {
                id: stay.id,
                status: stay.status,
                stayType: stay.stayType,
                checkInDate: stay.checkInDate,
                expectedCheckoutDate: stay.expectedCheckoutDate,
                foodIncluded: stay.foodPeriods[0]?.foodIncluded ?? false,
              }
            : null,
          location: assignment
            ? {
                branchId: assignment.bed.room.floor.branchId,
                branchName: assignment.bed.room.floor.branch.name,
                floorName: assignment.bed.room.floor.name,
                roomId: assignment.bed.room.id,
                roomName: assignment.bed.room.name,
                bedId: assignment.bedId,
                bedLabel: assignment.bed.label,
              }
            : null,
        };
      }),
    );

    const filtered = query.incompleteOnly === 'true'
      ? items.filter((i) => !i.profileComplete)
      : items;

    return {
      items: filtered,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Everything the tenant detail screen shows, in one call. */
  async findOne(id: string, options: { canSeeSensitive?: boolean } = {}) {
    const today = dayStart(new Date());
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        customFieldValues: { include: { definition: true } },
        documents: {
          include: { documentType: true },
          orderBy: { uploadedAt: 'desc' },
        },
        stays: {
          orderBy: { checkInDate: 'desc' },
          include: {
            assignments: {
              orderBy: { startDate: 'desc' },
              include: {
                bed: {
                  include: {
                    room: { include: { floor: { include: { branch: true } } } },
                  },
                },
              },
            },
            foodPeriods: { orderBy: { effectiveFrom: 'desc' } },
            pricingRules: { orderBy: { effectiveFrom: 'desc' } },
            invoices: {
              orderBy: { periodStart: 'desc' },
              include: { lines: true },
            },
            payments: { orderBy: { paidAt: 'desc' } },
            depositLedger: { orderBy: { occurredAt: 'desc' } },
            ebCharges: {
              orderBy: { createdAt: 'desc' },
              include: { cycle: true },
            },
            notice: true,
            settlement: { include: { lines: true } },
          },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const completeness = await this.profileCompleteness(id);
    const currentStay =
      tenant.stays.find((s) => OPEN_STAY_STATUSES.includes(s.status)) ?? null;
    const currentAssignment =
      currentStay?.assignments.find(
        (a) => a.startDate <= today && (!a.endDate || a.endDate >= today),
      ) ?? null;

    return {
      ...tenant,
      // Masked unless the viewer is permitted to see it in full.
      aadhaarNumber: maskAadhaar(tenant.aadhaarNumber, options.canSeeSensitive),
      completeness,
      currentStayId: currentStay?.id ?? null,
      currentLocation: currentAssignment
        ? {
            branchId: currentAssignment.bed.room.floor.branchId,
            branchName: currentAssignment.bed.room.floor.branch.name,
            floorId: currentAssignment.bed.room.floorId,
            floorName: currentAssignment.bed.room.floor.name,
            roomId: currentAssignment.bed.roomId,
            roomName: currentAssignment.bed.room.name,
            capacity: currentAssignment.bed.room.capacity,
            acType: currentAssignment.bed.room.acType,
            bedId: currentAssignment.bedId,
            bedLabel: currentAssignment.bed.label,
          }
        : null,
    };
  }

  async create(dto: CreateTenantDto) {
    const { customFields, ...rest } = dto;
    return this.prisma.runInTransaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: rest });
      if (customFields) await this.writeCustomFields(tx, tenant.id, customFields);
      return tenant;
    });
  }

  async update(id: string, dto: UpdateTenantDto) {
    const { customFields, ...rest } = dto;
    return this.prisma.runInTransaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id },
        data: rest,
      });
      if (customFields) await this.writeCustomFields(tx, id, customFields);
      return tenant;
    });
  }

  /**
   * Archives rather than deletes. Permanent erasure goes through the export
   * flow in the exports module so records are never lost by accident.
   */
  async archive(id: string) {
    return this.prisma.tenant.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  private async writeCustomFields(
    tx: Db,
    tenantId: string,
    values: Record<string, string>,
  ): Promise<void> {
    const keys = Object.keys(values);
    if (keys.length === 0) return;
    const definitions = await tx.customFieldDefinition.findMany({
      where: { key: { in: keys } },
    });
    for (const definition of definitions) {
      const value = values[definition.key];
      if (value === undefined || value === '') {
        await tx.customFieldValue.deleteMany({
          where: { definitionId: definition.id, tenantId },
        });
        continue;
      }
      await tx.customFieldValue.upsert({
        where: {
          definitionId_tenantId: { definitionId: definition.id, tenantId },
        },
        create: { definitionId: definition.id, tenantId, value },
        update: { value },
      });
    }
  }

  /**
   * A profile is never blocked from being saved — this only decides whether it
   * gets flagged as incomplete under the bell.
   */
  async profileCompleteness(tenantId: string): Promise<ProfileCompleteness> {
    const [tenant, requiredFieldsRaw, requiredCustom, requiredDocTypes] =
      await Promise.all([
        this.prisma.tenant.findUnique({
          where: { id: tenantId },
          include: {
            customFieldValues: true,
            documents: true,
          },
        }),
        this.settings.getString(SETTING_KEYS.TENANT_REQUIRED_FIELDS),
        this.prisma.customFieldDefinition.findMany({
          where: { required: true, isActive: true },
        }),
        this.prisma.documentType.findMany({
          where: { required: true, isActive: true },
        }),
      ]);

    if (!tenant) throw new NotFoundException('Tenant not found');

    let requiredFields: string[] = [];
    try {
      const parsed: unknown = JSON.parse(requiredFieldsRaw);
      if (Array.isArray(parsed)) requiredFields = parsed.map(String);
    } catch {
      requiredFields = [];
    }

    const missingFields = requiredFields
      .filter((field) => {
        const value = (tenant as unknown as Record<string, unknown>)[field];
        return value === null || value === undefined || value === '';
      })
      .map((key) => ({ key, label: BASIC_FIELD_LABELS[key] ?? key }));

    const providedCustom = new Set(
      tenant.customFieldValues.filter((v) => v.value !== '').map((v) => v.definitionId),
    );
    for (const definition of requiredCustom) {
      if (!providedCustom.has(definition.id)) {
        missingFields.push({ key: definition.key, label: definition.label });
      }
    }

    const providedDocs = new Set(tenant.documents.map((d) => d.documentTypeId));
    const missingDocuments = requiredDocTypes
      .filter((t) => !providedDocs.has(t.id))
      .map((t) => ({ key: t.key, name: t.name }));

    return {
      complete: missingFields.length === 0 && missingDocuments.length === 0,
      missingFields,
      missingDocuments,
    };
  }

  // --- Custom field definitions -----------------------------------------

  listCustomFields() {
    return this.prisma.customFieldDefinition.findMany({
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  createCustomField(dto: CreateCustomFieldDto) {
    return this.prisma.customFieldDefinition.create({
      data: {
        key: dto.key,
        label: dto.label,
        type: dto.type,
        options: dto.options ? JSON.stringify(dto.options) : null,
        required: dto.required ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateCustomField(id: string, dto: Partial<CreateCustomFieldDto> & { isActive?: boolean }) {
    return this.prisma.customFieldDefinition.update({
      where: { id },
      data: {
        label: dto.label,
        type: dto.type,
        options: dto.options ? JSON.stringify(dto.options) : undefined,
        required: dto.required,
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      },
    });
  }

  /**
   * Global search behind the magnifier icon.
   *
   * Aadhaar is searchable because staff often have only the document in hand,
   * but it is matched on digits alone and never returned in full unless the
   * viewer holds the sensitive-data permission.
   */
  async search(
    term: string,
    branchScope: string[] = [],
    options: { canSeeSensitive?: boolean } = {},
  ) {
    if (!term || term.trim().length < 2) {
      return { tenants: [], rooms: [], branches: [] };
    }
    const q = term.trim();
    const digits = q.replace(/\D/g, '');
    const today = dayStart(new Date());

    const [tenants, rooms, branches] = await Promise.all([
      this.prisma.tenant.findMany({
        where: {
          archivedAt: null,
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { mobile: { contains: q } },
            { officeName: { contains: q, mode: 'insensitive' } },
            // Only treat it as an Aadhaar lookup once enough digits are given
            // to be a deliberate search rather than an accidental match.
            ...(digits.length >= 4 ? [{ aadhaarNumber: { contains: digits } }] : []),
          ],
        },
        take: 15,
        select: {
          id: true,
          fullName: true,
          mobile: true,
          aadhaarNumber: true,
          stays: {
            where: { status: { in: [StayStatus.ACTIVE, StayStatus.NOTICE_GIVEN] } },
            take: 1,
            orderBy: { checkInDate: 'desc' },
            select: {
              id: true,
              assignments: {
                where: {
                  startDate: { lte: today },
                  OR: [{ endDate: null }, { endDate: { gte: today } }],
                },
                take: 1,
                select: {
                  bed: {
                    select: {
                      label: true,
                      room: {
                        select: {
                          name: true,
                          floor: {
                            select: { name: true, branch: { select: { name: true } } },
                          },
                        },
                      },
                    },
                  },
                },
              },
              invoices: {
                where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
                select: { totalAmount: true, paidAmount: true },
              },
            },
          },
        },
      }),
      this.prisma.room.findMany({
        where: {
          isActive: true,
          name: { contains: q, mode: 'insensitive' },
          floor: {
            branch: branchScope.length ? { id: { in: branchScope } } : undefined,
          },
        },
        take: 15,
        include: { floor: { include: { branch: true } } },
      }),
      this.prisma.branch.findMany({
        where: {
          name: { contains: q, mode: 'insensitive' },
          id: branchScope.length ? { in: branchScope } : undefined,
        },
        take: 10,
        select: { id: true, name: true },
      }),
    ]);

    return {
      tenants: tenants.map((tenant) => {
        const stay = tenant.stays[0];
        const assignment = stay?.assignments[0];
        const outstanding = (stay?.invoices ?? []).reduce(
          (total, invoice) =>
            total + Number(invoice.totalAmount) - Number(invoice.paidAmount),
          0,
        );

        return {
          id: tenant.id,
          fullName: tenant.fullName,
          mobile: tenant.mobile,
          aadhaarNumber: maskAadhaar(tenant.aadhaarNumber, options.canSeeSensitive),
          branchName: assignment?.bed.room.floor.branch.name ?? null,
          floorName: assignment?.bed.room.floor.name ?? null,
          roomName: assignment?.bed.room.name ?? null,
          bedLabel: assignment?.bed.label ?? null,
          paymentStatus:
            !stay ? 'No active stay' : outstanding > 0.005 ? 'Pending' : 'Up to date',
          outstanding: outstanding > 0.005 ? outstanding.toFixed(2) : '0.00',
        };
      }),
      rooms: rooms.map((r) => ({
        id: r.id,
        name: r.name,
        floorName: r.floor.name,
        branchName: r.floor.branch.name,
        branchId: r.floor.branchId,
      })),
      branches,
    };
  }
}

/**
 * Aadhaar is shown as its last four digits unless the viewer is permitted to
 * see it in full. A number on a search result is enough for staff to confirm
 * they have the right person without putting it on every screen.
 */
export function maskAadhaar(
  value: string | null,
  canSeeSensitive = false,
): string | null {
  if (!value) return null;
  if (canSeeSensitive) return value;
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '••••';
  return `•••• •••• ${digits.slice(-4)}`;
}
