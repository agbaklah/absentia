# Brag Plan: Absentia

## What is this app?
Absentia is the internal HR system for Verve Energy Resources — leave & absence, live balances, policy-checked requests, approvals with an audit trail, petty cash, people records — built to BambooHR level, and it replaced a spreadsheet.

## The angle
The old way was a spreadsheet full of single-letter codes (L, S, L1, T, W…) that nobody trusted. Absentia keeps the codes — they are real product vocabulary — but puts them on a live organisation calendar with balances, policy rules and an audit trail behind every decision. The video is a quiet product film: the spreadsheet fades, the real UI takes over, and one leave request travels from "Request leave" to "Approved" with its audit line.

## Hook (first 2-3 seconds)
A ghosted spreadsheet grid of leave codes (L · S · L1 · #REF!) sits on the dark pine background. Over it, the auth page's own headline lands in two beats: "Leave and absence," / "without the spreadsheet." As the second line settles, the grid dissolves.

## Key moments (the middle)
- The admin dashboard, recreated from `dashboard.tsx`: dark pine sidebar with the real nav (Dashboard, Calendar, Requests, Yearly Summary, Employees, Onboarding, Reports, Settings) and four KPI cards arriving one by one with count-ups — Absence days YTD, Vacation remaining, Sick days YTD, Pending approvals.
- The "Request leave" dialog: Vacation (Full), 5–9 Oct 2026, a cursor clicks Submit, the app's real toast appears ("Request submitted for you — 5 working days"), and five green "L" cells fill into the month calendar row.
- The approval: the request row's badge flips Pending → Approved, and the audit line writes itself — who approved, when, and why.

## Outro / punchline
"Absentia" wordmark with the amber dot, then the tagline again: "Leave and absence, without the spreadsheet." Small line: Built for Verve Energy Resources. Music fades under it.

## User flow worth showing
1. Employee opens "Request leave" → picks Vacation (Full), 5–9 Oct → Submit.
2. Toast confirms; the calendar row fills with L cells (pending, hatched).
3. Manager approves → badge turns green, audit entry appears with approver, timestamp and note.

## Tone
- Preset: polished
- Creative direction: quiet premium internal-tools film — forest green, amber, warm neutrals; the product speaks in its own copy
- Interpretation: few scenes, longer holds, soft crossfades; motion is confident and small; no jokes, no hype words; every line of text is verbatim from the product or a plain statement of what is on screen

## Format: landscape — 1920x1080
## Duration: 22 seconds

## Visual identity (from the project)
- Background (video): sidebar pine `oklch(0.185 0.028 155)` ≈ #1c2a21 for dark scenes; app background `oklch(0.97 0.005 145)` ≈ #f5f7f5 inside the UI recreation
- Primary: `oklch(0.38 0.1 153)` ≈ #22553a (deep pine)
- Accent: `oklch(0.72 0.15 60)` ≈ #e0973a (amber); sidebar-primary is the same amber
- Text: `oklch(0.22 0.03 155)` ≈ #26352c on light; `oklch(0.93 0.012 145)` ≈ #ebeeeb on pine
- Leave colours: Vacation #166534, Sickness #dc2626, TOIL #d97706, WFH #64748b, Bank Holiday #94a3b8
- Display font: Space Grotesk (project `--font-display`)
- Body font: Inter (project `--font-sans`)
- Strongest visual element: the KPI card (`KpiCard.tsx`: uppercase tracking label, big tabular Space Grotesk number, tinted icon chip) and the dark pine sidebar with amber active state

## Share copy (draft)
Absentia: leave and absence for Verve Energy Resources, without the spreadsheet. One calendar for everyone, live balances, and every approval recorded — who, when, and why.

## Audio direction
- Role: warm, steady bed with sparse professional accents
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (steady and clean; the polished pick)
- Music treatment: starts at 0 at ~0.32, fades to 0 over the final 2s under the outro
- Music cue guidance: preset read (`assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.md`, ~110 BPM). Strong cues to target: 8.74s (dashboard lands), 17.47s (approval flips), 19.66s (outro wordmark). Beat-grid window for the four KPI cards: every other beat from 8.74 → 9.83 → 10.93 → 12.02 (≈1.1s apart, readable).
- Audio-reactive treatment: subtle; the amber radial glow behind the dark scenes breathes with bass/RMS (scale ±4%, opacity ±0.06). No waveforms, no equalisers.
- SFX posture: sparse, warm, low high-frequency risk; volumes 0.4–0.7
- Audio-coupled moments: hook line landing; wordmark reveal; four KPI cards arriving (soft thuds); cursor click on Submit; toast/approval bell; outro wordmark
- Restraint rule: no sound on individual calendar cells or typed characters; nothing bright or repeated; the bell is used once

## Storyboard

### Scene 1 — Hook — 4.0s (0.0–4.0)
Dark pine full-bleed with a faint amber radial glow. A large ghosted spreadsheet grid (row labels of surnames, columns Mon–Fri, cells "L", "S", "L1", "T", "#REF!") sits at ~8% opacity, slowly drifting. Headline in Space Grotesk, two lines: "Leave and absence," (in at 0.5s) then "without the spreadsheet." (in at 1.5s, settled by 2.0s, held to 3.6s). The grid fades to 0 between 2.0s and 3.0s.
Sequential/interaction: two-line staggered headline; grid dissolve.
Audio intent: quiet confidence.
Audio-coupled idea: one soft impact when the second line lands.
Music: bed starts at 0.
Transition mood: soft crossfade → Scene 2

### Scene 2 — Reveal — 3.5s (4.0–7.5)
Wordmark "Absentia" (Space Grotesk 600, amber full stop) scales in at full width, near beat 4.39. Beneath, small: "Leave · Balances · Approvals · Petty cash · People" fades in at 5.2s and holds.
Sequential/interaction: none beyond the two-step reveal.
Audio intent: the name is said once, softly.
Audio-coupled idea: bong on the wordmark landing.
Transition mood: soft crossfade → Scene 3

### Scene 3 — Dashboard — 5.5s (7.5–13.0)
The admin dashboard recreated on the app's light background inside a slightly tilted, shadowed window: dark pine sidebar with the real nav (Dashboard active in amber), page header "Dashboard" with a year select "2026" and team select "All teams". Four KPI cards arrive one by one, each with a count-up: Absence days YTD 142 · Vacation remaining 318 · Sick days YTD 27 · Pending approvals 4. Window lands on the 8.74 strong cue; cards on 8.74 / 9.83 / 10.93 / 12.02. Caption top-left over pine: "Live balances" (settled 1.2s+).
Sequential/interaction: yes — 4 cards, one by one, count-ups.
Audio intent: things clicking into place.
Audio-coupled idea: one soft thud per card (four, quiet), the window landing gets the first.
Transition mood: soft slide → Scene 4

### Scene 4 — Request leave — 4.5s (13.0–17.5)
Same window. The "Request leave" dialog is open: Leave type "Vacation (Full)", Start 05 Oct 2026, End 09 Oct 2026, Note "Family trip". A cursor moves to "Submit request" and clicks at 14.2s. Dialog closes, the app's toast slides in bottom-right: "Request submitted for you — 5 working days" (holds 1.5s). Behind it, the October calendar row for Kofi Mensah fills Mon–Fri with five green "L" cells, one per 0.12s, hatched (pending).
Sequential/interaction: yes — cursor click; five cells fill.
Audio intent: a real action, then confirmation.
Audio-coupled idea: click on Submit; soft drop on the toast.
Transition mood: soft crossfade → Scene 5

### Scene 5 — Approved, with audit — 2.5s (17.5–20.0)
Close-up of the request row: "Kofi Mensah · Vacation (Full) · 5–9 Oct 2026 · 5 days" with a Pending badge (amber). At 17.5 (strong cue 17.47) the badge flips to Approved (green) and the cells lose their hatching. Beneath, the audit line writes in: "Approved by Ama Boateng · 17 Sep 2026, 14:02 · "Cover arranged with Yaw."" Caption: "Every decision recorded — who approved, when, and why." (held 2.0s).
Sequential/interaction: badge flip; audit line reveal.
Audio intent: the one moment of warmth.
Audio-coupled idea: bell on the flip (used once in the video).
Transition mood: soft crossfade → Scene 6

### Scene 6 — Outro — 2.0s (20.0–22.0)
Dark pine. "Absentia" wordmark (in near 19.66/20.19), then "Leave and absence, without the spreadsheet." and small "Built for Verve Energy Resources". Music fades to silence by 22.0.
Sequential/interaction: none.
Audio intent: settle.
Audio-coupled idea: soft bong on the wordmark; music fade.

**Music mood for this video:** steady, warm, corporate-clean (vol-12)
**Audio summary:** a single warm bed under six quiet scenes, four soft thuds as the KPI cards land, one click, one bell for the approval, and a fade to silence under the final wordmark.
