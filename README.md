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
- Tap-to-call call-off workflow using the device dialer.
- Optional Twilio-backed automatic call-off calls to the saved office number.
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
Automatic office calls also require Supabase plus Twilio Edge Function secrets. The browser app never stores Twilio credentials.

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
supabase functions deploy place-calloff-call
```

4. Set Edge Function secrets:

```sh
supabase secrets set GOOGLE_DOCUMENT_AI_PROCESS_URL=...
supabase secrets set GOOGLE_SERVICE_ACCOUNT_EMAIL=...
supabase secrets set GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=...
supabase secrets set CLEANUP_JOB_SECRET=...
supabase secrets set TWILIO_ACCOUNT_SID=...
supabase secrets set TWILIO_AUTH_TOKEN=...
supabase secrets set TWILIO_FROM_NUMBER=...
```

The parser function refuses to invent demo shifts until the Document AI file-to-OCR exchange is enabled with Google service account credentials.
The automatic call-off function places an outbound Twilio call to the saved call-off number and reads a short ShiftReady message for the selected shift. The call-off phone number should be stored in E.164 format, for example `+15551234567`.

## Automatic Office Calls

The app already has the call-off flow wired in:

- In the app, add the workplace call-off number in Settings.
- On a shift card, Auto Call asks the Supabase Edge Function to place the Twilio call.
- On mobile, the reminder notification includes Going and Call Off actions. Call Off opens the app and runs the same Auto Call flow.
- If Supabase or Twilio is not configured, Call Off falls back to the device dialer so the user can still call manually.

To make automatic calls work in your own account:

1. Create a Twilio account.
2. Get your Twilio Account SID and Auth Token from the Twilio Console.
3. Buy or verify a Twilio phone number that is allowed to place outbound voice calls.
4. Create a Supabase project for the app.
5. Run `supabase db push`.
6. Deploy `place-calloff-call` with `supabase functions deploy place-calloff-call`.
7. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` with `supabase secrets set`.
8. Put your Supabase URL and anon key into `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
9. Rebuild and redeploy the app.
10. Test with a number you control before using a real office call-off line.

## Mobile Builds

```sh
npx eas build --platform all
npx eas submit --platform all
```

Use TestFlight and Google Play internal testing before public release.
GitHub Pages is only the web preview. Mobile notification action buttons and the direct phone dialer flow must be tested in an iOS or Android build.

## Production Notes

- Raw schedule uploads are private and expire after 24 hours unless confirmed.
- Full team rosters should be parsed down to the current user’s shifts only.
- Uploads that appear to include patient information are blocked before saving.
- Automated portal login and auto-shift claiming are intentionally out of scope for v1.
