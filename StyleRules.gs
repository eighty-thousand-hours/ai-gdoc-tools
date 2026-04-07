/**
 * Epoch editorial checker — deterministic rule engine
 *
 * Rules derived from the Epoch AI Style Guide v3.0 (November 2025).
 */

// ---------------------------------------------------------------------------
// Glossary: spelling and terminology
// ---------------------------------------------------------------------------

var GLOSSARY_RULES = [
  // Spelling preferences (per style guide glossary)
  ['advisor', 'adviser', null],
  ['a\\.k\\.a\\.?', 'aka', null],
  ['alright', 'all right', 'Always two words'],
  ['analogue', 'analog', null],
  ['data set', 'dataset', 'One word'],
  ['e-mail', 'email', 'No hyphen'],
  ['NVIDIA', 'Nvidia', 'Not all-caps, even in product names like "Nvidia H100s"'],
  ['semi-conductor', 'semiconductor', 'One word, no hyphen'],
  ['standalone', 'stand-alone', 'Always hyphenated'],
  ['byproduct', 'by-product', 'Always hyphenated'],
  ['decisionmaking', 'decision-making', 'Always hyphenated'],
  ['decision making', 'decision-making', 'Always hyphenated'],
  ['spin-off', 'spinoff', 'One word'],
  ['spin off', 'spinoff', 'One word (noun/adj/verb)'],
  ['web site', 'website', 'One word'],
  ['Internet', 'internet', 'Lowercase preferred'],

  // Brand names and AI model names (one rule per correct form; case-insensitive + skip if already correct)
  ['EpochAI', 'Epoch AI', 'Two words, with a space'],
  ['epoch ai', 'Epoch AI', 'Capitalize both words'],
  ['GPT4', 'GPT-4', 'OpenAI models are hyphenated'],
  ['GPT 4', 'GPT-4', 'OpenAI models are hyphenated'],
  ['Claude-4\\.5', 'Claude 4.5', 'Anthropic uses space, not hyphen'],
  ['Claude-3\\.5', 'Claude 3.5', 'Anthropic uses space, not hyphen'],
  ['LLaMa', 'Llama', 'Capital L, lowercase rest'],
  ['Llama3', 'Llama 3', 'Space before version number'],
  ['arxiv', 'arXiv', 'Lowercase a, capital X'],
  ['openai', 'OpenAI', null],
  ['Open AI', 'OpenAI', 'One word'],
  ['chatgpt', 'ChatGPT', null],
  ['Chat GPT', 'ChatGPT', 'One word'],
  ['xai', 'xAI', 'Lowercase x, uppercase AI'],
  ['wifi', 'Wi-Fi', null],
  ['Wi-fi', 'Wi-Fi', 'Capital F'],
  ['llm', 'LLM', 'Always all-caps'],

  // Filler phrases
  ['it is worth noting that', null, 'Filler — cut or rephrase'],
  ['it should be noted that', null, 'Filler — cut or rephrase'],
  ['it is important to note that', null, 'Filler — cut or rephrase'],
  ['in order to', 'to', 'Simplify'],
  ['due to the fact that', 'because', 'Simplify'],
  ['needless to say', null, 'If needless to say, don\'t say it'],
  ['at the end of the day', null, 'Cliché — rephrase'],
  ['as a matter of fact', null, 'Filler — cut or rephrase'],

  // Diacritics
  ['\\bnaive\\b', 'naïve', 'Use diaeresis'],
  ['\\bnaivete\\b', 'naïveté', 'Use diacritics'],
  ['\\bnaivety\\b', 'naïveté', 'Use diacritics'],

  // Abbreviation periods
  ['A\\.I\\.', 'AI', 'No periods in abbreviations'],
  ['U\\.S\\.', 'US', 'No periods (exception: Washington, D.C.)'],
  ['U\\.K\\.', 'UK', 'No periods'],
  ['E\\.U\\.', 'EU', 'No periods'],
  ['Ph\\.D\\.?', 'PhD', 'No periods in academic degrees'],
  ['M\\.B\\.A\\.?', 'MBA', 'No periods in academic degrees'],

  // Brand names — additional
  ['\\banthropic\\b', 'Anthropic', 'Capitalize'],
  ['Gemini-1', 'Gemini 1', 'Google models use space, not hyphen'],
  ['Gemini-2', 'Gemini 2', 'Google models use space, not hyphen'],
  ['PaLM-2', 'PaLM 2', 'Google models use space, not hyphen'],
  ['DeepSeek-V3', 'DeepSeek V3', 'DeepSeek models use space, not hyphen'],
  ['DeepSeek-V2', 'DeepSeek V2', 'DeepSeek models use space, not hyphen'],
  ['DeepSeek-R1', 'DeepSeek R1', 'DeepSeek models use space, not hyphen'],

  // Hyphenation
  ['test time compute', 'test-time compute', 'Hyphenate compound modifier'],

  // Usage
  ['begs the question', 'raises the question', 'Almost always a misuse of "begs the question"'],
  ['whether or not', 'whether', '"or not" is usually superfluous'],

  // FLOP (single rule — case-insensitive catches FLOPs, flops, etc.)
  ['flops', 'FLOP', 'Always "FLOP" (singular and plural), never "FLOPs"'],

  // Other
  ['click here', null, 'Avoid — integrate links naturally into text'],
  ['SWE-bench verified', 'SWE-bench Verified', 'Capital V'],
  ['\\(link\\)', null, 'Avoid — integrate links naturally into text'],
  ['\\bvs\\.', 'versus', 'Write out "versus" in running text; "vs." only in tables/figures'],
];

