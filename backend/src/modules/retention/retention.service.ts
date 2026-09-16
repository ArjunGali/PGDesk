import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StayStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { ExportsService } from '../exports/exports.service';
import { SETTING_KEYS } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';

/**
 * Exporting and then erasing a former tenant's personal data.
 *
 * The hard part is not deleting — it is deleting the right half. A tenant's
 * name, phone number, address, Aadhaar and documents are personal data the
 * property has no reason to keep forever. Their bills, payments, deposits and
 * audit trail are financial records the property may be required to keep, and
 * which must still add up afterwards.
 *
 * So erasure clears the identifying fields on the Tenant row and destroys the
 * uploaded documents, while every Stay, Invoice, Payment, DepositEntry and
 * AuditLog row stays exactly where it was, still linked to the same tenant id.
 * Reports and settlements from before the erasure continue to balance; they
 * simply refer to a tenant who no longer has a name.
 */
@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exports: ExportsService,
    private readonly documents: DocumentsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Former tenants, with whether they have been exported and/or erased. */
  async listVacated() {
    const tenants = await this.prisma.tenant.findMany({
      where: {
        stays: {
          some: { status: StayStatus.VACATED },
          every: { status: { in: [StayStatus.VACATED, StayStatus.CANCELLED] } },
        },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        stays: {
          orderBy: { checkInDate: 'desc' },
          select: {
            id: true,
            checkInDate: true,
            actualCheckoutDate: true,
            settlement: { select: { status: true, netAmount: true } },
          },
        },
        dataExports: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, fileName: true, createdAt: true, format: true },
        },
        documents: { select: { id: true } },
      },
    });

    return tenants.map((tenant) => ({
      id: tenant.id,
      fullName: tenant.fullName,
      mobile: tenant.mobile,
      lastCheckout: tenant.stays[0]?.actualCheckoutDate ?? null,
      stayCount: tenant.stays.length,
      documentCount: tenant.documents.length,
      lastExport: tenant.dataExports[0] ?? null,
      erasedAt: tenant.personalDataErasedAt,
      settlementStatus: tenant.stays[0]?.settlement?.status ?? null,
    }));
  }

  /**
   * Produces the tenant's full record as a file and remembers that it was
   * produced. Erasure is gated on one of these existing, so the data always
   * leaves the app in a readable form before it leaves the database.
   */
  async export(
    tenantId: string,
    format: 'xlsx' | 'pdf',
    actorId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.personalDataErasedAt) {
      throw new BadRequestException(
        'This tenant\'s personal data has already been erased; there is nothing left to export.',
      );
    }

    const result =
      format === 'pdf'
        ? await this.exports.tenantInfoSheet(tenantId)
        : await this.exports.tenantArchiveXlsx(tenantId);

    await this.prisma.dataExport.create({
      data: {
        tenantId,
        format,
        fileName: result.fileName,
        sizeBytes: result.buffer.length,
        checksum: createHash('sha256').update(result.buffer).digest('hex'),
        exportedById: actorId,
      },
    });

    await this.audit.record({
      actorId,
      action: 'tenant.export',
      entityType: 'Tenant',
      entityId: tenantId,
      after: { format, fileName: result.fileName, sizeBytes: result.buffer.length },
    });

    return result;
  }

  /**
   * What erasing this tenant would remove, and whether it is allowed yet.
   * Shown for confirmation — the operation cannot be undone.
   */
  async erasurePreview(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        documents: { include: { documentType: true } },
        customFieldValues: true,
        dataExports: { orderBy: { createdAt: 'desc' }, take: 1 },
        stays: {
          include: {
            invoices: { select: { id: true } },
            payments: { select: { id: true } },
            depositLedger: { select: { id: true } },
          },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const requiresExport = await this.settings.getBoolean(
      SETTING_KEYS.TENANT_ERASURE_REQUIRES_EXPORT,
    );
    const blockers: string[] = [];

    const openStay = tenant.stays.find(
      (s) => s.status !== StayStatus.VACATED && s.status !== StayStatus.CANCELLED,
    );
    if (openStay) {
      blockers.push('This tenant still has an open stay. Vacate them first.');
    }
    if (tenant.personalDataErasedAt) {
      blockers.push('This tenant\'s personal data has already been erased.');
    }
    if (requiresExport && tenant.dataExports.length === 0) {
      blockers.push(
        'Export this tenant\'s records before erasing them. Erasure cannot be undone.',
      );
    }

    return {
      tenantId,
      fullName: tenant.fullName,
      canErase: blockers.length === 0,
      blockers,
      lastExport: tenant.dataExports[0] ?? null,
      /** Personal data that will be cleared. */
      willRemove: {
        identityFields: [
          'Full name',
          'Mobile number',
          'Emergency contact',
          'Permanent address',
          'Office address',
          'Aadhaar number',
          'Notes',
        ],
        documents: tenant.documents.map((d) => d.documentType.name),
        customFields: tenant.customFieldValues.length,
      },
      /** Financial and audit records that will be kept. */
      willKeep: {
        stays: tenant.stays.length,
        bills: tenant.stays.reduce((n, s) => n + s.invoices.length, 0),
        payments: tenant.stays.reduce((n, s) => n + s.payments.length, 0),
        depositEntries: tenant.stays.reduce((n, s) => n + s.depositLedger.length, 0),
        note: 'Bills, payments, deposits, settlements and the audit trail are kept so past reports still balance.',
      },
    };
  }

  /**
   * Irreversibly clears personal data, keeping financial history.
   *
   * The tenant row survives as an anonymous placeholder so every invoice and
   * payment still points somewhere — deleting the row would orphan or cascade
   * into records the property needs.
   */
  async erase(tenantId: string, reason: string, actorId: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to erase a tenant\'s data');
    }

    const preview = await this.erasurePreview(tenantId);
    if (!preview.canErase) {
      throw new BadRequestException(preview.blockers.join(' '));
    }

    const documents = await this.prisma.document.findMany({ where: { tenantId } });

    const result = await this.prisma.runInTransaction(async (tx) => {
      // Keep an anonymous but stable label so financial screens stay readable.
      const placeholder = `Erased tenant ${tenantId.slice(0, 8)}`;

      await tx.customFieldValue.deleteMany({ where: { tenantId } });
      await tx.document.deleteMany({ where: { tenantId } });
      await tx.notification.deleteMany({ where: { tenantId } });

      const updated = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          fullName: placeholder,
          mobile: null,
          emergencyContact: null,
          emergencyName: null,
          permanentAddress: null,
          officeAddress: null,
          officeName: null,
          // All three Aadhaar columns go: the ciphertext, the search index
          // that could confirm a guess, and the last four digits.
          aadhaarCiphertext: null,
          aadhaarIndex: null,
          aadhaarLast4: null,
          photoDocumentId: null,
          notes: null,
          archivedAt: new Date(),
          personalDataErasedAt: new Date(),
          erasedById: actorId,
        },
      });

      await this.audit.record({
        tx,
        actorId,
        action: 'tenant.erase_personal_data',
        entityType: 'Tenant',
        entityId: tenantId,
        before: { fullName: preview.fullName, documentCount: documents.length },
        after: {
          fullName: placeholder,
          keptStays: preview.willKeep.stays,
          keptBills: preview.willKeep.bills,
          keptPayments: preview.willKeep.payments,
        },
        reason,
      });

      return updated;
    });

    // Files come last: if the transaction failed, nothing should have been
    // destroyed on disk.
    for (const document of documents) {
      await this.documents.removeFileOnly(document.storagePath);
    }

    return {
      ok: true,
      tenantId,
      erasedAt: result.personalDataErasedAt,
      documentsDestroyed: documents.length,
      kept: preview.willKeep,
    };
  }
}
