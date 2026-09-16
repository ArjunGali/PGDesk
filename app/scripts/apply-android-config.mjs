#!/usr/bin/env node
/**
 * Applies the project's Android configuration to the generated native project.
 *
 * `app/android/` is build output: it is gitignored, it is recreated by
 * `npx cap add android`, and anything edited there by hand is lost on the next
 * clean checkout. So the parts we actually care about — launcher icon, splash,
 * cleartext policy for a LAN backend, camera and storage permissions — live in
 * `app/android-template/` under version control, and this script copies them
 * over after a sync.
 *
 * It is idempotent: running it twice changes nothing the second time.
 *
 * Usage:  npm run android:configure      (chained into android:sync)
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(APP, 'android-template');
const ANDROID = join(APP, 'android');
const MANIFEST = join(ANDROID, 'app/src/main/AndroidManifest.xml');

const changes = [];
const notes = [];

if (!existsSync(ANDROID)) {
  console.error(
    'app/android/ does not exist yet.\n' +
      'Create the native project first:  npx cap add android\n' +
      'then run this again (npm run android:sync does both).',
  );
  process.exit(1);
}

removeStockSplashBitmaps();
copyTree(TEMPLATE, ANDROID);
patchManifest();
checkOrientation();
checkAppName();

for (const note of notes) console.log(`  note: ${note}`);
if (changes.length === 0) {
  console.log('Android project already matches android-template/ — nothing to do.');
} else {
  console.log(`Applied ${changes.length} change${changes.length === 1 ? '' : 's'} to app/android/:`);
  for (const change of changes) console.log(`  ${change}`);
}

/**
 * Capacitor ships a splash bitmap per density and orientation. Ours is a
 * layer-list at res/drawable/splash.xml, and a density-qualified PNG of the
 * same name would win over it on every real device, so the stock ones go.
 */
function removeStockSplashBitmaps() {
  const res = join(ANDROID, 'app/src/main/res');
  if (!existsSync(res)) return;
  for (const dir of readdirSync(res)) {
    if (!/^drawable(-(port|land)-\w+)?$/.test(dir)) continue;
    const stale = join(res, dir, 'splash.png');
    if (!existsSync(stale)) continue;
    rmSync(stale);
    changes.push(`removed ${relative(APP, stale)}`);
  }
}

/** Copies every file under the template, skipping ones already identical. */
function copyTree(from, to) {
  for (const entry of readdirSync(from)) {
    const source = join(from, entry);
    const target = join(to, entry);
    if (statSync(source).isDirectory()) {
      mkdirSync(target, { recursive: true });
      copyTree(source, target);
      continue;
    }
    if (existsSync(target) && readFileSync(target).equals(readFileSync(source))) continue;
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    changes.push(`copied ${relative(APP, target)}`);
  }
}

/**
 * Adds the attributes and permissions Capacitor's stock manifest does not
 * carry. Everything here is matched before it is inserted, so re-running is
 * safe and a manual edit that already did the same thing is left alone.
 */
function patchManifest() {
  if (!existsSync(MANIFEST)) {
    notes.push('AndroidManifest.xml not found — skipped manifest patching.');
    return;
  }
  let manifest = readFileSync(MANIFEST, 'utf8');
  const before = manifest;

  // The LAN backend has no TLS certificate, so the hosts listed in
  // res/xml/network_security_config.xml are allowed over plain HTTP and
  // everything else keeps Android's HTTPS-only default.
  manifest = addApplicationAttribute(
    manifest,
    'android:networkSecurityConfig',
    '@xml/network_security_config',
  );

  // Exports are written to the device's shared Documents folder so the person
  // can hand the file to an accountant. On Android 10 that needs the legacy
  // path; 11+ ignores this flag and scopes writes to the app's own files.
  manifest = addApplicationAttribute(manifest, 'android:requestLegacyExternalStorage', 'true');

  // Document capture offers "camera or gallery"; exports write a file.
  // maxSdkVersion keeps the storage permissions off modern devices, which use
  // the system photo picker and scoped storage instead.
  manifest = addPermission(manifest, 'android.permission.CAMERA');
  manifest = addPermission(manifest, 'android.permission.READ_EXTERNAL_STORAGE', 32);
  manifest = addPermission(manifest, 'android.permission.WRITE_EXTERNAL_STORAGE', 29);

  if (manifest !== before) {
    writeFileSync(MANIFEST, manifest);
    changes.push(`patched ${relative(APP, MANIFEST)}`);
  }
}

function addApplicationAttribute(manifest, name, value) {
  if (manifest.includes(`${name}=`)) return manifest;
  return manifest.replace(/<application\b/, `<application\n        ${name}="${value}"`);
}

function addPermission(manifest, name, maxSdkVersion) {
  if (manifest.includes(`"${name}"`)) return manifest;
  const attrs =
    `android:name="${name}"` +
    (maxSdkVersion === undefined ? '' : ` android:maxSdkVersion="${maxSdkVersion}"`);
  return manifest.replace(
    /\n([ \t]*)<application\b/,
    `\n$1<uses-permission ${attrs} />\n$1<application`,
  );
}

/**
 * One APK has to work on a phone held either way and on a tablet, so the
 * activity must not pin an orientation. This only reports: silently rewriting
 * someone's deliberate choice would be worse than telling them about it.
 */
function checkOrientation() {
  if (!existsSync(MANIFEST)) return;
  const manifest = readFileSync(MANIFEST, 'utf8');
  const locked = manifest.match(/android:screenOrientation="(?!fullSensor|sensor|unspecified|user)([^"]+)"/);
  if (locked) {
    notes.push(
      `AndroidManifest.xml locks the activity to "${locked[1]}". ` +
        'Remove android:screenOrientation so the one APK rotates on phones and tablets.',
    );
  }
  if (!manifest.includes('android:configChanges')) {
    notes.push('MainActivity has no android:configChanges — rotating will restart the WebView.');
  }
}

/** The launcher label comes from capacitor.config.ts; confirm it survived. */
function checkAppName() {
  const strings = join(ANDROID, 'app/src/main/res/values/strings.xml');
  if (!existsSync(strings)) return;
  const contents = readFileSync(strings, 'utf8');
  const name = contents.match(/<string name="app_name">([^<]*)<\/string>/);
  if (name && name[1] !== 'PG Management') {
    notes.push(`strings.xml app_name is "${name[1]}", expected "PG Management".`);
  }
}
