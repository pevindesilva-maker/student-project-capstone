/**
 * Input validation for all write endpoints.
 * Runs server-side so it can't be bypassed by a malicious client.
 */

var Validation = {

  validateIncome: function(data) {
    var errors = [];
    if (!data.amount || Number(data.amount) <= 0) errors.push('Amount must be positive');
    if (!data.date) errors.push('Date is required');
    if (!data.source || Config.INCOME_SOURCES.indexOf(data.source) === -1) errors.push('Invalid source');
    if (data.note && data.note.length > 500) errors.push('Note too long');
    return errors;
  },

  validateExpectedIncome: function(data) {
    var errors = [];
    if (!data.amount || Number(data.amount) <= 0) errors.push('Amount must be positive');
    if (!data.date) errors.push('Expected date is required');
    if (!data.source || Config.INCOME_SOURCES.indexOf(data.source) === -1) errors.push('Invalid source');
    if (data.note && data.note.length > 500) errors.push('Note too long');
    return errors;
  },

  validateExpense: function(data) {
    var errors = [];
    if (!data.amount || Number(data.amount) <= 0) errors.push('Amount must be positive');
    if (!data.date) errors.push('Date is required');
    if (!data.category || Config.EXPENSE_CATEGORIES.indexOf(data.category) === -1) errors.push('Invalid category');
    if (data.note && data.note.length > 500) errors.push('Note too long');
    return errors;
  },

  validateUpcomingExpense: function(data) {
    var errors = [];
    if (!data.name || data.name.trim() === '') errors.push('Expense name is required');
    if (!data.amount || Number(data.amount) <= 0) errors.push('Amount must be positive');
    if (!data.dueDate) errors.push('Due date is required');
    if (!data.category || Config.EXPENSE_CATEGORIES.indexOf(data.category) === -1) errors.push('Invalid category');
    if (data.note && data.note.length > 500) errors.push('Note too long');
    return errors;
  },

  validateSavingsGoal: function(data) {
    var errors = [];
    if (!data.goalName || data.goalName.trim() === '') errors.push('Goal name is required');
    if (!data.targetAmount || Number(data.targetAmount) <= 0) errors.push('Target amount must be positive');
    if (data.currentAmount !== undefined && Number(data.currentAmount) < 0) errors.push('Current amount cannot be negative');
    if (data.targetDate) {
      var d = new Date(data.targetDate);
      if (isNaN(d.getTime())) errors.push('Invalid target date');
    }
    return errors;
  },

  /** Sanitise all string fields in an object. */
  sanitise: function(obj) {
    var out = {};
    for (var k in obj) {
      if (obj.hasOwnProperty(k)) {
        var v = obj[k];
        if (typeof v === 'string') {
          out[k] = sanitizeText(v);
        } else if (typeof v === 'number') {
          out[k] = sanitizeAmount(v);
        } else {
          out[k] = v;
        }
      }
    }
    return out;
  }
};