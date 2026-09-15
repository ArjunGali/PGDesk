import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { BuildingIcon, MoonIcon, ServerIcon, SunIcon } from '@/components/Icons';
import { FormRow, Sheet } from '@/components/ui';
import { getBaseUrl, setBaseUrl } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

const schema = z.object({
  username: z.string().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
});

type FormValues = z.infer<typeof schema>;

export function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverSheetOpen, setServerSheetOpen] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login(values.username, values.password);
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : 'Could not sign in. Please try again.',
      );
    }
  });

  return (
    <div
      className="min-h-screen bg-base flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="flex justify-end p-3 gap-1">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="btn-ghost w-touch h-touch !min-h-0 !px-0"
        >
          {theme === 'dark' ? <SunIcon size={21} /> : <MoonIcon size={21} />}
        </button>
        <button
          type="button"
          onClick={() => setServerSheetOpen(true)}
          aria-label="Server settings"
          className="btn-ghost w-touch h-touch !min-h-0 !px-0"
        >
          <ServerIcon size={21} />
        </button>
      </div>

      <div className="grow flex items-center justify-center px-5 pb-16">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-9">
            <div className="w-16 h-16 rounded-2xl bg-accent/12 border border-accent/25 flex items-center justify-center mb-4">
              <BuildingIcon size={30} className="text-accent" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">PG Management</h1>
            <p className="text-sm text-ink-muted mt-1">Sign in to continue</p>
          </div>

          <form onSubmit={onSubmit} noValidate>
            <FormRow label="Username" error={errors.username?.message}>
              <input
                {...register('username')}
                className="input"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                enterKeyHint="next"
              />
            </FormRow>

            <FormRow label="Password" error={errors.password?.message}>
              <input
                {...register('password')}
                type="password"
                className="input"
                autoComplete="current-password"
                enterKeyHint="go"
              />
            </FormRow>

            {serverError && (
              <p className="text-sm text-critical mb-4 leading-relaxed">{serverError}</p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>

      <ServerSheet open={serverSheetOpen} onClose={() => setServerSheetOpen(false)} />
    </div>
  );
}

/**
 * The server address is configurable in the app, so one APK works whether the
 * owner runs the backend on their own machine, on the LAN, or hosted.
 */
function ServerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState(false);

  const load = async (): Promise<void> => {
    setUrl(await getBaseUrl());
    setSaved(false);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Server address"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={async () => {
              await setBaseUrl(url);
              setSaved(true);
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div onFocus={url ? undefined : load}>
        <FormRow
          label="API address"
          hint="For example http://192.168.1.20:3000 on your home network, or your hosted address."
        >
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setSaved(false);
            }}
            onFocus={url ? undefined : load}
            placeholder="http://192.168.1.20:3000"
            className="input"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="url"
          />
        </FormRow>
        {saved && <p className="text-sm text-positive">Saved. Try signing in again.</p>}
      </div>
    </Sheet>
  );
}
