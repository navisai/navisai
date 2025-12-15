# Navis AI — Branding & Experience Specification

This document defines the **visual, tonal, motion, and UX foundations** for Navis AI across all surfaces (PWA, desktop, docs, CLI, and state illustrations).  
It is intended to stay stable long-term and guide all contributors.

> **Note**: All styling should be implemented using **Tailwind CSS v4** with the configuration defined in `apps/pwa/tailwind.config.js`. Design tokens are pre-configured and should be used consistently across all components.
> 
> **Code Formatting**: Use `pnpm format` to format all code. Prettier will automatically sort Tailwind CSS classes according to the recommended order.

---

# 1. Brand Positioning

**Navis AI**  
*Local-first AI control, without chaos.*

### Core principles
- Calm
- Precise
- Professional
- Local-first
- Trustworthy
- Minimalist
- Maritime-inspired, not literal

---

# 2. Color System

### Primary Colors
- **Deep Maritime Navy** — `#0E2A47`  
  Used for logo, headers, key UI elements  
  Tone: serious, calm, authoritative

- **White** — `#FFFFFF`  
  Default background everywhere

### Supporting Neutrals
- **Slate / Dark Neutral** — for secondary text  
- **Light Gray (Dividers)** — e.g., `#E6E8EB`  
  1px separators and subtle structure

### Accent (use sparingly)
- **Muted Teal**  
  Use for:  
  - active state  
  - selection  
  - “ready” indicators  
  Never for backgrounds or headlines.

### Color philosophy
- Prefer *restraint*.  
- Never overwhelm with saturation.  
- Use whitespace as a “color.”

---

# 3. Typography

### UI / Product Font (Primary)
**Source Sans 3**

Use for:
- body text  
- labels  
- section headings  
- settings, panels, dashboards  

#### Weights
- Regular (400) – body  
- Medium (500) – subheaders  
- SemiBold (600) – section titles  

**Tailwind Implementation**: 
- Pre-installed via `@fontsource/source-sans-3`
- Use `font-sans` class with `font-medium` or `font-semibold` utilities
- See `src/app.css` for font imports

### Monospace (Terminal / Logs)
**JetBrains Mono**

Use for:
- terminal output  
- hashes  
- code  
- logs  

**Tailwind Implementation**:
- Pre-installed via `@fontsource/jetbrains-mono`
- Use `font-mono` class
- See `src/app.css` for font imports  

### Rules
- No decorative fonts  
- No Inter (overused)  
- Avoid geometric grotesks  
- Keep all typography calm and readable  

---

# 4. Layout & Spacing System

### Base Unit
**8px** — all spacing must be multiples.

**Tailwind Implementation**:
- All spacing utilities available in `tailwind.config.js`
- Use `p-4` (16px), `p-6` (24px), `p-8` (32px) for padding
- Use `m-4` (16px), `m-6` (24px), `m-8` (32px) for margins

### Global Padding
- Mobile page padding: **16px**  
- Desktop page padding: **24–32px**

**Tailwind Implementation**:
- Use `.page-padding` utility class (defined in `src/app.css`)
- Automatically responsive: `px-4 md:px-6 lg:px-8`

### Vertical Rhythm
- Section spacing: **32–48px**  
- Within related groups: **16px**  
- Tight groupings: **8px**

**Tailwind Implementation**:
- Section: `.section-spacing` utility class (`my-8 md:my-12`)
- Groups: `.group-spacing` utility class (`my-4`)
- Tight: `.tight-spacing` utility class (`my-2`)  

### Panels & Cards
- Panel padding: 16px (mobile), 24px (desktop)  
- Prefer space over borders  
- Dividers: 1px light gray only  

### Lists & Tables
- Row padding: 12–16px  
- Group separation: 24–32px  

### Key Principle
> If something feels cluttered, increase outer spacing — don’t add borders or decoration.

---

# 5. Microcopy & Tone System

### Voice attributes
- Calm  
- Precise  
- Neutral  
- Reassuring  

