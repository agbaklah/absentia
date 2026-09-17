# Hyperframes Composition Brief: Absentia

## Objective
Create a short, polished launch-style brag video for Absentia, the internal HR system for Verve Energy Resources.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 22 seconds

## Source Material
- Project root: `/Users/sena/Documents/PERSONAL PROJECTS/ABSENTIA/absentia`
- Primary files read: `README.md`, `src/styles.css`, `src/routes/auth.tsx`, `src/routes/_authenticated/dashboard.tsx`, `src/components/KpiCard.tsx`, `src/components/AppSidebar.tsx`, `src/components/RequestLeaveDialog.tsx`, `src/lib/leave.ts`
- Product name: Absentia
- Tagline / strongest claim: "Leave and absence, without the spreadsheet."
- Key UI or visual moment to recreate: the admin dashboard (dark pine sidebar + KPI cards), the Request leave dialog → toast → calendar cells, the Pending → Approved badge with its audit line
- Copy that must appear verbatim:
  - Leave and absence, without the spreadsheet.
  - Absence days YTD · Vacation remaining · Sick days YTD · Pending approvals (KPI labels)
  - Request submitted for you — 5 working days (toast)
  - Every decision recorded — who approved, when, and why.
  - Vacation (Full) (leave type label)

## Creative Direction
- Tone preset: polished
- Creative direction: quiet premium internal-tools film — forest green, amber, warm neutrals
- Interpretation: six scenes, soft crossfades, confident small motion, nothing loud; text is either product copy or a plain statement of what is on screen
- Angle: the spreadsheet of leave codes fades; the real app takes over; one request travels from Submit to Approved with its audit line
- Hook: ghosted spreadsheet of leave codes under the two-line headline; the grid dissolves as the second line settles
- Outro / punchline: wordmark, tagline, "Built for Verve Energy Resources", music fades
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign

## Visual Identity
- Background: pine `#1c2a21` (sidebar token) for dark scenes; app surface `#f5f7f5` in the UI window
- Text: `#ebeeeb` on pine; `#26352c` on light
- Accent: amber `#e0973a`; primary pine `#22553a`; vacation green `#166534`
- Display font: Space Grotesk (shipped locally as woff2, @font-face)
- Body font: Inter (renderer-embedded)
- Visual references from the project: KpiCard (uppercase 11px tracked label, 2xl tabular Space Grotesk number, tinted icon chip, 12px radius), sidebar nav with amber active item, leave-code colour map from `leave.ts`

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Hook — 4.0s — ghost spreadsheet grid; "Leave and absence," / "without the spreadsheet."; grid dissolves
2. Reveal — 3.5s — "Absentia" wordmark; module list line
3. Dashboard — 5.5s — sidebar + header; 4 KPI cards one by one with count-ups; caption "Live balances"
4. Request leave — 4.5s — dialog, cursor clicks Submit, toast, five L cells fill
5. Approved — 2.5s — badge Pending → Approved, audit line writes in; caption "Every decision recorded — who approved, when, and why."
6. Outro — 2.0s — wordmark, tagline, "Built for Verve Energy Resources"; music fades

## Audio
- Audio role: warm bed with sparse accents
- Audio arc: bed from 0; four soft thuds under the KPI cards; one click; one bell for the approval; fade to silence under the outro
- Music: `assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` at 0.32
- Music treatment: fade to 0 over 20.0–22.0s
- Music cue guidance: `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json` (~110 BPM). Strong-cue locks: 8.74 (dashboard lands), 17.47 (approval flips), 19.66/20.19 (outro wordmark). Beat grid for KPI cards: 8.74, 9.83, 10.93, 12.02.
- Audio-reactive treatment: subtle — the amber radial glow behind dark scenes breathes with bass/RMS from `assets/audio-data.js` (pre-extracted, first 22s, 30fps). No waveforms.
- Audio-coupled moments:
  - Scene 1 second line lands — impactSoft_medium_001
  - Scene 2 wordmark — bong_001
  - Scene 3 window + cards — impactSoft_medium_002/003/004/001 at low volume
  - Scene 4 Submit click — ui/click2; toast — drop_001
  - Scene 5 badge flip — impactBell_heavy_000
  - Scene 6 wordmark — bong_001
- SFX selection guidance: low HF-risk picks from `sfx-analysis.md`; nothing on individual cells or characters
- Exact SFX choice: chosen above after the animation was designed; volumes 0.4–0.7
- Audio files: already copied into `brag-output/composition/assets/`

## Hyperframes Instructions
Standalone `index.html`, single paused GSAP timeline registered at `window.__timelines["absentia-brag"]`, root `data-duration="22"`, 1920x1080. Keep every text element on screen long enough to read. Run `npx hyperframes check` and fix everything before render.
