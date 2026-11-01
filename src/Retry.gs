/** UrlFetch 等の再試行（line 部品用。他部品と関数名を共有しない）。 */
function lineWithRetry_(fn, opts) {
  opts = opts || {};
  var max = opts.maxAttempts || 4;
  var base = opts.baseMs || 500;
  var lastErr;
  for (var attempt = 1; attempt <= max; attempt++) {
    try {
      return fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= max || !err || err.retryable !== true) throw err;
      Utilities.sleep(base * Math.pow(2, attempt - 1));
    }
  }
  throw lastErr;
}

function lineHttpShouldRetry_(code) {
  return code === 429 || (code >= 500 && code <= 599);
}

if (typeof module !== 'undefined') {
  module.exports = { lineWithRetry_: lineWithRetry_, lineHttpShouldRetry_: lineHttpShouldRetry_ };
}
