# Building and running the Android app

## How the pieces connect

Nothing leaves the property. There is no cloud account, no Firebase, no push
service and nothing to pay for monthly.

```
  ┌──────────────┐   ┌──────────────┐
  │  PHONE       │   │  TABLET      │     One APK. Layout adapts at runtime
  │  (Android)   │   │  (Android)   │     to width and orientation.
  └──────┬───────┘   └──────┬───────┘
         │                  │
         └────────┬─────────┘
                  │  HTTP over the LAN  (Wi-Fi / Ethernet)
                  │  e.g. http://192.168.1.20:3000/api
                  ▼
        ┌─────────────────────┐
        │  LOCAL NETWORK      │   Home or office router. No port forwarding,
        │  (router / switch)  │   no internet exposure.
        └──────────┬──────────┘
                   ▼
        ┌─────────────────────┐
        │  BACKEND            │   NestJS on the owner's machine or a small
        │  0.0.0.0:3000       │   always-on box. Source of truth for every
        │                     │   calculation; the app computes nothing.
        └──────────┬──────────┘
                   │  localhost:5432
                   ▼
        ┌─────────────────────┐
        │  POSTGRESQL         │   Docker container or a local install.
        │                     │   Aadhaar encrypted at rest.
        └─────────────────────┘
```

The backend and the database normally sit on the same machine, so the only
traffic on the network is between the devices and the API. If the machine is
off, the app says it cannot reach the server; it does not show stale numbers as
if they were current.

Running the backend on the internet instead works without any change to the
app — enter an `https://` address — but see [`SECURITY.md`](SECURITY.md) first.

---

## Prerequisites

- Node 20+
- JDK 17
- Android Studio, or the Android SDK with `ANDROID_HOME` set

## First build

```bash
cd app
npm install
npm run build
npx cap add android      # once — creates app/android/
npm run android:sync
```

Then either open the project in Android Studio (`npm run android:open`) or
build from the command line:

```bash
npm run android:build    # debug APK
npm run android:release  # release APK (needs a signing config)
```

The debug APK lands in `app/android/app/build/outputs/apk/debug/app-debug.apk`.

## `android/` is generated — `android-template/` is not

`app/android/` is build output. It is git-ignored and `npx cap add android`
recreates it from scratch, so anything edited there by hand disappears on the
next clean checkout.

The parts that matter are therefore kept under version control in
`app/android-template/`, mirroring the same paths, and copied in by:

```bash
npm run android:configure
```

which `npm run android:sync` already runs for you. It is idempotent — running
it twice changes nothing the second time. It applies:

| What | Where |
|---|---|
| Launcher icon (adaptive, all five densities) | `res/mipmap-*/` |
| Splash screen (colour + centred mark, never stretched) | `res/drawable/splash.xml` |
| Cleartext policy for the LAN server | `res/xml/network_security_config.xml` |
| Camera and storage permissions | `AndroidManifest.xml` |
| `android:networkSecurityConfig`, `requestLegacyExternalStorage` | `AndroidManifest.xml` |

It also warns if the manifest has picked up an orientation lock, or if the app
name no longer matches.

Edit `app/android-template/**`, never `app/android/**`.

## Project settings

| Setting | Value | Where |
|---|---|---|
| App name | PG Management | `capacitor.config.ts` → `res/values/strings.xml` |
| Application ID | `com.pgmanagement.app` | `capacitor.config.ts` → `app/build.gradle` |
| Version | `1.0` (code 1) | `android/app/build.gradle` |
| Min SDK | 22 (Android 5.1) | `android/variables.gradle` |
| Target SDK | 34 (Android 14) | `android/variables.gradle` |
| Orientation | unlocked — the activity handles rotation itself | `AndroidManifest.xml` |

One APK covers phones and tablets in both orientations. The activity declares
`configChanges` for orientation, screen size and layout, so rotating re-lays
out the page instead of restarting it and losing what was typed.

---

## Pointing the app at your server

The server address is set **in the app**, from the icon at the top right of the
profile screen, and again later under Settings → App & server. One APK
therefore works against any deployment, and the address survives reinstalling
the backend.

| Where the backend runs | Address to enter |
|---|---|
| Your machine, app in the Android emulator | `http://10.0.2.2:3000` |
| A server on your home network | `http://192.168.1.20:3000` |
| A hosted deployment | `https://pg.example.com` |

The app appends `/api` itself if you leave it off.

Find the server's LAN address with `ip addr` (Linux), `ipconfig` (Windows) or
`ifconfig` (macOS). Give that machine a static address or a DHCP reservation,
otherwise it will change and every device will need re-pointing.

## Plaintext HTTP on a LAN

Android blocks cleartext HTTP by default, and a self-hosted backend on
`192.168.1.20` has no certificate. So the specific hosts are allowed by name in
`app/android-template/app/src/main/res/xml/network_security_config.xml`:

```xml
<network-security-config>
    <!-- Everything not listed keeps Android's default: HTTPS only. -->
    <base-config cleartextTrafficPermitted="false" />

    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
        <domain includeSubdomains="false">localhost</domain>
        <!-- Add your server: -->
        <domain includeSubdomains="false">192.168.1.20</domain>
    </domain-config>
</network-security-config>
```

Add your server's address, then `npm run android:configure` and rebuild.

This is deliberately a list of hosts rather than
`android:usesCleartextTraffic="true"`, which would switch the protection off
for every destination the app could ever reach. If you put the backend behind
TLS, delete the domain entries and nothing else changes.

## Permissions

Only three, none requested at launch:

| Permission | Why | Asked when |
|---|---|---|
| `INTERNET` | Reaching the backend | Never — granted at install |
| `CAMERA` | Photographing a tenant's documents | The first time someone taps the camera |
| `READ_EXTERNAL_STORAGE` (≤ SDK 32) / `WRITE_EXTERNAL_STORAGE` (≤ SDK 29) | Saving a PDF/Excel export to the device's Documents folder | The first time someone exports |

The storage permissions carry `maxSdkVersion` so modern devices never see
them — Android 11+ uses scoped storage and the system photo picker instead.
`requestLegacyExternalStorage` covers Android 10, which is the one version that
needs it to write to the shared Documents folder.

There is no location permission, no contacts permission, no background service
and no analytics.

## CORS

The backend must allow the app's origin. `CORS_ORIGINS` already includes the
Capacitor origins by default:

```
capacitor://localhost,http://localhost,https://localhost
```

Add your development machine's address if you run the app in a browser against
a remote backend.

## Signing a release build

`npm run android:release` needs a signing config; without one Gradle produces
an unsigned APK. Create a keystore once:

```bash
keytool -genkey -v -keystore pg-release.keystore \
        -alias pg -keyalg RSA -keysize 2048 -validity 10000
```

Keep it and its passwords out of the repository — `*.keystore` is git-ignored —
and reference it from `~/.gradle/gradle.properties` or the environment, not
from `build.gradle`. Losing the keystore means never being able to update an
installed app.

For testing on your own devices the debug APK is enough.
