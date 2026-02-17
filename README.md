# SourceFence

**"Sourcing Compliance, Simplified."**

SourceFence is a Chrome extension paired with an admin dashboard that helps recruiting teams stay compliant when sourcing candidates on LinkedIn. It scans LinkedIn profiles in real time -- across Standard, Recruiter, and Sales Navigator views -- and displays color-coded alert banners when a candidate is located in a restricted market or employed at a restricted company. Rules are managed locally or centrally through a Supabase-backed admin dashboard with role-based access control.

---

## Features

- **Real-time LinkedIn profile scanning** -- works on Standard (`/in/`), Recruiter (`/talent/`), and Sales Navigator (`/sales/`) profile pages
- **Color-coded alert banners** -- Red (Restricted), Amber (Caution), Green (Clear)
- **Location-based and company-based restriction rules** with normalized substring matching
- **Shadow DOM banner injection** -- banners are fully encapsulated and never interfere with LinkedIn's UI
- **Offline-first with cloud sync** -- extension always works from local cache; rules sync from Supabase every 15 minutes
- **Admin dashboard** for centralized team rule management
- **CSV bulk import** for rules via drag-and-drop with validation and preview
- **Role-based access control** -- admin and member roles with scoped permissions
- **Supabase backend** with Row Level Security (RLS) on every table
- **Company name normalization** -- strips corporate suffixes (Inc, Ltd, GmbH, etc.) for accurate matching
- **Expiring company rules** -- rules with an `expires_at` date are automatically skipped once expired
- **Configurable alerts** -- toggle green alerts, set auto-dismiss timers, choose banner position (top/bottom)

---

## Architecture

### Project Structure

```
SourceFence/
├── extension/                    # Chrome Extension (Manifest V3)
│   ├── manifest.json             # Extension manifest (permissions, content scripts, service worker)
│   ├── background/
│   │   └── service-worker.js     # MV3 service worker: message routing, alarms, sync, badge updates
│   ├── content/
│   │   ├── linkedin-parser.js    # DOM parser: extracts location & employer from LinkedIn profiles
│   │   ├── matcher.js            # Rule matching engine: normalized substring matching, severity resolution
│   │   ├── banner.js             # Banner UI: Shadow DOM injection, animations, auto-dismiss
│   │   └── content.css           # Host element positioning (fixed, z-index)
│   ├── popup/
│   │   ├── popup.html            # Extension popup: status display, rule management, tabs
│   │   ├── popup.js              # Popup logic: CRUD rules, query active tab, message handling
│   │   └── popup.css             # Popup styles
│   ├── options/
│   │   └── options.html          # Settings page: enable/disable, green alerts, auto-dismiss, position
│   └── icons/
│       ├── icon.svg              # Source SVG icon
│       ├── icon16.png            # Toolbar icon
│       ├── icon48.png            # Extensions page icon
│       └── icon128.png           # Chrome Web Store icon
│
├── dashboard/                    # Admin Dashboard (React + Vite)
│   ├── package.json              # Dependencies: React 19, Supabase JS, PapaParse, Tailwind CSS 4
│   ├── vite.config.js            # Vite configuration with React and Tailwind plugins
│   ├── index.html                # Entry HTML
│   └── src/
│       ├── main.jsx              # App entry point with React Router
│       ├── App.jsx               # Route definitions with protected/public route wrappers
│       ├── index.css             # Tailwind imports and brand color theme
│       ├── lib/
│       │   └── supabase.js       # Supabase client initialization
│       ├── contexts/
│       │   └── AuthContext.jsx    # Authentication context (Supabase Auth)
│       ├── components/
│       │   ├── Layout.jsx        # Sidebar navigation layout with Outlet
│       │   ├── RuleTable.jsx     # Sortable rule table with severity badges
│       │   ├── RuleForm.jsx      # Add/edit rule form with validation
│       │   ├── CSVUpload.jsx     # CSV drag-and-drop upload with PapaParse validation
│       │   └── AlertPreview.jsx  # Live preview of how an alert banner will look
│       └── pages/
│           ├── Dashboard.jsx     # Overview: rule counts, recent activity
│           ├── LocationRules.jsx # Location rule CRUD + CSV import
│           ├── CompanyRules.jsx  # Company rule CRUD + CSV import
│           ├── TeamMembers.jsx   # Team management (admin-only)
│           ├── Settings.jsx      # Company settings
│           └── Login.jsx         # Authentication page
│
├── supabase/                     # Supabase Backend
│   ├── migrations/
│   │   └── 001_initial_schema.sql  # Tables, indexes, RLS policies, triggers
│   └── seed.sql                    # Sample data for development
│
├── DECISIONS.md                  # Technical decision log
└── README.md                     # This file
```

