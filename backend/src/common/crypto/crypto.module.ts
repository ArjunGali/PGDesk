import { Global, Module } from '@nestjs/common';
import { FieldEncryptionService } from './field-encryption';

/**
 * Global so any module holding a sensitive field can encrypt it without
 * threading the service through a chain of imports.
 */
@Global()
@Module({
  providers: [FieldEncryptionService],
  exports: [FieldEncryptionService],
})
export class CryptoModule {}
