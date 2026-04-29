/**
 * Epoch AI — LLM integration
 *
 * Supports both Anthropic (Claude) and OpenAI APIs.
 * Used for editorial style checking and internal link suggestions.
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

function getLinksLLMConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    provider: props.getProperty('LINKS_PROVIDER') || 'anthropic',
    model: props.getProperty('LINKS_MODEL') || '',
    apiKey: props.getProperty('LINKS_API_KEY') || ''
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

/**
 * Best-effort extractor: find the first balanced JSON array inside arbitrary
 * text that may wrap the JSON in prose, markdown fences, or preamble. Returns
 * the parsed array, or null if nothing parseable is found.
 */
function extractJsonArray_(text) {
  if (!text) return null;
  var cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '');

  var start = cleaned.indexOf('[');
  if (start === -1) return null;

  var depth = 0;
  var inString = false;
  var escape = false;
  for (var i = start; i < cleaned.length; i++) {
    var ch = cleaned.charAt(i);
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        var candidate = cleaned.substring(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch (e) {
          try {
            return JSON.parse(candidate.replace(/,\s*([\]}])/g, '$1'));
          } catch (e2) {
            return null;
          }
        }
      }
    }
  }
  return null;
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

// ===========================================================================
// Internal link suggestions
// ===========================================================================

var LINK_BASE_URL = 'https://epoch.ai';

var LINK_SUGGESTION_SYSTEM_PROMPT = [
  'You are an internal linking assistant for Epoch AI, a nonprofit research institute that tracks and forecasts AI development.',
  '',
  'Your job is to identify phrases in a draft document that should link to existing Epoch publications. Good internal links:',
  '- Connect the reader to relevant deeper analysis or data',
  '- Use natural anchor text (the phrase the author already wrote, not forced keyword stuffing)',
  '- Point to publications with substantive topical overlap',
  '- Are selective — aim for 3-10 high-value links per document, not exhaustive linking',
  '',
  'Do NOT suggest links for:',
  '- Phrases that are already hyperlinked (provided in the existing links list)',
  '- Generic terms that happen to match a title (e.g. don\'t link "AI" to every AI article)',
  '- Self-references (the document linking to itself)',
  '- Phrases where adding a link would disrupt reading flow',
  '',
  'Return your response as a JSON array of objects, each with:',
  '  - "excerpt": the exact text span to link (must be a verbatim substring of the document, 2-15 words)',
  '  - "targetPath": the path of the target publication (must be from the catalog)',
  '  - "targetTitle": the title of the target publication',
  '  - "reason": a brief explanation of why this link is valuable (1 sentence)',
  '',
  'Return ONLY the JSON array. No markdown, no commentary. If no good links exist, return [].'
].join('\n');

// ---------------------------------------------------------------------------
// Link suggestion main function
// ---------------------------------------------------------------------------

function runLinkSuggestion(documentText, existingLinks) {
  var config = getLinksLLMConfig_();
  if (!config.apiKey) {
    return [{
      error: true,
      message: 'Links API key not configured. Set LINKS_API_KEY in Script Properties.'
    }];
  }

  var provider = PROVIDERS[config.provider];
  if (!provider) {
    return [{
      error: true,
      message: 'Unknown LLM provider: "' + config.provider + '".'
    }];
  }

  var model = config.model || provider.defaultModel;

  var text = documentText;
  if (text.length > MAX_DOCUMENT_CHARS) {
    text = text.substring(0, MAX_DOCUMENT_CHARS) + '\n\n[Document truncated at ' + MAX_DOCUMENT_CHARS + ' characters]';
  }

  var catalogSummary = buildCatalogSummary_();

  var existingLinksText = '';
  if (existingLinks && existingLinks.length > 0) {
    var linkLines = existingLinks.map(function(l) {
      return '- "' + l.text + '" \u2192 ' + l.url;
    });
    existingLinksText = '\n\n## Existing links in this document (do NOT suggest these again)\n\n' + linkLines.join('\n');
  }

  var userMessage = '## Catalog of Epoch publications\n\n' + catalogSummary +
    existingLinksText +
    '\n\n## Document to suggest links for\n\n' + text;

  var options = provider.buildRequest(config.apiKey, model, LINK_SUGGESTION_SYSTEM_PROMPT, userMessage);

  try {
    var response = UrlFetchApp.fetch(provider.url, options);
    var statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      Logger.log('Link suggestion API error: ' + statusCode + ' \u2014 ' + response.getContentText());
      return [{
        error: true,
        message: 'LLM API returned HTTP ' + statusCode + '. Check the API key and model configuration.'
      }];
    }

    var body = JSON.parse(response.getContentText());
    var content = provider.extractContent(body);
    if (!content) return [];

    return parseLinkSuggestions_(content, documentText);
  } catch (e) {
    Logger.log('Link suggestion API exception: ' + e.message);
    return [{
      error: true,
      message: 'Failed to reach the LLM API: ' + e.message
    }];
  }
}

