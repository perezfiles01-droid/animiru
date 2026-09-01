/**
 * Explaining why a source failed.
 *
 * A scraper breaks constantly and for dull reasons: a site changed a class
 * name, started returning an error page, rate-limited the server, moved a
 * field. The raw message for all of those is something like "Cannot read
 * properties of null", which says nothing about which selector stopped
 * matching or what to do next.
 *
 * So a failure is reported as: where it happened, in the source's own code
 * with the line quoted; what it most likely means, in words; what to try;
 * and every HTTP request the source made along the way. The request trace
 * is often the whole answer - a 403 two lines above a null selector means
 * the site blocked the fetch, not that the markup moved.
 */

/** Where the sandbox compiles extension source, as it appears in a stack. */
const EXTENSION_FRAME = /animiru:extension:(\d+):(\d+)/;

const CONTEXT_LINES = 3;

/**
 * Patterns that turn a raw message into something actionable.
 *
 * Ordered: the first match wins, so the specific ones come before the
 * general ones.
 */
const CAUSES = [
  {
    match: /does not define a DefaultExtension class/,
    cause: () => 'The file loaded but declares no DefaultExtension class.',
    fix: 'A source must declare `class DefaultExtension extends MProvider`. '
      + 'If the file is minified or wrapped in a module format, the class is '
      + 'not visible at the top level.'
  },
  {
    match: /Extension failed to load/,
    cause: () => 'The file could not be parsed as JavaScript.',
    fix: 'A syntax error, or a file that is not a source at all - a 404 page '
      + 'served where the .js was expected is the usual culprit.'
  }
,
  // Ahead of the generic URL rule: "undefined/..." names its own cause, and
  // reporting it as a bad URL sends the reader looking at the wrong thing.
  {
    match: /Invalid URL: (?:undefined|null)(\/\S*)?/,
    cause: (m) => 'The source built a request against a base URL that was not set'
      + `, so it asked for "${m[0].replace('Invalid URL: ', '')}".`,
    fix: 'this.source.baseUrl was undefined. The source reads it from the '
      + 'entry the repository declares, so check that the index.json entry '
      + 'for this source has a baseUrl - and that the source is not '
      + 'overwriting this.source in its own constructor.'
  },
  {
    match: /Invalid URL: (\S+)/,
    cause: (m) => `The source asked for "${m[1]}", which is not a usable URL.`,
    fix: 'Usually a path joined onto the wrong thing, a missing scheme, or a '
      + 'value read from the page that was empty. The trace below shows what '
      + 'was asked for immediately before.'
  },
  {
    match: /Invalid URL/,
    cause: () => 'The source built a request URL the app could not parse.',
    fix: 'Check where the URL is assembled - a missing base, a missing '
      + 'scheme, or an empty value read from the page.'
  },
  {
    match: /Cannot read properties of (?:null|undefined) \(reading '([^']+)'\)/,
    cause: (m) => `A selector matched nothing, and the code then read .${m[1]} from it.`,
    fix: 'selectFirst() returns null when nothing matches. Check the selector on '
      + 'the line below against the site\'s current markup, and guard it '
      + '(`const el = doc.selectFirst(...); if (!el) return ...`).'
  },
  {
    match: /(\w+)\.(\w+) is not a function|(\w+) is not a function/,
    cause: () => 'Something was called that is not a function.',
    fix: 'On a DOM node only select, selectFirst and attr are methods. text, '
      + 'innerHtml, getHref, getSrc, id and className are properties - '
      + 'writing .text() returns a function rather than the text.'
  },
  {
    match: /(\w+) is not defined/,
    cause: (m) => `The source used \`${m[1]}\`, which does not exist in the sandbox.`,
    fix: 'Sources run in a bare JavaScript realm: no fetch, no '
      + 'URLSearchParams, no require, no window. HTTP is `new Client()`, '
      + 'settings are `new SharedPreferences()`. See extensions/README.md '
      + 'for the full list of what is available.'
  },
  {
    match: /Code generation from strings disallowed/,
    cause: () => 'The source tried to use eval() or new Function().',
    fix: 'Code generation is disabled deliberately - it is part of what keeps '
      + 'a source contained. For a packed script use unpackJs(), and for an '
      + 'encrypted payload use cryptoHandler() or decryptAESCryptoJS().'
  },
  // Ahead of the JSON rule: bot protection usually answers with an HTML
  // challenge, so without this the block is reported as a parsing problem
  // and the reader goes looking at the source instead of the network.
  {
    match: /bot protection|Cloudflare|browser check|DDoS-Guard/i,
    cause: () => "The site's bot protection refused the request.",
    fix: 'Extensions run on the Animiru server, not on your device, so the '
      + 'site sees a request from a hosting provider rather than from a '
      + 'phone or a laptop - which is what this protection exists to block. '
      + 'Opening the site in your own browser does not help, because your '
      + 'browser is not what made the request. Sources on sites that do not '
      + 'screen their traffic this way are unaffected.'
  },
  {
    match: /responded (403|503)\b/,
    cause: (m) => `The site refused the request with ${m[1]}.`,
    fix: 'A 403 or 503 arriving quickly, with no page behind it, is a site '
      + 'refusing the server rather than a source asking for the wrong '
      + 'thing. Extensions run on the Animiru server, so the request comes '
      + 'from a hosting provider, which sites with bot protection block on '
      + 'sight. If the same URL opens in your browser, that is the cause.'
  },
  {
    match: /is not valid JSON|Unexpected token/,
    cause: () => 'The site returned something that is not JSON, where JSON was expected.',
    fix: 'Look at the request trace below. An HTML body usually means an '
      + 'error page, a rate limit, a consent wall, or a URL that has moved.'
  },
  // Ahead of the run-budget rule: this is one request giving up, not the
  // whole run, and the two want different advice. axios words it "timeout
  // of 14955ms exceeded", which matched nothing at all before - so a site
  // that simply answered slowly was reported as an error the app does not
  // recognise, which tells the reader nothing.
  {
    match: /timeout of (\d+)ms exceeded|\bETIMEDOUT\b/,
    cause: (m) => (m[1]
      ? `A request to the site got no answer within ${m[1]}ms.`
      : 'A request to the site got no answer before it gave up.'),
    fix: 'The site is slow or not answering right now, rather than the source '
      + 'asking for the wrong thing. Each request is retried once before it '
      + 'is reported, so this means both attempts ran out of time. The trace '
      + 'below names the request that stalled; trying again later usually '
      + 'works if the site itself is up.'
  },
  {
    match: /\bECONNRESET\b|socket hang up/,
    cause: () => 'The site closed the connection part way through the request.',
    fix: 'Usually the site dropping a request it did not like, or an unstable '
      + 'hop between the server and the site. It is retried once before '
      + 'being reported, so a persistent one means the site is refusing this '
      + 'server at the connection level rather than with a status code.'
  },
  {
    // Stopping at the colon: http.js writes "Could not resolve host: why",
    // and a greedy match names the host with the punctuation attached.
    match: /\b(?:ENOTFOUND|EAI_AGAIN)\b|Could not resolve ([^\s:]+)/,
    cause: (m) => (m[1]
      ? `The address "${m[1]}" does not resolve.`
      : 'The site\'s address does not resolve.'),
    fix: 'The domain is wrong, has moved, or has expired - sources outlive '
      + 'the sites they scrape. Check the baseUrl the source declares '
      + 'against where the site actually lives now.'
  },
  {
    match: /\bECONNREFUSED\b/,
    cause: () => 'Nothing accepted the connection at that address.',
    fix: 'The host resolves but is not serving on that port. Usually a URL '
      + 'built with the wrong scheme or port, or a site that is down.'
  },
  {
    match: /certificate|\bERR_TLS|\bEPROTO\b|\bDEPTH_ZERO_SELF_SIGNED/i,
    cause: () => 'The site\'s TLS certificate could not be verified.',
    fix: 'An expired or misconfigured certificate on the site. This is not '
      + 'something the source can work around, and it is not bypassed here.'
  },
  {
    match: /timed out after (\d+)ms/,
    cause: (m) => `The source ran longer than ${m[1]}ms and was stopped.`,
    fix: 'Usually a site that stopped responding, or too many requests in one '
      + 'call. The trace below shows which request was last.'
  },
  {
    match: /Refusing to fetch a private address/,
    cause: () => 'The source tried to reach an address on the server\'s own network.',
    fix: 'Only public addresses are allowed. If the source is following a '
      + 'redirect, the site may be redirecting to localhost.'
  },
  {
    match: /exceeded (\d+) requests/,
    cause: (m) => `The source made more than ${m[1]} requests in a single call.`,
    fix: 'Usually a loop that does not end - a pagination check that never '
      + 'becomes false, or a redirect chase.'
  }
];