### Component Overview

| Component | Purpose |
|-----------|---------|
| **linkedin-parser.js** | Extracts candidate location and current employer from the LinkedIn DOM using a multi-layer selector chain with text-walking fallbacks. Handles Standard, Recruiter, and Sales Navigator variants. |
| **matcher.js** | Loads restriction rules from `chrome.storage.local`, matches candidate data using normalized substring matching, and resolves the highest-severity result. |
| **banner.js** | Injects alert banners into the page using a closed Shadow DOM. Handles animations, auto-dismiss for green alerts, and configurable positioning. |
| **service-worker.js** | MV3 service worker that routes messages between content scripts and the popup, manages the extension badge, schedules 15-minute sync alarms, and handles install/update lifecycle. |
| **popup** | Extension popup UI for viewing current profile status, managing rules (add/delete), and accessing settings. |
| **dashboard** | React admin app for centralized rule management, team administration, CSV bulk import, and settings. |
| **Supabase schema** | PostgreSQL tables for companies, team members, location rules, and company rules -- all with Row Level Security policies. |

---

## Getting Started

### Chrome Extension (Local Development)

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd SourceFence
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable **Developer Mode** (toggle in the top-right corner)

4. Click **"Load unpacked"** and select the `extension/` directory

5. Navigate to any LinkedIn profile -- you should see an alert banner appear at the top of the page

6. Click the **SourceFence** icon in the Chrome toolbar to view the current profile status and manage rules

7. Default test rules are loaded on first install:
   - **India** = Red ("India hub -- do not source. Route to APAC TA team.")
   - **Poland** = Amber ("Poland entity exists. Check with EU Ops before outreach.")
   - **Acme Corp** = Red ("Active non-solicit agreement until Dec 2026.")

### Admin Dashboard

1. Install dependencies:
   ```bash
   cd dashboard
   npm install
   ```