// ---------------------------------------------------------------------------
// Catalog summary builder
// ---------------------------------------------------------------------------

function buildCatalogSummary_() {
  var catalog = getCatalog();
  var lines = [];
  for (var i = 0; i < catalog.length; i++) {
    var entry = catalog[i];
    var line = '- ' + entry.path + ' | ' + entry.title + ' | ' + entry.contentType;
    if (entry.tags) line += ' | Tags: ' + entry.tags;
    if (entry.description) line += ' | ' + entry.description;
    lines.push(line);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Link suggestion response parsing
// ---------------------------------------------------------------------------

function parseLinkSuggestions_(responseText, documentText) {
  var suggestions = [];

  try {
    var cleaned = responseText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    var parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (jsonErr) {
      Logger.log('Link suggestion raw response (first 500 chars): ' + cleaned.substring(0, 500));
      var repaired = cleaned.replace(/,\s*([\]}])/g, '$1');
      parsed = JSON.parse(repaired);
    }
    if (!Array.isArray(parsed)) return [];

    var validPaths = {};
    var catalog = getCatalog();
    for (var c = 0; c < catalog.length; c++) {
      validPaths[catalog[c].path] = true;
    }

    var paragraphs = getDocumentParagraphs();

    for (var i = 0; i < parsed.length; i++) {
      var item = parsed[i];
      if (!item.excerpt || !item.targetPath) continue;
      if (!validPaths[item.targetPath]) {
        Logger.log('Filtered invalid link path: ' + item.targetPath);
        continue;
      }

      var location = findExcerptLocation_(item.excerpt, paragraphs);

      suggestions.push({
        excerpt: item.excerpt,
        targetPath: item.targetPath,
        targetTitle: item.targetTitle || '',
        targetUrl: LINK_BASE_URL + item.targetPath,
        reason: item.reason || '',
        paragraphIndex: location.paragraphIndex,
        matchStart: location.matchStart,
        matchEnd: location.matchEnd
      });
    }
  } catch (e) {
    Logger.log('Failed to parse link suggestions: ' + e.message);
  }

  return suggestions;
}

// ===========================================================================
// Related work suggestions
// ===========================================================================

var RELATED_WORK_SYSTEM_PROMPT = [
  'You are helping curate "Related work" links for a blog post on Epoch AI\'s website (epoch.ai).',
  'Epoch is a nonprofit research institute that tracks and forecasts AI development through empirical, data-driven methods.',
  '',
  'Given a blog post draft and a catalog of all publications on the site, suggest the 3-5 most relevant',
  'related publications that a reader of this article would find valuable. These will appear in a',
  '"Related work" section at the end of the published article. Choose publications that:',
  '- Cover closely related topics, methods, or datasets',
  '- Would help a reader deepen their understanding of the subject',
  '- Have substantive topical overlap (not just shared tags)',
  '- Span different content types when relevant (blog posts, data insights, gradient updates)',
  '',
  'IMPORTANT: Only suggest paths that appear exactly in the catalog. Do not invent or guess paths.',
  '',
  'Return your response as a JSON array of objects, each with:',
  '  - "path": the path of the suggested publication (must be from the catalog)',
  '  - "title": the title of the publication',
  '  - "reason": a brief explanation of why this is relevant (1 sentence)',
  '',
  'Return ONLY the JSON array. No markdown, no commentary. If no good matches exist, return [].'
].join('\n');

