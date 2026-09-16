import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Application-level encryption for sensitive identifiers held in PostgreSQL.
 *
 * Used for Aadhaar numbers. The threat this addresses is a database ending up
 * somewhere it should not — a stolen backup, a copied volume, a misplaced
 * laptop running the LAN server. Disk encryption does not help once the server
 * is running; encrypting the field does.
 *
 * SCHEME
 *   AES-256-GCM, a fresh 96-bit IV per value, with the authentication tag
 *   stored alongside. GCM is authenticated, so a tampered ciphertext fails to
 *   decrypt rather than returning plausible rubbish.
 *
 *   Stored form:  v1.<iv b64>.<tag b64>.<ciphertext b64>
 *
 *   The `v1` prefix is the key-rotation seam: a future v2 key can be added
 *   while v1 values are still readable, so rotation needs no flag day.
 *
 * SEARCH
 *   Ciphertext is not searchable — that is the point. A separate blind index
 *   (HMAC-SHA256 of the normalised digits, under a key derived from the same
 *   secret) allows exact-match lookup without storing or revealing the number.
 *   The HMAC is deterministic, so identical numbers produce identical indexes;
 *   that is the accepted trade-off for being able to find a tenant at all.
 *
 * KEY
 *   Supplied through AADHAAR_ENCRYPTION_KEY, never compiled in. See
 *   docs/SECURITY.md for generation, rotation and recovery.
 *
 * FAILURE BEHAVIOUR
 *   If the key is missing or malformed the service fails closed: encrypting or
 *   decrypting throws, so a misconfigured deployment cannot silently write
 *   plaintext. Everything that does not touch a sensitive field keeps working,
 *   so a property is not locked out of collecting rent by a configuration
 *   mistake.
 */
@Injectable()
export class FieldEncryptionService {
  private readonly logger = new Logger(FieldEncryptionService.name);

  private readonly key: Buffer | null;
  private readonly indexKey: Buffer | null;
  private readonly configurationError: string | null;

  /** Current version written by `encrypt`. Older versions stay readable. */
  private static readonly CURRENT_VERSION = 'v1';

  constructor(config: ConfigService) {
    const raw = config.get<string>('AADHAAR_ENCRYPTION_KEY')?.trim();

    if (!raw) {
      this.key = null;
      this.indexKey = null;
      this.configurationError =
        'AADHAAR_ENCRYPTION_KEY is not set. Aadhaar numbers cannot be stored or read until it is configured.';
      // Warn once at boot rather than on every request.
      this.logger.warn(this.configurationError);
      return;
    }

    let parsed: Buffer;
    try {
      parsed = parseKey(raw);
    } catch (error) {
      this.key = null;
      this.indexKey = null;
      this.configurationError =
        error instanceof Error ? error.message : 'AADHAAR_ENCRYPTION_KEY is invalid.';
      this.logger.error(this.configurationError);
      return;
    }

    this.key = parsed;
    // A separate key for the search index, derived so one secret configures
    // both without the index key ever being the encryption key itself.
    this.indexKey = createHmac('sha256', parsed).update('aadhaar-blind-index').digest();
    this.configurationError = null;
  }

  /** True when the service is configured and sensitive fields can be used. */
  get isConfigured(): boolean {
    return this.key !== null;
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new ServiceUnavailableException(
        this.configurationError ?? 'Encryption is not configured on the server.',
      );
    }
    return this.key;
  }

  /** Encrypts a value for storage. Returns null for an empty input. */
  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext === null || plaintext === undefined || plaintext === '') {
      return null;
    }
    const key = this.requireKey();

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      FieldEncryptionService.CURRENT_VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');
  }

  /**
   * Decrypts a stored value.
   *
   * Throws on tampering or on the wrong key — never returns a guess. The error
   * deliberately says nothing about the value itself.
   */
  decrypt(stored: string | null | undefined): string | null {
    if (stored === null || stored === undefined || stored === '') return null;
    const key = this.requireKey();

    const parts = stored.split('.');
    if (parts.length !== 4 || parts[0] !== FieldEncryptionService.CURRENT_VERSION) {
      throw new ServiceUnavailableException(
        'This value was encrypted with a key version this server does not recognise.',
      );
    }

    try {
      const [, ivB64, tagB64, dataB64] = parts;
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(ivB64, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Never log the ciphertext or any part of the value.
      throw new ServiceUnavailableException(
        'That stored value could not be decrypted. The encryption key may have changed.',
      );
    }
  }

  /**
   * Deterministic index for exact-match search.
   *
   * Digits only, so "1234 5678 9012" and "123456789012" find the same tenant.
   */
  blindIndex(plaintext: string | null | undefined): string | null {
    if (!plaintext) return null;
    const normalised = plaintext.replace(/\D/g, '');
    if (normalised === '') return null;
    if (!this.indexKey) {
      throw new ServiceUnavailableException(
        this.configurationError ?? 'Encryption is not configured on the server.',
      );
    }
    return createHmac('sha256', this.indexKey).update(normalised).digest('hex');
  }

  /** Constant-time comparison for blind indexes. */
  indexMatches(a: string | null, b: string | null): boolean {
    if (!a || !b || a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  }
}

/**
 * Accepts a 32-byte key as base64 or hex. Anything shorter is refused rather
 * than stretched: a short key silently padded is a false sense of security.
 */
function parseKey(raw: string): Buffer {
  const fromHex = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : null;
  const fromBase64 = fromHex ? null : safeBase64(raw);
  const key = fromHex ?? fromBase64;

  if (!key || key.length !== 32) {
    throw new Error(
      'AADHAAR_ENCRYPTION_KEY must be a 32-byte key, given as 64 hex characters or base64. Generate one with: openssl rand -base64 32',
    );
  }
  return key;
}

function safeBase64(raw: string): Buffer | null {
  try {
    const buffer = Buffer.from(raw, 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}
