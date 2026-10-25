# Driver attention monitor (educational prototype)

Browser-only demo: webcam -> face-api.js face + 68 landmarks -> eye aspect ratio (EAR) ->
"possible drowsiness" warning when smoothed EAR stays below a threshold for a set time.
**Not a validated safety device.** Frames never leave the browser.

## Structure
    driver-monitor/
      index.html  netlify.toml  vite.config.js  package.json  .gitignore
      scripts/copy-models.mjs     copies model weights into public/models (auto, pre-dev/build)
      src/main.jsx  App.jsx  detection.js  styles.css
      tests/tracker.test.mjs      unit tests for the EAR/closure logic
      public/models/              generated: tiny_face_detector_* and face_landmark_68_*

## Models
Uses `@vladmandic/face-api`, a maintained fork of face-api.js that works with modern bundlers.
Its npm package contains the weights, so `npm run build` on Netlify always has them; nothing is
fetched from a third-party URL at runtime. The build fails if any file is missing.
Manual fallback: put the four files listed in scripts/copy-models.mjs into public/models.

## Local (Windows CMD)
    cd driver-monitor
    npm install
    npm test
    npm run dev          (open http://localhost:5173, localhost is allowed for camera)
    npm run build
    npm run preview

## Netlify
Option A (Git): push to GitHub -> Netlify "Add new site > Import from Git". The settings come from
netlify.toml (build `npm run build`, publish `dist`). Deploy.
Option B (CLI):
    npm install -g netlify-cli
    netlify login
    npm run build
    netlify deploy --prod --dir=dist
Camera access requires HTTPS; Netlify serves every site over HTTPS. Opening the site over plain
http on a LAN IP will not work.

## Manual test checklist
- Models: dev tools Network tab shows 4 requests under /models returning 200; rename a file to see the error overlay and a disabled Start monitoring.
- Permission denied: block camera in site settings, press Start camera, read the message; unblock and retry.
- No camera: disable the device (or use a machine without one) -> "No camera was found".
- No face: cover the lens or look away -> "No face found", closure timer resets, no warning.
- Multiple faces: second person in frame -> largest face tracked, note shown.
- Warning: close eyes ~2 s -> red banner and history entry; open eyes -> clears after 0.4 s.
- Start/stop: stop monitoring/camera -> overlay cleared, camera light off; Reset clears the summary.
- Responsive: resize below 860 px or use device emulation; panels stack under the video.