function runRelatedWorkSuggestion(documentText) {
  var config = getLinksLLMConfig_();
  if (!config.apiKey) {
    return [{
      error: true,
      message: 'Links API key not configured. Set LINKS_API_KEY in Script Properties.'
    }];
  }

  var provider = PROVIDERS[config.provider];
  if (!provider) {
    return [{ error: true, message: 'Unknown LLM provider: "' + config.provider + '".' }];
  }

  var model = config.model || provider.defaultModel;

  var text = documentText;
  if (text.length > MAX_DOCUMENT_CHARS) {
    text = text.substring(0, MAX_DOCUMENT_CHARS) + '\n\n[Document truncated at ' + MAX_DOCUMENT_CHARS + ' characters]';
  }

  var catalogSummary = buildCatalogSummary_();
  var userMessage = '## Catalog of Epoch publications\n\n' + catalogSummary +
    '\n\n## Blog post draft to find related work for\n\n' + text;

  var options = provider.buildRequest(config.apiKey, model, RELATED_WORK_SYSTEM_PROMPT, userMessage);

  try {
    var response = UrlFetchApp.fetch(provider.url, options);
    var statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      Logger.log('Related work API error: ' + statusCode + ' \u2014 ' + response.getContentText());
      return [{ error: true, message: 'LLM API returned HTTP ' + statusCode + '.' }];
    }

    var body = JSON.parse(response.getContentText());
    var content = provider.extractContent(body);
    if (!content) return [];

    return parseRelatedWorkSuggestions_(content);
  } catch (e) {
    Logger.log('Related work API exception: ' + e.message);
    return [{ error: true, message: 'Failed to reach the LLM API: ' + e.message }];
  }
}

// ===========================================================================
// Alt-text generation for images
// ===========================================================================

var ALT_TEXT_SYSTEM_PROMPT = [
  'You generate HTML alt-text descriptions for images embedded in Epoch AI articles.',
  'Epoch AI is a nonprofit research institute; its articles are dense with charts, graphs, and data visualizations.',
  '',
  'Alt text is read aloud verbatim in audio narrations, so it must be:',
  '- One sentence (target ~15-25 words, hard cap ~35 words).',
  '- A concise description of what the image shows at a high level, not a reading of every data point.',
  '- Informative about the image\'s role in the article (e.g. "Line chart comparing compute growth across major AI labs from 2015 to 2025"), not a redundant paraphrase of adjacent prose.',
  '- Neutral in tone. Do not editorialize or add claims that are not evident from the image plus context.',
  '',
  'Conventions:',
  '- Do not start with "Image of", "Picture of", or "This image shows" — dive straight into the description.',
  '- For charts: name the chart type (line chart / bar chart / scatter plot / table), the variables on the axes, and the time range if visible.',
  '- For logos or portraits: just name them plainly (e.g. "Logo of DeepMind").',
  '- If the image is purely decorative and adds no information, respond with the single token: DECORATIVE',
  '',
  'Return ONLY the alt text (or DECORATIVE). No markdown, no quotes, no commentary.'
].join('\n');

/**
 * Call Claude with the image bytes + surrounding context. Returns
 * { altDescription } on success, { error } on failure.
 */
