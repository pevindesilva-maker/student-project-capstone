/**
 * Google Apps Script entry point — Student Budget web app.
 * Deploy as: Execute as "Me", Access "Anyone with Google account".
 * Frontend calls these endpoints via google.script.run.
 */

/**
 * Initial setup: create sheets and headers on first deploy.
 * Run once after deployment via the Apps Script editor.
 */
function onInstall() {
  var ss = SpreadsheetApp.openById(Config.SPREADSHEET_ID);
  var sheets = [
    { name: Config.SHEET_NAMES.INCOME, headers: ['userId', 'incomeId', 'amount', 'date', 'source', 'note', 'type', 'createdAt'] },
    { name: Config.SHEET_NAMES.EXPECTED_INCOME, headers: ['userId', 'incomeId', 'amount', 'date', 'source', 'note', 'type', 'createdAt'] },
    { name: Config.SHEET_NAMES.EXPENSES, headers: ['userId', 'expenseId', 'amount', 'date', 'category', 'note', 'type', 'essential', 'createdAt'] },
    { name: Config.SHEET_NAMES.SAVINGS_GOALS, headers: ['userId', 'goalId', 'goalName', 'targetAmount', 'currentAmount', 'targetDate', 'createdAt'] },
    { name: Config.SHEET_NAMES.AI_LOGS, headers: ['userId', 'recommendationId', 'timestamp', 'currentBalance', 'safeToSpend', 'expectedIncome', 'upcomingEssentialExpenses', 'savingsCommitment', 'model', 'promptVersion', 'aiResponse', 'status', 'error'] },
    { name: Config.SHEET_NAMES.SETTINGS, headers: ['userId', 'key', 'value'] }
  ];
  sheets.forEach(function(s) {
    var sheet = ss.getSheetByName(s.name) || ss.insertSheet(s.name);
    sheet.getRange(1, 1, 1, s.headers.length).setValues([s.headers]);
    sheet.setFrozenRows(1);
  });
}

/**
 * Web app entry point — serves the HTML frontend.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Student Budget — AI-Assisted Budget Planner')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Include partial HTML templates.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * --- READ endpoints ---
 */
function getDashboard() {
  var userId = getUserId();
  var data = BudgetEngine.getDashboardData(userId);
  return { success: true, data: JSON.parse(JSON.stringify(data)) };
}

function getConfig() {
  return {
    success: true,
    config: {
      CURRENCY_SYMBOL: Config.CURRENCY_SYMBOL,
      INCOME_SOURCES: Config.INCOME_SOURCES,
      EXPENSE_CATEGORIES: Config.EXPENSE_CATEGORIES,
      ESSENTIAL_CATEGORIES: Config.ESSENTIAL_CATEGORIES
    }
  };
}

/**
 * Full data for the PDF report: every record, plus the key figures.
 * Dates are converted to plain "yyyy-MM-dd" text so they never shift by a day.
 */
function getReportData() {
  var userId = getUserId();
  var tz = Session.getScriptTimeZone();
  var dash = BudgetEngine.getDashboardData(userId);

  function day_(v) {
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    return String(v || '').slice(0, 10);
  }
  function byDate_(a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); }

  var income = getIncomeRecords(userId)
    .filter(function(i) { return i.type === 'ACTUAL'; })
    .map(function(i) {
      return { date: day_(i.date), source: String(i.source || ''), note: String(i.note || ''), amount: Number(i.amount) || 0 };
    })
    .sort(byDate_);

  var expenses = getExpenseRecords(userId)
    .filter(function(e) { return e.type === 'ACTUAL'; })
    .map(function(e) {
      return { date: day_(e.date), category: String(e.category || ''), note: String(e.note || ''), amount: Number(e.amount) || 0 };
    })
    .sort(byDate_);

  var upcoming = getExpenseRecords(userId)
    .filter(function(e) { return e.type === 'UPCOMING'; })
    .map(function(e) {
      return {
        date: day_(e.date), category: String(e.category || ''), note: String(e.note || ''),
        amount: Number(e.amount) || 0, essential: e.essential === true || String(e.essential).toLowerCase() === 'true'
      };
    })
    .sort(byDate_);

  var expectedIncome = getExpectedIncomeRecords(userId)
    .map(function(i) {
      return { date: day_(i.date), source: String(i.source || ''), note: String(i.note || ''), amount: Number(i.amount) || 0 };
    })
    .sort(byDate_);

  var goals = getSavingsGoals(userId).map(function(g) {
    var target = Number(g.targetAmount) || 0;
    var saved = Number(g.currentAmount) || 0;
    var pct = target > 0 ? Math.min((saved / target) * 100, 100) : 0;
    return {
      goalName: String(g.goalName || ''), currentAmount: saved, targetAmount: target,
      progressPercent: Math.round(pct * 10) / 10, targetDate: g.targetDate ? day_(g.targetDate) : ''
    };
  });

  var next = dash.safeToSpend.nextExpectedIncome;

  return {
    success: true,
    data: {
      generatedAt: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'),
      userEmail: String(userId),
      summary: {
        balance: dash.balance.balance,
        totalIncome: dash.balance.totalIncome,
        totalExpenses: dash.balance.totalExpenses,
        safeToSpend: dash.safeToSpend.safeToSpend,
        essentialExpenses: dash.safeToSpend.essentialExpensesBeforeNextIncome,
        savingsCommitment: dash.safeToSpend.savingsCommitment,
        dailySafeToSpend: dash.dailySafeToSpend.dailySafeToSpend,
        daysUntilNextIncome: dash.dailySafeToSpend.daysUntilNextIncome,
        nextIncomeAmount: next ? Number(next.amount) : null,
        nextIncomeDate: next ? day_(next.date) : '',
        statusLabel: dash.statusLabel,
        alerts: dash.alerts.map(function(a) { return { title: a.title, message: a.message }; })
      },
      categories: dash.categorySpending.map(function(c) { return { category: c.category, amount: c.amount }; }),
      income: income,
      expenses: expenses,
      upcoming: upcoming,
      expectedIncome: expectedIncome,
      goals: goals
    }
  };
}