2. Create a `.env` file in the `dashboard/` directory:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:5173](http://localhost:5173) in your browser

### Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)

2. Run the initial migration in the Supabase SQL Editor:
   ```sql
   -- Copy and paste the contents of:
   -- supabase/migrations/001_initial_schema.sql
   ```

3. Optionally seed the database with sample data:
   ```sql
   -- Copy and paste the contents of:
   -- supabase/seed.sql
   ```

4. Copy your project URL and anon key from the Supabase dashboard (Settings > API) into:
   - The dashboard `.env` file (see above)
   - The extension options page (click SourceFence icon > Settings)

---

## How It Works

```
LinkedIn Profile Page
        |
        v
[1] Content script (linkedin-parser.js) detects a profile page
    and parses the candidate's location and current employer
    from the DOM using a multi-layer selector chain.
        |
        v
[2] Parsed data is passed to the matcher (matcher.js), which
    loads restriction rules from chrome.storage.local and checks
    the candidate against all active rules using normalized
    substring matching.
        |
        v
[3] The matcher resolves the highest-severity match:
    - Red (Restricted) if any red rule matches
    - Amber (Caution) if any amber rule matches
    - Green (Clear) if no rules match
        |
        v
[4] The banner module (banner.js) injects a color-coded alert
    banner into the page via Shadow DOM. Red and amber banners
    persist until dismissed; green banners auto-dismiss after
    5 seconds (configurable).
        |
        v
[5] The service worker updates the extension badge icon and
    caches the result. Rules sync from the Supabase backend
    every 15 minutes via the Chrome Alarms API.
```

### Data Flow Summary

1. User navigates to a LinkedIn profile
2. Content script parses location and employer from the DOM
3. Matcher checks the parsed data against cached rules
4. Banner displays the result (red / amber / green)
5. Rules sync from the Supabase backend every 15 minutes

---

## Configuration

### Options Page

Access the options page by clicking the SourceFence popup icon and then "Settings", or by right-clicking the extension icon and selecting "Options."

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable SourceFence** | Master on/off switch for all banner alerts | Enabled |
| **Show green alerts** | Whether to display the "no restriction" green banner | Enabled |
| **Auto-dismiss green alerts** | Number of seconds before green banners automatically disappear | 5 seconds |
| **Alert banner position** | Where the banner appears on the page | Top |

### Rule Format

Each rule consists of the following fields:

| Field | Required | Description |
|-------|----------|-------------|
| `pattern` | Yes | The text pattern to match against. For location rules, this matches against the candidate's location string. Supports comma-separated alternatives (e.g., `India, Bengaluru, Mumbai`). |
| `severity` | Yes | `red` (Restricted) or `amber` (Caution). |
| `message` | No | A compliance note displayed in the alert banner and popup (e.g., "Non-solicit agreement in effect until Dec 2026."). |
| `expires_at` | No | Company rules only. An ISO date (`YYYY-MM-DD`) after which the rule is automatically treated as inactive. |
| `active` | No | Boolean. Rules with `active: false` are skipped during matching. Defaults to `true`. |

### CSV Import Format

The dashboard supports bulk rule import via CSV files. Drag and drop a `.csv` file onto the upload area or click to browse.

**Location rules CSV:**

```csv
pattern,severity,message
India,red,Do not source candidates from India.
Poland,amber,Check with EU Ops before outreach.
"Germany, Berlin",amber,Berlin office restrictions apply.
```

**Company rules CSV:**

```csv
pattern,severity,message,expires_at
Meta,red,Non-solicit agreement in effect.,2026-12-31
Stripe,amber,Check with leadership before approaching.,
```

**Column requirements:**
- `pattern` (required) -- the match pattern
- `severity` (required) -- must be `red` or `amber`
- `message` (optional) -- compliance note
- `expires_at` (optional, company rules only) -- expiration date in any parseable date format

---

## Privacy & Compliance

- This extension **only reads visible page content** from the LinkedIn DOM to extract location and employer text.
- It does **not** scrape, store, or export any candidate data.
- It does **not** automate any LinkedIn actions (no clicks, messages, or connection requests).
- **No candidate PII is transmitted to any server.** All matching happens locally in the browser.
- The **only data synced** with the Supabase backend is the ruleset itself (patterns, severities, and messages). No candidate information ever leaves the browser.

---

## Brand Colors

| Color | Hex | Usage |
|-------|-----|-------|
| **Navy** | `#1B2A4A` | Primary brand color, headers, sidebar, dark text accents |
| **Teal** | `#0EA5A0` | Primary action color, buttons, links, green banner accent |
| **Teal Dark** | `#0C8F8A` | Hover state for teal elements |
| **Orange** | `#E8713A` | Amber severity accent |
| **Red** | `#DC2626` | Red severity / restricted alerts |
| **Amber** | `#F59E0B` | Amber severity banner background |
| **Green** | `#10B981` | Green severity / clear status |
| **Light** | `#F0F7F7` | Light background, cards |
| **Dark** | `#2D2D2D` | Body text color |
| **White** | `#FFFFFF` | Backgrounds, text on dark surfaces |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Extension** | Vanilla JavaScript, Chrome Manifest V3, Shadow DOM, Chrome Storage API, Chrome Alarms API |
| **Dashboard** | React 19, React Router 6, Vite 7, Tailwind CSS 4 |
| **Backend** | Supabase (PostgreSQL + Auth + Row Level Security) |
| **CSV Parsing** | PapaParse |
| **Fonts** | Inter (Google Fonts) |

---

## License

MIT
