import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentVerification } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { PrismaService } from '../../common/prisma/prisma.service';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Tenant documents are stored on the filesystem, never in the database, and
 * always behind a permission check. The stored path is relative and generated
 * here: a client never chooses where its file lands.
 */
@Injectable()
export class DocumentsService {
  private readonly storageRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.storageRoot = resolve(config.get<string>('STORAGE_ROOT', './storage'));
  }

  listTypes() {
    return this.prisma.documentType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  createType(input: {
    key: string;
    name: string;
    required?: boolean;
    sortOrder?: number;
  }) {
    return this.prisma.documentType.create({ data: input });
  }

  updateType(
    id: string,
    input: { name?: string; required?: boolean; sortOrder?: number; isActive?: boolean },
  ) {
    return this.prisma.documentType.update({ where: { id }, data: input });
  }

  listForTenant(tenantId: string) {
    return this.prisma.document.findMany({
      where: { tenantId },
      orderBy: { uploadedAt: 'desc' },
      include: { documentType: true },
    });
  }

  async upload(
    input: {
      tenantId: string;
      documentTypeId: string;
      fileName: string;
      mimeType: string;
      buffer: Buffer;
      notes?: string;
    },
    actorId: string,
  ) {
    if (!ALLOWED_MIME.has(input.mimeType)) {
      throw new BadRequestException(
        'Only JPG, PNG, WEBP, HEIC images and PDF files can be uploaded',
      );
    }
    if (input.buffer.length > MAX_BYTES) {
      throw new BadRequestException('That file is larger than 15 MB');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const ext = safeExtension(input.fileName, input.mimeType);
    const relativeDir = join('tenants', input.tenantId);
    const relativePath = join(relativeDir, `${randomUUID()}${ext}`);
    const absolutePath = this.resolveWithinRoot(relativePath);

    await mkdir(join(this.storageRoot, relativeDir), { recursive: true });
    await writeFile(absolutePath, input.buffer);

    return this.prisma.document.create({
      data: {
        tenantId: input.tenantId,
        documentTypeId: input.documentTypeId,
        storagePath: relativePath,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
        uploadedById: actorId,
        notes: input.notes,
      },
      include: { documentType: true },
    });
  }

  async getFileStream(documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!document) throw new NotFoundException('Document not found');

    const absolutePath = this.resolveWithinRoot(document.storagePath);
    if (!existsSync(absolutePath)) {
      throw new NotFoundException('The stored file is missing from disk');
    }
    return { document, stream: createReadStream(absolutePath) };
  }

  async verify(
    documentId: string,
    status: DocumentVerification,
    actorId: string,
    notes?: string,
  ) {
    return this.prisma.document.update({
      where: { id: documentId },
      data: {
        verification: status,
        verifiedById: actorId,
        verifiedAt: new Date(),
        notes,
      },
    });
  }

  async remove(documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!document) throw new NotFoundException('Document not found');

    await this.prisma.document.delete({ where: { id: documentId } });
    try {
      await unlink(this.resolveWithinRoot(document.storagePath));
    } catch {
      // The database row is the record of truth; a missing file is not fatal.
    }
    return { ok: true };
  }

  /**
   * Guards against a stored path escaping the storage root. Paths are
   * generated server-side, but this stays as a second line of defence.
   */
  private resolveWithinRoot(relativePath: string): string {
    const candidate = resolve(this.storageRoot, normalize(relativePath));
    if (
      candidate !== this.storageRoot &&
      !candidate.startsWith(this.storageRoot + sep)
    ) {
      throw new BadRequestException('Invalid document path');
    }
    return candidate;
  }
}

function safeExtension(fileName: string, mimeType: string): string {
  const fromName = extname(fileName).toLowerCase();
  if (/^\.[a-z0-9]{1,5}$/.test(fromName)) return fromName;
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'application/pdf': '.pdf',
  };
  return map[mimeType] ?? '.bin';
}
