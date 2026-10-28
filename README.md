# Hiking Trails

A personal hiking review PWA: city-grouped reviews, quarter-star ratings out of five, descriptions, search, list/map views, Apple Maps directions, and encrypted phone-to-phone backups. No analytics or remote review database.

**Open the app:** https://hiking-trails.savorymug256.chatgpt.site

## Install

On iPhone, open in Safari, then Share → Add to Home Screen → Add. On Mac, Safari → File → Add to Dock. Add reviews in the app; the journal starts empty. Online maps use OpenStreetMap, and directions open Apple Maps. Add trailhead coordinates to show a review on the map; a search button can find candidates after you enter a name/city.

The app shell and saved reviews work offline after the first successful load. Map tiles, coordinate search, directions, and GitHub deliveries need a connection. All reviews live in IndexedDB for this app's origin on each device. Clearing website data may erase them. The app requests persistent storage when you press its Settings button, but browsers decide whether to grant it. There is no cloud copy of your decrypted journal.

## Transfer phones

1. Settings → enter a backup password (8+ characters) → Export backup. Save the file and password securely.
2. Open **the same app URL** on the new phone. Settings → enter that password → Import backup.
3. Restore merges trail IDs, replacing matching IDs, and restores the old delivery key and receipts. Disconnect GitHub on the old phone; reconnect it on the new phone. An old backup does not contain entries added since it was exported.

Backups use AES-256-GCM with a PBKDF2-SHA256 key (310,000 iterations, random 16-byte salt). Backups contain the journal, delivery private key, and import receipts, but **never the GitHub token**. Keep the backup password; there is no password recovery. Local IndexedDB uses the browser/device's protections; the app is not a password vault and does not add a separate app lock.

## Direct import links

An assistant can send an app link with a `#import=` fragment containing a base64url-encoded `{version:1,trails:[...]}` payload. Opening it removes the fragment from browser history and asks you to confirm the named reviews before the service worker saves them locally. A durable receipt prevents repeat imports. No review payload is sent to the host or committed to GitHub. The original link remains in whichever chat or message contains it; treat it as private. Links support up to 100 reviews and 100,000 encoded characters. This option needs no GitHub pairing.

## One-time entry-hook setup on your phone

1. Create a [fine-grained GitHub token](https://github.com/settings/personal-access-tokens/new) limited to this repository, with **Contents: Read and write**. Enter it directly in the app's Settings → GitHub delivery inbox.
2. Tap **Connect this device**. The app generates the receiving key locally, publishes only `delivery-key.json` to GitHub, verifies write access, and saves the token locally. If another device is already paired, you must confirm before replacing its public key. Never upload a backup or private key. Token expiry/revocation requires reconnection.
3. Ask your assistant to add hiking reviews using `ENTRY_HOOK.md`. It can read the public key, encrypt a batch, and create an `inbox/<unique-id>.json` file using the GitHub connector. The phone's service worker imports the batch, commits the local journal and receipt in one IndexedDB transaction, and then deletes the active GitHub file using its exact SHA.

**Important limits:** iOS does not guarantee background synchronization. Deliveries check when the app opens, becomes visible, reconnects, or you tap Check deliveries; supported browsers can also retry via Background Sync. A service worker cannot receive arbitrary inbound HTTP requests from chat. Until you connect the device with its repository token, remote delivery is unpaired, not silently active. Encrypted delivery files may also be imported manually without a GitHub token.

GitHub stores the source code, the public key, and **temporary encrypted delivery envelopes**, not plaintext reviews. File deletion removes the active inbox entry, **not Git history, cached copies, or forks**. Full erasure from GitHub cannot be guaranteed by deleting a file. If you require no GitHub delivery data even temporarily, use local entry/manual encrypted delivery import instead. After receipt, the device holds the decrypted trail entries. Anyone who later obtains both a delivery private key and historical envelopes could decrypt them.

The importer processes up to 100 envelopes per check, at most 500 trails each, and does not overwrite the source app for entry deliveries. A durable receipt stops already imported envelopes from resurrecting edited/deleted reviews when cleanup fails. Cleanup is retried on later checks. Files are deleted only following a successful local transaction. A malformed or wrong-key envelope remains in the inbox, with an error in the app.

Use one receiving phone at a time. Remote-delivery duplicate IDs intentionally replace those trail IDs; use a new ID for each new review, reuse an ID only for an intentional update. Your assistant should never invent your personal rating.

## Develop / host

Buildless HTML/CSS/JS. Serve `dist/` over HTTPS (or localhost for development). No package install/build step is needed in production. Manifest, icons, and service worker are relative, so GitHub Pages subpaths are supported. When changing the shell, bump `CACHE` in `dist/sw.js` so installed phones get fresh assets. Use a stable origin: storage does not transfer between different domains.

This repository is the GitHub source mirror; the app is hosted privately at the URL above. A GitHub Pages Actions workflow is included for optional self-hosting. It runs only with manual `workflow_dispatch`; it requires you to enable Pages with GitHub Actions in repo Settings first. It publishes app code only, never `inbox/` or `delivery-key.json`.

Run logic tests with Node 20+ and `fake-indexeddb` available: `FAKE_INDEXEDDB_PATH=/absolute/path/to/fake-indexeddb/build/esm/index.js node --test tests/core.test.mjs`. Tests cover local writes, encrypted deliveries, duplicate receipts, retry after deletion failure, backup/restore, tampering, and failed-save cleanup safety. Browser/device installation QA must also be performed on the intended phone.

## References checked

- [MDN: Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API) — limited browser availability and service-worker retries.
- [MDN: StorageManager.persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist) — persistence is a request, not a guarantee.
- [GitHub: Removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) — file deletion is not history erasure.

Verified against these three primary references on October 17, 2026. Map attribution: © OpenStreetMap contributors. No third-party JavaScript or fonts are loaded.

## Want to go

Use the Status selector to save a future hike as **Want to go**, without a rating. Filter All trails, Want to go, or Visited in list and map views. Existing entries remain Visited with their original ratings. Edit the same entry after a visit and select Visited, then add your own rating. Status is retained in encrypted backups and deliveries. Wishlist deliveries use payload version 2 so an older app safely retains them until updated; envelope encryption remains version 1.
