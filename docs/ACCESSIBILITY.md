# Accessibility & localisation

## Implemented
* All controls have `accessibilityRole`/labels, ≥48 dp touch targets, toggles expose `checked`/`selected` state, headings marked.
* System font scaling is not disabled; colours follow light/dark with AA-contrast palettes; no colour-only status (status text is always shown).
* Arabic: complete second dictionary (key and placeholder parity enforced by tests), layout direction set per language via the `direction` style (no restart), `textAlign: auto`, Arabic content fields stored and shown separately from English; admin shows both with `dir="rtl"`.
* Interface language and religious content are independent settings; content for a tradition is shown in the chosen language, falling back to the other only if a translation is missing.
* Dates/cut-offs use the viewer's locale (`toLocaleString`). Numerals follow the OS locale.

## Not verified (needs devices/people)
* Screen-reader walk-throughs (VoiceOver/TalkBack) in both languages.
* RTL visual QA of every screen on iOS and Android; long-text expansion; Arabic font rendering on older Android versions.
* Reduced-motion behaviour (the app uses no custom animations; default navigation transitions apply).
* Reviewed Arabic religious terminology: the Arabic strings and activity texts are **machine drafts** (`translation_status = machine_draft`) and cannot be approved in the dashboard until a translation reviewer marks them reviewed.
