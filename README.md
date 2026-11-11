# VertGames

VertGames is an offline-first collection of 11 browser games wrapped as a native Android application. The original Russian/English portal, account/profile screens, local storage, game catalog, and bundled game assets remain in the repository. The uploaded source archive is retained as `VertGames  (3).zip`; its contents are also extracted so the source can be built and maintained normally.

## Project layout

- `index.html`, `top.html`, `roulette.html`, `admin.html`, and the information pages: the original portal UI.
- `games/`: 11 standalone games (2D arcade/puzzle games and 3D games), plus source modules and license notices.
- `assets/`: bundled Redline models, collision/surface data, metadata, and attribution.
- `server.py`, `google_oauth.py`, `database.js`, and the setup guides: the existing optional account backend and local account storage.
- `android/`: native Android WebView host, app resources, asset packaging, Gradle wrapper, and verification scripts.
- `.github/workflows/android-apk.yml`: builds and uploads a signed release APK on relevant pushes and manual dispatches.

## Android app

- **Name:** VertGames
- **Application ID:** `com.vertgames.mobile`
- **Version:** `1.0.0` (`versionCode` 1)
- **Android:** minimum API 23; target API 35
- **Distribution:** signed release APK

The app serves the site's bundled files from Android's local app-assets origin; games do not need a web server or network connection. The games already include mobile touch controls (including multitouch joysticks/action controls in the 3D titles), and Android WebView hardware acceleration is enabled. Guest play is available offline; individual games keep their existing local saves/high scores on-device where supported. Existing local accounts can still sign in. New email registrations, email verification, and Google sign-in require the original `server.py` deployment with SMTP/OAuth configured, as described in `AUTH_SETUP.md` and `GOOGLE_AUTH_SETUP.md`.

## Build locally

Install JDK 17 and Android SDK Platform 35 with Android Build Tools 35.0.0. From the repository root:

```sh
cd android
./gradlew assembleDebug
# Install on a connected Android device (USB debugging enabled):
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

For a release build:

```sh
./gradlew assembleRelease
```

The checked-in Gradle 8.9 wrapper downloads Gradle on its first run. The local release build uses the machine's Android debug signing key when no signing environment is supplied; it is installable for testing, but is not a reusable Play Store signing identity. To sign with your own persistent key, set these environment variables before building:

```sh
export VERTGAMES_KEYSTORE=/absolute/path/to/your-release-key.jks
export VERTGAMES_STORE_PASSWORD='…'
export VERTGAMES_KEY_ALIAS='…'
export VERTGAMES_KEY_PASSWORD='…'
./gradlew assembleRelease
```

The Gradle build copies current site/game sources into generated Android assets; do not edit a second copied version. From the repository root the release output is `android/app/build/outputs/apk/release/app-release.apk`. Run `python3 android/verify_web_assets.py` and `python3 android/verify_javascript.py` from the repository root to check the static asset inventory, local links, and script syntax before building.

## CI APK

The Android workflow uses the runner's preinstalled Android 35 SDK, sets up JDK 17, signs the release build with a temporary CI key, verifies APK structure/package/signature, and uploads `VertGames-1.0.0-release.apk` with build metadata and a SHA-256 checksum as a GitHub Actions artifact. The CI key is deliberately not retained; a later APK signed by a different CI key will not update-install over this one. Keep a private persistent signing key for updateable releases.

## Existing backend

The Python server is not embedded in the APK. It remains available as source for deployments needing server-backed accounts. Run it separately with `python3 server.py` and configure SMTP/Google OAuth as documented. Offline guest play, bundled game assets, local profile state, and standalone game saves do not depend on that service.
