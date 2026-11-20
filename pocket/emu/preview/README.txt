FM-1 Pocket Player: test build (not published)

This folder is the web player exactly as the site would be, with both engines, running on your Mac only.
Nothing here is uploaded anywhere.

Start it (one of these):

A. Double-click "Start Pocket preview.command".
   If macOS says it cannot check it for malicious software: open System Settings > Privacy & Security,
   scroll down, click "Open Anyway" next to "Start Pocket preview.command", then double-click it again.

B. Or open Terminal (Applications > Utilities > Terminal), type this, with a space at the end:
       python3 -m http.server 8765 --directory
   then drag the "site" folder from this folder into the Terminal window, press Return,
   and open http://localhost:8765/ in Safari or Chrome.

Either way, if a box asks to install "command line developer tools", click Install (free, from Apple),
wait for it to finish, then start again.

Leave the Terminal window open while you test. Close it (or press Control-C in it) to stop.
