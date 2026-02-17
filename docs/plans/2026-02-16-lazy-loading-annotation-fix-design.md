# Design: Fix Lazy Loading Annotation Bug + Headline Pipe-Split

**Date**: 2026-02-16
**Status**: Draft
**Scope**: `extension/content/search-annotator.js`

## Problem

LinkedIn Recruiter renders search result cards **progressively** — only the first ~4 cards have content when the page initially loads. The remaining cards are empty `<li>` placeholder elements that get populated later.

The extension's current retry mechanism (3 attempts with 500ms debounce = ~1.5s total window) marks empty cards as permanently "done" before LinkedIn finishes rendering them. Once marked "done", cards are never re-scanned, even when content appears.

### Evidence (from live DOM inspection + console logs)

- 13 cards found via `ol.profile-list > li`
- Cards 0-3: parsed successfully with company/location data
- Cards 4-12: ALL logged as "location: (none) | company: (none) | exp companies: (none)"
- Cards 4-12: ALL hit "Card empty after 3 attempts, marking done"
- Cards 4-6 had content when checked later via Playwright (LinkedIn rendered them after the extension gave up)
- Cards 7-12 rendered content only after user scrolled

### Secondary issue: Headline pipe-split

Headlines like "Total Rewards | Compensation | People Equity" return "Compensation" (shortest pipe-separated part) as the company name. This prevents correct fallback to experience-section extraction.

## Solution

### Fix 1: Content-aware annotation (replaces retry-count)

**Remove `CARD_MAX_RETRIES`**. Empty cards should never be permanently marked "done".

Instead:
1. When an empty card is first seen, store a `first-seen` timestamp on the card's data attribute
2. On each re-scan, check if the card now has content:
   - **Has content**: parse and match as normal, mark "done"
   - **Still empty, < 60s old**: leave as pending, will retry on next MutationObserver trigger
   - **Still empty, > 60s old**: mark "done" (truly empty/removed card)
3. Add a **scroll event listener** (debounced) to trigger re-annotation when user scrolls, catching cards that LinkedIn renders on scroll without adding new DOM nodes

### Fix 2: Pipe-split headline heuristic

Before returning the shortest pipe-separated part as a company name:
- Check if any part contains an "at" preposition or company-like indicators
- If ALL parts look like skill/topic keywords (no company signals), return `null`
- This lets the experience-section fallback strategy handle it correctly

## Changes

### `extension/content/search-annotator.js`

1. **Remove** `CARD_MAX_RETRIES` constant (line 710)
2. **Add** `CARD_STALE_MS = 60000` constant (60-second timeout for truly empty cards)
3. **Modify** `annotateSingleCard()`:
   - Replace retry-counter logic with timestamp-based staleness check
   - Store `Date.now()` on first empty encounter as the attribute value
   - On subsequent scans, compare elapsed time against `CARD_STALE_MS`
4. **Add** scroll listener in `init()`:
   - `window.addEventListener('scroll', debouncedAnnotate, { passive: true })`
5. **Modify** `extractCompanyFromHeadline()`:
   - In pipe-split branch, reject if no part has company-like characteristics

### No changes needed to:
- `matcher.js` (matching logic is correct)
- `banner.js` (banner injection is correct)
- `linkedin-parser.js` (profile page parsing is separate)
- MutationObserver setup (already triggers correctly)

## Risk Assessment

- **Low risk**: Only modifies the annotation retry logic in one file
- **No API changes**: `parseCard`, `matchOnly`, `injectBadge` interfaces unchanged
- **Backward compatible**: Cards with content are still processed identically
- **Performance**: Minimal impact — re-scanning empty cards is a cheap DOM `textContent.length` check
