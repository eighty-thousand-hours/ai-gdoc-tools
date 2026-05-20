/**
 * 80,000 Hours editorial checker — deterministic rule engine
 *
 * Rules derived from the 80,000 Hours Style Guide.
 */

// ---------------------------------------------------------------------------
// Glossary: spelling and terminology
// ---------------------------------------------------------------------------

var GLOSSARY_RULES = [

  // -------------------------------------------------------------------------
  // British English: -ise / -isation forms (American -ize → British -ise)
  // -------------------------------------------------------------------------
  ['organize', 'organise', null],
  ['organizes', 'organises', null],
  ['organized', 'organised', null],
  ['organizing', 'organising', null],
  ['organization', 'organisation', null],
  ['organizations', 'organisations', null],
  ['recognize', 'recognise', null],
  ['recognizes', 'recognises', null],
  ['recognized', 'recognised', null],
  ['recognizing', 'recognising', null],
  ['recognizable', 'recognisable', null],
  ['analyze', 'analyse', null],
  ['analyzed', 'analysed', null],
  ['analyzing', 'analysing', null],
  ['specialize', 'specialise', null],
  ['specialized', 'specialised', null],
  ['specializes', 'specialises', null],
  ['emphasize', 'emphasise', null],
  ['emphasizes', 'emphasises', null],
  ['emphasized', 'emphasised', null],
  ['prioritize', 'prioritise', null],
  ['prioritized', 'prioritised', null],
  ['prioritizes', 'prioritises', null],
  ['maximize', 'maximise', null],
  ['maximizes', 'maximises', null],
  ['maximized', 'maximised', null],
  ['minimize', 'minimise', null],
  ['minimizes', 'minimises', null],
  ['minimized', 'minimised', null],
  ['rationalize', 'rationalise', null],
  ['rationalized', 'rationalised', null],
  ['utilize', 'utilise', null],
  ['utilizes', 'utilises', null],
  ['utilized', 'utilised', null],
  ['civilization', 'civilisation', null],
  ['civilizations', 'civilisations', null],
  ['centralize', 'centralise', null],
  ['decentralize', 'decentralise', null],
  ['decentralized', 'decentralised', null],
  ['standardize', 'standardise', null],
  ['standardized', 'standardised', null],
  ['categorize', 'categorise', null],
  ['categorized', 'categorised', null],

  // -------------------------------------------------------------------------
  // British English: -our forms
  // -------------------------------------------------------------------------
  ['\\bcolor\\b', 'colour', null],
  ['\\bcolors\\b', 'colours', null],
  ['\\bcolored\\b', 'coloured', null],
  ['\\bcolorful\\b', 'colourful', null],
  ['\\bbehavior\\b', 'behaviour', null],
  ['\\bbehaviors\\b', 'behaviours', null],
  ['\\bbehavioral\\b', 'behavioural', null],
  ['\\bneighbor\\b', 'neighbour', null],
  ['\\bneighbors\\b', 'neighbours', null],
  ['\\bneighborhood\\b', 'neighbourhood', null],
  ['\\bfavor\\b', 'favour', null],
  ['\\bfavors\\b', 'favours', null],
  ['\\bfavorite\\b', 'favourite', null],
  ['\\bfavorably\\b', 'favourably', null],
  ['\\bhonor\\b', 'honour', null],
  ['\\bhonors\\b', 'honours', null],
  ['\\bhumor\\b', 'humour', null],
  ['\\blabor\\b', 'labour', null],
  ['\\brumor\\b', 'rumour', null],
  ['\\bvapor\\b', 'vapour', null],

  // -------------------------------------------------------------------------
  // British English: -re forms
  // -------------------------------------------------------------------------
  ['\\bcenter\\b', 'centre', 'Use "centre" unless part of an organisation name'],
  ['\\bcenters\\b', 'centres', null],
  ['\\bfiber\\b', 'fibre', null],
  ['\\bfibers\\b', 'fibres', null],

  // -------------------------------------------------------------------------
  // British English: -ense forms
  // -------------------------------------------------------------------------
  ['\\bdefense\\b', 'defence', 'Use "defence" unless part of a proper name like "Department of Defense"'],
  ['\\boffense\\b', 'offence', null],

  // -------------------------------------------------------------------------
  // British English: double-L forms
  // -------------------------------------------------------------------------
  ['\\benroll\\b', 'enrol', null],
  ['\\bfulfill\\b', 'fulfil', null],
  ['\\bfulfills\\b', 'fulfils', null],
  ['\\bfulfillment\\b', 'fulfilment', null],
  ['\\bskillful\\b', 'skilful', null],

  // -------------------------------------------------------------------------
  // 80k preferred word choices (from style guide)
  // -------------------------------------------------------------------------
  ['alright', 'all right', 'Always two words'],
  ['\\bokay\\b', 'OK', null],
  ['\\bamongst\\b', 'among', 'The 80k style guide prefers "among"'],
  ['\\btoward\\b', 'towards', 'The 80k style guide prefers "towards"'],
  ['\\bwhilst\\b', 'while', 'The 80k style guide prefers "while"'],
  ['data are', 'data is', 'The 80k style guide treats "data" as singular'],
  ['in regards to', 'with regard to', null],
  ['in regard to', 'with regard to', null],
  ['with regards to', 'with regard to', null],
  ['\\bmanpower\\b', 'personpower', null],
  ['\\bbiassed\\b', 'biased', null],

  // -------------------------------------------------------------------------
  // COVID-19
  // -------------------------------------------------------------------------
  ['Covid-19', 'COVID-19', null],
  ['covid-19', 'COVID-19', null],
  ['Covid19', 'COVID-19', null],
  ['covid19', 'COVID-19', null],

  // -------------------------------------------------------------------------
  // Living word list: one word (no hyphen, no space)
  // -------------------------------------------------------------------------
  ['well-being', 'wellbeing', 'One word per 80k style guide'],
  ['non-profit', 'nonprofit', 'One word per 80k style guide'],
  ['write-up', 'writeup', 'One word (noun) per 80k style guide'],
  ['trade-off', 'tradeoff', 'One word (noun) per 80k style guide'],
  ['start-up', 'startup', 'One word (noun) per 80k style guide'],
  ['long-termist', 'longtermist', 'One word per 80k style guide'],
  ['near-termist', 'neartermist', 'One word per 80k style guide'],
  ['co-author', 'coauthor', 'One word per 80k style guide'],
  ['co-founder', 'cofounder', 'One word per 80k style guide'],
  ['e-book', 'ebook', 'One word per 80k style guide'],
  ['mega-project', 'megaproject', 'One word per 80k style guide'],
  ['pre-existing', 'preexisting', 'One word per 80k style guide'],
  ['pre-training', 'pretraining', 'One word per 80k style guide'],
  ['hyper-efficient', 'hyperefficient', 'One word per 80k style guide'],
  ['under-represented', 'underrepresented', 'One word per 80k style guide'],
  ['anti-war', 'antiwar', 'One word per 80k style guide'],
  ['post-war', 'postwar', 'One word per 80k style guide'],
  ['post-apocalyptic', 'post-apocalyptic', null],  // Already hyphenated — listed for completeness

  // -------------------------------------------------------------------------
  // Living word list: two words (not one, not hyphenated as noun)
  // -------------------------------------------------------------------------
  ['\\bdataset\\b', 'data set', 'Two words per 80k style guide'],
  ['\\bwebpage\\b', 'web page', 'Two words per 80k style guide'],
  ['\\bskillset\\b', 'skill set', 'Two words per 80k style guide'],
  ['\\bbednet\\b', 'bed net', 'Two words per 80k style guide'],
  ['decision-maker', 'decision maker', 'Two words (noun) per 80k style guide'],
  ['decision-makers', 'decision makers', 'Two words (noun) per 80k style guide'],
  ['policy maker', 'policymaker', 'One word per 80k style guide'],
  ['policy-maker', 'policymaker', 'One word per 80k style guide'],
  ['policy makers', 'policymakers', 'One word per 80k style guide'],
  ['policy-makers', 'policymakers', 'One word per 80k style guide'],
  ['X-risk', 'x-risk', 'Lowercase x per 80k style guide'],

  // -------------------------------------------------------------------------
  // Abbreviation formatting (no periods per style guide)
  // -------------------------------------------------------------------------
  ['A\\.I\\.', 'AI', 'No periods in abbreviations'],
  ['U\\.S\\.', 'US', 'No periods (exception: Washington, D.C.)'],
  ['U\\.K\\.', 'UK', 'No periods'],
  ['E\\.U\\.', 'EU', 'No periods'],
  ['Ph\\.D\\.?', 'PhD', 'No periods in academic degrees'],
  ['M\\.B\\.A\\.?', 'MBA', 'No periods in academic degrees'],
  ['B\\.A\\.', 'BA', 'No periods in academic degrees'],
  ['M\\.A\\.', 'MA', 'No periods in academic degrees'],
  ['e-mail', 'email', 'No hyphen'],
  ['\\bvs\\.', 'vs', '"vs" without a period; write "versus" in running text'],

  // -------------------------------------------------------------------------
  // Filler phrases
  // -------------------------------------------------------------------------
  ['it is worth noting that', null, 'Filler — cut or rephrase'],
  ['it should be noted that', null, 'Filler — cut or rephrase'],
  ['it is important to note that', null, 'Filler — cut or rephrase'],
  ['in order to', 'to', 'Simplify'],
  ['due to the fact that', 'because', 'Simplify'],
  ['needless to say', null, 'If needless to say, don\'t say it'],
  ['at the end of the day', null, 'Cliché — rephrase'],
  ['whether or not', 'whether', '"or not" is usually superfluous'],
  ['click here', null, 'Avoid — integrate links naturally into anchor text'],
  ['begs the question', 'raises the question', 'Almost always a misuse of "begs the question"'],

  // -------------------------------------------------------------------------
  // EA jargon — flag for general-audience writing
  // -------------------------------------------------------------------------
  ['\\bcounterfactual\\b', null, 'EA jargon — consider "what would have happened otherwise" for general audiences'],
  ['\\bepistemic\\b', null, 'EA jargon — consider rephrasing for general audiences'],
  ['\\bheuristic\\b', null, 'EA jargon — consider "rule of thumb"'],
  ['\\bsteelman\\b', null, 'EA jargon — consider "the best defence of that view is…"'],
  ['on priors', null, 'EA jargon — consider "based on my background knowledge" for general audiences'],
  ['an order of magnitude', null, 'EA jargon — consider "10 times" for general audiences (if that\'s what you mean)'],
  ['\\bsignalling\\b', null, 'EA jargon — consider "showing" or "showing off"'],
  ['\\bsignaling\\b', null, 'EA jargon — consider "showing" or "showing off"'],

  // -------------------------------------------------------------------------
  // EA preferred terminology
  // -------------------------------------------------------------------------
  ['effective altruists', 'members of the effective altruism community', null],
  ['clean meat', 'cell-cultured meat', 'Preferred term per 80k style guide'],
  ['cultivated meat', 'cell-cultured meat', 'Preferred term per 80k style guide'],
  ['lab-grown meat', 'cell-cultured meat', 'Preferred term per 80k style guide'],
  ['cell-based meat', 'cell-cultured meat', 'Preferred term per 80k style guide'],
  ['\\brich countries\\b', 'high-income countries', 'Preferred term per 80k style guide'],
  ['\\bdeveloped countries\\b', 'high-income countries', 'Preferred term per 80k style guide'],
  ['\\bfar future\\b', 'long-term future', 'Preferred term per 80k style guide'],
  ['space colonisation', 'space settlement', 'Preferred term per 80k style guide'],
  ['space colonization', 'space settlement', 'Preferred term per 80k style guide'],
  ['make the world a better place', null, 'Avoid — use "do good", "have a big impact", or "create social impact"'],
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
    pattern: /(?<!\d)(\.\d+%)/g,
    message: 'Add a leading zero before decimal points (e.g. "0.4%" not ".4%").',
    suggestion: function(match) { return '0' + match[1]; },
    severity: 'warning',
    category: 'formatting'
  },
  {
    id: 'fmt-decade-apostrophe',
    pattern: /\b(1[7-9]\d\d|20\d\d)'s\b/g,
    message: 'Decades should be written without an apostrophe: "1990s" not "1990\'s". (Ignore if this is a possessive.)',
    suggestion: function(match) { return match[1] + 's'; },
    severity: 'info',
    category: 'formatting',
    test: function(match, ctx) {
      var before = ctx.text.substring(Math.max(0, match.index - 10), match.index).toLowerCase();
      var after = ctx.text.substring(match.index + match[0].length, match.index + match[0].length + 20).toLowerCase();
      if (/\b(the|in|during|throughout|by|since|of the)\s*$/.test(before)) return true;
      if (/^\s+[a-z]/.test(after)) return false;
      return true;
    }
  },
  {
    id: 'fmt-decade-short',
    pattern: /\bthe\s+(\d{2})s\b/g,
    message: 'Include the century when referring to decades: "the 1990s" not "the 90s".',
    suggestion: null,
    severity: 'info',
    category: 'formatting'
  },
  {
    id: 'fmt-ellipsis-dots',
    pattern: /\.\.\./g,
    message: 'Use the ellipsis character "…" instead of three periods.',
    suggestion: '…',
    severity: 'warning',
    category: 'formatting'
  },
  {
    id: 'fmt-double-space',
    pattern: /(\S)( {2,})(\S)/g,
    message: 'Double space detected. Use a single space.',
    suggestion: function(match) { return match[1] + ' ' + match[3]; },
    severity: 'error',
    category: 'formatting'
  },
  {
    id: 'fmt-exclamation',
    pattern: /!(?![\])])/g,
    message: 'Use exclamation points sparingly — when in doubt, use a period instead.',
    suggestion: '.',
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
    pattern: /(\d)\s+%/g,
    message: 'No space before "%". Write "48%" not "48 %".',
    suggestion: function(match) { return match[1] + '%'; },
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
    id: 'fmt-am-pm-format',
    pattern: /\b(\d{1,2}(?::\d{2})?)\s*(a\.m\.|p\.m\.|A\.M\.|P\.M\.|am|pm)\b/g,
    message: 'Use "AM" or "PM" (uppercase, with a space): "7:00 AM" or "7:30 PM".',
    suggestion: function(match) {
      var suffix = match[2].toLowerCase().replace(/[. ]/g, '');
      return match[1] + ' ' + (suffix === 'am' ? 'AM' : 'PM');
    },
    severity: 'warning',
    category: 'formatting'
  },
  {
    id: 'fmt-am-pm-no-space',
    pattern: /\b(\d{1,2}(?::\d{2})?)(AM|PM)\b/g,
    message: 'Add a space before "AM"/"PM": "7:00 AM" not "7:00AM".',
    suggestion: function(match) { return match[1] + ' ' + match[2]; },
    severity: 'warning',
    category: 'formatting'
  },
  {
    id: 'fmt-figure-lowercase',
    pattern: /\b(figure|table|section|chapter|appendix)\s+(\d+)/gi,
    message: 'Capitalise when numbered: "Figure 3", "Table 1", "Section 2".',
    suggestion: function(match) {
      return match[1].charAt(0).toUpperCase() + match[1].slice(1) + ' ' + match[2];
    },
    severity: 'warning',
    category: 'formatting',
    test: function(match) {
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
    id: 'fmt-ampersand',
    pattern: /\s&\s/g,
    message: 'Avoid ampersands in running text — write "and" instead (exception: brand names like "Ben & Jerry\'s").',
    suggestion: ' and ',
    severity: 'info',
    category: 'formatting'
  },
  {
    id: 'fmt-eg-ie-comma',
    pattern: /(e\.g\.|i\.e\.),/gi,
    message: 'Remove the comma after "e.g." or "i.e." — the 80k style guide uses no comma here.',
    suggestion: function(match) { return match[1]; },
    severity: 'warning',
    category: 'formatting'
  },
  {
    id: 'fmt-em-dash-no-spaces',
    pattern: /\S—\S/g,
    message: 'Add a space on each side of em dashes: "word — word".',
    suggestion: null,
    severity: 'info',
    category: 'formatting'
  },
  {
    id: 'fmt-ea-capitalization',
    // Case-sensitive: only flags "Effective Altruism" mid-sentence, not the correct lowercase form
    pattern: /(?<!\. |\? |! |\n)Effective Altruism(?! is a proper)/g,
    message: 'Use lowercase "effective altruism" unless at the start of a sentence.',
    suggestion: 'effective altruism',
    severity: 'info',
    category: 'formatting',
    test: function(match, ctx) {
      return match.index > 0;
    }
  },
  {
    id: 'fmt-80k-brand',
    pattern: /\b80[Kk]\b/g,
    message: 'In external-facing content, use "80,000 Hours" rather than "80K".',
    suggestion: '80,000 Hours',
    severity: 'info',
    category: 'formatting'
  },
  {
    id: 'fmt-oxford-comma-check',
    // Flag "X, Y and Z" (list of three without Oxford comma before "and")
    pattern: /(\w[\w\s]+),\s+(\w[\w\s]+)\s+and\s+(\w)/g,
    message: 'Check for Oxford comma: "X, Y, and Z" not "X, Y and Z".',
    suggestion: null,
    severity: 'info',
    category: 'formatting',
    test: function(match) {
      // Only flag if the structure looks like a list item (not a compound sentence)
      var part1 = match[1].split(' ').length;
      var part2 = match[2].split(' ').length;
      return part1 <= 4 && part2 <= 4;
    }
  }
];

