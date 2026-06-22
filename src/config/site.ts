export const brandName = 'Pixel Arc Labs';
export const companyName = 'Pixel Arc Labs LLC';
export const supportEmail = 'hello@pixelarclabs.com';

export type AppEntry = {
  id: string;
  name: string;
  fullName: string;
  tagline: string;
  subtitle: string;
  description: string;
  href: string;
  iconSrc: string;
  appStoreUrl: string | null;
  privacyPath: string;
  features: string[];
};

/** Add new apps here — they appear in the nav dropdown and homepage. */
export const apps: AppEntry[] = [
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
    appStoreUrl: null,
    privacyPath: '/privacy',
    features: [
      'Bills, income, and accounts in one app',
      'Calendar and metrics at a glance',
      'Cloud sync across your devices',
      'ONYX Black — export, widgets, and more',
    ],
  },
];

export const onyx = apps.find((app) => app.id === 'onyx')!;
