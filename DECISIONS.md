# SourceFence — Technical Decisions

Brainstorm decisions made before writing any code. These govern the implementation of all phases.

---

## Decision 1: LinkedIn DOM Parsing Strategy

**Choice: Hybrid — Multi-layer selector chain + text-content walking fallback**

### Selector Priority Chain (per data point)

1. `data-testid` attributes — most stable, LinkedIn uses these for testing
2. `aria-label` / ARIA landmarks — accessibility attributes change less frequently
3. Semantic class patterns — e.g., classes containing `location`, `headline`, `experience`
4. Text-content walking (final fallback) — walk DOM tree looking for section headings ("Location", "Experience") and extract adjacent text nodes

### Fallback Selectors: Location

| Priority | Strategy | Example Selector |
|----------|----------|-----------------|
| 1 | data-testid | `[data-testid="profile-location"]` |
| 2 | ARIA | `[aria-label*="location" i]` |
| 3 | Class pattern | `.text-body-small.inline.t-black--light.break-words` |
| 4 | Structural | Element adjacent to connections/followers count in top card |
| 5 | Text walk | Find "Location" heading, grab next sibling text |

### Fallback Selectors: Current Employer

| Priority | Strategy | Example Selector |
|----------|----------|-----------------|
| 1 | Headline parse | Extract company from headline text (e.g., "Engineer at Acme") |
| 2 | data-testid | `[data-testid="experience-item"]` first entry |
| 3 | ARIA | Experience section `[aria-label*="experience" i]` first item |
| 4 | Class pattern | `.experience-section` or `.pvs-list` first child company name |
| 5 | Text walk | Find "Experience" heading, extract first company name |

### LinkedIn Variant Handling

- **Standard (`/in/`)**: Primary parsing path, most selector data available
- **Recruiter (`/talent/`)**: Completely different DOM. Separate selector set with own fallback chain. Key difference: profile data is in a modal/panel, not the main page
- **Sales Navigator (`/sales/`)**: Third DOM structure. Separate selector set. Profile data is in a different layout with Sales Nav-specific classes

### Resilience Measures

