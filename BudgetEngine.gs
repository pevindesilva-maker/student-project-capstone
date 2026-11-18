/**
 * Deterministic budget calculation engine (no AI).
 * All safe-to-spend and alert logic runs here on the server so it's tamper-proof
 * and identical for every user. AI only explains the figures this module produces.
 */

var BudgetEngine = {

  /**
   * Sum of all ACTUAL income minus all ACTUAL expenses.
   */
  calculateCurrentBalance: function(userId) {
    var income = getIncomeRecords(userId).filter(function(i) { return i.type === 'ACTUAL'; });
    var expenses = getExpenseRecords(userId).filter(function(e) { return e.type === 'ACTUAL'; });
    var totalIncome = income.reduce(function(sum, i) { return sum + Number(i.amount || 0); }, 0);
    var totalExpenses = expenses.reduce(function(sum, e) { return sum + Number(e.amount || 0); }, 0);
    return { totalIncome: totalIncome, totalExpenses: totalExpenses, balance: totalIncome - totalExpenses };
  },

  /**
   * Core deterministic calculation.
   * Safe-to-spend = currentBalance - upcomingEssentialExpenses - savingsCommitments.
   * Never negative; floors at 0.
   * Expected income NEVER counts toward current balance (only for planning).
   */
  calculateSafeToSpend: function(userId) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var balanceInfo = this.calculateCurrentBalance(userId);
    var currentBalance = balanceInfo.balance;

    var expectedIncome = getExpectedIncomeRecords(userId)
      .map(function(i) { return Object.assign({}, i, { parsedDate: new Date(i.date) }); })
      .filter(function(i) { return i.parsedDate >= today; })
      .sort(function(a, b) { return a.parsedDate - b.parsedDate; });

    var nextExpectedIncome = expectedIncome.length > 0 ? expectedIncome[0] : null;
    var safeToSpend = 0;
    var essentialExpensesBeforeNextIncome = 0;
    var savingsCommitment = 0;
    var hasExpectedIncome = false;

    if (nextExpectedIncome) {
      hasExpectedIncome = true;
      var nextIncomeDate = nextExpectedIncome.parsedDate;
      var upcomingExpenses = getExpenseRecords(userId).filter(function(e) { return e.type === 'UPCOMING'; });
      essentialExpensesBeforeNextIncome = upcomingExpenses
        .filter(function(e) {
          var d = new Date(e.date);
          d.setHours(0, 0, 0, 0);
          return d <= nextIncomeDate && e.essential;
        })
        .reduce(function(sum, e) { return sum + Number(e.amount || 0); }, 0);

      var goals = getSavingsGoals(userId);
      savingsCommitment = goals
        .filter(function(g) {
          if (!g.targetDate) return false;
          var d = new Date(g.targetDate);
          d.setHours(0, 0, 0, 0);
          return d <= nextIncomeDate;
        })
        .reduce(function(sum, g) { return sum + Math.max(Number(g.targetAmount || 0) - Number(g.currentAmount || 0), 0); }, 0);

      safeToSpend = currentBalance - essentialExpensesBeforeNextIncome - savingsCommitment;
    } else {
      var upcomingExpenses = getExpenseRecords(userId).filter(function(e) { return e.type === 'UPCOMING'; });
      essentialExpensesBeforeNextIncome = upcomingExpenses
        .filter(function(e) { return e.essential; })
        .reduce(function(sum, e) { return sum + Number(e.amount || 0); }, 0);

      var goals = getSavingsGoals(userId);
      savingsCommitment = goals.reduce(function(sum, g) { return sum + Math.max(Number(g.targetAmount || 0) - Number(g.currentAmount || 0), 0); }, 0);
      safeToSpend = currentBalance - essentialExpensesBeforeNextIncome - savingsCommitment;
    }

    return {
      currentBalance: currentBalance,
      safeToSpend: Math.max(safeToSpend, 0),
      nextExpectedIncome: nextExpectedIncome ? {
        amount: nextExpectedIncome.amount,
        date: nextExpectedIncome.date,
        source: nextExpectedIncome.source
      } : null,
      essentialExpensesBeforeNextIncome: essentialExpensesBeforeNextIncome,
      savingsCommitment: savingsCommitment,
      hasExpectedIncome: hasExpectedIncome,
      totalIncome: balanceInfo.totalIncome,
      totalExpenses: balanceInfo.totalExpenses
    };
  },

  calculateDailySafeToSpend: function(userId) {
    var info = this.calculateSafeToSpend(userId);
    if (!info.hasExpectedIncome || !info.nextExpectedIncome) {
      return { dailySafeToSpend: null, daysUntilNextIncome: null };
    }
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var nextDate = new Date(info.nextExpectedIncome.date);
    nextDate.setHours(0, 0, 0, 0);
    var rawDays = daysBetween(today, nextDate);   // real number of days, can be 0
    var daysUntil = Math.max(rawDays, 1);         // only used to avoid dividing by zero
    return {
      dailySafeToSpend: Math.round((info.safeToSpend / daysUntil) * 100) / 100,
      daysUntilNextIncome: rawDays
    };
  },

  calculateCategorySpending: function(userId) {
    var expenses = getExpenseRecords(userId).filter(function(e) { return e.type === 'ACTUAL'; });
    var totals = {};
    Config.EXPENSE_CATEGORIES.forEach(function(cat) { totals[cat] = 0; });
    expenses.forEach(function(e) { if (totals[e.category] !== undefined) totals[e.category] += Number(e.amount || 0); });
    return Object.keys(totals)
      .filter(function(cat) { return totals[cat] > 0; })
      .map(function(cat) { return { category: cat, amount: totals[cat] }; })
      .sort(function(a, b) { return b.amount - a.amount; });
  },

  calculateSavingsProgress: function(userId) {
    return getSavingsGoals(userId).map(function(g) {
      var progress = Number(g.targetAmount) > 0
        ? Math.min((Number(g.currentAmount) / Number(g.targetAmount)) * 100, 100)
        : 0;
      return Object.assign({}, g, {
        progressPercent: Math.round(progress * 10) / 10,
        remainingAmount: Math.max(Number(g.targetAmount) - Number(g.currentAmount), 0)
      });
    });
  },

  calculateAlerts: function(userId) {
    var alerts = [];
    var safeToSpendInfo = this.calculateSafeToSpend(userId);
    var balanceInfo = this.calculateCurrentBalance(userId);
    var upcomingExpenses = getExpenseRecords(userId).filter(function(e) { return e.type === 'UPCOMING'; });
    var savingsGoals = getSavingsGoals(userId);
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    // Spending exceeds safe-to-spend
    if (safeToSpendInfo.safeToSpend === 0 && balanceInfo.balance > 0) {
      alerts.push({ type: 'DANGER', title: 'Spending Alert', message: 'Your spending has exceeded your safe-to-spend amount.', icon: '⚠' });
    }

    // Upcoming essential expenses
    upcomingExpenses.forEach(function(e) {
      var d = new Date(e.date);
      d.setHours(0, 0, 0, 0);
      var daysUntil = daysBetween(today, d);
      if (daysUntil >= 0 && daysUntil <= Config.ALERT_UPCOMING_EXPENSE_DAYS) {
        alerts.push({
          type: daysUntil <= 7 ? 'DANGER' : 'CAUTION',
          title: 'Upcoming Expense',
          message: 'Your ' + formatCurrency(e.amount) + ' ' + e.category + ' expense "' + e.note + '" is due in ' + daysUntil + ' day' + (daysUntil !== 1 ? 's' : '') + '.',
          icon: '⚠'
        });
      }
    });

    // Low balance
    if (balanceInfo.balance < Config.ALERT_LOW_BALANCE_THRESHOLD && balanceInfo.balance >= 0) {
      alerts.push({
        type: 'CAUTION',
        title: 'Low Balance',
        message: 'Your balance of ' + formatCurrency(balanceInfo.balance) + ' is below the threshold.',
        icon: '⚠'
      });
    }

    // Savings behind
    savingsGoals.forEach(function(g) {
      if (g.targetDate) {
        var targetDate = new Date(g.targetDate);
        var totalDays = daysBetween(today, targetDate);
        var progress = Number(g.targetAmount) > 0 ? (Number(g.currentAmount) / Number(g.targetAmount)) * 100 : 0;
        if (totalDays > 0 && progress < 50) {
          alerts.push({
            type: 'CAUTION',
            title: 'Savings Goal Behind',
            message: 'Your savings goal "' + g.goalName + '" is at ' + Math.round(progress) + '% of target.',
            icon: '⚠'
          });
        }
      }
    });

    return alerts;
  },
  /**
   * Balance history (actual) + forward projection (planning only).
   * Projection applies UPCOMING expenses and expected income on their dates.
   * Overdue upcoming items (dated before today) are ignored.
   */
  calculateBalanceProjection: function(userId) {
    var tz = Session.getScriptTimeZone();
    var todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var DAY = 24 * 60 * 60 * 1000;
    var actualChange = {}, futureChange = {};

        function dayOf(d) {
      if (!d) return '';
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
      var dt = (d instanceof Date) ? d : new Date(d);
      if (isNaN(dt.getTime())) return '';
      return Utilities.formatDate(dt, tz, 'yyyy-MM-dd');
    }
    function add(map, key, delta) { if (key) map[key] = (map[key] || 0) + delta; }
    function r2(n) { return Math.round(n * 100) / 100; }

    // Actual history (anything dated in the future is treated as today,
    // so the chart's "today" point always equals the Current Cash Balance)
    getIncomeRecords(userId).forEach(function(i) {
      if (i.type !== 'ACTUAL') return;
      var k = dayOf(i.date);
      add(actualChange, k > todayKey ? todayKey : k, Number(i.amount || 0));
    });
    getExpenseRecords(userId).forEach(function(e) {
      var k = dayOf(e.date), amt = Number(e.amount || 0);
      if (e.type === 'ACTUAL') add(actualChange, k > todayKey ? todayKey : k, -amt);
      else if (e.type === 'UPCOMING' && k >= todayKey) add(futureChange, k, -amt);
    });

    // Future money in (planning only, never part of the current balance)
    getExpectedIncomeRecords(userId).forEach(function(i) {
      var k = dayOf(i.date);
      if (k >= todayKey) add(futureChange, k, Number(i.amount || 0));
    });

    var keys = Object.keys(actualChange)
      .concat(Object.keys(futureChange), [todayKey]).sort();
    var cursor = new Date(keys[0] + 'T12:00:00');
    var last = new Date(keys[keys.length - 1] + 'T12:00:00');
    var labels = [], actual = [], projected = [];
    var running = 0, projRunning = 0;

    while (cursor <= last) {
      var k = Utilities.formatDate(cursor, tz, 'yyyy-MM-dd');
      labels.push(k);
      if (k < todayKey) {
        running += actualChange[k] || 0;
        actual.push(r2(running));
        projected.push(null);
      } else if (k === todayKey) {
        running += actualChange[k] || 0;
        actual.push(r2(running));
        projRunning = running + (futureChange[k] || 0);
        projected.push(r2(projRunning));
      } else {
        projRunning += futureChange[k] || 0;
        actual.push(null);
        projected.push(r2(projRunning));
      }
      cursor = new Date(cursor.getTime() + DAY);
    }
    return { labels: labels, actual: actual, projected: projected };
  },
  getDashboardData: function(userId) {
    var balanceInfo = this.calculateCurrentBalance(userId);
    var safeToSpendInfo = this.calculateSafeToSpend(userId);
    var dailySafeToSpend = this.calculateDailySafeToSpend(userId);
    var categorySpending = this.calculateCategorySpending(userId);
    var savingsProgress = this.calculateSavingsProgress(userId);
    var upcomingObligations = getExpenseRecords(userId)
      .filter(function(e) { return e.type === 'UPCOMING'; })
      .sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
    var alerts = this.calculateAlerts(userId);
    var recentIncome = getIncomeRecords(userId).filter(function(i) { return i.type === 'ACTUAL'; }).slice(-5).reverse();
    var recentExpenses = getExpenseRecords(userId).filter(function(e) { return e.type === 'ACTUAL'; }).slice(-5).reverse();
    var expectedIncome = getExpectedIncomeRecords(userId);

    var financialStatus = 'SAFE';
    var statusLabel = 'SAFE';
    if (safeToSpendInfo.safeToSpend === 0) {
      financialStatus = 'DANGER';
      statusLabel = 'AT RISK';
    } else if (safeToSpendInfo.safeToSpend < balanceInfo.balance * 0.2) {
      financialStatus = 'CAUTION';
      statusLabel = 'CAUTION';
    }

    return {
      balance: balanceInfo,
      safeToSpend: safeToSpendInfo,
      dailySafeToSpend: dailySafeToSpend,
      categorySpending: categorySpending,
      savingsProgress: savingsProgress,
      upcomingObligations: upcomingObligations,
      alerts: alerts,
      recentIncome: recentIncome,
      recentExpenses: recentExpenses,
      expectedIncome: expectedIncome,
      balanceProjection: this.calculateBalanceProjection(userId),
      financialStatus: financialStatus,
      statusLabel: statusLabel,
      hasData: balanceInfo.totalIncome > 0 || balanceInfo.totalExpenses > 0
    };
  }
};