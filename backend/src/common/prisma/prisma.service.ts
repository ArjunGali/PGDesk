import {
  INestApplication,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Single Prisma client for the modular monolith.
 *
 * `runInTransaction` is the only sanctioned way to perform multi-step financial
 * work (room switch, settlement, invoice issue). Services take a `tx` parameter
 * so they compose inside one atomic unit.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  enableShutdownHooks(app: INestApplication): void {
    process.on('beforeExit', () => {
      void app.close();
    });
  }

  /**
   * Serializable-by-default transaction wrapper. Financial invariants (bed
   * capacity, deposit balances, invoice totals) are checked inside the
   * transaction, so a weaker isolation level could let two concurrent writes
   * both pass their checks.
   */
  runInTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { timeout?: number },
  ): Promise<T> {
    return this.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: options?.timeout ?? 15_000,
      maxWait: 10_000,
    });
  }
}

/** Either the root client or an in-flight transaction client. */
export type Db = PrismaService | Prisma.TransactionClient;
