import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { dayStart } from '../../common/utils/dates';
import { sum, toDb } from '../../common/utils/money';

const RECEIPT_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

@Injectable()
export class ExpensesService {
  private readonly storageRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.storageRoot = resolve(config.get<string>('STORAGE_ROOT', './storage'));
  }

  /** Stores a receipt photo next to the expense that it evidences. */
  async attachReceipt(
    expenseId: string,
    file: { fileName: string; mimeType: string; buffer: Buffer },
    _actorId: string,
  ) {
    if (!RECEIPT_MIME.has(file.mimeType)) {
      throw new BadRequestException(
        'A receipt must be a JPG, PNG, WEBP, HEIC image or a PDF',
      );
    }
    const exists = await this.prisma.expense.count({ where: { id: expenseId } });
    if (!exists) throw new NotFoundException('Expense not found');

    const ext = /^\.[a-z0-9]{1,5}$/i.test(extname(file.fileName))
      ? extname(file.fileName).toLowerCase()
      : '.bin';
    const relativeDir = join('expenses', expenseId);
    const relativePath = join(relativeDir, `${randomUUID()}${ext}`);

    await mkdir(join(this.storageRoot, relativeDir), { recursive: true });
    await writeFile(join(this.storageRoot, relativePath), file.buffer);

    return this.prisma.expense.update({
      where: { id: expenseId },
      data: { attachmentPath: relativePath, attachmentName: file.fileName },
    });
  }

  listCategories() {
    return this.prisma.expenseCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  createCategory(input: { key: string; name: string; sortOrder?: number }) {
    return this.prisma.expenseCategory.create({ data: input });
  }

  async list(filter: {
    branchId?: string;
    categoryId?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
    branchScope?: string[];
  }) {
    const page = filter.page ?? 1;
    const pageSize = Math.min(filter.pageSize ?? 25, 200);
    const where = {
      branchId: filter.branchId
        ? filter.branchId
        : filter.branchScope?.length
          ? { in: filter.branchScope }
          : undefined,
      categoryId: filter.categoryId,
      spentAt: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
    };

    const [items, total, all] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        orderBy: { spentAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { branch: { select: { name: true } }, category: true },
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.findMany({ where, select: { amount: true } }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      totalAmount: sum(all.map((e) => e.amount)).toFixed(2),
    };
  }

  create(
    input: {
      branchId?: string;
      categoryId?: string;
      title: string;
      amount: string;
      spentAt: string;
      paidTo?: string;
      method?: PaymentMethod;
      notes?: string;
      attachmentPath?: string;
    },
    actorId: string,
  ) {
    return this.prisma.expense.create({
      data: {
        branchId: input.branchId,
        categoryId: input.categoryId,
        title: input.title,
        amount: toDb(input.amount),
        spentAt: dayStart(input.spentAt),
        paidTo: input.paidTo,
        method: input.method ?? PaymentMethod.CASH,
        notes: input.notes,
        attachmentPath: input.attachmentPath,
        createdById: actorId,
      },
    });
  }

  async update(
    id: string,
    input: Partial<{
      branchId: string;
      categoryId: string;
      title: string;
      amount: string;
      spentAt: string;
      paidTo: string;
      method: PaymentMethod;
      notes: string;
    }>,
  ) {
    const exists = await this.prisma.expense.count({ where: { id } });
    if (!exists) throw new NotFoundException('Expense not found');
    return this.prisma.expense.update({
      where: { id },
      data: {
        ...input,
        amount: input.amount !== undefined ? toDb(input.amount) : undefined,
        spentAt: input.spentAt ? dayStart(input.spentAt) : undefined,
      },
    });
  }

  remove(id: string) {
    return this.prisma.expense.delete({ where: { id } });
  }

  /** Totals by category for the reports screen. */
  async summary(from: Date, to: Date, branchId?: string) {
    const expenses = await this.prisma.expense.findMany({
      where: { spentAt: { gte: from, lte: to }, branchId },
      include: { category: true },
    });

    const byCategory = new Map<string, { name: string; total: string; count: number }>();
    for (const expense of expenses) {
      const key = expense.category?.name ?? 'Uncategorised';
      const existing = byCategory.get(key);
      if (existing) {
        existing.total = sum([existing.total, expense.amount]).toFixed(2);
        existing.count += 1;
      } else {
        byCategory.set(key, {
          name: key,
          total: sum([expense.amount]).toFixed(2),
          count: 1,
        });
      }
    }

    return {
      from,
      to,
      total: sum(expenses.map((e) => e.amount)).toFixed(2),
      count: expenses.length,
      byCategory: [...byCategory.values()].sort(
        (a, b) => Number(b.total) - Number(a.total),
      ),
    };
  }
}