// ---------------------------------------------------------------------------
// Formatting rules
// ---------------------------------------------------------------------------

var FORMATTING_RULES = [
  {
    id: 'fmt-percent-word',
    pattern: /(\d+)\s+percent\b/gi,
    message: 'Use the "%" symbol instead of spelling out "percent".',
    suggestion: function(match) { return match[1] + '%'; },
    severity: 'error',
    category: 'formatting'
  },
  {
    id: 'fmt-leading-zero',
    pattern: /(?<!\d)\.\d+%/g,
    message: 'Add a leading zero before decimal points (e.g. "0.4%" not ".4%").',
    severity: 'warning',
    category: 'formatting'
  },
  {
    id: 'fmt-decade-apostrophe',
    pattern: /\b(\d{4})'s\b/g,
    message: 'No apostrophe in decades. Write "1920s" not "1920\'s".',
    suggestion: function(match) { return match[1] + 's'; },
    severity: 'warning',
    category: 'formatting'
  },
  {
    id: 'fmt-ellipsis-dots',
    pattern: /\.\.\./g,
    message: 'Use the ellipsis character " … " (with spaces) instead of three periods.',
    suggestion: ' … ',
    severity: 'warning',
    category: 'formatting'
  },
  {
    id: 'fmt-double-space',
    pattern: /\S  +\S/g,
    message: 'Double space detected. Use a single space.',
    severity: 'error',
    category: 'formatting'
  },
  {
    id: 'fmt-exclamation',
    pattern: /!(?![\])])/g,
    message: 'Avoid exclamation points in Epoch content.',
    severity: 'info',
    category: 'formatting'
  },
  {
    id: 'fmt-timezone-specific',
    pattern: /\b(?:EST|EDT|CST|CDT|PST|PDT|MST|MDT|CEST)\b/g,
    message: 'Use year-round timezone abbreviation: ET (not EST/EDT), CET (not CEST), PT (not PST/PDT).',
    severity: 'info',
    category: 'formatting'
  },
  {
    id: 'fmt-figure-lowercase',
    pattern: /\b(figure|table|section|chapter|appendix)\s+(\d+)/gi,
    message: 'Capitalize when numbered: "Figure 3", "Table 1", "Section 2".',
    severity: 'warning',
    category: 'formatting',
    test: function(match) {
      // Only flag if the first letter is actually lowercase
      return match[1].charAt(0) === match[1].charAt(0).toLowerCase();
    }
  },
  {
    id: 'fmt-ly-hyphen',
    pattern: /\b(\w+ly)-(\w+)\b/g,
    message: 'Never hyphenate after adverbs ending in -ly. Write "highly accurate" not "highly-accurate".',
    suggestion: function(match) { return match[1] + ' ' + match[2]; },
    severity: 'error',
    category: 'formatting'
  },
  {
    id: 'fmt-abbreviated-units',
    pattern: /\b(\d+(?:\.\d+)?)\s*([MBT])\b(?!\w)/g,
    message: 'In running text, write out units: "5 million", "3 billion", "2 trillion". Abbreviations (M, B, T) only in tables and figures.',
    severity: 'warning',
    category: 'formatting',
    suggestion: function(match) {
      var units = { M: ' million', B: ' billion', T: ' trillion' };
      return match[1] + (units[match[2]] || match[2]);
    }
  },
  {
    id: 'fmt-time-unnecessary-zeros',
    pattern: /\b(\d{1,2}):00\s*([ap]\.m\.)/g,
    message: 'Omit ":00" for round hours. Write "2 p.m." not "2:00 p.m.".',
    suggestion: function(match) { return match[1] + ' ' + match[2]; },
    severity: 'info',
    category: 'formatting'
  },
  {
    id: 'fmt-date-european',
    pattern: /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/g,
    message: 'Use month-day-year format: "August 12, 2025" not "12 August 2025".',
    suggestion: function(match) { return match[2] + ' ' + match[1] + ', ' + match[3]; },
    severity: 'warning',
    category: 'formatting'
  },
  {
    id: 'fmt-punctuation-inside-quotes',
    pattern: /[,.]"/g,
    message: 'Epoch style: punctuation goes outside quotation marks unless it\'s part of the quoted material.',
    severity: 'info',
    category: 'formatting'
  },
  {
    id: 'fmt-contractions',
    pattern: /\b(can't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|couldn't|wouldn't|shouldn't|it's|we're|they're|I'm|we've|they've|we'll|they'll|he's|she's|that's|there's|let's)\b/gi,
    message: 'Avoid contractions in formal content (papers, reports). Permitted in blog posts and social media.',
    severity: 'info',
    category: 'formatting'
  },
  {
    id: 'fmt-long-numbers',
    pattern: /\b\d{1,3}(?:,\d{3}){3,}\b/g,
    message: 'Consider using readable short forms: "3.4 billion" instead of "3,400,000,000".',
    severity: 'info',
    category: 'formatting'
  },
  {
    id: 'fmt-space-before-percent',
    pattern: /\d\s+%/g,
    message: 'No space before "%". Write "48%" not "48 %".',
    severity: 'error',
    category: 'formatting'
  },
  {
    id: 'fmt-date-ordinal',
    pattern: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(st|nd|rd|th)\b/g,
    message: 'Use cardinal numbers for dates: "December 25" not "December 25th".',
    suggestion: function(match) { return match[1] + ' ' + match[2]; },
    severity: 'warning',
    category: 'formatting'
  },
  {
    id: 'fmt-month-comma-year',
    pattern: /\b(January|February|March|April|May|June|July|August|September|October|November|December),\s+(\d{4})\b/g,
    message: 'No comma between month and year when no day is given: "March 1980" not "March, 1980".',
    suggestion: function(match) { return match[1] + ' ' + match[2]; },
    severity: 'warning',
    category: 'formatting'
  },
  {
    id: 'fmt-month-day-year-comma',
    pattern: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s+(\d{4})\b/g,
    message: 'Add a comma before the year: "January 5, 2025" not "January 5 2025".',
    suggestion: function(match) { return match[1] + ' ' + match[2] + ', ' + match[3]; },
    severity: 'warning',
    category: 'formatting'
  },
  {
    id: 'fmt-noon-midnight',
    pattern: /\b12(?::00)?\s*(a\.m\.|p\.m\.|am|pm|AM|PM)/g,
    message: 'Use "noon" for 12 p.m. and "midnight" for 12 a.m.',
    severity: 'info',
    category: 'formatting'
  },
  {
    id: 'fmt-am-pm-format',
    pattern: /\b(\d{1,2}(?::\d{2})?)\s*(a\.m\.|p\.m\.|A\.M\.|P\.M\.|am|pm|AM|PM)/g,
    message: 'Use "a.m." and "p.m." (lowercase, with periods).',
    severity: 'warning',
    category: 'formatting',
    test: function(match) {
      var suffix = match[2];
      // Don't flag if already correct: a.m. or p.m.
      return suffix !== 'a.m.' && suffix !== 'p.m.';
    }
  },
  {
    id: 'fmt-per-year',
    pattern: /\b(\d+(?:\.\d+)?%?)\s*\/\s*year\b/g,
    message: 'Write "per year" instead of "/year" in running text.',
    suggestion: function(match) { return match[1] + ' per year'; },
    severity: 'warning',
    category: 'formatting'
  },
  {
    id: 'fmt-company-they',
    pattern: /\b(OpenAI|Google|Meta|Anthropic|Microsoft|Apple|Amazon|Nvidia|xAI|DeepSeek|Mistral|Cohere)\s+(?:\w+\s+){0,4}(they|their|them|themselves)\b/g,
    message: 'Refer to singular companies as "it"/"its", not "they"/"their".',
    severity: 'info',
    category: 'formatting'
  },
  {
    id: 'fmt-ampersand',
    pattern: /\s&\s/g,
    message: 'Avoid ampersands in running text. Write "and" instead (exception: R&D, organization names).',
    severity: 'info',
    category: 'formatting',
    test: function(match) {
      // Don't flag R&D
      return true; // We'll rely on context; R&D is handled by not having spaces
    }
  }
];