/**
 * Finds the line in the extension's own code where a failure happened.
 *
 * Frames from the runtime and the driver are skipped: they are ours, and
 * pointing at them would send an author looking in the wrong file.
 */
function locate(stack) {
  if (!stack) return null;

  for (const line of String(stack).split('\n')) {
    const match = line.match(EXTENSION_FRAME);
    if (match) {
      return {
        line: Number(match[1]),
        column: Number(match[2]),
        // "at DefaultExtension.getPopular (animiru:extension:12:20)"
        where: (line.match(/at\s+([^(]+?)\s*\(/) || [])[1] || null
      };
    }
  }
  return null;
}

/** The failing line and a little either side, numbered as the file is. */
function excerpt(code, lineNumber) {
  if (!code || !lineNumber) return null;

  const lines = String(code).split('\n');
  const from = Math.max(1, lineNumber - CONTEXT_LINES);
  const to = Math.min(lines.length, lineNumber + CONTEXT_LINES);

  const out = [];
  for (let n = from; n <= to; n += 1) {
    out.push({ number: n, text: lines[n - 1], failing: n === lineNumber });
  }
  return out;
}

function explain(message) {
  for (const candidate of CAUSES) {
    const match = String(message || '').match(candidate.match);
    if (match) {
      return { cause: candidate.cause(match), fix: candidate.fix };
    }
  }
  return {
    cause: 'The source failed with an error the app does not recognise.',
    fix: 'The request trace and console output below are the place to start: '
      + 'they show what the source asked for and what it got.'
  };
}

/**
 * Builds the report shown when a source fails.
 *
 * @param {Object} options
 * @param {string} options.message
 * @param {string} [options.stack] the vm stack, for the failing line
 * @param {string} [options.code] the source, to quote that line from
 * @param {Array}  [options.requests] the HTTP trace
 * @param {Array}  [options.logs] captured console output
 * @param {Object} [options.source] the source's index entry
 * @param {string} [options.method] the method that was called
 */
function buildDiagnostics({ message, stack, code, requests = [], logs = [], source = {}, method } = {}) {
  const location = locate(stack);
  const { cause, fix } = explain(message);

  const failed = requests.filter((request) => (
    request.error || (request.status && (request.status < 200 || request.status >= 300))
  ));

  return {
    message: String(message || 'Unknown error'),
    method: method || null,
    source: {
      name: source.name || null,
      version: source.version || null,
      repoUrl: source.repoUrl || null,
      codeUrl: source.codeUrl || null
    },
    cause,
    fix,
    location,
    excerpt: location ? excerpt(code, location.line) : null,
    requests,
    // Called out because a failed request two lines above a null selector is
    // usually the real cause, and it is easy to miss in a long trace.
    failedRequests: failed,
    logs
  };
}

module.exports = { buildDiagnostics, locate, excerpt, explain, CAUSES };
