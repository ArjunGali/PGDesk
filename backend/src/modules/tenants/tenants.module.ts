import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { SettlementsModule } from '../settlements/settlements.module';
import { StaysService } from './stays.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [PricingModule, BillingModule, PaymentsModule, SettlementsModule],
  controllers: [TenantsController],
  providers: [TenantsService, StaysService],
  exports: [TenantsService, StaysService],
})
export class TenantsModule {}
