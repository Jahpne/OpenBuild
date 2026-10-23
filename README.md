# SLICE NAIRA

Touchless, accessible gaming and fun physical therapy. Slice fruit with your index finger through your webcam.
Hackathon build: vanilla HTML/CSS/JS, Canvas, MediaPipe Hands. No build step.

## Files
| File | What it does |
|---|---|
| `index.html` | All screens (landing, camera, levels, daily, shop, stats, HUD, pause, game over) |
| `style.css` | Theme: #0a0a0f base, purple neon glow, scanlines, JetBrains Mono + Space Grotesk |
| `storage.js` | Single localStorage store, leaderboard (backend-ready), daily meta (login streak, missions, seed), seeded PRNG |
| `hand.js` | Camera + MediaPipe Hands index-tip tracking, mouse/touch fallback, frame-rate-independent smoothing |
| `game.js` | Runs (10 levels, endless, daily), physics, slicing, juice, sound, rendering, UI wiring |

## Run locally
Camera access needs a secure context. Either use `localhost` or HTTPS.

```bash
cd slice-naira
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy (HTTPS, free)
- **Netlify:** drag the folder onto app.netlify.com/drop. Done, you get an https:// URL.
- **GitHub Pages:** push to a repo, Settings → Pages → deploy from `main` / root. Open the https:// URL.

MediaPipe is loaded from the jsDelivr CDN, so the first load needs internet access.

## Rules (all virtual ₦, no real money)
- ₦1,000 per fruit. PERFECT CUT (through the centre) +₦500. Edge nick = base only.
- Combo: 3 fruits in one swipe +₦1,500. 5 or more +₦5,000.
- Streak: 10 clean slices in a row → ×2 on fruit payouts. A bomb or a missed fruit resets it.
- Golden fruit ₦10,000. Bombs cost 1 of 3 lives. Missing a fruit costs nothing except the streak.
- Level targets: ₦6k to ₦60k. Stars: 1 = clear, 2 = clear with 2+ lives, 3 = clear with 3 lives at 1.6× target.
- Daily: 60 s, same seed for everyone each day. First official run pays ×0.5 of score as a bonus.
- Login streak: ₦5,000 on day 1, +₦2,500 per day, capped at ₦25,000.

## Controls
- Index finger = blade. Wave three times to calibrate.
- No camera? MOUSE / TOUCH button. Move the pointer or finger to slice.
- P / Esc pauses. M toggles sound.

## Rehab mode
Slower speeds, fruit 35% bigger, fewer bombs, no frenzy. The game records every fingertip position while you play.
Stats → Rehab shows left/right/up/down reach as a percentage of the screen from centre, and a reps-per-session chart.

## Backend later
`Leaderboard.top()` and `Leaderboard.submit()` in `storage.js` are the only functions to replace.
Point them at FastAPI or Firebase `fetch()` calls. The shape is `{name, score, mode, level, date}`.

## Known limits
- Hand tracking runs at camera rate (~30 fps). The smoothing hides that, but very fast flicks can miss a thin fruit.
- Best results: good lighting, plain background, one hand.
