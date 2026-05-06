const appVersion = import.meta.env.VITE_APP_VERSION || '0.1.0';
const buildDate = import.meta.env.VITE_BUILD_DATE || '';

export const APP_VERSION_DISPLAY = buildDate ? `${appVersion} (${buildDate})` : appVersion;