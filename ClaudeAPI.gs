/**
 * Epoch editorial checker — LLM integration
 *
 * Supports both Anthropic (Claude) and OpenAI APIs.
 * The admin configures the provider, model, and API key via Script Properties.
 */

var MAX_DOCUMENT_CHARS = 30000;

// ---------------------------------------------------------------------------
// Provider configurations
// ---------------------------------------------------------------------------

var PROVIDERS = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-20250514',
    buildRequest: function(apiKey, model, systemPrompt, userMessage) {
      return {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        payload: JSON.stringify({
          model: model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }]
        }),
        muteHttpExceptions: true
      };
    },
    extractContent: function(body) {
      return body.content && body.content[0] && body.content[0].text;
    }
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o',
    buildRequest: function(apiKey, model, systemPrompt, userMessage) {
      return {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'Authorization': 'Bearer ' + apiKey
        },
        payload: JSON.stringify({
          model: model,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ]
        }),
        muteHttpExceptions: true
      };
    },
    extractContent: function(body) {
      return body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
    }
  }
};

// ---------------------------------------------------------------------------
// Admin configuration helpers
// ---------------------------------------------------------------------------

function getLLMConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    provider: props.getProperty('LLM_PROVIDER') || 'anthropic',
    model: props.getProperty('LLM_MODEL') || '',
    apiKey: props.getProperty('LLM_API_KEY') || ''
  };
}

/**
 * Run from the script editor to configure the LLM backend.
 *
 * @param {Object} config - { provider: 'anthropic'|'openai', model: string (optional), apiKey: string }
 */
