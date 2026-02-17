# SourceFence — Claude Code Build Prompt

## Context

You are building **SourceFence** — a Chrome extension that alerts recruiters when they view a LinkedIn candidate who is in a restricted sourcing market or employed at a restricted company. Read `SOURCEGUARD_CLAUDE_CODE_PROMPT.md` in this project directory for the full technical specification. **Replace all references to "SourceGuard" with "SourceFence" throughout.** The tagline is: **"Sourcing Compliance, Simplified."**

## Pre-Build: Brainstorm Phase

Before writing any code, use the **Superpowers brainstorm** approach to think through the following and document your thinking in a `DECISIONS.md` file:

1. **LinkedIn DOM parsing strategy**: What are the most resilient approaches to extracting location and current employer from LinkedIn profiles across Standard, Recruiter, and Sales Navigator variants? Consider `data-testid` attributes, ARIA labels, semantic HTML patterns, and text-based heuristics as fallback layers. Document at least 3 fallback strategies per data point.

2. **Matching algorithm design**: Should we use exact substring matching, fuzzy matching (Levenshtein distance), or regex patterns for location/company rules? Consider that "Bangalore" should match "Bengaluru, Karnataka, India" and "Greater Bangalore Area." Document the tradeoffs and recommend an approach.

3. **Extension ↔ Backend sync strategy**: How should the extension cache rules locally while staying in sync with the Supabase backend? Consider offline-first behaviour, sync intervals, conflict resolution, and the Manifest V3 constraint that service workers are non-persistent.

4. **Banner injection approach**: What's the safest way to inject alert banners into LinkedIn's DOM without breaking their UI or being removed by their scripts? Consider Shadow DOM encapsulation vs. direct injection.

## Agent Teams Structure

Use the following agent delegation if Agent Teams are available:

### Agent 1: Extension Core (Priority — build first)
**Scope:** Everything inside `/extension/`
- Scaffold the Manifest V3 extension structure
- Build `linkedin-parser.js` with MutationObserver and multi-selector fallbacks
- Build `matcher.js` with the matching logic decided in brainstorm
- Build `banner.js` with Shadow DOM encapsulated alert banners
- Build `popup/` with manual rule management UI
- Build `service-worker.js` for tab navigation detection and storage management
- Create SVG-based extension icons (shield with "SF" monogram) at 16x16, 48x48, 128x128
- Use **Context7** MCP to fetch current Chrome Extension Manifest V3 documentation for accurate API usage

### Agent 2: Admin Dashboard
**Scope:** Everything inside `/dashboard/`
- Scaffold React + Vite + Tailwind project
- Build Supabase auth integration (email/password + magic link)
- Build all dashboard pages: Login, Dashboard overview, Location Rules, Company Rules, Team Members, Settings
- Build CSV upload component for bulk rule import
- Build rule management UI with inline editing, severity toggles, and custom message fields
- Style everything with the brand colours from the spec
- Use **Context7** MCP to fetch current Supabase JS client library docs and React Router docs

### Agent 3: Backend & Data
**Scope:** Everything inside `/supabase/` plus integration glue
- Write the full Supabase migration SQL with tables, RLS policies, and indexes
- Write seed data with example rules for testing
- Build the API sync layer in the extension's service worker — fetching rules from Supabase and caching in chrome.storage
- Build the domain-based team auto-association logic (on sign-up, check email domain against companies table)
- Build invite code generation and redemption flow
- Handle auth token management in the extension (Supabase session stored in chrome.storage)

## Build Sequence

Follow this exact order. Do not skip ahead.

```
PHASE 1 — Extension MVP (no backend, local storage only)
  Step 1: Brainstorm phase → output DECISIONS.md
  Step 2: Scaffold extension file structure + manifest.json
  Step 3: Build linkedin-parser.js (Standard LinkedIn only first)
  Step 4: Build matcher.js with 3 hardcoded test rules
  Step 5: Build banner.js with Shadow DOM encapsulation
  Step 6: Build content.css for banner styling
  Step 7: Build popup with manual rule CRUD against chrome.storage
  Step 8: Build service-worker.js for SPA navigation detection
  Step 9: Generate extension icons (SVG → PNG)
  Step 10: End-to-end testing on LinkedIn profiles
  
PHASE 2 — Admin Dashboard
  Step 11: Scaffold React + Vite + Tailwind project
  Step 12: Set up Supabase project config + migration SQL
  Step 13: Build Login page with Supabase Auth
  Step 14: Build Location Rules page (CRUD + table view)
  Step 15: Build Company Rules page (CRUD + expiry dates)
  Step 16: Build Team Members page
  Step 17: Build Settings page + CSV upload
  Step 18: Build Dashboard overview page with stats

PHASE 3 — Connect Extension to Backend
  Step 19: Add Supabase client to extension
  Step 20: Build auth flow in extension (login via popup)
  Step 21: Build rule sync (fetch from API → cache in chrome.storage)
  Step 22: Add periodic background sync (every 15 minutes)
  Step 23: Add domain-based team auto-association
  Step 24: Polish, error handling, loading states
```