/**
 * --- WRITE endpoints (CRUD) ---
 */

function addIncome(record) {
  var userId = getUserId();
  var errors = Validation.validateIncome(record);
  if (errors.length) return { success: false, errors: errors };
  var clean = Validation.sanitise(record);
  var now = new Date().toISOString();
  var full = Object.assign({}, clean, {
    incomeId: generateId('INC'),
    type: 'ACTUAL',
    createdAt: now
  });
  saveIncomeRecord(userId, full);
  return { success: true, record: full };
}

function addExpectedIncome(record) {
  var userId = getUserId();
  var errors = Validation.validateExpectedIncome(record);
  if (errors.length) return { success: false, errors: errors };
  var clean = Validation.sanitise(record);
  var now = new Date().toISOString();
  var full = Object.assign({}, clean, {
    incomeId: generateId('INC'),
    type: 'EXPECTED',
    createdAt: now
  });
  saveExpectedIncomeRecord(userId, full);
  return { success: true, record: full };
}

function addExpense(record) {
  var userId = getUserId();
  var errors = Validation.validateExpense(record);
  if (errors.length) return { success: false, errors: errors };
  var clean = Validation.sanitise(record);
  var now = new Date().toISOString();
  var isEssential = Config.ESSENTIAL_CATEGORIES.indexOf(clean.category) !== -1;
  var full = Object.assign({}, clean, {
    expenseId: generateId('EXP'),
    type: 'ACTUAL',
    essential: isEssential,
    createdAt: now
  });
  saveExpenseRecord(userId, full);
  return { success: true, record: full };
}

function addUpcomingExpense(record) {
  var userId = getUserId();
  var errors = Validation.validateUpcomingExpense(record);
  if (errors.length) return { success: false, errors: errors };
  var clean = Validation.sanitise(record);
  var now = new Date().toISOString();
  var isEssential = Config.ESSENTIAL_CATEGORIES.indexOf(clean.category) !== -1;
  var full = Object.assign({}, clean, {
    expenseId: generateId('EXP'),
    date: clean.dueDate,
    note: clean.name + (clean.note ? ' - ' + clean.note : ''),
    type: 'UPCOMING',
    essential: isEssential,
    createdAt: now
  });
  saveExpenseRecord(userId, full);
  return { success: true, record: full };
}

function addSavingsGoal(record) {
  var userId = getUserId();
  var errors = Validation.validateSavingsGoal(record);
  if (errors.length) return { success: false, errors: errors };
  var clean = Validation.sanitise(record);
  var now = new Date().toISOString();
  var full = Object.assign({}, clean, {
    goalId: generateId('SAV'),
    createdAt: now
  });
  saveSavingsGoal(userId, full);
  return { success: true, record: full };
}

/**
 * Delete endpoints — the frontend asks for confirmation first.
 * Each one only deletes records that belong to the logged-in user.
 */
function deleteIncome(incomeId) {
  return { success: deleteRowById(Config.SHEET_NAMES.INCOME, 'incomeId', incomeId, getUserId()) };
}

