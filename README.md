# 💰 Expense Tracker PWA

A free, installable expense tracker that works fully offline. **No accounts. No servers. All data stays on your phone.**

---

## ✨ Features

- **Quick-add** expenses in under 5 seconds
- **11 categories** with emoji icons (editable)
- **Dashboard** with pie chart, picture mode, bar chart, and 6-month trend
- **Budget tracking** with progress bars (turns red near limit)
- **Transactions** list with search, filter, and edit
- **Auto-categorize** by merchant keyword rules (editable + learns your corrections)
- **Paste SMS** to auto-fill amounts from Indian bank messages
- **URL automation** for iOS Shortcuts
- **Export / Import** as CSV or JSON
- **Dark mode** automatic
- **Offline-first** via Service Worker

---

## 🖥️ Run Locally (Windows + VS Code)

You need a local server because browsers block ES modules opened directly as `file://`.

**Option 1 – VS Code Live Server (easiest)**

1. Install [VS Code](https://code.visualstudio.com/)
2. Open the `Expense tracker` folder in VS Code: `File → Open Folder`
3. Install the **Live Server** extension (search "Live Server" in Extensions panel)
4. Right-click `index.html` → **"Open with Live Server"**
5. Browser opens at `http://127.0.0.1:5500`

**Option 2 – Node.js `serve`**

```bash
# Install Node.js from https://nodejs.org first (one-time)
npx serve .
# Opens at http://localhost:3000
```

**Option 3 – Python (if installed)**

```bash
python -m http.server 5500
# Opens at http://localhost:5500
```

---

## 🌐 Live URL

**https://athirab102116.github.io/expense-tracker/**

The app is deployed on GitHub Pages. It updates automatically whenever you push to the `main` branch.

---

## 📱 Add to Home Screen on iPhone

1. Open Safari on your iPhone (must be Safari, not Chrome)
2. Navigate to your GitHub Pages URL (or local server IP from Step 4 below)
3. Tap the **Share button** (box with arrow pointing up)
4. Scroll down and tap **"Add to Home Screen"**
5. Tap **"Add"** in the top right
6. The app icon appears on your Home Screen — it opens full-screen like a native app!

### Test on your iPhone from local Windows PC

1. Make sure your iPhone and PC are on the same Wi-Fi network
2. Run `ipconfig` in Windows Command Prompt, find your IPv4 address (e.g. `192.168.1.5`)
3. Open Live Server in VS Code (port 5500)
4. On iPhone Safari, go to: `http://192.168.1.5:5500`
5. Add to Home Screen from there

> **Note**: The Service Worker (offline mode) only works on HTTPS or localhost. On your local IP, the app works but won't install the service worker. Full offline support activates once deployed to GitHub Pages (which uses HTTPS automatically).

---

## 🤖 iOS Shortcuts Automation

See the **Automation setup** page inside the app (Settings tab → iOS Shortcuts Automation).

### URL format

Open the app and silently log an expense by opening this URL:

```
https://athirab102116.github.io/expense-tracker/?add=1&amount=250&merchant=Swiggy&method=UPI&note=Lunch
```

Parameters:
| Param | Required | Description |
|-------|----------|-------------|
| `add` | Yes | Must be `1` |
| `amount` | Yes | Number (e.g. `250`) |
| `merchant` | No | Shop/app name for auto-categorization |
| `method` | No | `UPI`, `Card`, or `Cash` (default: `UPI`) |
| `note` | No | Short description |

### Basic iOS Shortcut

1. Open **Shortcuts app** → Automation → + → Personal Automation
2. Trigger: **Message** → Contains: `debited`
3. Actions:
   - **Text**: your tracker URL with amount placeholder
   - **Open URLs**
4. Disable "Ask Before Running" for silent operation

---

## 📂 Demo Data

1. Go to **Settings tab** in the app
2. Tap **"Load Demo"** to see sample data across charts
3. Tap **"Clear Demo"** to remove all data and start fresh

---

## 📁 File Structure

```
Expense tracker/
├── index.html          # App shell
├── manifest.json       # PWA manifest
├── sw.js              # Service worker (offline)
├── css/
│   └── app.css        # All styles
├── js/
│   ├── app.js         # Main app logic
│   ├── db.js          # IndexedDB wrapper
│   └── categories.js  # Default categories & SMS patterns
├── lib/
│   └── chart.umd.min.js  # Chart.js 4 (bundled, no CDN)
├── icons/
│   ├── icon-180.png   # Apple touch icon
│   ├── icon-192.png   # PWA icon
│   └── icon-512.png   # Large PWA icon
└── README.md
```

---

## 🔒 Privacy

- **Zero network requests** after initial load (served from cache)
- **No analytics, no tracking, no ads**
- All expense data is stored in your browser's IndexedDB — it never leaves your device
- Export your data anytime as JSON or CSV as a personal backup

---

## 🆘 Troubleshooting

**"App doesn't install / no Add to Home Screen prompt"**
- Must use Safari on iOS (Chrome on iPhone cannot install PWAs)
- Must be on HTTPS (GitHub Pages) — not `http://`

**"Charts don't show"**
- Load demo data (Settings → Load Demo) to see example charts
- Or add a few expenses manually first

**"Service worker not updating after I change files"**
- Increment the cache version in `sw.js`: change `v1` to `v2`
- Or open DevTools → Application → Service Workers → click "Update"

**"Data disappeared"**
- Safari may clear site data if storage is low or "Prevent Cross-Site Tracking" is aggressive
- Export JSON regularly as a backup (Settings → Export JSON)
