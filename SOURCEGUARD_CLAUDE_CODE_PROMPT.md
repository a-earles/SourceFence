# SOURCEGUARD — Chrome Extension Build Prompt

## Project Overview

Build **SourceGuard**, a Chrome extension (Manifest V3) that alerts recruiters/sourcers when they view a candidate on LinkedIn who is located in a restricted market or employed at a restricted company. The extension reads candidate location and employer data from the LinkedIn DOM and cross-references it against configurable restriction rules, displaying colour-coded alert banners directly on the page.

This is a compliance tool — not a scraping tool. It passively reads what's already visible on screen and overlays warnings. It does not extract, store, or export candidate data.

---

## Architecture

```
sourceguard/
├── extension/                    # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── content/
│   │   ├── linkedin-parser.js    # DOM parsing for candidate data
│   │   ├── matcher.js            # Rule matching logic
│   │   ├── banner.js             # Alert banner injection
│   │   └── content.css           # Banner styles
│   ├── background/
│   │   └── service-worker.js     # Auth, API sync, rule caching
│   ├── options/
│   │   ├── options.html
│   │   └── options.js
│   ├── icons/
│   │   ├── icon16.png
│   │   ├── icon48.png
│   │   └── icon128.png
│   └── lib/
│       └── supabase-client.js    # Lightweight Supabase wrapper
│
├── dashboard/                    # Admin Web Dashboard (React + Tailwind)
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   ├── LocationRules.jsx
│   │   │   ├── CompanyRules.jsx
│   │   │   ├── TeamMembers.jsx
│   │   │   └── Settings.jsx
│   │   ├── components/
│   │   │   ├── RuleTable.jsx
│   │   │   ├── RuleForm.jsx
│   │   │   ├── CSVUpload.jsx
│   │   │   ├── AlertPreview.jsx
│   │   │   └── Layout.jsx
│   │   └── lib/
│   │       └── supabase.js
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.js
│
├── supabase/                     # Database & Auth
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   └── seed.sql
│
└── README.md
```

---

## Phase 1: Chrome Extension (MVP — Build This First)

### 1. manifest.json