function deleteExpectedIncome(incomeId) {
  return { success: deleteRowById(Config.SHEET_NAMES.EXPECTED_INCOME, 'incomeId', incomeId, getUserId()) };
}

function deleteExpense(expenseId) {
  return { success: deleteRowById(Config.SHEET_NAMES.EXPENSES, 'expenseId', expenseId, getUserId()) };
}

function deleteSavingsGoal(goalId) {
  return { success: deleteRowById(Config.SHEET_NAMES.SAVINGS_GOALS, 'goalId', goalId, getUserId()) };
}

/**
 * AI chat endpoint.
 */
function chatWithGemini(message, history) {
  var userId = getUserId();
  var result = AIService.chatWithGemini(userId, message, history);
  return { success: true, response: result.text, sources: result.sources, searched: result.searched };
}

/** Date helper for demo data: "yyyy-MM-dd" for today plus N days (negative = past). */
function dateOffset_(days) {
  var d = new Date();
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Demo data loader (for presentation / testing).
 * Records are spread over the last few weeks so the PDF line chart has a real shape.
 */
function loadDemoData() {
  var userId = getUserId();
  var timestamp = new Date().toISOString();

  // Income
  var income1 = { incomeId: generateId('INC'), amount: 50000, date: dateOffset_(-20), source: 'Family Support', note: 'Monthly family transfer', type: 'ACTUAL', createdAt: timestamp };
  var income2 = { incomeId: generateId('INC'), amount: 12000, date: dateOffset_(-8), source: 'Part-Time Work', note: 'Weekend shift payment', type: 'ACTUAL', createdAt: timestamp };
  var income3 = { incomeId: generateId('INC'), amount: 10000, date: dateOffset_(14), source: 'Family Support', note: 'Expected family transfer', type: 'EXPECTED', createdAt: timestamp };
  saveIncomeRecord(userId, income1);
  saveIncomeRecord(userId, income2);
  saveExpectedIncomeRecord(userId, income3);

  // Expenses
  var exp1 = { expenseId: generateId('EXP'), amount: 8000, date: dateOffset_(-12), category: 'Food', note: 'Groceries', type: 'ACTUAL', essential: false, createdAt: timestamp };
  var exp2 = { expenseId: generateId('EXP'), amount: 4000, date: dateOffset_(-9), category: 'Transport', note: 'Bus pass', type: 'ACTUAL', essential: true, createdAt: timestamp };
  var exp3 = { expenseId: generateId('EXP'), amount: 3000, date: dateOffset_(-6), category: 'Education', note: 'Textbooks', type: 'ACTUAL', essential: true, createdAt: timestamp };
  var exp4 = { expenseId: generateId('EXP'), amount: 2000, date: dateOffset_(-2), category: 'Entertainment', note: 'Movie night', type: 'ACTUAL', essential: false, createdAt: timestamp };
  var exp5 = { expenseId: generateId('EXP'), amount: 20000, date: dateOffset_(10), category: 'Education', note: 'Semester Fee', type: 'UPCOMING', essential: true, createdAt: timestamp };
  saveExpenseRecord(userId, exp1);
  saveExpenseRecord(userId, exp2);
  saveExpenseRecord(userId, exp3);
  saveExpenseRecord(userId, exp4);
  saveExpenseRecord(userId, exp5);

  // Savings Goals
  var goal1 = { goalId: generateId('SAV'), goalName: 'Emergency Fund', targetAmount: 10000, currentAmount: 3000, targetDate: '', createdAt: timestamp };
  var goal2 = { goalId: generateId('SAV'), goalName: 'Laptop Fund', targetAmount: 50000, currentAmount: 15000, targetDate: '', createdAt: timestamp };
  saveSavingsGoal(userId, goal1);
  saveSavingsGoal(userId, goal2);

  return { success: true };
}

/**
 * Reset all user data.
 */
function resetAllData() {
  var userId = getUserId();
  var sheets = [Config.SHEET_NAMES.INCOME, Config.SHEET_NAMES.EXPECTED_INCOME, Config.SHEET_NAMES.EXPENSES, Config.SHEET_NAMES.SAVINGS_GOALS, Config.SHEET_NAMES.AI_LOGS];
  sheets.forEach(function(name) {
    var sheet = getSheetByName(name);
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
      var userCol = 0; // userId is always first column
      for (var i = data.length - 1; i >= 0; i--) {
        if (String(data[i][userCol]) === String(userId)) {
          sheet.deleteRow(i + 2);
        }
      }
    }
  });
  return { success: true };
}