// ---------------------------------------------------------------------------
// Math notation rules
// ---------------------------------------------------------------------------

var MATH_RULES = [
  {
    id: 'math-x-multiply',
    pattern: /(\d+)\s*x\s*(\d+)/g,
    message: 'Use "×" (multiplication sign) instead of the letter "x".',
    suggestion: function(match) { return match[1] + ' × ' + match[2]; },
    severity: 'error',
    category: 'math'
  },
  {
    id: 'math-multiply-no-spaces',
    pattern: /(\d)\u00D7(\d)/g,
    message: 'Use spaces around × in mathematical operations: "3 × 10" not "3×10".',
    suggestion: function(match) { return match[1] + ' × ' + match[2]; },
    severity: 'warning',
    category: 'math'
  },
  {
    id: 'math-e-notation',
    pattern: /\b(\d+)[eE]\+?(\d+)\b/g,
    message: 'Use superscript notation (10²⁶) instead of e-notation (1e26).',
    severity: 'warning',
    category: 'math'
  },
  {
    id: 'math-caret-notation',
    pattern: /\b(\d+)\^(\d+)\b/g,
    message: 'Use proper superscript notation instead of caret (^). In Google Docs: Format > Text > Superscript.',
    severity: 'warning',
    category: 'math'
  },
  {
    id: 'math-gt-lt-symbols',
    pattern: /(?<!\w)[<>]\s*\d/g,
    message: 'Avoid < and > symbols in running text. Write out "greater than", "less than", "more than", "fewer than".',
    severity: 'warning',
    category: 'math'
  },
  {
    id: 'math-range-hyphen',
    pattern: /\b(\d{4})\s*-\s*(\d{2,4})\b/g,
    message: 'Use an en dash (–) for ranges, not a hyphen: "2001–2009".',
    suggestion: function(match) { return match[1] + '–' + match[2]; },
    severity: 'warning',
    category: 'math'
  },
  {
    id: 'math-numeric-range-hyphen',
    pattern: /\b(\d+(?:\.\d+)?%?)\s*-\s*(\d+(?:\.\d+)?%?)\b/g,
    message: 'Use an en dash (–) for ranges, not a hyphen: "70%–80%".',
    suggestion: function(match) { return match[1] + '–' + match[2]; },
    severity: 'warning',
    category: 'math',
    test: function(match) {
      // Skip year ranges (handled by math-range-hyphen) and negative numbers
      var n1 = parseInt(match[1]);
      if (n1 >= 1900 && n1 <= 2100) return false;
      return true;
    }
  },
  {
    id: 'math-multiplier-letter-x',
    pattern: /\b(\d+)\s*x\s+(higher|lower|faster|slower|growth|more|less|greater|larger|smaller|bigger|increase|decrease|improvement)\b/gi,
    message: 'Use "×" (multiplication sign) for multipliers, with no space: "4× higher".',
    suggestion: function(match) { return match[1] + '× ' + match[2]; },
    severity: 'warning',
    category: 'math'
  }
];

