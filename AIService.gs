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

  /**
   * Model fallback chain. Free-tier keys hit 429/503 on a single model very
   * easily, so try the next model instead of failing the chat outright.
   */
  MODELS: [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash',
    'gemini-flash-lite-latest'
  ],

  modelChain: function() {
    var primary = (Config.AI && Config.AI.MODEL) || '';
    var chain = AIService.MODELS.slice();
    var at = chain.indexOf(primary);
    if (at > 0) chain.splice(at, 1);
    if (primary && at !== 0) chain.unshift(primary);
    return chain;
  },

  /** One Gemini request. grounded=true adds Google Search grounding to the call. */
  request: function(apiKey, model, contents, maxTokens, temperature, grounded) {
    var body = {
      contents: contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature: temperature }
    };
    if (grounded) body.tools = [{ google_search: {} }];

    var response = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      }
    );
    return { code: response.getResponseCode(), text: response.getContentText() };
  },

  /** Pull the answer, the model that served it and any real search links out of a response. */
  parse: function(model, bodyText) {
    var json = JSON.parse(bodyText);
    var candidate = json.candidates && json.candidates[0];
    var parts = (candidate && candidate.content && candidate.content.parts) || [];
    var text = parts.map(function(p) { return p.text || ''; }).join('').trim();
    if (!text) throw new Error('Empty Gemini response');

    var meta = candidate.groundingMetadata || {};
    var links = [];
    (meta.groundingChunks || []).forEach(function(chunk) {
      if (chunk.web && chunk.web.uri) {
        links.push({
          title: chunk.web.title || AIService.hostOf(chunk.web.uri),
          url: chunk.web.uri
        });
      }
    });

    return { text: text, model: model, links: links, queries: meta.webSearchQueries || [] };
  },

  /**
   * Ask Gemini, walking the model chain on 404/429/500/503.
   * Returns { text, model, links, queries }.
   */
  generateWithMeta: function(contents, maxTokens, temperature, grounded) {
    var apiKey = PropertiesService.getScriptProperties().getProperty(Config.AI.API_KEY_PROPERTY);
    if (!apiKey) throw new Error('Gemini API key not configured');

    var models = AIService.modelChain();
    var failures = [];
    for (var i = 0; i < models.length; i++) {
      var model = models[i];
      var res = AIService.request(apiKey, model, contents, maxTokens, temperature, grounded);
      if (res.code === 200) return AIService.parse(model, res.text);
      failures.push(model + ' HTTP ' + res.code);

      var retryable = [404, 429, 500, 502, 503].indexOf(res.code) !== -1;
      if (!retryable) {
        throw new Error('Gemini HTTP ' + res.code + ': ' + res.text);
      }
    }
    throw new Error('Gemini unavailable (' + failures.join(', ') + ')');
  },

  /** Plain answer without grounding (kept for the search-query helper). */
  generate: function(contents, maxTokens, temperature) {
    return AIService.generateWithMeta(contents, maxTokens, temperature, false).text;
  },

  /** Live prices need Google Search grounding; on by default, AI_LIVE_SEARCH=false turns it off. */
  liveSearchEnabled: function() {
    var flag = PropertiesService.getScriptProperties().getProperty('AI_LIVE_SEARCH');
    if (flag === null || flag === undefined) return true;
    return String(flag).trim().toLowerCase() !== 'false';
  },

  /** Read the Tavily key. Works even if the whole MCP link was pasted by mistake. */
  getTavilyKey: function() {
    var raw = PropertiesService.getScriptProperties().getProperty('TAVILY_API_KEY');
    if (!raw) return '';
    var match = String(raw).match(/tvly-[A-Za-z0-9_-]+/);
    return match ? match[0] : String(raw).trim();
  },

  /**
   * Live web search is OPTIONAL and off by default.
   *
   * UrlFetchApp has no request timeout, so a stalled Tavily connection can burn
   * the whole 6-minute Apps Script quota and leave the chat spinner running.
   * The core chat must never depend on it: turn search on deliberately with the
   * script property AI_WEB_SEARCH=true, and only with a real tvly- key.
   */
  webSearchEnabled: function() {
    var props = PropertiesService.getScriptProperties();
    if (String(props.getProperty('AI_WEB_SEARCH') || '').trim().toLowerCase() !== 'true') return false;
    return /^tvly-[A-Za-z0-9_-]{10,}$/.test(AIService.getTavilyKey());
  },

  /**
   * Curated directory of Sri Lankan stores useful to students.
   * Mirrors server/services/shop-directory.js. The model may only ever show
   * these URLs, so a shop link is either verified here or removed entirely.
   */
  SHOPS: [
    { name: 'Daraz Sri Lanka', url: 'https://www.daraz.lk/', categories: ['general', 'fashion', 'electronics', 'books', 'home'], note: 'Large marketplace with island-wide delivery; compare sellers before buying.' },
    { name: 'Kapruka', url: 'https://www.kapruka.com/', categories: ['general', 'groceries', 'home'], note: 'General online store and gift delivery, including groceries.' },
    { name: 'ikman', url: 'https://ikman.lk/', categories: ['general', 'electronics', 'books', 'home'], note: 'Classifieds for new and used items; meet safely and inspect before paying.' },
    { name: 'Cool Planet', url: 'https://coolplanet.lk/', categories: ['fashion', 'home'], note: 'Affordable clothing, footwear and lifestyle items with regular offers.' },
    { name: 'Nolimit', url: 'https://www.nolimit.lk/', categories: ['fashion'], note: 'Everyday clothing and accessories; frequent student-friendly discounts.' },
    { name: 'Fashion Bug', url: 'https://fashionbug.lk/', categories: ['fashion'], note: 'Clothing and accessories with stores across the island.' },
    { name: 'Cotton Collection', url: 'https://cottoncollection.com/', categories: ['fashion'], note: 'Casual clothing and basics; watch the sale section for lower prices.' },
    { name: 'Kelly Felder', url: 'https://kellyfelder.com/', categories: ['fashion'], note: 'Clothing and accessories; online store with local delivery.' },
    { name: 'Sarasavi Bookshop', url: 'https://sarasavi.lk/', categories: ['books'], note: 'Books, textbooks and stationery, with branches near many universities.' },
    { name: 'Vijitha Yapa', url: 'https://www.vijithayapa.com/', categories: ['books'], note: 'Bookshop chain with academic titles, fiction and stationery.' },
    { name: 'Makeen Books', url: 'https://makeenbooks.com/', categories: ['books'], note: 'Online bookstore with delivery and frequent discounts.' },
    { name: 'Atlas Sri Lanka', url: 'https://www.atlas.lk/', categories: ['books', 'stationery'], note: 'School and office stationery, notebooks, pens and art supplies.' },
    { name: 'Singer Sri Lanka', url: 'https://www.singersl.com/', categories: ['electronics', 'home'], note: 'Electronics, appliances and accessories with instalment options.' },
    { name: 'Softlogic', url: 'https://www.softlogic.lk/', categories: ['electronics', 'home'], note: 'Electronics and mobile accessories; compare prices with other retailers.' },
    { name: 'Keells', url: 'https://www.keells.com/', categories: ['groceries'], note: 'Supermarket groceries and household essentials with online ordering.' },
    { name: 'Glomark', url: 'https://glomark.lk/', categories: ['groceries'], note: 'Supermarket delivery for groceries, snacks and household items.' },
    { name: 'PickMe', url: 'https://pickme.lk/', categories: ['food', 'general'], note: 'Food delivery and ride-hailing; useful for budget-friendly meals.' }
  ],

  SHOP_CATEGORY_RULES: [
    { id: 'fashion', pattern: /\b(cloth|clothe|clothes|clothing|shirt|t-?shirt|tee|jeans|trouser|pants|dress|saree|sari|kurta|fashion|outfit|shoe|shoes|footwear|sneaker|bag|handbag|accessor(?:y|ies))\b/i },
    { id: 'books', pattern: /\b(book|books|textbook|novel|stationery|stationary|pen|pens|notebook|note ?book|paper|pencil|highlighter|art supplies|atlas|sarasavi|vijitha|makeen)\b/i },
    { id: 'electronics', pattern: /\b(laptop|laptops|computer|phone|mobile|smartphone|headphone|headphones|earphone|earphones|earbud|earbuds|charger|cable|power ?bank|electronic|electronics|gadget|singer|softlogic|abans|calculator)\b/i },
    { id: 'groceries', pattern: /\b(grocery|groceries|supermarket|rice|vegetable|vegetables|fruit|fruits|milk|snack|snacks|keells|glomark|essential|essentials)\b/i },
    { id: 'food', pattern: /\b(food delivery|takeaway|takeout|restaurant|meal|meals|lunch|dinner|breakfast|pickme|uber ?eats)\b/i }
  ],

  /** Bare hostname, used to match links against the directory. */
  hostOf: function(url) {
    return String(url || '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split('?')[0];
  },

  BUDGET_TALK: /\b(spent|spend|spending|budget|expense|expenses|balance|safe[- ]to[- ]spend|summary|recorded|tracked|analyse|analyze|breakdown)\b/i,

  SHOPPING_TALK: /\b(buy|buying|purchase|shop|shopping|store|stores|marketplace|online|website|web ?link|link|links|order|price|prices|cost|deliver|delivery|where to|where can i|recommend|cheap|affordable|discount|sale)\b/i,

  /** True when the message is about buying something, so live prices are worth fetching. */
  isShoppingMessage: function(text) {
    var lower = String(text || '').toLowerCase();
    if (AIService.SHOPPING_TALK.test(lower)) return true;
    return AIService.SHOPS.some(function(shop) {
      return lower.indexOf(shop.name.toLowerCase()) !== -1;
    });
  },

  /** Shops worth showing for this message (empty when it is a budget question). */
  findShops: function(text) {
    var lower = String(text || '').toLowerCase();
    var budgetTalk = AIService.BUDGET_TALK;
    var shoppingTalk = AIService.SHOPPING_TALK;

    var mentionsShop = AIService.SHOPS.some(function(shop) {
      return lower.indexOf(shop.name.toLowerCase()) !== -1;
    });
    if (!mentionsShop && budgetTalk.test(lower) && !shoppingTalk.test(lower)) return [];

    var wanted = [];
    AIService.SHOP_CATEGORY_RULES.forEach(function(rule) {
      if (rule.pattern.test(lower)) wanted.push(rule.id);
    });
    if (!mentionsShop && !shoppingTalk.test(lower) && wanted.length === 0) return [];

    var wantsGeneral = wanted.length === 0 || wanted.indexOf('general') !== -1;
    var scored = AIService.SHOPS.map(function(shop) {
      var score = lower.indexOf(shop.name.toLowerCase()) !== -1 ? 5 : 0;
      shop.categories.forEach(function(category) {
        if (wanted.indexOf(category) !== -1) score += 2;
      });
      if (wantsGeneral && shop.categories.indexOf('general') !== -1) score += 1;
      return { shop: shop, score: score };
    }).filter(function(entry) {
      return entry.score > 0;
    }).sort(function(a, b) {
      return b.score - a.score || a.shop.name.localeCompare(b.shop.name);
    });

    return scored.slice(0, 6).map(function(entry) { return entry.shop; });
  },

  /** Prompt block listing the only shops the model is allowed to link. */
  buildShopContext: function(shops) {
    if (!shops || shops.length === 0) return '';
    return 'VERIFIED STORE DIRECTORY (curated for Sri Lankan students; these are the only shops you may recommend):\n' +
      shops.map(function(shop) {
        return '- ' + shop.name + ': ' + shop.url + ' — ' + shop.note;
      }).join('\n');
  },

  /**
   * Remove any link the model invented. A URL survives only when its host is in
   * the curated directory or came back from a real search result.
   */
  sanitizeLinks: function(text, shops, results) {
    var allowed = {};
    (shops || []).forEach(function(shop) { allowed[AIService.hostOf(shop.url)] = true; });
    (results || []).forEach(function(r) { allowed[AIService.hostOf(r.url)] = true; });

    return String(text || '')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function(match, label, url) {
        return allowed[AIService.hostOf(url)] ? match : '**' + label + '**';
      })
      .replace(/(^|[\s(])(https?:\/\/[^\s)]+)/gm, function(match, before, url) {
        return allowed[AIService.hostOf(url)] ? match : before;
      })
      .replace(/[ \t]{2,}/g, ' ');
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

    var answer = AIService.generate([{ role: 'user', parts: [{ text: prompt }] }], 1024, 0);
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

    var conversation = [message].concat((history || []).filter(function(h) {
      return h.role === 'user';
    }).slice(-3).map(function(h) {
      return String(h.content || '');
    })).join(' ');
    var shops = AIService.findShops(conversation);
    var shopContext = AIService.buildShopContext(shops);
    var shoppingQuestion = shops.length > 0 || AIService.isShoppingMessage(conversation);

    // Optional extra source: Tavily snippets, only when deliberately switched on.
    var results = [];
    if (AIService.webSearchEnabled()) {
      try {
        var searchQuery = AIService.decideSearchQuery(apiKey, message, history);
        if (searchQuery) results = AIService.tavilySearch(searchQuery);
      } catch (e) {
        Logger.log('Search step failed: ' + e.message);
      }
    }

    var webContext = results.length
      ? 'LIVE WEB SEARCH RESULTS (fresh snippets):\n' + results.map(function(r, i) {
          return (i + 1) + '. ' + r.title + ' (' + r.url + ')\n   ' + r.content;
        }).join('\n')
      : 'No external web snippets were fetched.';

    var intro =
      'You are a sharp, conversational financial copilot for a university student in Sri Lanka.\n' +
      'Currency: Sri Lankan Rupees (Rs.).\n\n' +
      'STUDENT LEDGER DATA (Calculated deterministically by the system - do not recalculate or invent):\n' +
      AIService.buildContext(dashboardData) + '\n\n' +
      webContext + '\n\n' +
      (shopContext ? shopContext + '\n\n' : '') +
      'INSTRUCTIONS:\n' +
      '1. Sound like a modern AI assistant (like ChatGPT or Claude). Be direct, conversational, and helpful.\n' +
      '2. When the student asks for shops, products, or where to buy items, recommend only stores you can actually source: the VERIFIED STORE DIRECTORY above, the live search snippets, or - when live search is active - the shops it returns. Write each store as a markdown link using its exact URL. Never invent a URL or a store that is not listed or sourced.\n' +
      '3. PRICES: if a price appears in the live search snippets or search grounding, quote it as "around Rs. X" and say it was checked online. If you have no sourced price, give a typical range and label it as an estimate. Never present an invented price as exact.\n' +
      '4. DO NOT repeat the exact same robotic phrase ("Your Safe-to-Spend amount is Rs. X...") on every response.\n' +
      '5. If discussing a potential purchase, evaluate affordability naturally: compare the sourced price against their Safe-to-Spend balance.\n' +
      '6. Use clean markdown: bold for store names and prices, and bullet points for lists.';

    var contents = [
      { role: 'user', parts: [{ text: intro }] },
      { role: 'model', parts: [{ text: 'Understood. I will provide natural, realistic shopping recommendations and budget advice for a Sri Lankan university student.' }] }
    ];
    (history || []).forEach(function(h) {
      var role = h.role === 'user' ? 'user' : 'model';
      contents.push({ role: role, parts: [{ text: h.content }] });
    });
    contents.push({ role: 'user', parts: [{ text: message }] });

    // Live prices and fresh links: Gemini grounds the answer in Google Search in
    // the same request. Falls back to a plain answer if grounding is unavailable.
    var answer = null;
    var grounded = false;
    if (AIService.liveSearchEnabled() && shoppingQuestion) {
      try {
        answer = AIService.generateWithMeta(contents, Config.AI.MAX_OUTPUT_TOKENS, 0.7, true);
        grounded = answer.links.length > 0;
        Logger.log('Grounded search (' + answer.model + '): ' + (answer.queries || []).join(' | ') +
          ' -> ' + answer.links.length + ' links');
      } catch (e) {
        Logger.log('Grounded search unavailable: ' + e.message);
      }
    }
    if (!answer) answer = AIService.generateWithMeta(contents, Config.AI.MAX_OUTPUT_TOKENS, 0.7, false);

    var liveLinks = results.map(function(r) { return { title: r.title || r.url, url: r.url }; })
      .concat(answer.links || []);
    var text = AIService.sanitizeLinks(answer.text, shops, liveLinks);

    // Prefer a curated URL when Google's title matches a known shop, so the
    // reader gets a clean link instead of a search redirect.
    var sources = [];
    var seen = {};
    function addSource(title, url) {
      var host = AIService.hostOf(url);
      if (!host || seen[host]) return;
      seen[host] = true;
      sources.push({ title: title || host, url: url });
    }
    (answer.links || []).forEach(function(link) {
      var lower = String(link.title || '').toLowerCase();
      var known = null;
      shops.forEach(function(shop) {
        if (lower.indexOf(shop.name.toLowerCase()) !== -1) known = shop;
      });
      if (known) addSource(known.name, known.url);
      else addSource(link.title, link.url);
    });
    shops.forEach(function(shop) { addSource(shop.name, shop.url); });
    results.forEach(function(r) { addSource(r.title, r.url); });

    return {
      text: text,
      sources: sources.slice(0, 8),
      searched: liveLinks.length > 0,
      grounded: grounded,
      verifiedLinks: shops.length > 0,
      model: answer.model
    };
  }
};