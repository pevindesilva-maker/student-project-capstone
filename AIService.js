/**
 * AI Service — Gemini chatbot for the student budget app.
 * - Deterministic figures come from BudgetEngine (never from the AI).
 * - Tavily Search finds real shops, prices and links on the web.
 * - Gemini writes natural, helpful answers combining web search and Sri Lankan student retail knowledge.
 */

var AIService = {

  /** Plain-text summary of the user's figures, used as chat context. */
  buildContext: function(d) {
    if (!d.hasData) return 'The user has not recorded any transactions yet.';
    var lines = [
      'Current Balance: ' + formatCurrency(d.balance.balance),
      'Safe-to-Spend: ' + formatCurrency(d.safeToSpend.safeToSpend),
      'Upcoming Essential Expenses: ' + formatCurrency(d.safeToSpend.essentialExpensesBeforeNextIncome),
      'Savings Commitment: ' + formatCurrency(d.safeToSpend.savingsCommitment)
    ];
    if (d.safeToSpend.nextExpectedIncome) {
      lines.push('Next Expected Income: ' + formatCurrency(d.safeToSpend.nextExpectedIncome.amount) + ' on ' + d.safeToSpend.nextExpectedIncome.date);
    }
    lines.push('Spending by category: ' + (d.categorySpending.map(function(c) {
      return c.category + ' ' + formatCurrency(c.amount);
    }).join(', ') || 'none'));
    lines.push('Savings goals: ' + (d.savingsProgress.map(function(g) {
      return g.goalName + ' (' + g.progressPercent + '%)';
    }).join(', ') || 'none'));
    lines.push('Active alerts: ' + (d.alerts.map(function(a) {
      return a.title + ': ' + a.message;
    }).join('; ') || 'none'));
    return lines.join('\n');
  },

  /** Send contents to Gemini and return the answer text. */
  generate: function(apiKey, contents, maxTokens, temperature) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + Config.AI.MODEL + ':generateContent?key=' + apiKey;
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        contents: contents,
        generationConfig: { maxOutputTokens: maxTokens, temperature: temperature }
      }),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    var text = response.getContentText();
    if (code !== 200) throw new Error('Gemini HTTP ' + code + ': ' + text);
    var json = JSON.parse(text);
    var candidate = json.candidates && json.candidates[0];
    var parts = (candidate && candidate.content && candidate.content.parts) || [];
    var content = parts.map(function(p) { return p.text || ''; }).join('').trim();
    if (!content) throw new Error('Empty Gemini response');
    return content;
  },

  /** Read the Tavily key. Works even if the whole MCP link was pasted by mistake. */
  getTavilyKey: function() {
    var raw = PropertiesService.getScriptProperties().getProperty('TAVILY_API_KEY');
    if (!raw) return '';
    var match = String(raw).match(/tvly-[A-Za-z0-9_-]+/);
    return match ? match[0] : String(raw).trim();
  },

  /** Ask Gemini whether a web search is needed. Skips AI if query is clearly internal. */
  decideSearchQuery: function(apiKey, message, history) {
    var cleanMsg = String(message || '').trim().toLowerCase();

    // Fast-path: Greetings and budget questions skip web search immediately
    var internalPatterns = [
      /^(hi|hello|hey|greetings|good morning|good evening|thanks|thank you)\b/i,
      /\b(my budget|safe to spend|balance|how much|can i spend|my savings|my expenses|summary)\b/i
    ];
    for (var i = 0; i < internalPatterns.length; i++) {
      if (internalPatterns[i].test(cleanMsg) && !/\b(buy|shop|store|price|daraz|colombo|kandy|cost of|where to)\b/i.test(cleanMsg)) {
        return null;
      }
    }

    var recent = (history || []).slice(-4).map(function(h) {
      return (h.role === 'user' ? 'Student: ' : 'Assistant: ') + String(h.content || '').slice(0, 400);
    }).join('\n');

    var prompt =
      'You help a shopping assistant for a university student in Sri Lanka. ' +
      'Decide whether a live web search is needed to find shops, products, prices or website links for the latest message. ' +
      'If yes, reply with ONLY a short web search query (maximum 10 words), including "Sri Lanka" when location matters. ' +
      'If the message is about their own budget numbers or needs no web search, reply with exactly NONE.\n\n' +
      'Recent conversation:\n' + (recent || '(none)') + '\n\n' +
      'Latest message: ' + message;

    var answer = AIService.generate(apiKey, [{ role: 'user', parts: [{ text: prompt }] }], 1024, 0);
    var query = answer.replace(/[*"`]/g, '').split('\n')[0].trim();
    if (!query || /^none\b/i.test(query)) return null;
    return query.slice(0, 120);
  },

  /** Search the web with Tavily, filtering out B2B, packaging, and finance news. */
  tavilySearch: function(query) {
    var key = AIService.getTavilyKey();
    if (!key) throw new Error('Tavily API key not configured');

    var response = UrlFetchApp.fetch('https://api.tavily.com/search', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + key },
      payload: JSON.stringify({
        query: query + ' Sri Lanka retail shop buy',
        search_depth: 'basic',
        max_results: 6,
        include_answer: false
      }),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    var text = response.getContentText();
    if (code !== 200) throw new Error('Tavily HTTP ' + code + ': ' + text);

    var blocked = ['rocketreach.com', 'cnbc.com', 'investing.com', 'bloomberg.com', 'linkedin.com', 'wikipedia.org', 'paperbags.lk'];

    var json = JSON.parse(text);
    return (json.results || [])
      .filter(function(r) {
        if (!r.url || !/^https?:\/\//.test(r.url)) return false;
        var urlLower = r.url.toLowerCase();
        for (var i = 0; i < blocked.length; i++) {
          if (urlLower.indexOf(blocked[i]) !== -1) return false;
        }
        return true;
      })
      .map(function(r) {
        return { title: r.title || r.url, url: r.url, content: String(r.content || '').slice(0, 300) };
      });
  },

  /** Chat: blends student financial reality, real Sri Lankan retail knowledge, and live links. */
  chatWithGemini: function(userId, message, history) {
    var apiKey = PropertiesService.getScriptProperties().getProperty(Config.AI.API_KEY_PROPERTY);
    if (!apiKey) throw new Error('Gemini API key not configured');

    var dashboardData = BudgetEngine.getDashboardData(userId);

    var searchQuery = null;
    var results = [];
    try {
      searchQuery = AIService.decideSearchQuery(apiKey, message, history);
      if (searchQuery) results = AIService.tavilySearch(searchQuery);
    } catch (e) {
      Logger.log('Search step failed: ' + e.message);
    }

    var webContext = results.length
      ? 'LIVE WEB SEARCH RESULTS:\n' + results.map(function(r, i) {
          return (i + 1) + '. ' + r.title + ' (' + r.url + ')\n   ' + r.content;
        }).join('\n')
      : 'No specific external web links found.';

    var intro =
      'You are a sharp, conversational financial copilot for a university student in Sri Lanka.\n' +
      'Currency: Sri Lankan Rupees (Rs.).\n\n' +
      'STUDENT LEDGER DATA (Calculated deterministically by the system - do not recalculate or invent):\n' +
      AIService.buildContext(dashboardData) + '\n\n' +
      webContext + '\n\n' +
      'INSTRUCTIONS:\n' +
      '1. Sound like a modern AI assistant (like ChatGPT or Claude). Be direct, conversational, and helpful.\n' +
      '2. When the student asks for shops, products, or where to buy items, suggest popular, well-known retail chains in Sri Lanka suitable for student budgets (e.g. Nolimit, Cool Planet, Fashion Bug, House of Fashions, ODEL, Sarasavi, Makeen, Majestic City, Pettah, Daraz.lk, etc.), plus any relevant web links from the search results.\n' +
      '3. DO NOT repeat the exact same robotic phrase ("Your Safe-to-Spend amount is Rs. X...") on every response.\n' +
      '4. If discussing a potential purchase, evaluate affordability naturally: compare realistic price ranges against their Safe-to-Spend balance.\n' +
      '5. Use clean markdown: bold for store names and prices, and bullet points for lists.';

    var contents = [
      { role: 'user', parts: [{ text: intro }] },
      { role: 'model', parts: [{ text: 'Understood. I will provide natural, realistic shopping recommendations and budget advice for a Sri Lankan university student.' }] }
    ];
    (history || []).forEach(function(h) {
      var role = h.role === 'user' ? 'user' : 'model';
      contents.push({ role: role, parts: [{ text: h.content }] });
    });
    contents.push({ role: 'user', parts: [{ text: message }] });

    var text = AIService.generate(apiKey, contents, Config.AI.MAX_OUTPUT_TOKENS, 0.7);

    var sources = [];
    var seen = {};
    results.forEach(function(r) {
      var host = r.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
      if (!seen[host]) {
        seen[host] = true;
        sources.push({ title: host, url: r.url });
      }
    });

    return { text: text, sources: sources.slice(0, 5), searched: results.length > 0, searchQuery: searchQuery };
  }
};