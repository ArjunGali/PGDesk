import { BadRequestException } from '@nestjs/common';

/**
 * PIN rules, shared by the auth and users modules.
 *
 * This lives here rather than on either service so neither module has to
 * import the other — the profile screen and the PIN screen are two halves of
 * the same flow, and a circular import between them is easy to create.
 *
 * PINs are 4 to 8 digits. Obvious sequences and repeats are refused: on a
 * shared device "1234" is not a secret, and the person setting one up is
 * usually in a hurry.
 */
export function assertPinFormat(pin: string): void {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new BadRequestException('A PIN must be 4 to 8 digits');
  }
  if (/^(\d)\1+$/.test(pin)) {
    throw new BadRequestException(
      'That PIN is too easy to guess — avoid repeating one digit',
    );
  }
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) {
    throw new BadRequestException(
      'That PIN is too easy to guess — avoid running sequences like 1234',
    );
  }
}