// ---------------------------------------------------------------------------
// Rule engine
// ---------------------------------------------------------------------------

function buildGlossaryRules_() {
  var rules = [];
  for (var i = 0; i < GLOSSARY_RULES.length; i++) {
    var entry = GLOSSARY_RULES[i];
    var wrong = entry[0];
    var correct = entry[1];
    var note = entry[2];

    if (correct === null && note === null) continue;

    // Only add \b where the pattern starts/ends with a word character.
    // Patterns ending with escaped non-word chars (\. \) etc.) or
    // already containing \b don't need extra boundaries.
    var prefix = '\\b';
    var suffix = '\\b';
    // Skip leading \b if pattern already starts with \b or an escaped non-word char
    if (/^\\b/.test(wrong) || /^\\[^a-zA-Z0-9]/.test(wrong)) {
      prefix = '';
    }
    // Skip trailing \b if pattern already ends with \b, or ends with
    // an escaped non-word char (optionally followed by ?)
    if (/\\b$/.test(wrong) || /\\[^a-zA-Z0-9]\??$/.test(wrong)) {
      suffix = '';
    }
    var patternStr = prefix + wrong + suffix;
    var pattern;
    try {
      pattern = new RegExp(patternStr, 'gi');
    } catch (e) {
      patternStr = prefix + wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + suffix;
      pattern = new RegExp(patternStr, 'gi');
    }

    rules.push({
      id: 'glossary-' + i,
      category: 'glossary',
      severity: correct ? 'warning' : 'info',
      pattern: pattern,
      message: null, // built dynamically in buildIssue_
      suggestion: correct || null,
      _note: note,
      _isGlossary: true
    });
  }
  return rules;
}

