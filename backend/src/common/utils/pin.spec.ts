import { assertPinFormat } from './pin';

/**
 * A short PIN is only acceptable because the obvious ones are refused and
 * repeated attempts are throttled. These are the rules that make it so.
 */
describe('assertPinFormat', () => {
  it.each(['4071', '8305', '90210', '73519024'])('accepts %s', (pin) => {
    expect(() => assertPinFormat(pin)).not.toThrow();
  });

  it.each([
    ['123', 'too short'],
    ['123456789', 'too long'],
    ['12a4', 'not digits'],
    ['', 'empty'],
  ])('rejects %s (%s)', (pin) => {
    expect(() => assertPinFormat(pin)).toThrow(/4 to 8 digits/);
  });

  it.each(['0000', '1111', '99999999'])('rejects the repeated digit %s', (pin) => {
    expect(() => assertPinFormat(pin)).toThrow(/repeating one digit/);
  });

  it.each(['1234', '2345', '456789', '9876', '43210'])(
    'rejects the running sequence %s',
    (pin) => {
      expect(() => assertPinFormat(pin)).toThrow(/running sequences/);
    },
  );
});
