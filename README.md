# Pixel Arc Labs Site

A modern company site for [pixelarclabs.com](https://pixelarclabs.com), built with Astro and Tailwind CSS.

## Pages

| URL | Purpose |
|-----|---------|
| `/` | Company landing page |
| `/contact` | Support contact form |
| `/privacy` | Privacy policy |

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:4321](http://localhost:4321).

## Build

```bash
npm run build
npm run preview
```

Static output is written to `dist/`.

## Deploy to Netlify

Build settings are in `netlify.toml` (`npm run build`, publish `dist/`). Push to GitHub and Netlify auto-deploys.

## Contact form

The `/contact` page uses [Netlify Forms](https://docs.netlify.com/forms/setup/). After deploying:

1. Netlify dashboard → your site → **Forms** — confirm the `contact` form appears
2. **Form notifications** → add email notification → `hello@pixelarclabs.com`
3. Submit a test message at `https://pixelarclabs.com/contact` to verify delivery

Form detection must stay **enabled** in Netlify (Site configuration → Forms).

## App Store Connect

Use these URLs when submitting apps:

- **Support URL:** `https://pixelarclabs.com`
- **Privacy Policy URL:** `https://pixelarclabs.com/privacy`
- **Marketing URL (optional):** `https://pixelarclabs.com`

Support contact: [hello@pixelarclabs.com](mailto:hello@pixelarclabs.com)