### Global rules
- No emojis  
- No exclamation marks  
- No anthropomorphizing  
- Facts over personality  

### Status vocabulary
- Ready  
- Running  
- Paused  
- Stopped  
- Degraded  
- Local mode  
- Remote available  
- Remote connected  

### Progress vocabulary
- Processing  
- Waiting  
- Completed  
- Failed  

### Approvals
Headers:
- **Approval required**

Actions:
- Approve  
- Deny  
- View details  

### Errors
Format:
1. What happened  
2. What is affected  
3. What remains safe  

Example:
**Connection failed**  
Local services are still available.

### Empty states
- **No active projects**  
  Open a project to get started.

### Navigation labels
- Projects  
- Terminals  
- Approvals  
- Settings  
- Access  
- Status  
- Logs  

---

# 6. Motion & Animation Language

### Purpose
Motion must serve clarity, not decoration.

### Timing
- Micro transitions: **120–180ms**  
- State transitions: **240–320ms**

**Tailwind Implementation**:
- Pre-defined animations in `tailwind.config.js`:
  - `animate-micro-in/out` (120ms)
  - `animate-state-in/out` (240ms)  
  - `animate-panel-in/out` (320ms)
- Custom durations: `duration-150`, `duration-200`, `duration-300`

### Easing
- `ease-in-out` only  
- No bounce  
- No elastic curves

**Tailwind Implementation**:
- Use `ease-in-out` transition class
- All predefined animations use correct easing  

### Allowed motion (MVP)
- Opacity + translate only  
- Status transitions  
- Panel open/close  
- Queue item enter/exit  
- Project switching  
- Modal/sheet slide  

### Prohibited in MVP
- Scale pops  
- Looping animations  
- Lottie-heavy illustrations  
- Character animations

### View Transitions API
- **Optional / progressive enhancement**  
- Never required  

### Motion Philosophy
> Calm, precise, minimal. Motion exists to explain state changes, not add flair.

---

# 7. State Illustrations

### MVP
- Static SVGs only  
- Minimal lines or shapes  
- Navy + neutral palette  
- Use for:  
  - empty states  
  - read-only mode  
  - degraded mode  
  - waiting  

### Phase 2 (later)
- Subtle animated SVG illustrations (no characters)
- Light drift or pulse motion (≤ 8px movement)
- Functional, not cute

Illustrations must feel like *visual explanations*, not mascots.

---

# 8. PWA-Specific Enhancements

### Stable APIs to Use (MVP)
- CSS transitions  
- Web Animations API (limited)  
- Page Visibility API  
- Online/Offline events  
- Notifications API (for approvals)  
- Badging API (progressive)  
- Service Workers (offline caching + notifications)

### MVP Guidelines
- Notifications only for approvals, connection loss, long tasks  
- Silent by default  
- No sound unless user opts-in  
- Reduce polling when hidden  
- Pause animations while backgrounded  

### Phase 2 Enhancements
- Vibration API for approvals  
- Gesture support (swipe navigation, long-press menus)  
- Advanced View Transitions adoption  
- More adaptive behaviors (context awareness)

---

# 9. Brand Behavior Principles

### 1. Calm by default
No sudden movement, loud colors, or emotional text.

### 2. Clarity over personality
Navis states facts. The user is the protagonist.

### 3. Precision and restraint
Every pixel, space, and word must feel intended.

### 4. Local-first trust
Always signal what is local vs remote.

### 5. Upgrade-path transparency
Premium features must feel additive, not restrictive.

---

# 10. Deliverables Overview (For Contributors)

### Required for MVP
- Color tokens  
- Type tokens  
- Spacing scale  
- Motion tokens  
- Status icons/illustrations (static)  
- Notification handling  
- Approval flows  
- Layout grid / rhythm  

### Phase 2 Deliverables
- Animated state illustrations  
- Advanced View Transitions  
- Haptics layer  
- Gesture interactions  
- Personalization layer  
- Data boundary explanations  
- System activity visualizers  

---