## Technical Requirements

### Extension (Manifest V3)
- All persistent data in `chrome.storage.local` (NOT localStorage)
- Content scripts communicate with service worker via `chrome.runtime.sendMessage`
- Service worker is event-driven and non-persistent — handle wake/sleep gracefully
- Permissions: `storage`, `activeTab` only. Host permissions for `linkedin.com` domains
- Banner injection uses Shadow DOM to prevent LinkedIn CSS from affecting our styles and vice versa

### LinkedIn Parsing
- Use `MutationObserver` on the main content container to detect profile loads
- Debounce parsing (300ms) to avoid re-running on every minor DOM mutation
- Detect URL changes via `popstate` event + polling (LinkedIn SPA doesn't always fire popstate)
- Build a selector priority chain: `data-testid` → `aria-label` → semantic class patterns → text heuristic
- When parsing fails, show "Unable to read profile" in popup — never crash or throw visible errors
- Log parse failures to console with selector details for debugging

### Matching Logic
- Case-insensitive matching throughout
- Location rules: substring match with comma-separated alternatives support
  - Rule "India, Bengaluru" matches if candidate location contains "India" OR "Bengaluru"
- Company rules: substring match with normalisation (strip "Inc", "Ltd", "Corp", etc.)
- Return highest severity match (red > amber > green)
- Expired company rules (past `expires_at`) are automatically treated as inactive

### Banner Design
- Fixed position, top of viewport, z-index high enough to overlay LinkedIn but below their modals
- Red: `#DC2626` background, white text, stop icon
- Amber: `#F59E0B` background, dark text, warning icon
- Green: subtle left-border accent `#0EA5A0`, small text, auto-dismiss after 5s
- Slide-down animation on appear, slide-up on dismiss
- Dismiss button (X) on all banners
- "SourceFence" branding badge, subtle

### Dashboard
- React 18+ with React Router v6
- Tailwind CSS with brand colour config
- Supabase JS client v2 for auth and data
- Responsive design (works on desktop, passable on tablet)
- All CRUD operations optimistic with rollback on error
- CSV upload: parse client-side with Papa Parse, validate columns, preview before import

### Brand Colours (use throughout)
```
Navy:    #1B2A4A  (headings, dark UI elements)
Teal:    #0EA5A0  (primary accent, CTAs, logo, green alerts)
Orange:  #E8713A  (warnings, amber alerts)  
Red:     #DC2626  (blocked/restricted alerts)
Light:   #F0F7F7  (subtle backgrounds, cards)
Dark:    #2D2D2D  (body text)
White:   #FFFFFF  (backgrounds, light text on dark)
```

### Font
- Dashboard: Inter (import from Google Fonts)
- Extension: system-ui stack for performance

## Important Constraints

1. **This is NOT a scraping tool.** The extension only reads visible page content and overlays warnings. It does not extract, store, or export any candidate data. This distinction matters for LinkedIn ToS compliance.

2. **LinkedIn DOM will change.** Build the parser to degrade gracefully. Multiple fallback selectors, never crash on parse failure, log warnings not errors.

3. **Manifest V3 service workers sleep.** Do not assume persistent background state. Re-hydrate from chrome.storage on every wake.

4. **Supabase RLS is critical.** Every table must have row-level security policies. Users must only ever see their own company's data. Test this explicitly.

5. **Extension popup has no access to page DOM.** It must communicate with the content script via messaging to get current profile data.

## Output Expectations

After completing all phases, the project should have:
- A working Chrome extension that can be loaded as an unpacked extension in Chrome
- Alert banners appearing correctly on LinkedIn profile pages
- A popup UI for managing rules locally
- A React dashboard deployed (or deployable) to Vercel
- Supabase migration SQL ready to run
- A comprehensive README.md with setup instructions, screenshots, and architecture overview