- `MutationObserver` on `document.body` (or closest stable container) to detect profile loads
- Debounce parsing at 300ms to avoid thrashing on rapid DOM mutations
- URL change detection via `popstate` + 1-second polling (LinkedIn SPA doesn't always fire popstate)
- Selector config stored as a plain object — updatable without rebuilding the extension
- Parse failures log to console as warnings, never throw. Popup shows "Unable to read profile"

---

## Decision 2: Matching Algorithm Design

**Choice: Normalized substring matching with alias support — no fuzzy matching**

### Rationale

This is a compliance tool. False positives ("you can't source this person") are far worse than false negatives ("we didn't catch a restriction"). Fuzzy matching (Levenshtein) introduces ambiguity — "Poland" fuzzy-matching "Portland" would be a serious problem. Substring matching is deterministic and predictable.

### Algorithm

```
For each rule pattern:
  1. Split pattern on commas → alternatives (e.g., "India, Bengaluru" → ["India", "Bengaluru"])
  2. Normalize both the candidate value and each alternative:
     - Lowercase
     - Trim whitespace
     - Strip diacritics (NFD decomposition + strip combining marks)
  3. Check if normalized candidate value CONTAINS normalized alternative
  4. If any alternative matches → rule matches
```

### Company Name Normalization

Before matching company rules, strip common suffixes from both the rule pattern and the candidate's employer:
- "Inc", "Inc.", "Incorporated"
- "Ltd", "Ltd.", "Limited"
- "Corp", "Corp.", "Corporation"
- "LLC", "L.L.C."
- "GmbH", "AG", "S.A.", "Pty", "PLC"

Example: Rule "Acme Corp" matches candidate employer "Acme Corporation" after both normalize to "acme".

### Severity Resolution

When multiple rules match, return only the highest severity:
- `red` > `amber` > `green` (no match)
- If multiple red rules match, return the first one found (rules are ordered by creation date)

### Expiry Handling

Company rules with `expires_at` in the past are treated as inactive and skipped during matching. Checked at match time, not sync time, so expiry is always current.

---

## Decision 3: Extension ↔ Backend Sync Strategy

**Choice: Offline-first with periodic pull sync**

### Architecture

```
chrome.storage.local (source of truth for extension)
        ↑
   Pull sync every 15 minutes
        ↑
Supabase backend (source of truth for rules)
```

### How It Works

1. **Extension always reads from `chrome.storage.local`** — never directly from the network. This guarantees the extension works offline and instantly.
2. **Sync is pull-only** — the extension fetches the full rule set from Supabase and overwrites the local cache. No conflict resolution needed because the dashboard is the only write path for synced rules.
3. **Manual rules (pre-backend)** are stored with a `source: "local"` flag. Once backend is connected, synced rules have `source: "remote"`. Local rules are preserved and merged with remote rules.
4. **Sync trigger**: Chrome alarm API fires every 15 minutes. Also triggers on extension startup, and on manual "Sync now" button in popup.
5. **Service worker sleep handling**: On every wake, check `last_sync_timestamp` in storage. If stale (>15 min), sync immediately.

### Sync Flow

```
1. Service worker wakes (alarm, startup, or message)
2. Read auth token from chrome.storage.local
3. If no token → skip sync, use local rules only
4. Fetch rules from Supabase: GET location_rules + company_rules
5. Merge with local-only rules (source: "local")
6. Write merged ruleset to chrome.storage.local
7. Update last_sync_timestamp
8. Send message to any active content scripts to re-evaluate current profile
```

### Failure Handling

- Network failure during sync: log warning, keep existing cached rules, retry on next alarm
- Auth token expired: clear token from storage, set extension status to "logged out", keep cached rules working
- Never block the UI on sync — always async, always use cached data first

---

## Decision 4: Banner Injection Approach

**Choice: Shadow DOM encapsulation**

### Rationale

- **Isolation**: Shadow DOM prevents LinkedIn's CSS from leaking into our banner styles and vice versa. LinkedIn uses aggressive global styles that would override our colors, fonts, and layout.
- **Resilience**: LinkedIn's JavaScript can't accidentally remove or modify our banner's internal structure through DOM manipulation of the main page.
- **Clean removal**: Removing the entire shadow host cleanly removes all our UI with no orphaned styles or elements.

### Implementation

```
1. Create a host element: <div id="sourcefence-banner-host">
2. Attach shadow root: host.attachShadow({ mode: 'closed' })
3. Inject <style> + banner HTML into shadow root
4. Append host to document.body as first child
5. Host element gets: position: fixed, top: 0, z-index: 2147483646 (below max, above LinkedIn)
```

### Why `mode: 'closed'`

- Prevents LinkedIn's scripts from accessing our shadow DOM via `element.shadowRoot`
- Our content script retains a reference to the shadow root internally for updates
- Marginally more resistant to page scripts interfering with our UI

### Banner Lifecycle

1. Before injecting, check for and remove any existing `#sourcefence-banner-host` element
2. Create new banner based on severity (red/amber/green)
3. Animate in with CSS `transform: translateY(-100%) → translateY(0)` transition
4. Green banners: start a 5-second auto-dismiss timer (configurable via settings)
5. Dismiss button removes the host element entirely
6. On SPA navigation (URL change detected): remove old banner, re-parse, inject new banner

### Z-Index Strategy

- Banner host: `z-index: 2147483646` (one below max int)
- LinkedIn modals typically use `z-index` in the 9000-10000 range
- Our banner stays visible over LinkedIn's UI but below their modal overlays (which the user intentionally opened)

---

## Summary of Decisions

| Area | Decision | Key Rationale |
|------|----------|---------------|
| DOM Parsing | Hybrid selector chain + text walking | Fast primary path, resilient fallback |
| Matching | Normalized substring, no fuzzy | Compliance tool — false positives are worse than false negatives |
| Sync | Offline-first pull sync, 15-min interval | Works offline, no conflict resolution, MV3 compatible |
| Banners | Shadow DOM, closed mode | CSS isolation, resilience against LinkedIn DOM changes |