function runAltTextGeneration(imageBlob, surroundingText, caption) {
  var config = getLLMConfig_();
  if (!config.apiKey) {
    return { error: 'LLM API key not configured.' };
  }
  if (config.provider !== 'anthropic') {
    return { error: 'Alt-text generation currently requires the anthropic provider.' };
  }

  var model = config.model || PROVIDERS.anthropic.defaultModel;
  var mediaType = imageBlob.getContentType() || 'image/png';
  if (mediaType === 'image/jpg') mediaType = 'image/jpeg';

  var supportedTypes = { 'image/png': true, 'image/jpeg': true, 'image/gif': true, 'image/webp': true };
  if (!supportedTypes[mediaType]) {
    return { error: 'Unsupported image type for alt-text generation: ' + mediaType };
  }

  var base64 = Utilities.base64Encode(imageBlob.getBytes());

  var userContent = [];
  userContent.push({
    type: 'image',
    source: { type: 'base64', media_type: mediaType, data: base64 }
  });

  var contextLines = [];
  if (surroundingText) {
    contextLines.push('## Surrounding article text');
    contextLines.push(surroundingText);
  }
  if (caption) {
    contextLines.push('## Caption');
    contextLines.push(caption);
  }
  contextLines.push('## Task');
  contextLines.push('Generate a one-sentence alt description for the image above.');
  userContent.push({ type: 'text', text: contextLines.join('\n\n') });

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: model,
      max_tokens: 256,
      system: ALT_TEXT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }]
    }),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(PROVIDERS.anthropic.url, options);
    var statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      Logger.log('Alt-text API error: ' + statusCode + ' — ' + response.getContentText());
      return { error: 'Claude API returned HTTP ' + statusCode + '.' };
    }

    var body = JSON.parse(response.getContentText());
    var content = PROVIDERS.anthropic.extractContent(body);
    if (!content) return { error: 'Empty response from Claude.' };

    var text = content.trim().replace(/^"|"$/g, '').trim();
    return { altDescription: text };
  } catch (e) {
    Logger.log('Alt-text API exception: ' + e.message);
    return { error: 'Failed to reach the Claude API: ' + e.message };
  }
}

// ===========================================================================
// Research helper — link verification
// ===========================================================================

var LINK_VERIFICATION_SYSTEM_PROMPT = [
  'You verify whether a hyperlink in an Epoch AI draft points to a page that actually supports the claim the draft is making.',
  '',
  'The user gives you:',
  '  - The surrounding sentence(s) from the draft (the "claim").',
  '  - The anchor text of the hyperlink.',
  '  - The extracted text of the target page (may be truncated — the user will tell you).',
  '',
  'Assess whether the target page substantively supports, partially supports, or does not support the claim.',
  'Be generous about structural variation (e.g. the target may use different phrasing) but strict about factual fit.',
  '',
  'BIAS TOWARD "ok" WHEN UNCERTAIN. The default assumption is that an Epoch editor placed this link deliberately. Flag a problem only when you have positive evidence that the target does not support the claim — not when you simply cannot find the supporting passage.',
  '',
  'Return a JSON object with exactly these fields:',
  '  - "status": one of "ok" | "partial" | "mismatch" | "unknown"',
  '      * "ok"       — target clearly attests to the claim, OR the page is plausibly the right reference and you have no evidence against it',
  '      * "partial"  — target is topically related and loosely supports, but doesn\'t directly attest (use sparingly)',
  '      * "mismatch" — target actively contradicts the claim, or is clearly about a different topic',
  '      * "unknown"  — target text is too thin (redirect, paywall, JS-only page) to judge, OR the extracted text was truncated and the supporting passage is plausibly later in the page',
  '  - "explanation": one short sentence stating the reason for the status',
  '  - "suggestedAnchor": optional — a tighter anchor-text phrase if the current one is vague or misleading (omit or null otherwise)',
  '',
  'Important: if the user notes the target text was truncated, do NOT issue "partial" or "mismatch" just because the supporting passage was missing — return "unknown" or "ok".',
  '',
  'Return ONLY the JSON object. No markdown, no commentary.'
].join('\n');

