import type { CapacitorConfig } from '@capacitor/cli';

/**
 * One APK for phones and tablets, portrait and landscape. The layout adapts at
 * runtime from the available width rather than shipping separate builds.
 */
const config: CapacitorConfig = {
  appId: 'com.pgmanagement.app',
  appName: 'PG Management',
  webDir: 'dist',
  android: {
    // The API is reached over HTTPS in production. For a LAN/self-hosted
    // server without TLS, set this to true and list the host in
    // android/app/src/main/res/xml/network_security_config.xml.
    allowMixedContent: false,
  },
  plugins: {
    Keyboard: { resizeOnFullScreen: true },
    StatusBar: { overlaysWebView: false },
  },
};

export default config;
