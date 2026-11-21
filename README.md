# XO LAB — Frame Echo

Audio-reactive DJ visuals. Runs in a browser, and builds into an iPhone app (IPA) on GitHub.

## Get the IPA
1. Upload every file in this folder to a GitHub repository (include the `.github` folder).
2. Open the repo's **Actions** tab → **Build iOS IPA**. It starts by itself after each upload, or press **Run workflow**.
3. When it shows a green tick (about 10 minutes), open the run and download **XO-LAB-unsigned-ipa** at the bottom. Unzip it to get `XO-LAB-unsigned.ipa`.
4. Install it on your iPhone with Sideloadly or AltStore (they sign it with your Apple ID).

## Use in a browser instead
Open `dist/index.html` after running `npm install` and `npm run build`, or use the ready-made `index.html` from the web build.

## Files
- `src/` — the app (engine in `app.js`, interface in `index.html`)
- `public/` — offline files and web icons
- `resources/` — iPhone app icon and black launch screen
- `capacitor.config.json` — app name XO LAB, bundle ID com.xolab.frameecho
- `.github/workflows/build-ipa.yml` — the GitHub build
