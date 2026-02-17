# SourceFence — Chrome Web Store Submission Checklist

## Developer Account
- [ ] Register a Chrome Web Store developer account at https://chrome.google.com/webstore/devconsole/
- [ ] Pay the one-time $5 USD registration fee
- [ ] Verify your email address

## Store Listing (required fields)
- [x] Extension name: "SourceFence — Sourcing Compliance for Recruiters" (49 chars, max 75)
- [x] Summary: see store-listing.md (126 chars, max 132)
- [x] Detailed description: see store-listing.md
- [x] Category: Productivity
- [x] Language: English

## Graphics (required)
- [x] Store icon: 128x128 PNG — exists at extension/icons/icon128.png
- [ ] Screenshot 1: 1280x800 PNG — Profile page with red banner alert
- [ ] Screenshot 2: 1280x800 PNG — Search results with coloured badges
- [ ] Screenshot 3: 1280x800 PNG — Popup with rules configured
- [ ] Screenshot 4: 1280x800 PNG — Settings page (optional but recommended)
- [x] Small promo tile: 440x280 PNG — docs/chrome-web-store/promo-small-440x280.png

## Privacy
- [x] Privacy policy: docs/chrome-web-store/privacy-policy.html
- [x] Host the privacy policy at a public URL — https://a-earles.github.io/SourceFence/chrome-web-store/privacy-policy.html
- [ ] Enter the privacy policy URL in the developer dashboard

## Permission Justifications (entered during submission)
- **storage**: "Saves the user's restriction rules and settings locally. No data is sent externally."
- **activeTab**: "Reads the active LinkedIn tab to display compliance alert banners on profile pages."
- **host_permissions (linkedin.com)**: "Injects compliance alert banners and reads publicly displayed profile information (name, location, employer) on LinkedIn pages to match against user-configured restriction rules. All processing is local."

## Single Purpose Statement
"SourceFence helps recruiters maintain sourcing compliance by flagging restricted locations and companies on LinkedIn profiles in real time."

## Package
- [x] Create the extension ZIP — docs/chrome-web-store/sourcefence-v1.0.0.zip (58KB)
- [ ] Verify the ZIP loads correctly via chrome://extensions in developer mode
- [ ] Test all functionality after loading from ZIP

## Pre-Submission Testing
- [x] Extension loads without errors in Chrome
- [x] Popup opens and displays correctly
- [x] Rules can be added and deleted
- [x] Profile page banners appear on linkedin.com/in/
- [x] Recruiter page banners appear on linkedin.com/talent/
- [x] Search result badges appear
- [x] Settings page saves and loads correctly
- [x] No console errors in service worker
- [ ] Test on a fresh Chrome profile (no previous extension data)
- [ ] Verify icon displays correctly at all sizes (16, 48, 128)

## Post-Submission
- [ ] Monitor the developer dashboard for review status
- [ ] Respond promptly to any reviewer feedback
- [ ] Expected review time: 1-3 days (may take up to 3 weeks for first submission)
