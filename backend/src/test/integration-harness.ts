import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { CryptoModule } from '../common/crypto/crypto.module';
import { PrismaModule } from '../common/prisma/prisma.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditModule } from '../modules/audit/audit.module';
import { AuthModule } from '../modules/auth/auth.module';
import { BillingModule } from '../modules/billing/billing.module';
import { PaymentsModule } from '../modules/payments/payments.module';
import { PricingModule } from '../modules/pricing/pricing.module';
import { PropertyModule } from '../modules/property/property.module';
import { SettingsModule } from '../modules/settings/settings.module';
import { SettlementsModule } from '../modules/settlements/settlements.module';
import { TenantsModule } from '../modules/tenants/tenants.module';

/**
 * Integration tests run against a real PostgreSQL database.
 *
 * The invariants worth protecting here — a bed cannot be double booked, a
 * past bill cannot change, a deposit ledger must balance — are all properties
 * of transactions and constraints. Mocking the database would test the mocks.
 *
 * Each run uses its own schema so tests never disturb development data and can
 * be dropped wholesale afterwards.
 */
export const TEST_SCHEMA = `test_${process.pid}`;

export function testDatabaseUrl(): string {
  const base =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://pgm:pgm_password@localhost:5432/pg_management';
  const url = new URL(base);
  url.searchParams.set('schema', TEST_SCHEMA);
  return url.toString();
}

export async function setUpTestDatabase(): Promise<void> {
  process.env.DATABASE_URL = testDatabaseUrl();
  // A throwaway key, so encryption is exercised rather than skipped. Real
  // deployments supply their own; nothing here is a usable secret.
  process.env.AADHAAR_ENCRYPTION_KEY ??=
    'dGVzdC1vbmx5LWtleS0zMi1ieXRlcy1sb25nLXh4eHg=';
  // Same idea for token signing: the auth module refuses to build without it.
  process.env.JWT_SECRET ??= 'test-only-jwt-secret-not-used-anywhere-real';
  // `db push` builds the schema straight from schema.prisma, which is faster
  // than replaying every migration and is equivalent for a fresh schema.
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'pipe',
  });
}

export async function tearDownTestDatabase(): Promise<void> {
  const client = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl() } },
  });
  try {
    await client.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`,
    );
  } finally {
    await client.$disconnect();
  }
}

export async function createTestModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      // PrismaModule is @Global; importing it is what makes PrismaService
      // injectable across every other module here.
      PrismaModule,
      CryptoModule,
      AuditModule,
      AuthModule,
      SettingsModule,
      PropertyModule,
      PricingModule,
      TenantsModule,
      BillingModule,
      PaymentsModule,
      SettlementsModule,
    ],
  }).compile();
}

/** Clears every table between tests, leaving the schema in place. */
export async function resetData(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = '${TEST_SCHEMA}'`,
  );
  const names = tables
    .map((t) => `"${TEST_SCHEMA}"."${t.tablename}"`)
    .filter((n) => !n.includes('_prisma_migrations'));
  if (names.length === 0) return;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${names.join(', ')} RESTART IDENTITY CASCADE`,
  );
}
