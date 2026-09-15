import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { ExportsModule } from '../exports/exports.module';
import { RetentionController } from './retention.controller';
import { RetentionService } from './retention.service';

@Module({
  imports: [ExportsModule, DocumentsModule],
  controllers: [RetentionController],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