function runLinkVerificationLLM(link, fetched) {
  var config = getLLMConfig_();
  if (!config.apiKey) {
    return { status: 'error', explanation: 'LLM API key not configured.' };
  }
  var provider = PROVIDERS[config.provider];
  if (!provider) {
    return { status: 'error', explanation: 'Unknown LLM provider: ' + config.provider };
  }
  var model = config.model || provider.defaultModel;

  var pageTextHeader = '## Target page extracted text';
  if (fetched.truncated) {
    pageTextHeader += ' (TRUNCATED to first ~' + (fetched.text ? fetched.text.length : 0) +
      ' chars — supporting passage may appear later; default to "unknown" or "ok" if you cannot find evidence either way)';
  }

  var user = [
    '## Claim (from the draft)',
    link.context,
    '',
    '## Anchor text',
    link.anchorText,
    '',
    '## Target URL',
    link.url,
    '',
    '## Target page title',
    fetched.title || '(no title)',
    '',
    pageTextHeader,
    fetched.text || '(empty)'
  ].join('\n');

  var options = provider.buildRequest(config.apiKey, model, LINK_VERIFICATION_SYSTEM_PROMPT, user);

  try {
    var response = UrlFetchApp.fetch(provider.url, options);
    var statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      Logger.log('Link verification API error: ' + statusCode + ' — ' + response.getContentText());
      return { status: 'error', explanation: 'Claude API returned HTTP ' + statusCode + '.' };
    }
    var body = JSON.parse(response.getContentText());
    var content = provider.extractContent(body);
    if (!content) return { status: 'unknown', explanation: 'Empty response from Claude.' };

    var cleaned = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    var parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (jsonErr) {
      Logger.log('Link verification raw response: ' + cleaned.substring(0, 400));
      parsed = JSON.parse(cleaned.replace(/,\s*([\]}])/g, '$1'));
    }
    return {
      status: parsed.status || 'unknown',
      explanation: parsed.explanation || '',
      suggestedAnchor: parsed.suggestedAnchor || null
    };
  } catch (e) {
    Logger.log('Link verification exception: ' + e.message);
    return { status: 'error', explanation: 'Claude API failure: ' + e.message };
  }
}

// ===========================================================================
// Research helper — recency check via web search
// ===========================================================================

var RECENCY_CHECK_SYSTEM_PROMPT = [
  'You help an Epoch AI draft avoid stale facts before publication.',
  'Epoch AI is a nonprofit AI research institute; its articles cite empirical numbers, lab releases, benchmarks, model parameters, company actions, and policy events.',
  '',
  'You will be given a draft article. Use the web_search tool to look for developments in the last 14 days that would:',
  '  - contradict a factual claim in the draft (a number has moved, a release was withdrawn, a policy changed),',
  '  - or update it with materially new information the author might want to reflect.',
  '',
  'Search strategy:',
  '  - Identify the 3-6 most time-sensitive factual claims (model capabilities, benchmark leaderboards, company announcements, funding rounds, regulatory actions).',
  '  - For each, search for the specific entity + date context.',
  '  - Skip evergreen claims (definitions, historical events > 6 months old, methodology).',
  '',
  'EVALUATION DISCIPLINE — read both sides carefully before flagging:',
  '  - Read the FULL surrounding paragraph in the draft, not just the bare claim. The author often qualifies (e.g. "as of Q1 2025", "in the training run we measured", "for inference", "projected"). A finding that contradicts the claim out of context but matches once you read the qualification is NOT a finding.',
  '  - Read the source you found carefully. Note its date, its scope (current vs projected, training vs inference, US-only vs global, lab vs industry), and its methodology. A "12 GW projected for 2027" claim does NOT contradict "5 GW currently deployed" in the draft.',
  '  - Match units, time horizons, and definitions exactly. If the draft says "training compute" and the source says "total compute (training + inference)", that is not a contradiction.',
  '  - Tense matters: a draft saying "OpenAI has not released GPT-5" is NOT contradicted by "OpenAI announced GPT-5 will be released next month".',
  '  - When in doubt, don\'t flag. Aim for 0-3 high-quality findings rather than a long list of weak ones. False positives waste editor time.',
  '',
  'After the tool calls are done, emit exactly ONE final message whose entire content is a JSON array (starting with "[" and ending with "]"). No preamble. No prose. No markdown code fence. No trailing commentary.',
  '',
  'Each finding has:',
  '  - "claim": the specific sentence or phrase from the draft (verbatim, ASCII-clean)',
  '  - "finding": a one-sentence summary of what the recent source says, with units / time-horizon / scope explicit',
  '  - "reasoning": a one-sentence justification for why this is a real conflict (not a scope or time mismatch)',
  '  - "sourceUrl": canonical URL of the supporting source',
  '  - "sourceTitle": title of the source (short)',
  '  - "severity": "update" (new info worth mentioning) | "contradiction" (the draft is now wrong)',
  '',
  'Use plain ASCII in the JSON strings — no smart quotes, no em-dashes, no zero-width spaces, no markdown formatting characters.',
  '',
  'If nothing material was found, the entire final message is the literal three characters: []'
].join('\n');