function checkParagraph(text, paragraphIndex) {
  var issues = [];
  var allRules = [].concat(
    buildGlossaryRules_(),
    FORMATTING_RULES,
    MATH_RULES
  );

  for (var r = 0; r < allRules.length; r++) {
    var rule = allRules[r];
    var pattern = rule.pattern;

    if (pattern.global) {
      pattern.lastIndex = 0;
    }

    var match;
    if (pattern.global) {
      while ((match = pattern.exec(text)) !== null) {
        if (rule.test && !rule.test(match)) continue;
        var issue = buildIssue_(rule, match, paragraphIndex);
        if (issue) issues.push(issue);
      }
    } else {
      match = pattern.exec(text);
      if (match) {
        if (!rule.test || rule.test(match)) {
          var issue = buildIssue_(rule, match, paragraphIndex);
          if (issue) issues.push(issue);
        }
      }
    }
  }

  return issues;
}

function buildIssue_(rule, match, paragraphIndex) {
  var suggestion = null;
  if (typeof rule.suggestion === 'function') {
    suggestion = rule.suggestion(match);
  } else if (typeof rule.suggestion === 'string') {
    suggestion = rule.suggestion;
  }

  // Skip if matched text already equals the suggestion (case-sensitive)
  if (suggestion && match[0] === suggestion) return null;

  // Build message dynamically for glossary rules (uses actual matched text)
  var message = rule.message;
  if (rule._isGlossary) {
    if (suggestion) {
      message = 'Use "' + suggestion + '" instead of "' + match[0] + '".';
    } else {
      message = 'Check usage of "' + match[0] + '".';
    }
    if (rule._note) message += ' ' + rule._note;
  }

  return {
    ruleId: rule.id,
    severity: rule.severity,
    category: rule.category,
    message: message,
    suggestion: suggestion,
    paragraphIndex: paragraphIndex,
    matchStart: match.index,
    matchEnd: match.index + match[0].length,
    original: match[0]
  };
}
