import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/**
 * Turns every failure into a consistent shape the Android app can display.
 * Prisma constraint errors become plain sentences instead of database jargon,
 * because the person reading them runs a PG, not a database.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Something went wrong';
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ??
            exception.message);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      code = exception.code;
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = `That ${describeTarget(exception)} already exists`;
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          message = 'A linked record is missing or still in use';
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          break;
        case 'P2034':
          status = HttpStatus.CONFLICT;
          message = 'Someone else changed this at the same time. Please retry.';
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          message = 'The database rejected this change';
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (status >= 500) {
      this.logger.error(
        `${request?.method} ${request?.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      code,
      path: request?.url,
      timestamp: new Date().toISOString(),
    });
  }
}

function describeTarget(e: Prisma.PrismaClientKnownRequestError): string {
  const target = (e.meta as { target?: string[] | string } | undefined)?.target;
  if (Array.isArray(target)) return target.join(' + ');
  if (typeof target === 'string') return target;
  return 'record';
}
