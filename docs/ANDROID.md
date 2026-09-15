# Building and running the Android app

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

The debug APK lands in `app/android/app/build/outputs/apk/debug/`.

`app/android/` is generated and git-ignored; `npx cap add android` recreates it
on a fresh clone.

## Pointing the app at your server

The server address is set **in the app**, from the icon at the top right of the
sign-in screen, and again later under Settings → App & server. One APK
therefore works against any deployment, and the address survives reinstalling
the backend.

Useful values:

| Where the backend runs | Address to enter |
|---|---|
| Your machine, app in the Android emulator | `http://10.0.2.2:3000` |
| A server on your home network | `http://192.168.1.20:3000` |
| A hosted deployment | `https://pg.example.com` |

The app appends `/api` itself if you leave it off.

## Plaintext HTTP on a LAN

Android blocks cleartext HTTP by default. A self-hosted backend without TLS
needs its host allowed explicitly.

Create `app/android/app/src/main/res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Allow plaintext only to the specific server, never to everything. -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">192.168.1.20</domain>
        <domain includeSubdomains="false">10.0.2.2</domain>
    </domain-config>
</network-security-config>
```

Reference it from `app/android/app/src/main/AndroidManifest.xml`:

```xml
<application
    android:networkSecurityConfig="@xml/network_security_config"
    ... >
```

Prefer listing the exact hosts over setting
`android:usesCleartextTraffic="true"`, which turns the protection off for every
destination.

If you put the backend behind TLS — a reverse proxy with a certificate, or a
tunnel — none of this is needed.

## Permissions

`@capacitor/camera` adds the camera and photo-library permissions to the
manifest during `cap sync`. They are requested at the moment a document is
captured, not at launch.

## CORS

The backend must allow the app's origin. `CORS_ORIGINS` already includes the
Capacitor origins by default:

```
capacitor://localhost,http://localhost,https://localhost
```

Add your development machine's address if you run the app in a browser against
a remote backend.
