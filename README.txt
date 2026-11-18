Student Budget Planner — Google Apps Script option

See README.md in this folder for the full deployment steps.

Quick summary:
  1. Create a Google Sheet and copy its ID.
  2. Create an Apps Script project and add the script and .html files from this folder.
  3. Script Properties: SPREADSHEET_ID (required), GEMINI_API_KEY (optional).
  4. Run onInstall once, then Deploy > New deployment > Web app.

Each script exists twice (.gs and .js) with identical code. Deploy only one set.
