import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftIcon, FingerprintIcon } from '@/components/Icons';
import { initials } from '@/lib/format';
import { useAuthStore, type Profile } from '@/stores/auth.store';

const PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 8;

/**
 * App-level PIN entry.
 *
 * Deliberately NOT the device's fingerprint sensor or Android's biometric API:
 * this is the app's own lock, so the same APK behaves identically on a shared
 * tablet with no enrolled fingerprint as it does on a personal phone, and the
 * PIN is checked on the server rather than trusted from the device.
 *
 * The fingerprint mark above the dots is the visual language people expect
 * from an unlock screen; tapping it focuses the keypad.
 */
export function PinScreen({
  profile,
  onBack,
}: {
  profile: Profile;
  onBack: () => void;
}) {
  const unlock = useAuthStore((s) => s.unlock);
  const setInitialPin = useAuthStore((s) => s.setInitialPin);

  const settingUp = !profile.hasPin;
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [stage, setStage] = useState<'enter' | 'confirm'>('enter');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const active = stage === 'confirm' ? confirmPin : pin;
  const setActive = stage === 'confirm' ? setConfirmPin : setPin;

  const fail = useCallback((message: string) => {
    setError(message);
    setShake(true);
    navigator.vibrate?.([12, 60, 12]);
    window.setTimeout(() => setShake(false), 420);
  }, []);

  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      try {
        if (settingUp) {
          await setInitialPin(profile.id, value);
        } else {
          await unlock(profile.id, value);
        }
      } catch (e) {
        setPin('');
        setConfirmPin('');
        setStage('enter');
        fail(e instanceof Error ? e.message : 'That did not work. Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [fail, profile.id, setInitialPin, settingUp, unlock],
  );

  const press = useCallback(
    (digit: string) => {
      if (busy) return;
      setError(null);

      const next = (active + digit).slice(0, MAX_PIN_LENGTH);
      setActive(next);

      if (next.length < PIN_LENGTH) return;

      // Setting up: take the first PIN, then ask for it again before saving.
      if (settingUp && stage === 'enter' && next.length === PIN_LENGTH) {
        setStage('confirm');
        return;
      }
      if (settingUp && stage === 'confirm' && next.length === PIN_LENGTH) {
        if (next !== pin) {
          setPin('');
          setConfirmPin('');
          setStage('enter');
          fail('Those PINs did not match. Start again.');
          return;
        }
        void submit(next);
        return;
      }
      if (!settingUp && next.length === PIN_LENGTH) {
        void submit(next);
      }
    },
    [active, busy, fail, pin, setActive, settingUp, stage, submit],
  );

  const backspace = useCallback(() => {
    if (busy) return;
    setError(null);
    setActive(active.slice(0, -1));
  }, [active, busy, setActive]);

  // A hardware keyboard is useful on a tablet in a case.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') backspace();
      else if (event.key === 'Escape') onBack();
      else if (event.key === 'Enter' && active.length >= PIN_LENGTH) void submit(active);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, backspace, onBack, press, submit]);

  const tint = profile.avatarColor ?? '#8B9296';
  const heading = settingUp
    ? stage === 'enter'
      ? 'Choose a PIN'
      : 'Enter it again'
    : 'Enter your PIN';

  return (
    <div
      className="min-h-screen bg-base flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="p-3">
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost h-touch !min-h-0 px-3"
          aria-label="Back to profiles"
        >
          <ArrowLeftIcon size={20} />
          <span className="text-sm">Profiles</span>
        </button>
      </div>

      <div className="grow flex flex-col items-center justify-center px-5 pb-6">
        <div className="w-full max-w-xs flex flex-col items-center">
          {profile.avatarPath ? (
            <img
              src={profile.avatarPath}
              alt=""
              className="w-16 h-16 rounded-full object-cover border border-line mb-3"
            />
          ) : (
            <span
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-semibold border mb-3"
              style={{
                backgroundColor: `${tint}22`,
                borderColor: `${tint}55`,
                color: tint,
              }}
            >
              {initials(profile.fullName)}
            </span>
          )}

          <p className="font-semibold">{profile.fullName}</p>
          <p className="text-xs text-ink-muted mb-6">
            {profile.roleNames.join(', ') || (profile.isOwner ? 'Owner' : '')}
          </p>

          <FingerprintIcon
            size={46}
            className={`mb-4 transition-colors ${
              error ? 'text-critical' : busy ? 'text-accent' : 'text-ink-faint'
            }`}
          />

          <p className="text-base font-medium mb-1">{heading}</p>
          {settingUp && stage === 'enter' && (
            <p className="text-xs text-ink-muted mb-3 text-center">
              4 digits. Avoid 1234 or the same digit repeated.
            </p>
          )}

          <div
            className={`flex gap-3.5 my-5 ${shake ? 'animate-shake' : ''}`}
            role="status"
            aria-label={`${active.length} of ${PIN_LENGTH} digits entered`}
          >
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <span
                key={i}
                className={`w-3.5 h-3.5 rounded-full border-2 transition-colors ${
                  i < active.length
                    ? error
                      ? 'bg-critical border-critical'
                      : 'bg-accent border-accent'
                    : 'border-line-strong'
                }`}
              />
            ))}
          </div>

          <p className="text-sm text-critical text-center min-h-[2.5rem] px-2">
            {error ?? ''}
          </p>

          <div className="grid grid-cols-3 gap-3 w-full mt-1">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <PinKey key={digit} label={digit} onPress={() => press(digit)} disabled={busy} />
            ))}
            <span />
            <PinKey label="0" onPress={() => press('0')} disabled={busy} />
            <PinKey label="⌫" onPress={backspace} disabled={busy} muted />
          </div>

          {busy && <p className="text-sm text-ink-muted mt-5">Checking…</p>}
        </div>
      </div>
    </div>
  );
}

function PinKey({
  label,
  onPress,
  disabled,
  muted = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className={`h-16 rounded-xl border border-line text-2xl font-medium
                  transition-colors active:brightness-125
                  disabled:opacity-45 disabled:pointer-events-none ${
                    muted ? 'bg-surface-sunken text-ink-muted' : 'bg-surface-raised text-ink'
                  }`}
    >
      {label}
    </button>
  );
}
