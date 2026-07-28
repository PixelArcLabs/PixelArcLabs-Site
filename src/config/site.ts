export const brandName = 'Pixel Arc Labs';
export const companyName = 'Pixel Arc Labs LLC';
export const supportEmail = 'hello@pixelarclabs.com';

export type AppPlatform = 'iOS' | 'macOS';

export type AppEntry = {
  id: string;
  name: string;
  fullName: string;
  tagline: string;
  subtitle: string;
  description: string;
  href: string;
  iconSrc: string;
  platform: AppPlatform;
  /** App Store URL when available (iOS). */
  appStoreUrl: string | null;
  /** One-time price label for direct sales (e.g. "$9.99"). */
  price: string | null;
  /** Path to the product sales page when sold on the web. */
  buyPath: string | null;
  privacyPath: string;
  termsPath: string;
  features: string[];
};

/** Add new apps here — they appear in the nav dropdown and homepage. */
export const apps: AppEntry[] = [
  {
    id: 'holodock',
    name: 'HoloDock',
    fullName: 'HoloDock for Mac',
    tagline: 'Window peeks for your Dock.',
    subtitle: 'Dock window previews',
    description:
      'Hover a Dock icon to peek open windows, then click the one you want. A lightweight menu-bar utility for macOS — private, fast, and built for daily use.',
    href: '/holodock',
    iconSrc: '/holodock-icon-v2.png',
    platform: 'macOS',
    appStoreUrl: null,
    price: '$9.99',
    buyPath: '/holodock',
    privacyPath: '/privacy',
    termsPath: '/terms',
    features: [
      'Hover Dock icons for live window peeks',
      'Click a thumbnail to jump straight to that window',
      'Keyboard navigation and quick close',
      'Everything stays on your Mac — no cloud uploads',
    ],
  },
  {
    id: 'onyx',
    name: 'ONYX',
    fullName: 'ONYX: Bill & Money Tracker',
    tagline: 'Know what’s due. Know what’s left.',
    subtitle: 'Bill & money tracker',
    description:
      'A thoughtful bill and money tracker for iPhone. Track bills, income, and accounts in one calm place — with calendar views, cloud sync, and optional ONYX Black for export and more.',
    href: '/#onyx',
    iconSrc: '/onyx-logo.png',
    platform: 'iOS',
    appStoreUrl: null,
    price: null,
    buyPath: null,
    privacyPath: '/privacy',
    termsPath: '/terms',
    features: [
      'Bills, income, and accounts in one app',
      'Calendar and metrics at a glance',
      'Cloud sync across your devices',
      'ONYX Black — export, widgets, and more',
    ],
  },
];

export const onyx = apps.find((app) => app.id === 'onyx')!;
export const holodock = apps.find((app) => app.id === 'holodock')!;

/** Live Stripe Payment Link (override via PUBLIC_HOLODOCK_CHECKOUT_URL). */
export const holodockCheckoutUrlLive =
  import.meta.env.PUBLIC_HOLODOCK_CHECKOUT_URL?.trim() ||
  'https://buy.stripe.com/dRm28r1BG1gi0MM74cgEg00';

/** Test-mode Payment Link — use with ?sandbox=1 (override via PUBLIC_HOLODOCK_CHECKOUT_URL_TEST). */
export const holodockCheckoutUrlTest =
  import.meta.env.PUBLIC_HOLODOCK_CHECKOUT_URL_TEST?.trim() ||
  'https://buy.stripe.com/test_dRm28r1BG1gi0MM74cgEg00';

/** Build-time sandbox (deploy previews). Runtime toggle: /holodock?sandbox=1 */
export const holodockSandboxByDefault =
  import.meta.env.PUBLIC_HOLODOCK_SANDBOX === 'true';

/** @deprecated Prefer holodockCheckoutUrlLive / resolving sandbox at runtime. */
export const holodockCheckoutUrl = holodockCheckoutUrlLive;

export const holodockPrice = '$9.99';