// ---------------------------------------------------------------------------
// Math and number rules
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
    pattern: /(\d)×(\d)/g,
    message: 'Add spaces around ×: "3 × 10" not "3×10".',
    suggestion: function(match) { return match[1] + ' × ' + match[2]; },
    severity: 'warning',
    category: 'math'
  },
  {
    id: 'math-multiplier-letter-x',
    pattern: /\b(\d+)\s*x\s+(higher|lower|faster|slower|more|less|greater|larger|smaller|bigger|increase|decrease|improvement|times)\b/gi,
    message: 'Use "×" (multiplication sign) for multipliers: "4× higher" not "4x higher".',
    suggestion: function(match) { return match[1] + '× ' + match[2]; },
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
    message: 'Use an en dash (–) for ranges, not a hyphen: "10–14 days".',
    suggestion: function(match) { return match[1] + '–' + match[2]; },
    severity: 'warning',
    category: 'math',
    test: function(match) {
      var n1 = parseInt(match[1]);
      if (n1 >= 1900 && n1 <= 2100) return false;
      return true;
    }
  },
  {
    id: 'math-gt-lt-symbols',
    pattern: /(?<!\w)[<>]\s*\d/g,
    message: 'Avoid < and > symbols in running text — write out "greater than", "less than", "more than", "fewer than".',
    severity: 'warning',
    category: 'math'
  },
  {
    id: 'math-caret-notation',
    pattern: /\b(\d+)\^(\d+)\b/g,
    message: 'Use proper superscript notation instead of caret (^). In Google Docs: Format → Text → Superscript.',
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

    var prefix = '\\b';
    var suffix = '\\b';
    if (/^\\b/.test(wrong) || /^\\[^a-zA-Z0-9]/.test(wrong)) {
      prefix = '';
    }
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
      message: null,
      suggestion: correct || null,
      _note: note,
      _isGlossary: true
    });
  }
  return rules;
}