```json
{
  "manifest_version": 3,
  "name": "SourceGuard",
  "version": "0.1.0",
  "description": "Sourcing compliance alerts for recruiting teams. Flags restricted locations and companies in real-time.",
  "permissions": ["storage", "activeTab"],
  "host_permissions": [
    "https://www.linkedin.com/*",
    "https://linkedin.com/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "https://www.linkedin.com/in/*",
        "https://www.linkedin.com/talent/*",
        "https://www.linkedin.com/sales/*",
        "https://www.linkedin.com/search/*"
      ],
      "js": ["content/linkedin-parser.js", "content/matcher.js", "content/banner.js"],
      "css": ["content/content.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "options_page": "options/options.html",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### 2. Content Script: linkedin-parser.js

This is the most critical and fragile component. LinkedIn's DOM changes frequently, so build with resilience in mind.

**Requirements:**
- Extract the candidate's **location** (e.g., "Bangalore, Karnataka, India" or "Greater Mumbai Area")
- Extract the candidate's **current employer** (company name from the Experience section or headline)
- Handle three LinkedIn variants: Standard profiles (`/in/`), Recruiter (`/talent/`), Sales Navigator (`/sales/`)
- Use a `MutationObserver` to detect when LinkedIn loads profile data (it's a SPA — content loads dynamically)
- Implement multiple selector fallbacks for each data point. LinkedIn uses data-testid attributes, aria-labels, and class-based selectors — try all of them
- Debounce parsing to avoid running on every minor DOM change
- When URL changes (LinkedIn SPA navigation), re-parse the new profile

**Key selectors to try (standard LinkedIn — these WILL change, build fallbacks):**
- Location: `.text-body-small.inline.t-black--light.break-words`, or the element near the connections/followers count
- Headline/Company: `.text-body-medium.break-words`, or experience section entries
- For Recruiter/Sales Nav: Different DOM structure entirely — parse separately

**Output:** Call `matcher.checkCandidate({ location, company })` with extracted data.

### 3. Content Script: matcher.js

**Requirements:**
- Load restriction rules from `chrome.storage.local` (synced from backend or manually configured)
- Rules have two types: `location_rules` and `company_rules`
- Each rule has: `pattern` (string), `severity` ("red" | "amber"), `message` (string), `active` (boolean)
- Location matching: Case-insensitive substring match. "India" matches "Bangalore, Karnataka, India". Also support comma-separated alternatives (e.g., "India, Bengaluru, Hyderabad")
- Company matching: Case-insensitive substring match. "Acme Corp" matches "Acme Corporation" and "Acme Corp Ltd"
- Return the highest-severity match (red > amber) with its associated message
- If no match, return `{ severity: "green", message: "No restrictions. Source freely." }`

### 4. Content Script: banner.js

**Requirements:**
- Inject a fixed-position alert banner at the top of the LinkedIn profile page
- Banner should NOT interfere with LinkedIn's own UI — position it carefully
- Three visual states:
  - **Red**: Bold red background (#DC2626), white text, stop icon. "⛔ RESTRICTED — [custom message]"
  - **Amber**: Orange background (#F59E0B), dark text, warning icon. "⚠️ CAUTION — [custom message]"
  - **Green**: Subtle green left-border, small text. "✅ No restrictions apply"
- Banner should include a small "SG" logo/badge and a dismiss button (X)
- Green banners should auto-dismiss after 5 seconds unless user has "always show green" enabled
- Banner should animate in (slide down) and out smoothly
- Remove any existing SourceGuard banner before injecting a new one (prevents duplicates on SPA navigation)
- Include a "Powered by SourceGuard" link that opens the dashboard in a new tab

### 5. Popup (popup.html / popup.js)

**Requirements:**
- Show current profile status (if on a LinkedIn profile page): candidate name, location, employer, and alert status
- Quick stats: "X restrictions active" / "Last synced: [time]"
- Manual rule entry section:
  - "Add restricted location" input + severity dropdown + message field + Add button
  - "Add restricted company" input + severity dropdown + message field + Add button
- View/delete existing rules in a scrollable list
- "Sync rules" button (for when backend is connected)
- Settings link to options page
- Clean, modern design. Use the brand colours: Navy (#1B2A4A), Teal (#0EA5A0), Orange (#E8713A)

### 6. Popup: Local Storage Schema

For the MVP (before backend), store rules in `chrome.storage.local`:

```javascript
{
  "sourceguard_location_rules": [
    { "id": "lr_1", "pattern": "India", "severity": "red", "message": "India hub — do not source. Route to APAC TA team.", "active": true },
    { "id": "lr_2", "pattern": "Poland", "severity": "amber", "message": "Poland entity exists. Check with EU Ops before outreach.", "active": true }
  ],
  "sourceguard_company_rules": [
    { "id": "cr_1", "pattern": "Acme Corp", "severity": "red", "message": "Active non-solicit agreement until Dec 2026.", "active": true, "expires": "2026-12-31" }
  ],
  "sourceguard_settings": {
    "show_green_alerts": true,
    "green_auto_dismiss_seconds": 5,
    "alert_position": "top",
    "enabled": true
  }
}
```

### 7. Service Worker (background/service-worker.js)

For MVP, this is lightweight:
- Listen for tab URL changes and send messages to content scripts to re-parse
- Handle any chrome.storage operations
- (Phase 2: Sync rules from Supabase API, handle auth tokens)

---

## Phase 2: Admin Dashboard

### Tech Stack
- React 18+ with Vite
- Tailwind CSS for styling
- Supabase for auth + database
- Deploy to Vercel

### Pages

**Login:** Email/password + magic link via Supabase Auth. After login, check user's email domain against `companies` table for auto-association.

**Dashboard:** Overview showing total active rules, team members count, and recent alert activity (Phase 2).

**Location Rules:** Table of all location restrictions. Columns: Location Pattern, Severity, Custom Message, Status (active/inactive), Actions (edit/delete). Add new rule form. CSV bulk upload button.

**Company Rules:** Same as location rules but with an additional "Expires" date field for time-limited non-solicits.

**Team Members:** List of team members with roles (admin/member). Invite by email. Remove members. Only visible to admins.

**Settings:** Company name, default alert preferences, invite code management, export rules as CSV.

### Supabase Schema

```sql
-- Companies
CREATE TABLE companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  invite_code TEXT UNIQUE,
  plan TEXT DEFAULT 'starter' CHECK (plan IN ('starter', 'team', 'enterprise')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Team Members
CREATE TABLE team_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, user_id)
);

-- Location Rules
CREATE TABLE location_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('red', 'amber')),
  message TEXT,
  active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES team_members(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Company Rules
CREATE TABLE company_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('red', 'amber')),
  message TEXT,
  expires_at DATE,
  active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES team_members(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_rules ENABLE ROW LEVEL SECURITY;

-- Policies: Users can only see their own company's data
CREATE POLICY "Users see own company" ON team_members
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users see own company rules" ON location_rules
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM team_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users see own company rules" ON company_rules
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM team_members WHERE user_id = auth.uid())
  );

