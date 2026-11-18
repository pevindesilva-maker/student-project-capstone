/**
 * Shared utility helpers for the Student Budget Apps Script.
 * Includes sanitisation (formula-injection protection) and formatting helpers.
 */

function generateId(prefix) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var result = '';
  for (var i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix + '-' + result;
}

/**
 * Sanitise free-text user input before it is stored or written back.
 * Strips characters that could be interpreted as a spreadsheet formula
 * (e.g. "=SUM(A1:A2)", "+A1", "@A1") to prevent formula injection.
 */
function sanitizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/^[=+\-@]+/, '')
    .slice(0, 500)
    .trim();
}

function sanitizeAmount(value) {
  var num = Number(value);
  if (isNaN(num) || num < 0) return 0;
  return Math.round(num * 100) / 100;
}

function formatCurrency(amount) {
  var value = Number(amount);
  if (isNaN(value)) value = 0;
  return 'Rs. ' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function daysBetween(date1, date2) {
  var d1 = new Date(date1);
  var d2 = new Date(date2);
  return Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function getTodayString() {
  var d = new Date();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function getUserId() {
  var email = Session.getActiveUser().getEmail();
  return email || Session.getEffectiveUser().getEmail() || 'anonymous';
}

// ---------------------------------------------------------------------------
// Spreadsheet / sheet helpers
// ---------------------------------------------------------------------------

function getSheetByName(name) {
  var ss = SpreadsheetApp.openById(Config.SPREADSHEET_ID);
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function readObjects(sheetName, userId) {
  var sheet = getSheetByName(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];
  var data = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var c = 0; c < headers.length; c++) {
      row[headers[c]] = data[i][c];
    }
    if (String(row.userId || '').trim() !== String(userId)) continue;
    rows.push(row);
  }
  return rows;
}

function appendRow(sheetName, row) {
  var sheet = getSheetByName(sheetName);
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (!headers[0]) {
    headers = Object.keys(row);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  var values = headers.map(function(h) { return row[h] !== undefined ? row[h] : ''; });
  sheet.appendRow(values);
  return row;
}

function deleteRowById(sheetName, idField, idValue, userId) {
  var sheet = getSheetByName(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return false;
  var data = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  var headers = data[0];
  var idCol = headers.indexOf(idField);
  var userCol = headers.indexOf('userId');
  if (idCol < 0) return false;
  for (var i = 1; i < data.length; i++) {
    var sameId = String(data[i][idCol]) === String(idValue);
    var sameUser = userCol < 0 || String(data[i][userCol]).trim() === String(userId);
    if (sameId && sameUser) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}
