import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { ExportsService } from './exports.service';

@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  /** The A4 information sheet behind the tenant INFO action. */
  @Get('tenants/:id/info-sheet.pdf')
  @RequirePermissions(PERMISSIONS.TENANT_VIEW, PERMISSIONS.EXPORT_RUN)
  async tenantInfoSheet(@Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.exports.tenantInfoSheet(id);
    sendFile(res, buffer, fileName, 'application/pdf');
  }

  @Get('invoices/:id.pdf')
  @RequirePermissions(PERMISSIONS.INVOICE_VIEW, PERMISSIONS.EXPORT_RUN)
  async invoicePdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.exports.invoicePdf(id);
    sendFile(res, buffer, fileName, 'application/pdf');
  }

  @Get('stays/:id/settlement.pdf')
  @RequirePermissions(PERMISSIONS.SETTLEMENT_VIEW, PERMISSIONS.EXPORT_RUN)
  async settlementPdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.exports.settlementPdf(id);
    sendFile(res, buffer, fileName, 'application/pdf');
  }

  @Get('tenants.xlsx')
  @RequirePermissions(PERMISSIONS.TENANT_VIEW, PERMISSIONS.EXPORT_RUN)
  async tenantsXlsx(@Query('branchId') branchId: string | undefined, @Res() res: Response) {
    const { buffer, fileName } = await this.exports.tenantsXlsx(branchId);
    sendFile(
      res,
      buffer,
      fileName,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  @Get('collections.xlsx')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW, PERMISSIONS.EXPORT_RUN)
  async collectionsXlsx(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId: string | undefined,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.exports.collectionsXlsx(
      new Date(from),
      new Date(to),
      branchId,
    );
    sendFile(
      res,
      buffer,
      fileName,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  @Get('payments.csv')
  @RequirePermissions(PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.EXPORT_RUN)
  async paymentsCsv(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.exports.paymentsCsv(new Date(from), new Date(to), branchId);
    sendFile(res, Buffer.from(csv, 'utf8'), 'payments.csv', 'text/csv; charset=utf-8');
  }
}

function sendFile(
  res: Response,
  buffer: Buffer,
  fileName: string,
  contentType: string,
): void {
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(fileName)}"`,
  );
  res.setHeader('Content-Length', String(buffer.length));
  res.end(buffer);
}