function configureLLM(config) {
  var props = PropertiesService.getScriptProperties();
  if (config.provider) props.setProperty('LLM_PROVIDER', config.provider);
  if (config.model) props.setProperty('LLM_MODEL', config.model);
  if (config.apiKey) props.setProperty('LLM_API_KEY', config.apiKey);
  Logger.log('LLM configured: provider=' + (config.provider || '(unchanged)') +
    ', model=' + (config.model || '(default)'));
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

var STYLE_GUIDE_SYSTEM_PROMPT = [
  'You are an editorial assistant for Epoch AI, a nonprofit research institute that tracks and forecasts AI development through empirical, data-driven methods.',
  'Your job is to review text against Epoch\'s style guide (v3.0) and flag stylistic issues that a regex-based checker cannot catch.',
  '',
  'EPOCH VOICE: Authoritative but accessible. Empirical and evidence-based. Avoids hype, speculation, and unsubstantiated claims.',
  'First-person plural ("we") in papers, reports, Data Insights, social media. First-person singular ("I") allowed in Gradient Updates and podcasts.',
  '',
  'Focus ONLY on issues that require human/LLM judgment — things a regex cannot detect:',
  '',
  '1. TONE: Flag hype language ("breakthrough", "revolutionary", "game-changing", "unprecedented"), unsubstantiated superlatives ("the best", "the most"), or overly casual/sensational phrasing for research content.',
  '2. HEDGING: Claims should be qualified appropriately ("suggests" not "proves", "indicates" not "demonstrates", "appears to" not "clearly"). Flag both under-hedging (overclaiming) and excessive hedging that weakens the writing.',
  '3. CLARITY: Flag ambiguous pronoun references where the antecedent is unclear, overly long sentences (>40 words), paragraphs making too many unrelated points, and jargon used without explanation on first reference.',
  '4. VOICE: Flag passive voice where active voice would be clearer and the actor is known. Flag "they"/"their" referring to a singular company mentioned in a PRIOR sentence (e.g. "Google released Gemini. They said..." should be "...It said...").',
  '5. PRECISION: Flag vague quantifiers ("many", "significant", "large", "substantial", "a number of", "various") when a specific number or comparison would be more informative. Flag "percent" vs "percentage points" confusion.',
  '6. STRUCTURE: Flag "which" used restrictively without a preceding comma (should be "that"). Flag dangling modifiers. Flag unclear parallel structure in lists.',
  '',
  'IMPORTANT — Do NOT flag any of the following (they are already handled by a deterministic checker):',
  '- Spelling, terminology, glossary terms, or brand name capitalization',
  '- FLOP/FLOPs notation',
  '- Filler phrases ("in order to", "it should be noted", etc.)',
  '- Contractions, exclamation points, or other punctuation issues',
  '- Number formatting, date formatting, or unit abbreviations',
  '- Hyphenation of -ly adverbs (e.g. "highly-accurate" is already caught)',
  '- Company pronoun usage when the company name appears in the SAME sentence (already caught)',
  '- Timezone abbreviations, decade apostrophes, ellipsis formatting',
  '- a.m./p.m. formatting, en dash for ranges, multiplication signs',
  '- Any issue that can be detected by pattern matching or regex',
  '',
  'Be selective. Only flag issues where your suggestion genuinely improves the writing. Aim for 3-8 high-value suggestions per document, not an exhaustive list.',
  '',
  'Return your response as a JSON array of objects, each with:',
  '  - "excerpt": the exact text span with the issue (20-60 chars, must be a verbatim substring of the input)',
  '  - "message": a concise explanation citing the relevant style guide principle',
  '  - "suggestion": a concrete rewrite, or null if the fix is context-dependent',
  '  - "severity": "warning" or "info"',
  '  - "category": "tone" | "hedging" | "clarity" | "voice" | "precision" | "structure"',
  '',
  'Return ONLY the JSON array. No markdown, no commentary. If no issues found, return [].'
].join('\n');

// ---------------------------------------------------------------------------
// Main LLM check
// ---------------------------------------------------------------------------

function runLLMCheck(documentText) {
  var config = getLLMConfig_();
  if (!config.apiKey) {
    return [{
      ruleId: 'llm-no-key',
      severity: 'info',
      category: 'config',
      message: 'LLM API key not configured. Ask the add-on admin to run configureLLM() in the script editor.',
      suggestion: null,
      paragraphIndex: 0,
      matchStart: 0,
      matchEnd: 0,
      original: ''
    }];
  }

  var provider = PROVIDERS[config.provider];
  if (!provider) {
    return [{
      ruleId: 'llm-bad-provider',
      severity: 'warning',
      category: 'config',
      message: 'Unknown LLM provider: "' + config.provider + '". Supported: anthropic, openai.',
      suggestion: null,
      paragraphIndex: 0,
      matchStart: 0,
      matchEnd: 0,
      original: ''
    }];
  }

  var model = config.model || provider.defaultModel;

  var text = documentText;
  if (text.length > MAX_DOCUMENT_CHARS) {
    text = text.substring(0, MAX_DOCUMENT_CHARS) + '\n\n[Document truncated at ' + MAX_DOCUMENT_CHARS + ' characters]';
  }

  var userMessage = 'Review the following document for stylistic issues according to the Epoch AI style guide:\n\n' + text;
  var options = provider.buildRequest(config.apiKey, model, STYLE_GUIDE_SYSTEM_PROMPT, userMessage);

  try {
    var response = UrlFetchApp.fetch(provider.url, options);
    var statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      Logger.log('LLM API error: ' + statusCode + ' — ' + response.getContentText());
      return [{
        ruleId: 'llm-error',
        severity: 'warning',
        category: 'config',
        message: 'LLM API returned HTTP ' + statusCode + '. Check the API key and model configuration.',
        suggestion: null,
        paragraphIndex: 0,
        matchStart: 0,
        matchEnd: 0,
        original: ''
      }];
    }

    var body = JSON.parse(response.getContentText());
    var content = provider.extractContent(body);
    if (!content) return [];

    return parseLLMResponse_(content, documentText);
  } catch (e) {
    Logger.log('LLM API exception: ' + e.message);
    return [{
      ruleId: 'llm-exception',
      severity: 'warning',
      category: 'config',
      message: 'Failed to reach the LLM API: ' + e.message,
      suggestion: null,
      paragraphIndex: 0,
      matchStart: 0,
      matchEnd: 0,
      original: ''
    }];
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseLLMResponse_(responseText, documentText) {
  var issues = [];

  try {
    var cleaned = responseText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    // Try direct parse first; if that fails, attempt to fix common JSON issues
    var parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (jsonErr) {
      Logger.log('LLM raw response (first 500 chars): ' + cleaned.substring(0, 500));
      // Attempt repair: remove trailing commas before ] or }
      var repaired = cleaned.replace(/,\s*([\]}])/g, '$1');
      parsed = JSON.parse(repaired);
    }
    if (!Array.isArray(parsed)) return [];

    var paragraphs = getDocumentParagraphs();

    for (var i = 0; i < parsed.length; i++) {
      var item = parsed[i];
      var location = findExcerptLocation_(item.excerpt, paragraphs);

      issues.push({
        ruleId: 'llm-' + (item.category || 'style') + '-' + i,
        severity: item.severity || 'info',
        category: item.category || 'style',
        message: item.message || '',
        suggestion: item.suggestion || null,
        paragraphIndex: location.paragraphIndex,
        matchStart: location.matchStart,
        matchEnd: location.matchEnd,
        original: item.excerpt || ''
      });
    }
  } catch (e) {
    Logger.log('Failed to parse LLM response: ' + e.message);
  }

  return issues;
}

function findExcerptLocation_(excerpt, paragraphs) {
  if (!excerpt) return { paragraphIndex: 0, matchStart: 0, matchEnd: 0 };

  for (var i = 0; i < paragraphs.length; i++) {
    var idx = paragraphs[i].text.indexOf(excerpt);
    if (idx !== -1) {
      return {
        paragraphIndex: paragraphs[i].paragraphIndex,
        matchStart: idx,
        matchEnd: idx + excerpt.length
      };
    }
  }

  var prefix = excerpt.substring(0, 30);
  for (var j = 0; j < paragraphs.length; j++) {
    var jdx = paragraphs[j].text.indexOf(prefix);
    if (jdx !== -1) {
      return {
        paragraphIndex: paragraphs[j].paragraphIndex,
        matchStart: jdx,
        matchEnd: jdx + excerpt.length
      };
    }
  }

  return { paragraphIndex: 0, matchStart: 0, matchEnd: 0 };
}
