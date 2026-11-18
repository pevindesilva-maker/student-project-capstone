/**
 * Update endpoints — edit an existing record in place.
 *
 * Add this as a NEW file called "Updates.gs" in the Apps Script project.
 * It is self-contained: it only uses helpers that already exist in
 * Utilities.gs and Validation.js, so no other .gs file needs to change.
 *
 * Each endpoint keeps the record's id, type and createdAt, and only rewrites
 * the editable columns. Ownership is re-checked with userId on every write.
 */

/** Locate the sheet row that holds this record for this user. */
function findRecordRow_(sheetName, idField, idValue, userId) {
  var sheet = getSheetByName(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return null;
  var data = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  var headers = data[0];
  var idCol = headers.indexOf(idField);
  var userCol = headers.indexOf('userId');
  if (idCol < 0) return null;
  for (var i = 1; i < data.length; i++) {
    var sameId = String(data[i][idCol]) === String(idValue);
    var sameUser = userCol < 0 || String(data[i][userCol]).trim() === String(userId);
    if (sameId && sameUser) {
      return { sheet: sheet, rowIndex: i + 1, headers: headers };
    }
  }
  return null;
}

/** Overwrite only the given columns of one row. Returns true when a row was updated. */
function updateRowById_(sheetName, idField, idValue, userId, changes) {
  var found = findRecordRow_(sheetName, idField, idValue, userId);
  if (!found) return false;
  var headers = found.headers;
  var row = found.sheet.getRange(found.rowIndex, 1, 1, headers.length).getValues()[0];
  Object.keys(changes).forEach(function (key) {
    var col = headers.indexOf(key);
    if (col >= 0) row[col] = changes[key];
  });
  found.sheet.getRange(found.rowIndex, 1, 1, headers.length).setValues([row]);
  return true;
}

function updateIncome(record) {
  var userId = getUserId();
  var errors = Validation.validateIncome(record);
  if (errors.length) return { success: false, errors: errors };
  var clean = Validation.sanitise(record);
  var ok = updateRowById_(
    Config.SHEET_NAMES.INCOME,
    'incomeId',
    record.incomeId,
    userId,
    { amount: clean.amount, date: clean.date, source: clean.source, note: clean.note }
  );
  return ok ? { success: true } : { success: false, errors: ['Income record not found'] };
}

function updateExpectedIncome(record) {
  var userId = getUserId();
  var errors = Validation.validateExpectedIncome(record);
  if (errors.length) return { success: false, errors: errors };
  var clean = Validation.sanitise(record);
  var ok = updateRowById_(
    Config.SHEET_NAMES.EXPECTED_INCOME,
    'incomeId',
    record.incomeId,
    userId,
    { amount: clean.amount, date: clean.date, source: clean.source, note: clean.note }
  );
  return ok ? { success: true } : { success: false, errors: ['Expected income not found'] };
}

function updateExpense(record) {
  var userId = getUserId();
  var errors = Validation.validateExpense(record);
  if (errors.length) return { success: false, errors: errors };
  var clean = Validation.sanitise(record);
  var isEssential = Config.ESSENTIAL_CATEGORIES.indexOf(clean.category) !== -1;
  var ok = updateRowById_(
    Config.SHEET_NAMES.EXPENSES,
    'expenseId',
    record.expenseId,
    userId,
    {
      amount: clean.amount,
      date: clean.date,
      category: clean.category,
      note: clean.note,
      essential: isEssential
    }
  );
  return ok ? { success: true } : { success: false, errors: ['Expense not found'] };
}

function updateUpcomingExpense(record) {
  var userId = getUserId();
  var errors = Validation.validateUpcomingExpense(record);
  if (errors.length) return { success: false, errors: errors };
  var clean = Validation.sanitise(record);
  var isEssential = Config.ESSENTIAL_CATEGORIES.indexOf(clean.category) !== -1;
  var ok = updateRowById_(
    Config.SHEET_NAMES.EXPENSES,
    'expenseId',
    record.expenseId,
    userId,
    {
      amount: clean.amount,
      date: clean.dueDate,
      category: clean.category,
      note: String(clean.name || '') + (clean.note ? ' - ' + clean.note : ''),
      essential: isEssential
    }
  );
  return ok ? { success: true } : { success: false, errors: ['Upcoming bill not found'] };
}

function updateSavingsGoal(record) {
  var userId = getUserId();
  var errors = Validation.validateSavingsGoal(record);
  if (errors.length) return { success: false, errors: errors };
  var clean = Validation.sanitise(record);
  var ok = updateRowById_(
    Config.SHEET_NAMES.SAVINGS_GOALS,
    'goalId',
    record.goalId,
    userId,
    {
      goalName: clean.goalName,
      targetAmount: clean.targetAmount,
      currentAmount: clean.currentAmount,
      targetDate: clean.targetDate
    }
  );
  return ok ? { success: true } : { success: false, errors: ['Savings goal not found'] };
}
