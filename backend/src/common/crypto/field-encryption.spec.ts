import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { FieldEncryptionService } from './field-encryption';

/** A throwaway 32-byte key. Nothing here is a usable secret. */
const TEST_KEY = 'dGVzdC1vbmx5LWtleS0zMi1ieXRlcy1sb25nLXh4eHg=';
const OTHER_KEY = 'YW5vdGhlci10ZXN0LWtleS0zMi1ieXRlcy1sb25nISE=';

function serviceWith(key: string | undefined): FieldEncryptionService {
  return new FieldEncryptionService({
    get: () => key,
  } as unknown as ConfigService);
}

describe('FieldEncryptionService', () => {
  const service = serviceWith(TEST_KEY);
  const AADHAAR = '123412341234';

  it('round-trips a value', () => {
    const stored = service.encrypt(AADHAAR);
    expect(service.decrypt(stored)).toBe(AADHAAR);
  });

  it('never stores the plaintext', () => {
    const stored = service.encrypt(AADHAAR)!;
    expect(stored).not.toContain(AADHAAR);
    // Nor any run of the digits, in any encoding we write.
    expect(Buffer.from(stored, 'utf8').toString('utf8')).not.toContain(AADHAAR);
    expect(stored.startsWith('v1.')).toBe(true);
  });

  it('produces a different ciphertext every time', () => {
    // A fresh IV per value: two tenants with the same number must not be
    // identifiable as such from the ciphertext.
    const a = service.encrypt(AADHAAR);
    const b = service.encrypt(AADHAAR);
    expect(a).not.toBe(b);
    expect(service.decrypt(a)).toBe(service.decrypt(b));
  });

  it('refuses a tampered ciphertext instead of returning rubbish', () => {
    const stored = service.encrypt(AADHAAR)!;
    const [version, iv, tag, data] = stored.split('.');
    // Flip a byte in the payload.
    const corrupted = Buffer.from(data, 'base64');
    corrupted[0] ^= 0xff;
    const tampered = [version, iv, tag, corrupted.toString('base64')].join('.');

    expect(() => service.decrypt(tampered)).toThrow(ServiceUnavailableException);
  });

  it('refuses a ciphertext written under a different key', () => {
    const stored = service.encrypt(AADHAAR);
    const other = serviceWith(OTHER_KEY);
    expect(() => other.decrypt(stored)).toThrow(/could not be decrypted/i);
  });

  it('refuses an unknown key version rather than guessing', () => {
    expect(() => service.decrypt('v9.aaaa.bbbb.cccc')).toThrow(
      /key version/i,
    );
  });

  it('treats empty values as absent rather than encrypting them', () => {
    expect(service.encrypt(null)).toBeNull();
    expect(service.encrypt('')).toBeNull();
    expect(service.decrypt(null)).toBeNull();
  });

  describe('blind index', () => {
    it('is stable for the same number, so it can be searched', () => {
      expect(service.blindIndex(AADHAAR)).toBe(service.blindIndex(AADHAAR));
    });

    it('ignores spacing, so a number reads the same either way', () => {
      expect(service.blindIndex('1234 1234 1234')).toBe(service.blindIndex(AADHAAR));
    });

    it('differs for different numbers', () => {
      expect(service.blindIndex(AADHAAR)).not.toBe(service.blindIndex('999912341234'));
    });

    it('does not reveal the number it indexes', () => {
      const index = service.blindIndex(AADHAAR)!;
      expect(index).not.toContain(AADHAAR);
      expect(index).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is keyed, so two deployments do not share an index', () => {
      const other = serviceWith(OTHER_KEY);
      expect(service.blindIndex(AADHAAR)).not.toBe(other.blindIndex(AADHAAR));
    });

    it('compares in constant time and rejects mismatches', () => {
      const index = service.blindIndex(AADHAAR);
      expect(service.indexMatches(index, service.blindIndex(AADHAAR))).toBe(true);
      expect(service.indexMatches(index, service.blindIndex('000012341234'))).toBe(false);
      expect(service.indexMatches(index, null)).toBe(false);
    });
  });

  describe('when the key is unavailable', () => {
    const unconfigured = serviceWith(undefined);

    it('reports that it is not configured', () => {
      expect(unconfigured.isConfigured).toBe(false);
      expect(service.isConfigured).toBe(true);
    });

    it('fails closed rather than storing plaintext', () => {
      expect(() => unconfigured.encrypt(AADHAAR)).toThrow(ServiceUnavailableException);
      expect(() => unconfigured.decrypt('v1.a.b.c')).toThrow(ServiceUnavailableException);
      expect(() => unconfigured.blindIndex(AADHAAR)).toThrow(ServiceUnavailableException);
    });

    it('still treats an empty value as absent, so unrelated writes work', () => {
      expect(unconfigured.encrypt(null)).toBeNull();
      expect(unconfigured.blindIndex(null)).toBeNull();
    });
  });

  describe('key validation', () => {
    it.each([
      ['too short', 'c2hvcnQ='],
      ['not a key at all', 'hello'],
    ])('refuses a key that is %s', (_label, key) => {
      const bad = serviceWith(key);
      expect(bad.isConfigured).toBe(false);
      expect(() => bad.encrypt('x')).toThrow(/32-byte key/);
    });

    it('accepts a 64-character hex key', () => {
      const hex = serviceWith('a'.repeat(64));
      expect(hex.isConfigured).toBe(true);
      expect(hex.decrypt(hex.encrypt('abc'))).toBe('abc');
    });
  });
});