function runRecencyCheck(documentText) {
  var config = getLLMConfig_();
  if (!config.apiKey) {
    return { error: 'LLM API key not configured.' };
  }
  if (config.provider !== 'anthropic') {
    return { error: 'Recency check requires the anthropic provider (web search tool).' };
  }

  var model = config.model || PROVIDERS.anthropic.defaultModel;
  var text = documentText;
  if (text.length > MAX_DOCUMENT_CHARS) {
    text = text.substring(0, MAX_DOCUMENT_CHARS) + '\n\n[Document truncated at ' + MAX_DOCUMENT_CHARS + ' characters]';
  }

  // Extended thinking gives Claude budget to reason about scope/time/unit
  // mismatches before deciding whether a finding is real. Editors flagged that
  // the prior pass produced false positives (e.g. flagging "current volume"
  // claims as contradicted by sources reporting "projected" numbers).
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: model,
      max_tokens: 12000,
      thinking: { type: 'enabled', budget_tokens: 6000 },
      system: RECENCY_CHECK_SYSTEM_PROMPT,
      tools: [{
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 6
      }],
      messages: [{
        role: 'user',
        content: 'Draft article to check for recency issues:\n\n' + text
      }]
    }),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(PROVIDERS.anthropic.url, options);
    var statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      Logger.log('Recency check API error: ' + statusCode + ' — ' + response.getContentText());
      return { error: 'Claude API returned HTTP ' + statusCode + '.' };
    }

    var body = JSON.parse(response.getContentText());
    // The assistant may emit a mix of thinking, tool_use, and text blocks.
    // Pull the last text block — that's where the summary lives after tool
    // calls finish.
    var textBlocks = (body.content || []).filter(function(b) { return b.type === 'text'; });
    if (!textBlocks.length) return { findings: [] };
    var content = textBlocks[textBlocks.length - 1].text;

    var parsed = extractJsonArray_(content);
    if (!Array.isArray(parsed)) {
      Logger.log('Recency check: could not extract JSON array. Raw response: ' + content.substring(0, 600));
      return { error: 'Claude returned a non-JSON response. See script logs for details.' };
    }
    return { findings: parsed.map(sanitizeFinding_) };
  } catch (e) {
    Logger.log('Recency check exception: ' + e.message);
    return { error: 'Claude API failure: ' + e.message };
  }
}

/**
 * Strip control characters and normalize whitespace in any string field of a
 * recency finding. Editors saw stray characters in the rendered output;
 * Claude sometimes emits zero-width / unprintable codepoints inside JSON
 * strings that JSON.parse passes through unchanged.
 */
function sanitizeFinding_(finding) {
  if (!finding || typeof finding !== 'object') return finding;
  var out = {};
  for (var k in finding) {
    if (Object.prototype.hasOwnProperty.call(finding, k)) {
      var v = finding[k];
      out[k] = (typeof v === 'string') ? sanitizeText_(v) : v;
    }
  }
  return out;
}

