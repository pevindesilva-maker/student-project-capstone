# Student Budget Planner — Google Apps Script option

This is the original Google Sheets version of the planner: same interface and budgeting rules as
the Node app, but it runs entirely inside your Google account and stores records in a spreadsheet.

All scripts are present twice — once as `.gs` and once as `.js` — with identical code (only line
endings differ). `Database` and `Validation` exist only as `.js`. Deploy **one** set, never both,
or the project will contain duplicate functions. The all-`.js` set is complete and is the easiest
to follow.

## Files to deploy

| File | Purpose |
| --- | --- |
| `Code` | Entry point (`doGet`), dashboard/report endpoints, record actions, demo/reset |
| `Config` | Sheet names, currency, categories, AI settings |
| `BudgetEngine` | Deterministic safe-to-spend, projections, alerts |
| `Database` | Spreadsheet reads/writes, scoped by `userId` |
| `Utilities` | Helpers (dates, ids, formatting) |
| `Validation` | Input validation |
| `AIService` | Gemini calls and the offline fallback |
| `Index.html` | Page shell |
| `JavaScript.html` | Client logic (`google.script.run`) |
| `Styles.html` | Styles |

Script files are shown without extension because each exists as both `.gs` and `.js`; pick one
extension and use it for all seven.

`appsscript.json` holds the timezone (`Asia/Colombo`), V8 runtime and web-app settings.

## Setup

1. **Create the spreadsheet** and copy its ID from the URL:
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`
2. **Create the script** at <https://script.google.com> → *New project*.
3. Recreate the files above in the editor (or push them with `clasp`), copying the contents from
   this folder.
4. **Project Settings → Script Properties**, add:

   | Property | Value |
   | --- | --- |
   | `SPREADSHEET_ID` | the ID from step 1 |
   | `GEMINI_API_KEY` | optional Gemini key for AI answers |

5. Run **`onInstall`** once from the editor and approve the permissions. It creates the tabs
   `Income`, `ExpectedIncome`, `Expenses`, `SavingsGoals`, `AILogs`, `Settings` with their headers.
6. **Deploy → New deployment → Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone with a Google account** (or *Anyone*)
7. Open the deployment URL.

To publish an update: **Deploy → Manage deployments → pencil → New version → Deploy**.

## Deploying with clasp (optional)

```bash
npm install -g @google/clasp
clasp login
cd legacy-apps-script
clasp push
```

Note `.clasp.json` points at the original script ID and lists both `.js` and `.gs` extensions, so a
plain `clasp push` would upload both sets and collide. Before pushing, either remove one copy of
each duplicate, or set `"scriptExtensions": [".js"]` in `.clasp.json`. Change `scriptId` (or run
`clasp clone <your-script-id>`) to target a different project.

## Data

All records live in the spreadsheet tabs listed above; each row has a `userId`, so several
accounts can share one sheet. There is no SQLite/PostgreSQL database in this option.

To move data into the Node version, export each tab as CSV and run:

```bash
npm run import:sheets -- --dir ./sheets --email you@example.com
```

See the main [`README.md`](../README.md) for the Node/desktop app.
