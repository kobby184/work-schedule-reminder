# ShiftReady

ShiftReady is an Expo React Native app for nurses and shift workers. It supports iOS, Android, and a web preview. The MVP is local-first, with Supabase and Google Document AI hooks ready for production configuration.

## What Is Implemented

- Profile onboarding with display name, contact email, mobile phone, schedule aliases, time zone, call-off phone number, and 4-hour reminder default.
- Photo/PDF/text schedule import flow with PHI blocking rules.
- Browser preview image OCR fallback with `tesseract.js` when Supabase is not configured.
- Profile-only extraction using display name, saved aliases, first/last name variants, and initials before shifts are shown for review.
- Monthly grid fallback that can turn profile-row shift codes such as day/evening/night into editable candidates while preserving off-day positions.
- OCR layout extraction that maps the matched profile row back to calendar date columns.
- Reset Demo action that clears saved local profile, shifts, and call-off logs.
- Confirm-before-save review for detected shifts, including editable title, unit, role, date, start/end times, notes, and day/evening/night presets.
- Manual shift creation, schedule list, status changes, deletion, and call-off log.
- 4-hour local mobile reminders with `expo-notifications`, including Going and Call Off notification actions.
- Optional device calendar export with `expo-calendar`.
- User-phone call-off workflow using the device phone app.
- Supabase schema, RLS policies, private upload bucket, and Edge Function scaffolding.

## Local Development

```sh
npm install
npm run web
```

If your shell does not have npm, this workspace was bootstrapped with a local npm wrapper from `../../work/npm-bootstrap/bin`.

## GitHub Pages Hosting

This repo includes a static GitHub Pages build in `docs/`.
After pushing to GitHub, open the repository settings and enable Pages with:

- Source: Deploy from a branch
- Branch: `main`
- Folder: `/docs`

The Expo web export uses a relative base path in `app.json`, so the hosted demo works from a GitHub Pages project URL such as:

```text
https://YOUR_GITHUB_USERNAME.github.io/work-schedule-reminder/
```

## Environment

Copy `.env.example` to `.env` and set:

```sh
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

Without those values, the app runs in local mode using device storage. In the web preview, uploaded images are read with a browser OCR fallback. PDFs and mobile OCR still require the Supabase/Document AI backend.
Call-off calls do not require Twilio. The app opens the saved call-off number with the user's own phone app.

## Supabase Deployment

1. Create separate staging and production Supabase projects.
2. Run the migration:

```sh
supabase db push
```

3. Deploy functions:

```sh
supabase functions deploy parse-shift-upload
supabase functions deploy confirm-shifts
supabase functions deploy cleanup-expired-uploads
```

4. Set Edge Function secrets:

```sh
supabase secrets set GOOGLE_DOCUMENT_AI_PROCESS_URL=...
supabase secrets set GOOGLE_SERVICE_ACCOUNT_EMAIL=...
supabase secrets set GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=...
supabase secrets set CLEANUP_JOB_SECRET=...
```

The parser function refuses to invent demo shifts until the Document AI file-to-OCR exchange is enabled with Google service account credentials.
The call-off phone number should be stored in E.164 format when possible, for example `+15551234567`.

## User-Phone Call-Off Calls

- In the app, add the workplace call-off number in Settings.
- On a shift card, Call Off opens the saved office number with the user's phone app.
- On mobile, the reminder notification includes Going and Call Off actions. Call Off opens the app, logs the call-off, marks the shift called off, and opens the phone app.
- This is the free path because the call comes from the user's own phone plan, not Twilio.
- iOS and Android may still ask the user to confirm the outgoing call. Apps are not allowed to silently place calls from a user's phone in the background.

## Mobile Builds

```sh
npx eas build --platform all
npx eas submit --platform all
```

Use TestFlight and Google Play internal testing before public release.
GitHub Pages is only the web preview. Mobile notification action buttons and the user-phone call flow must be tested in an iOS or Android build.

## Production Notes

- Raw schedule uploads are private and expire after 24 hours unless confirmed.
- Full team rosters should be parsed down to the current user’s shifts only.
- Uploads that appear to include patient information are blocked before saving.
- Automated portal login and auto-shift claiming are intentionally out of scope for v1.