function sanitizeText_(s) {
  if (!s) return s;
  return String(s)
    // C0 controls + DEL, except tab/newline/CR.
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    // Soft hyphen, zero-width spaces, bidi marks, BOM, other invisibles.
    .replace(/[\u00AD\u200B-\u200F\u2028-\u202F\u205F-\u206F\uFEFF]/g, '')
    // Smart quotes -> ASCII.
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    // En/em dashes -> hyphen, ellipsis -> three dots.
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    // Non-breaking space -> regular space.
    .replace(/\u00A0/g, ' ')
    // Collapse runs of horizontal whitespace.
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ===========================================================================
// Metadata generation (tags, HTML title, HTML meta)
// ===========================================================================

var METADATA_SYSTEM_PROMPT = [
  'You fill in SEO metadata for Epoch AI articles. Epoch AI is a nonprofit research institute that publishes empirical analysis of AI trends.',
  '',
  'The user gives you:',
  '  - The draft article text.',
  '  - A canonical list of tags already in use on the site. You MUST select from this list; do not invent new tags.',
  '  - Which metadata fields to produce (may be any subset of: tags, htmlTitle, htmlMeta).',
  '',
  '## tags',
  '',
  'Choose 2–4 tags from the canonical list that best describe the article\'s primary topics. Return a comma-separated string.',
  '',
  '## htmlTitle and htmlMeta',
  '',
  '### Step 1 — Identify the content type',
  '',
  '  - **Data Insight** — one key finding or chart per page (typically a short post built around a single chart and headline number).',
  '  - **Long-form / Other** — research paper, explainer, multi-finding analysis, blog post, gradient update, benchmark write-up, or anything else.',
  '',
  '### Step 2 — Write the htmlTitle',
  '',
  'Aim for the length of a short newspaper headline — roughly 6–9 words before the brand suffix. Always end with " — Epoch AI".',
  '',
  'Think about how someone would phrase this as a question to ChatGPT or Perplexity, then write the title to match that phrasing. A user asking "do rich people use different AI tools?" would likely trigger a background search for "AI chatbot usage by income", so that phrase belongs in the title.',
  '',
  'Apply the formula for the content type:',
  '',
  '**Data Insight** — `Topic: Key finding or framing — Epoch AI`',
  '',
  'Examples:',
  '  - AI Chatbot Users by Income: Claude vs Meta AI — Epoch AI',
  '  - Hyperscaler Capex: Quadrupled Since GPT-4 — Epoch AI',
  '  - Global AI Compute: Doubling Every 7 Months — Epoch AI',
  '  - China vs US AI Frontier: 7-Month Lag Since 2023 — Epoch AI',
  '  - Anthropic Revenue: Could Pass OpenAI by Mid-2026 — Epoch AI',
  '  - AI Power Capacity: Comparable to Peak New York State — Epoch AI',
  '  - Microsoft Physical Assets: $68B Driven by AI — Epoch AI',
  '',
  '**Long-form / Other** — `Primary keyword as a natural question or statement — Epoch AI`',
  '',
  'A natural question is often the strongest framing for long-form pieces, because it matches how users phrase searches in ChatGPT/Perplexity. Prefer the question form when a clear question fits; fall back to a topic statement (a "statement form of the question") only when no question reads naturally. Either form should reflect what the user is searching, not a takeaway from the piece.',
  '',
  'Question-form examples (preferred):',
  '  - How Close Is AI to Taking My Job? — Epoch AI',
  '  - Can AI Companies Become Profitable? — Epoch AI',
  '  - How Persistent Is the Inference Cost Burden? — Epoch AI',
  '  - How Far Can Decentralized Training Scale? — Epoch AI',
  '  - How Well Did Forecasters Predict 2025 AI Progress? — Epoch AI',
  '  - What Do Frontier AI Job Postings Reveal? — Epoch AI',
  '  - What Do "Economic Value" Benchmarks Tell Us? — Epoch AI',
  '',
  'Statement-form examples (use when a question doesn\'t fit naturally):',
  '  - Cost of Training Frontier AI Models — Epoch AI',
  '  - The Least Understood Driver of AI Progress — Epoch AI',
  '  - Reinforcement Learning Environments: State of the Field — Epoch AI',
  '  - Where Autonomy Works: Robot Capabilities in 2026 — Epoch AI',
  '  - Epoch AI 2025 Impact Report — Epoch AI',
  '  - Top 10 Data Insights and Gradient Updates of 2025 — Epoch AI',
  '',
  '### Step 3 — Write the htmlMeta',
  '',
  'Aim for 1–2 short sentences. Lead with the sharpest specific finding or the scope of the resource. Include "Epoch AI". Close with a phrase that signals there is more detail inside.',
  '',
  '**Data Insight** — Lead with the key number; close with "Epoch AI\'s [topic] breakdown."',
  '  - Example: 80% of Claude users live in $100k+ households vs 37% of Meta AI users. Epoch AI\'s income breakdown of US AI chatbot usage across major providers.',
  '',
  '**Long-form / Other** — Lead with the core finding; add a methodology signal if the source is notable.',
  '  - Example: Frontier AI training costs have risen 2.4× year-over-year. Epoch AI\'s analysis of public and disclosed compute and cost figures for leading models.',
  '',
  '### Before finalizing — cut any of the following',
  '',
  '  - Filler openers: "Analysis reveals", "This article explores", "New research shows".',
  '  - Vague qualifiers: "significant", "major", "key", "important".',
  '  - Do not repeat the htmlTitle verbatim in the htmlMeta.',
  '',
  '## Output',
  '',
  'Return a JSON object with only the requested fields. Omit fields you were not asked to produce.',
  'Return ONLY the JSON object. No markdown, no commentary.'
].join('\n');

function runMetadataGeneration(documentText, availableTags, metadataRows) {
  var config = getLLMConfig_();
  if (!config.apiKey) return { error: 'LLM API key not configured.' };
  var provider = PROVIDERS[config.provider];
  if (!provider) return { error: 'Unknown LLM provider: ' + config.provider };

  var model = config.model || provider.defaultModel;

  var text = documentText;
  if (text.length > MAX_DOCUMENT_CHARS) {
    text = text.substring(0, MAX_DOCUMENT_CHARS) + '\n\n[Document truncated at ' + MAX_DOCUMENT_CHARS + ' characters]';
  }

  var fieldsRequested = (metadataRows || []).map(function(r) { return r.field; });
  if (fieldsRequested.length === 0) fieldsRequested = ['tags', 'htmlTitle', 'htmlMeta'];

  var userMessage = [
    '## Fields to produce',
    fieldsRequested.join(', '),
    '',
    '## Canonical tag list (pick from these for the "tags" field)',
    (availableTags || []).join(', '),
    '',
    '## Draft article',
    text
  ].join('\n');

  var options = provider.buildRequest(config.apiKey, model, METADATA_SYSTEM_PROMPT, userMessage);

  try {
    var response = UrlFetchApp.fetch(provider.url, options);
    var statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      Logger.log('Metadata API error: ' + statusCode + ' — ' + response.getContentText());
      return { error: 'Claude API returned HTTP ' + statusCode + '.' };
    }
    var body = JSON.parse(response.getContentText());
    var content = provider.extractContent(body);
    if (!content) return { error: 'Empty response from Claude.' };

    var cleaned = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    var parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (jsonErr) {
      Logger.log('Metadata raw response: ' + cleaned.substring(0, 400));
      parsed = JSON.parse(cleaned.replace(/,\s*([\]}])/g, '$1'));
    }

    // Filter tags to ones in the canonical list (defensive).
    if (parsed.tags && availableTags && availableTags.length) {
      var allowed = {};
      availableTags.forEach(function(t) { allowed[t.toLowerCase()] = t; });
      var filtered = parsed.tags.split(',').map(function(t) {
        return allowed[t.trim().toLowerCase()] || null;
      }).filter(Boolean);
      parsed.tags = filtered.join(', ');
    }

    return { proposals: parsed };
  } catch (e) {
    Logger.log('Metadata API exception: ' + e.message);
    return { error: 'Claude API failure: ' + e.message };
  }
}

function parseRelatedWorkSuggestions_(responseText) {
  var suggestions = [];

  try {
    var cleaned = responseText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    var parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (jsonErr) {
      var repaired = cleaned.replace(/,\s*([\]}])/g, '$1');
      parsed = JSON.parse(repaired);
    }
    if (!Array.isArray(parsed)) return [];

    var validPaths = {};
    var catalog = getCatalog();
    for (var c = 0; c < catalog.length; c++) {
      validPaths[catalog[c].path] = true;
    }

    for (var i = 0; i < parsed.length; i++) {
      var item = parsed[i];
      if (!item.path) continue;
      if (!validPaths[item.path]) {
        Logger.log('Filtered invalid related work path: ' + item.path);
        continue;
      }
      suggestions.push({
        path: item.path,
        title: item.title || '',
        url: LINK_BASE_URL + item.path,
        reason: item.reason || ''
      });
    }
  } catch (e) {
    Logger.log('Failed to parse related work suggestions: ' + e.message);
  }

  return suggestions;
}