/**
 * Walk the paragraph's ancestor chain to decide whether it lives inside a
 * table cell.
 */
function isParagraphInTable_(paragraph) {
  if (!paragraph) return false;
  try {
    var el = paragraph.getParent && paragraph.getParent();
    while (el) {
      var type = el.getType && el.getType();
      if (type === DocumentApp.ElementType.TABLE_CELL ||
          type === DocumentApp.ElementType.TABLE) {
        return true;
      }
      if (!el.getParent) return false;
      el = el.getParent();
    }
  } catch (e) {
    return false;
  }
  return false;
}

function checkParagraph(text, paragraphIndex, paragraph) {
  var issues = [];
  var allRules = [].concat(
    buildGlossaryRules_(),
    FORMATTING_RULES,
    MATH_RULES
  );

  var ctx = {
    paragraph: paragraph,
    paragraphIndex: paragraphIndex,
    text: text,
    inTable: isParagraphInTable_(paragraph)
  };

  for (var r = 0; r < allRules.length; r++) {
    var rule = allRules[r];
    var pattern = rule.pattern;

    if (rule.skipInTable && ctx.inTable) continue;

    if (pattern.global) {
      pattern.lastIndex = 0;
    }

    var match;
    if (pattern.global) {
      while ((match = pattern.exec(text)) !== null) {
        if (rule.test && !rule.test(match, ctx)) continue;
        var issue = buildIssue_(rule, match, paragraphIndex);
        if (issue) issues.push(issue);
      }
    } else {
      match = pattern.exec(text);
      if (match) {
        if (!rule.test || rule.test(match, ctx)) {
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

  if (suggestion && match[0] === suggestion) return null;

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
