import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentVerification } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from './documents.service';

@Controller()
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  @Get('document-types')
  @RequirePermissions(PERMISSIONS.DOCUMENT_VIEW)
  listTypes() {
    return this.documents.listTypes();
  }

  @Post('document-types')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  createType(
    @Body() dto: { key: string; name: string; required?: boolean; sortOrder?: number },
  ) {
    return this.documents.createType(dto);
  }

  @Patch('document-types/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  updateType(
    @Param('id') id: string,
    @Body() dto: { name?: string; required?: boolean; sortOrder?: number; isActive?: boolean },
  ) {
    return this.documents.updateType(id, dto);
  }

  @Get('tenants/:id/documents')
  @RequirePermissions(PERMISSIONS.DOCUMENT_VIEW)
  listForTenant(@Param('id') id: string) {
    return this.documents.listForTenant(id);
  }

  /** Accepts a gallery pick, a camera capture or a signature image. */
  @Post('tenants/:id/documents')
  @RequirePermissions(PERMISSIONS.DOCUMENT_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async upload(
    @Param('id') tenantId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { documentTypeId: string; notes?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException('No file was received');
    if (!body.documentTypeId) {
      throw new BadRequestException('Choose a document type');
    }

    const document = await this.documents.upload(
      {
        tenantId,
        documentTypeId: body.documentTypeId,
        fileName: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer,
        notes: body.notes,
      },
      user.id,
    );

    await this.audit.record({
      actorId: user.id,
      action: 'document.upload',
      entityType: 'Document',
      entityId: document.id,
      after: {
        tenantId,
        type: document.documentType.name,
        fileName: document.fileName,
      },
    });
    return document;
  }

  @Get('documents/:id/file')
  @RequirePermissions(PERMISSIONS.DOCUMENT_VIEW)
  async download(@Param('id') id: string, @Res() res: Response) {
    const { document, stream } = await this.documents.getFileStream(id);
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(document.fileName)}"`,
    );
    stream.pipe(res);
  }

  @Post('documents/:id/verify')
  @RequirePermissions(PERMISSIONS.DOCUMENT_VERIFY)
  async verify(
    @Param('id') id: string,
    @Body() dto: { status: DocumentVerification; notes?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const document = await this.documents.verify(id, dto.status, user.id, dto.notes);
    await this.audit.record({
      actorId: user.id,
      action: 'document.verify',
      entityType: 'Document',
      entityId: id,
      after: { status: dto.status },
    });
    return document;
  }

  @Delete('documents/:id')
  @RequirePermissions(PERMISSIONS.DOCUMENT_MANAGE)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.audit.record({
      actorId: user.id,
      action: 'document.delete',
      entityType: 'Document',
      entityId: id,
    });
    return this.documents.remove(id);
  }
}
