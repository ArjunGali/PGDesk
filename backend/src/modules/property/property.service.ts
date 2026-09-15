import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AcType, BranchStatus, Prisma, StayStatus } from '@prisma/client';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { addDaysTo, dayStart } from '../../common/utils/dates';
import type {
  CreateBranchDto,
  CreateFloorDto,
  CreateRoomDto,
  UpdateBranchDto,
  UpdateFloorDto,
  UpdateRoomDto,
  VacancyQueryDto,
} from './dto';

export interface BedOccupancy {
  bedId: string;
  bedLabel: string;
  occupied: boolean;
  stayId?: string;
  tenantId?: string;
  tenantName?: string;
  /** Set when the occupant has given notice or has a known checkout date. */
  vacatingOn?: Date | null;
}

@Injectable()
export class PropertyService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Branches ----------------------------------------------------------

  async listBranches(includeArchived = false, branchScope: string[] = []) {
    return this.prisma.branch.findMany({
      where: {
        status: includeArchived
          ? undefined
          : { in: [BranchStatus.ACTIVE, BranchStatus.DISABLED] },
        id: branchScope.length ? { in: branchScope } : undefined,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async getBranch(id: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      include: {
        floors: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            floorType: true,
            rooms: {
              where: { isActive: true },
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
              include: { beds: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
            },
          },
        },
      },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  createBranch(dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: { ...dto } });
  }

  async updateBranch(id: string, dto: UpdateBranchDto) {
    await this.assertBranchExists(id);
    if (dto.status === BranchStatus.ARCHIVED) {
      const active = await this.prisma.stay.count({
        where: {
          status: { in: [StayStatus.ACTIVE, StayStatus.NOTICE_GIVEN] },
          assignments: {
            some: {
              endDate: null,
              bed: { room: { floor: { branchId: id } } },
            },
          },
        },
      });
      if (active > 0) {
        throw new BadRequestException(
          `This branch still has ${active} tenant(s) staying. Vacate or move them before archiving.`,
        );
      }
    }
    return this.prisma.branch.update({ where: { id }, data: { ...dto } });
  }

  // --- Floor types -------------------------------------------------------

  listFloorTypes() {
    return this.prisma.floorType.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  createFloorType(dto: { key: string; name: string; sortOrder?: number }) {
    return this.prisma.floorType.create({ data: dto });
  }

  // --- Floors ------------------------------------------------------------

  async createFloor(branchId: string, dto: CreateFloorDto) {
    await this.assertBranchExists(branchId);
    return this.prisma.floor.create({ data: { branchId, ...dto } });
  }

  async updateFloor(id: string, dto: UpdateFloorDto) {
    return this.prisma.floor.update({ where: { id }, data: { ...dto } });
  }

  async listFloors(branchId: string) {
    return this.prisma.floor.findMany({
      where: { branchId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { floorType: true },
    });
  }

  // --- Rooms and beds ----------------------------------------------------

  /**
   * Creating a room creates its beds. Availability is always
   * "beds minus active assignments", never a boolean on the room.
   */
  async createRoom(floorId: string, dto: CreateRoomDto) {
    const floor = await this.prisma.floor.findUnique({ where: { id: floorId } });
    if (!floor) throw new NotFoundException('Floor not found');

    const labels = this.resolveBedLabels(dto.capacity, dto.bedLabels);
    return this.prisma.room.create({
      data: {
        floorId,
        name: dto.name,
        capacity: dto.capacity,
        acType: dto.acType ?? AcType.AC,
        variant: dto.variant,
        notes: dto.notes,
        sortOrder: dto.sortOrder ?? 0,
        beds: {
          create: labels.map((label, index) => ({ label, sortOrder: index })),
        },
      },
      include: { beds: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  /**
   * Changing capacity adds or retires beds. A bed that is currently occupied
   * is never removed — the tenant has to be moved first.
   */
  async updateRoom(id: string, dto: UpdateRoomDto) {
    const room = await this.prisma.room.findUnique({
      where: { id },
      include: {
        beds: {
          orderBy: { sortOrder: 'asc' },
          include: { assignments: { where: { endDate: null } } },
        },
      },
    });
    if (!room) throw new NotFoundException('Room not found');

    return this.prisma.runInTransaction(async (tx) => {
      if (dto.capacity !== undefined && dto.capacity !== room.capacity) {
        const activeBeds = room.beds.filter((b) => b.isActive);
        if (dto.capacity > activeBeds.length) {
          const toAdd = dto.capacity - activeBeds.length;
          const existing = new Set(room.beds.map((b) => b.label));
          const newLabels = this.resolveBedLabels(
            room.beds.length + toAdd,
            undefined,
          ).filter((l) => !existing.has(l)).slice(0, toAdd);
          await tx.bed.createMany({
            data: newLabels.map((label, i) => ({
              roomId: id,
              label,
              sortOrder: activeBeds.length + i,
            })),
          });
        } else {
          // Retire the highest-numbered free beds.
          const removable = activeBeds
            .filter((b) => b.assignments.length === 0)
            .sort((a, b) => b.sortOrder - a.sortOrder);
          const toRemove = activeBeds.length - dto.capacity;
          if (removable.length < toRemove) {
            throw new BadRequestException(
              `Cannot reduce to ${dto.capacity} beds: ${
                activeBeds.length - removable.length
              } bed(s) are occupied. Move those tenants first.`,
            );
          }
          await tx.bed.updateMany({
            where: { id: { in: removable.slice(0, toRemove).map((b) => b.id) } },
            data: { isActive: false },
          });
        }
      }

      return tx.room.update({
        where: { id },
        data: {
          name: dto.name,
          capacity: dto.capacity,
          acType: dto.acType,
          variant: dto.variant,
          notes: dto.notes,
          isActive: dto.isActive,
          sortOrder: dto.sortOrder,
        },
        include: { beds: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      });
    });
  }

  async getRoom(id: string, asOf = new Date()) {
    const room = await this.prisma.room.findUnique({
      where: { id },
      include: {
        floor: { include: { branch: true, floorType: true } },
        beds: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!room) throw new NotFoundException('Room not found');
    const occupancy = await this.bedOccupancy(
      room.beds.map((b) => b.id),
      asOf,
    );
    return {
      ...room,
      beds: room.beds.map((bed) => ({
        ...bed,
        ...(occupancy.get(bed.id) ?? {
          bedId: bed.id,
          bedLabel: bed.label,
          occupied: false,
        }),
      })),
      occupiedCount: [...occupancy.values()].filter((o) => o.occupied).length,
      availableCount:
        room.beds.length - [...occupancy.values()].filter((o) => o.occupied).length,
    };
  }

  /**
   * Who is in each bed on a given date. One query for a whole set of beds so
   * the Home screen doesn't fan out into hundreds of round trips.
   */
  async bedOccupancy(
    bedIds: string[],
    asOf: Date = new Date(),
    db: Db = this.prisma,
  ): Promise<Map<string, BedOccupancy>> {
    if (bedIds.length === 0) return new Map();
    const day = dayStart(asOf);

    const assignments = await db.bedAssignment.findMany({
      where: {
        bedId: { in: bedIds },
        startDate: { lte: day },
        OR: [{ endDate: null }, { endDate: { gte: day } }],
      },
      include: {
        bed: true,
        stay: {
          include: {
            tenant: { select: { id: true, fullName: true } },
            notice: true,
          },
        },
      },
    });

    const map = new Map<string, BedOccupancy>();
    for (const bedId of bedIds) map.set(bedId, { bedId, bedLabel: '', occupied: false });

    for (const a of assignments) {
      if (a.stay.status === StayStatus.CANCELLED) continue;
      map.set(a.bedId, {
        bedId: a.bedId,
        bedLabel: a.bed.label,
        occupied: true,
        stayId: a.stayId,
        tenantId: a.stay.tenantId,
        tenantName: a.stay.tenant.fullName,
        vacatingOn:
          a.stay.actualCheckoutDate ??
          a.stay.notice?.intendedCheckout ??
          a.stay.expectedCheckoutDate ??
          a.endDate ??
          null,
      });
    }
    return map;
  }

  /**
   * Branch summary used by Home: current vacancy, upcoming vacancy and the
   * number of tenants with money outstanding.
   */
  async branchSummaries(asOf = new Date(), upcomingDays = 30, branchScope: string[] = []) {
    const day = dayStart(asOf);
    const horizon = addDaysTo(day, upcomingDays);

    const branches = await this.prisma.branch.findMany({
      where: {
        status: { in: [BranchStatus.ACTIVE, BranchStatus.DISABLED] },
        id: branchScope.length ? { in: branchScope } : undefined,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        floors: {
          where: { isActive: true },
          include: {
            rooms: {
              where: { isActive: true },
              include: { beds: { where: { isActive: true } } },
            },
          },
        },
      },
    });

    const summaries = [];
    for (const branch of branches) {
      const bedIds = branch.floors.flatMap((f) =>
        f.rooms.flatMap((r) => r.beds.map((b) => b.id)),
      );
      const occupancy = await this.bedOccupancy(bedIds, day);
      const occupied = [...occupancy.values()].filter((o) => o.occupied);

      const upcoming = occupied.filter(
        (o) => o.vacatingOn && dayStart(o.vacatingOn) <= horizon,
      ).length;

      const stayIds = occupied.map((o) => o.stayId!).filter(Boolean);
      const paymentPending = stayIds.length
        ? await this.countStaysWithDues(stayIds, day)
        : 0;

      summaries.push({
        id: branch.id,
        name: branch.name,
        code: branch.code,
        status: branch.status,
        totalBeds: bedIds.length,
        occupiedBeds: occupied.length,
        currentVacancy: bedIds.length - occupied.length,
        upcomingVacancy: upcoming,
        paymentPending,
        floorCount: branch.floors.length,
        roomCount: branch.floors.reduce((n, f) => n + f.rooms.length, 0),
      });
    }
    return summaries;
  }

  private async countStaysWithDues(stayIds: string[], asOf: Date): Promise<number> {
    const rows = await this.prisma.invoice.groupBy({
      by: ['stayId'],
      where: {
        stayId: { in: stayIds },
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        dueDate: { lte: asOf },
      },
    });
    return rows.length;
  }

  /** The Home hierarchy: branch -> floor -> room -> bed occupants. */
  async branchTree(branchId: string, asOf = new Date()) {
    const branch = await this.getBranch(branchId);
    const bedIds = branch.floors.flatMap((f) =>
      f.rooms.flatMap((r) => r.beds.map((b) => b.id)),
    );
    const occupancy = await this.bedOccupancy(bedIds, asOf);

    return {
      id: branch.id,
      name: branch.name,
      address: branch.address,
      contact: branch.contact,
      status: branch.status,
      floors: branch.floors.map((floor) => {
        const rooms = floor.rooms.map((room) => {
          const beds = room.beds.map((bed) => ({
            id: bed.id,
            label: bed.label,
            ...(occupancy.get(bed.id) ?? { occupied: false }),
          }));
          const occupied = beds.filter((b) => b.occupied).length;
          return {
            id: room.id,
            name: room.name,
            capacity: room.capacity,
            acType: room.acType,
            variant: room.variant,
            occupiedCount: occupied,
            availableCount: beds.length - occupied,
            beds,
          };
        });
        return {
          id: floor.id,
          name: floor.name,
          floorType: floor.floorType?.name ?? null,
          rooms,
          totalBeds: rooms.reduce((n, r) => n + r.beds.length, 0),
          occupiedBeds: rooms.reduce((n, r) => n + r.occupiedCount, 0),
        };
      }),
    };
  }

  /** Vacancy screen: free beds now, plus beds freeing up soon. */
  async vacancy(query: VacancyQueryDto, branchScope: string[] = []) {
    const asOf = query.asOf ? dayStart(query.asOf) : dayStart(new Date());
    const upcomingDays = query.upcomingDays ?? 30;
    const horizon = addDaysTo(asOf, upcomingDays);

    const where: Prisma.RoomWhereInput = {
      isActive: true,
      capacity: query.capacity,
      acType: query.acType,
      floor: {
        isActive: true,
        id: query.floorId,
        branchId: query.branchId,
        branch: {
          status: { in: [BranchStatus.ACTIVE] },
          id: branchScope.length ? { in: branchScope } : undefined,
        },
      },
    };

    const rooms = await this.prisma.room.findMany({
      where,
      orderBy: [{ floor: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        floor: { include: { branch: true } },
        beds: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      },
    });

    const bedIds = rooms.flatMap((r) => r.beds.map((b) => b.id));
    const occupancy = await this.bedOccupancy(bedIds, asOf);

    const available: unknown[] = [];
    const upcoming: unknown[] = [];

    for (const room of rooms) {
      for (const bed of room.beds) {
        const o = occupancy.get(bed.id);
        const location = {
          branchId: room.floor.branchId,
          branchName: room.floor.branch.name,
          floorId: room.floorId,
          floorName: room.floor.name,
          roomId: room.id,
          roomName: room.name,
          capacity: room.capacity,
          acType: room.acType,
          variant: room.variant,
          bedId: bed.id,
          bedLabel: bed.label,
        };
        if (!o?.occupied) {
          available.push({ ...location, availableFrom: asOf });
        } else if (o.vacatingOn && dayStart(o.vacatingOn) <= horizon) {
          upcoming.push({
            ...location,
            occupiedBy: o.tenantName,
            tenantId: o.tenantId,
            stayId: o.stayId,
            availableFrom: addDaysTo(dayStart(o.vacatingOn), 1),
          });
        }
      }
    }

    return {
      asOf,
      upcomingDays,
      totalBeds: bedIds.length,
      occupiedBeds: [...occupancy.values()].filter((o) => o.occupied).length,
      availableCount: available.length,
      upcomingCount: upcoming.length,
      available,
      upcoming,
    };
  }

  // --- helpers -----------------------------------------------------------

  private async assertBranchExists(id: string): Promise<void> {
    const exists = await this.prisma.branch.count({ where: { id } });
    if (!exists) throw new NotFoundException('Branch not found');
  }

  /** A, B, C ... Z, AA, AB ... — readable bed labels for any capacity. */
  private resolveBedLabels(capacity: number, provided?: string[]): string[] {
    if (provided?.length) {
      if (provided.length !== capacity) {
        throw new BadRequestException(
          `Provide exactly ${capacity} bed label(s), or none to generate them`,
        );
      }
      return provided;
    }
    return Array.from({ length: capacity }, (_, i) => toLabel(i));
  }
}

function toLabel(index: number): string {
  let n = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}