-- Admins can insert/update/delete rules
CREATE POLICY "Admins manage location rules" ON location_rules
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM team_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins manage company rules" ON company_rules
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM team_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
```

---

## Design Guidelines

### Brand Colours
- **Navy:** #1B2A4A (headings, dark backgrounds)
- **Teal:** #0EA5A0 (primary accent, CTAs, logo)
- **Orange:** #E8713A (warnings, amber alerts)
- **Light BG:** #F0F7F7 (subtle backgrounds)
- **Dark Text:** #2D2D2D (body text)

### Typography
- Font: Inter (dashboard) / system-ui (extension for performance)
- Clean, professional, minimal. This is a compliance tool — it should feel trustworthy and understated

### Extension Banner Design
- Banners should feel native to LinkedIn's design language but clearly distinct
- Use rounded corners (8px), subtle shadow, and smooth transitions
- Red/Amber banners should be impossible to miss but not annoying
- Green banners should be subtle — a gentle confirmation, not a celebration

### Logo
- "SG" monogram in a shield shape, rendered in teal (#0EA5A0) on dark navy (#1B2A4A)
- For the extension icon, create simple versions at 16x16, 48x48, and 128x128

---

## Build Sequence (Follow This Order)

1. **Scaffold the extension** — manifest.json, empty files, folder structure
2. **Build the LinkedIn parser** — Get location and company extraction working on standard LinkedIn profiles first
3. **Build the matcher** — Hardcode 2-3 test rules, verify matching logic works
4. **Build the banner injection** — Get visual alerts appearing on LinkedIn profiles
5. **Build the popup** — Manual rule management UI with chrome.storage
6. **Test end-to-end** — Navigate LinkedIn profiles and verify alerts appear correctly
7. **Create extension icons** — Simple SVG-based shield icon at required sizes
8. **Set up Supabase project** — Create tables, configure auth, set up RLS policies
9. **Scaffold the React dashboard** — Vite + React + Tailwind + Supabase client
10. **Build dashboard pages** — Login, rules management, team management
11. **Connect extension to backend** — Replace local storage with API sync
12. **Add CSV upload** — Bulk rule import for location and company rules
13. **Polish and test** — Cross-browser, error handling, loading states

---

## Key Technical Considerations

### LinkedIn DOM Resilience
LinkedIn's DOM changes regularly. Build the parser with:
- Multiple fallback selectors for each data point
- Graceful degradation if parsing fails (show "Unable to read profile" in popup, don't crash)
- A version/selector config that can be updated without rebuilding the entire extension
- Console warnings (not errors) when selectors fail

### Chrome Extension Manifest V3 Constraints
- Service workers are NOT persistent — they wake up on events and go back to sleep
- Use `chrome.storage` (not localStorage) for all persistent data
- Content scripts run in an isolated world — communicate with service worker via `chrome.runtime.sendMessage`
- Be mindful of permissions — request only what's needed

### LinkedIn Terms of Service
- This extension ONLY reads visible page content — no API calls to LinkedIn
- It does NOT scrape, store, or export any candidate data
- It does NOT automate any actions (no clicking, no messaging)
- This is functionally identical to a user reading the screen — the extension just adds a visual overlay
- Include a clear privacy policy stating this

---

## Testing Checklist

- [ ] Standard LinkedIn profile (/in/) — location and company extracted correctly
- [ ] LinkedIn Recruiter profile (/talent/) — parsing works
- [ ] LinkedIn Sales Navigator (/sales/) — parsing works
- [ ] Red alert displays correctly when location matches a red rule
- [ ] Amber alert displays correctly when location matches an amber rule
- [ ] Green alert displays when no rules match
- [ ] Company rule matching works (current employer)
- [ ] Banner dismisses correctly and doesn't reappear until next profile
- [ ] SPA navigation (clicking between profiles) triggers re-parse
- [ ] Popup shows current rules and allows add/delete
- [ ] Rules persist across browser restarts (chrome.storage)
- [ ] Extension works with 0 rules configured (no errors, shows setup prompt)
- [ ] Dashboard login works via Supabase Auth
- [ ] Dashboard rule CRUD operations work
- [ ] CSV upload creates rules correctly
- [ ] Extension syncs rules from backend when connected
