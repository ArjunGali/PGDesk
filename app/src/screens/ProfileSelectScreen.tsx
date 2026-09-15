import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  BuildingIcon,
  MoonIcon,
  ServerIcon,
  SunIcon,
} from '@/components/Icons';
import { FormRow, Sheet } from '@/components/ui';
import { api, getBaseUrl, setBaseUrl } from '@/lib/api';
import { initials } from '@/lib/format';
import { useAuthStore, type Profile } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { PinScreen } from './PinScreen';

/**
 * The first screen in the app.
 *
 * There is no username and no password. The person taps their own face on a
 * list and enters a short PIN — the same gesture as unlocking anything else
 * they own, and nothing to remember or type on a phone keyboard.
 */
export function ProfileSelectScreen() {
  const selectedProfile = useAuthStore((s) => s.selectedProfile);
  const selectProfile = useAuthStore((s) => s.selectProfile);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const [serverOpen, setServerOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['profiles'],
    queryFn: () => api.get<Profile[]>('/auth/profiles'),
    retry: 1,
  });

  // Once a profile is chosen the screen becomes the PIN pad.
  if (selectedProfile) {
    return <PinScreen profile={selectedProfile} onBack={() => selectProfile(null)} />;
  }

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
          onClick={() => setServerOpen(true)}
          aria-label="Server settings"
          className="btn-ghost w-touch h-touch !min-h-0 !px-0"
        >
          <ServerIcon size={21} />
        </button>
      </div>

      <div className="grow flex flex-col items-center justify-center px-5 pb-16">
        <div className="w-full max-w-2xl">
          <div className="flex flex-col items-center mb-10">
            <div className="w-14 h-14 rounded-2xl bg-accent/12 border border-accent/25 flex items-center justify-center mb-5">
              <BuildingIcon size={26} className="text-accent" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-center">
              Who&rsquo;s using the app?
            </h1>
            <p className="text-sm text-ink-muted mt-1.5 text-center">
              Tap your profile to continue
            </p>
          </div>

          {isLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="card h-44 animate-pulse" />
              ))}
            </div>
          )}

          {error && (
            <div className="card p-6 text-center">
              <p className="font-medium">Cannot reach the server</p>
              <p className="text-sm text-ink-muted mt-1.5">
                {error instanceof Error ? error.message : 'Please try again.'}
              </p>
              <div className="flex gap-2 justify-center mt-5">
                <button type="button" className="btn-secondary" onClick={() => refetch()}>
                  Try again
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setServerOpen(true)}
                >
                  Server address
                </button>
              </div>
            </div>
          )}

          {data && data.length === 0 && (
            <div className="card p-6 text-center">
              <p className="font-medium">No profiles yet</p>
              <p className="text-sm text-ink-muted mt-1.5">
                Run the setup seed on the server to create the Owner profile.
              </p>
            </div>
          )}

          {data && data.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {data.map((profile) => (
                <ProfileCard
                  key={profile.id}
                  profile={profile}
                  onSelect={() => selectProfile(profile)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <ServerSheet open={serverOpen} onClose={() => setServerOpen(false)} />
    </div>
  );
}

function ProfileCard({
  profile,
  onSelect,
}: {
  profile: Profile;
  onSelect: () => void;
}) {
  const locked = profile.lockedUntil !== null;
  const tint = profile.avatarColor ?? '#8B9296';

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={locked}
      className="card p-4 flex flex-col items-center gap-3 text-center
                 hover:border-line-strong active:scale-[0.98] transition-all
                 disabled:opacity-50 disabled:pointer-events-none min-h-[11rem] justify-center"
    >
      {profile.avatarPath ? (
        <img
          src={profile.avatarPath}
          alt=""
          className="w-16 h-16 rounded-full object-cover border border-line"
        />
      ) : (
        <span
          className="w-16 h-16 rounded-full flex items-center justify-center
                     text-xl font-semibold border"
          style={{
            backgroundColor: `${tint}22`,
            borderColor: `${tint}55`,
            color: tint,
          }}
        >
          {initials(profile.fullName)}
        </span>
      )}

      <div className="min-w-0">
        <p className="font-semibold truncate">{profile.fullName}</p>
        <p className="text-xs text-ink-muted truncate">
          {profile.roleNames.join(', ') || (profile.isOwner ? 'Owner' : 'No role')}
        </p>
      </div>

      {locked && <span className="chip text-critical border-critical/35">Locked</span>}
      {!locked && !profile.hasPin && (
        <span className="chip text-accent border-accent/35">Set up PIN</span>
      )}
    </button>
  );
}

/** The backend address, so one APK works against any deployment. */
function ServerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (open && !loaded) {
    setLoaded(true);
    void getBaseUrl().then(setUrl);
  }

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
              // The profile list is fetched from the new address on reload.
              window.location.reload();
            }}
          >
            Save
          </button>
        </>
      }
    >
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
          placeholder="http://192.168.1.20:3000"
          className="input"
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="url"
        />
      </FormRow>
      {saved && <p className="text-sm text-positive">Saved.</p>}
    </Sheet>
  );
}
