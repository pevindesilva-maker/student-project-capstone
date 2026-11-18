/**
 * Configuration constants for the Student Budget Google Apps Script.
 * All tunable values for the budget planner live here.
 */

var Config = {
  // Spreadsheet to use (set in Script Properties as SPREADSHEET_ID).
  SPREADSHEET_ID: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '',

  SHEET_NAMES: {
    INCOME: 'Income',
    EXPECTED_INCOME: 'ExpectedIncome',
    EXPENSES: 'Expenses',
    SAVINGS_GOALS: 'SavingsGoals',
    AI_LOGS: 'AILogs',
    SETTINGS: 'Settings'
  },

  CURRENCY_SYMBOL: 'Rs.',
  CURRENCY_CODE: 'LKR',

  INCOME_SOURCES: [
    'Family Support',
    'Allowance',
    'Part-Time Work',
    'Freelance Work',
    'Scholarship',
    'Bursary',
    'Other'
  ],

  EXPENSE_CATEGORIES: [
    'Food', 'Transport', 'Accommodation', 'Education', 'Bills', 'Entertainment',
    'Shopping', 'Health', 'Subscriptions', 'Social', 'Other'
  ],

  ESSENTIAL_CATEGORIES: ['Accommodation', 'Education', 'Bills', 'Health'],

  ALERT_LOW_BALANCE_THRESHOLD: 1000,
  ALERT_UPCOMING_EXPENSE_DAYS: 14,


  AI: {
    ENABLED: true,
    MODEL: 'gemini-3.5-flash-lite',
    PROMPT_VERSION: '2.0',
    API_KEY_PROPERTY: 'GEMINI_API_KEY',
    MAX_OUTPUT_TOKENS: 2048
  },

  DEFAULT_SETTINGS: {
    LOW_BALANCE_THRESHOLD: 1000,
    UPCOMING_EXPENSE_DAYS: 14
  }
};
