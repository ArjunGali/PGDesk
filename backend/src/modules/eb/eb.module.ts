import { Module } from '@nestjs/common';
import { EbController } from './eb.controller';
import { EbService } from './eb.service';

@Module({
  controllers: [EbController],
  providers: [EbService],
  exports: [EbService],
})
export class EbModule {}
