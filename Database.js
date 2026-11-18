/**
 * Database access layer for the Student Budget Apps Script.
 * Reads and writes records to the bound Google Sheets spreadsheet.
 * Each row is scoped by userId for multi-user isolation.
 */

function getIncomeRecords(userId) {
  return readObjects(Config.SHEET_NAMES.INCOME, userId);
}

function saveIncomeRecord(userId, record) {
  return appendRow(Config.SHEET_NAMES.INCOME, Object.assign({ userId: userId }, record));
}

function getExpectedIncomeRecords(userId) {
  return readObjects(Config.SHEET_NAMES.EXPECTED_INCOME, userId);
}

function saveExpectedIncomeRecord(userId, record) {
  return appendRow(Config.SHEET_NAMES.EXPECTED_INCOME, Object.assign({ userId: userId }, record));
}

function getExpenseRecords(userId) {
  return readObjects(Config.SHEET_NAMES.EXPENSES, userId);
}

function saveExpenseRecord(userId, record) {
  return appendRow(Config.SHEET_NAMES.EXPENSES, Object.assign({ userId: userId }, record));
}

function getSavingsGoals(userId) {
  return readObjects(Config.SHEET_NAMES.SAVINGS_GOALS, userId);
}

function saveSavingsGoal(userId, record) {
  return appendRow(Config.SHEET_NAMES.SAVINGS_GOALS, Object.assign({ userId: userId }, record));
}

function getAILogs(userId) {
  return readObjects(Config.SHEET_NAMES.AI_LOGS, userId);
}

function saveAILog(userId, log) {
  return appendRow(Config.SHEET_NAMES.AI_LOGS, Object.assign({ userId: userId }, log));
}

function getSettings(userId) {
  var rows = readObjects(Config.SHEET_NAMES.SETTINGS, userId);
  var settings = {};
  rows.forEach(function(r) { settings[r.key] = r.value; });
  return settings;
}

function saveSetting(userId, key, value) {
  var rows = readObjects(Config.SHEET_NAMES.SETTINGS, userId);
  var existing = rows.filter(function(r) { return String(r.key) === String(key); })[0];
  if (existing) {
    existing.value = value;
    return appendRow(Config.SHEET_NAMES.SETTINGS, existing);
  }
  return appendRow(Config.SHEET_NAMES.SETTINGS, { userId: userId, key: key, value: value });
}
