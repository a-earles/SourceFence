# SourceFence

**"Sourcing Compliance, Simplified."**

SourceFence is a Chrome extension that helps recruiters stay compliant when sourcing candidates on LinkedIn. It scans LinkedIn profiles in real time — across Standard, Recruiter, and Sales Navigator views — and displays color-coded alert banners when a candidate is located in a restricted market or employed at a restricted company.

All rules are stored locally in your browser. No data leaves your device.

---

## Features

- **Real-time LinkedIn profile scanning** — works on Standard (`/in/`), Recruiter (`/talent/`), and Sales Navigator (`/sales/`) profile pages
- **Search result badges** — per-candidate compliance badges on LinkedIn search results (Recruiter, Sales Nav, and standard search)
- **Color-coded alerts** — Red (Restricted), Amber (Caution), Green (Clear)
- **Location-based restriction rules** with comma-separated pattern matching (e.g., "Germany, Berlin, Munich")
- **Company-based restriction rules** with automatic name normalization (strips Inc, Ltd, GmbH, etc.)
- **Expiring company rules** — rules with an expiry date are automatically skipped once expired
- **Shadow DOM banner injection** — banners are fully encapsulated and never interfere with LinkedIn's UI
- **Privacy-first** — zero external network requests, all data stays in your browser
- **Configurable alerts** — toggle green alerts, set auto-dismiss timers

---

## Architecture

### Project Structure

```
SourceFence/
├── extension/                    # Chrome Extension (Manifest V3)
│   ├── manifest.json             # Extension manifest
│   ├── background/
│   │   └── service-worker.js     # MV3 service worker: message routing, badge updates, install lifecycle
│   ├── content/
│   │   ├── linkedin-parser.js    # DOM parser: extracts location & employer from LinkedIn profiles
│   │   ├── matcher.js            # Rule matching engine: normalized substring matching, severity resolution
│   │   ├── banner.js             # Banner UI: Shadow DOM injection, animations, auto-dismiss
│   │   ├── search-annotator.js   # Search results: per-card badge injection with lazy-load handling
│   │   └── content.css           # Host element positioning
│   ├── popup/
│   │   ├── popup.html            # Extension popup: status display, rule management
│   │   ├── popup.js              # Popup logic: CRUD rules, query active tab, message handling
│   │   └── popup.css             # Popup styles
│   ├── options/
│   │   └── options.html          # Settings page
│   └── icons/
│       ├── icon16.png            # Toolbar icon
│       ├── icon48.png            # Extensions page icon
│       └── icon128.png           # Chrome Web Store icon
│
├── docs/                         # GitHub Pages & Chrome Web Store assets
│   ├── index.html                # Landing page
│   └── chrome-web-store/
│       ├── privacy-policy.html   # Privacy policy
│       ├── store-listing.md      # CWS listing copy
│       └── submission-checklist.md
│
└── README.md                     # This file
```

### How It Works

```
LinkedIn Profile Page
        |
        v
[1] Content script (linkedin-parser.js) detects a profile page
    and parses the candidate's location and current employer
    from the DOM using a multi-layer selector chain with
    text-walking fallbacks.
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
    a configurable number of seconds (default: 3).
```

On search result pages, the search-annotator.js handles badge injection per candidate card instead of showing a single banner.

---

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/a-earles/SourceFence.git
   cd SourceFence
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable **Developer Mode** (toggle in the top-right corner)

4. Click **"Load unpacked"** and select the `extension/` directory

5. Navigate to any LinkedIn profile — you should see an alert banner appear

6. Click the **SourceFence** icon in the Chrome toolbar to add restriction rules

---

## Configuration

### Settings

Access settings by clicking the SourceFence popup icon and then "Settings".

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable SourceFence** | Master on/off switch for all alerts | Enabled |
| **Show green alerts** | Whether to display the "no restriction" confirmation banner | Enabled |
| **Auto-dismiss green alerts** | Seconds before green banners automatically disappear (1–60) | 3 seconds |

### Rule Format

| Field | Required | Description |
|-------|----------|-------------|
| `pattern` | Yes | Text to match against. For locations, supports comma-separated alternatives (e.g., `India, Bengaluru, Mumbai`). For companies, matches the candidate's current employer. |
| `severity` | Yes | `red` (Restricted) or `amber` (Caution). |
| `message` | No | A compliance note displayed in the alert banner (e.g., "Non-solicit agreement until Dec 2026"). |
| `expires_at` | No | Company rules only. A date after which the rule is automatically skipped. |

---

## Privacy

- **No data collection** — SourceFence does not collect, transmit, or store any personal data
- **No external requests** — the extension makes zero network requests after install
- **Local storage only** — all rules and settings are stored in your browser via `chrome.storage.local`
- **No LinkedIn API access** — only reads publicly visible page content from the DOM
- **No candidate data exported** — all matching happens locally in the browser

Full privacy policy: [a-earles.github.io/SourceFence/chrome-web-store/privacy-policy.html](https://a-earles.github.io/SourceFence/chrome-web-store/privacy-policy.html)

---

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Saves restriction rules and settings locally |
| `activeTab` | Reads the active LinkedIn tab to display compliance alerts |
| `host_permissions` (linkedin.com) | Injects alert banners and reads profile information on LinkedIn pages |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Extension** | Vanilla JavaScript, Chrome Manifest V3, Shadow DOM, Chrome Storage API |

---

## Support

Report issues or request features at [github.com/a-earles/SourceFence/issues](https://github.com/a-earles/SourceFence/issues)
