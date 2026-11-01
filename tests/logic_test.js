const assert = require('assert');
const fs = require('fs');
const path = require('path');

const props = {
  LINE_CHANNEL_ACCESS_TOKEN: 'token_demo',
  LINE_PUSH_TO_USER_ID: 'Udemo0001'
};

const mod = { exports: {} };
new Function(
  'module',
  'exports',
  'PropertiesService',
  'UrlFetchApp',
  'Utilities',
  fs.readFileSync(path.join(__dirname, '..', 'src', 'Retry.gs'), 'utf8') + '\n' +
  fs.readFileSync(path.join(__dirname, '..', 'src', 'LinePush.gs'), 'utf8') + '\n' +
  'module.exports = { buildLineTextMessage_: buildLineTextMessage_, validateLinePushTexts_: validateLinePushTexts_, pushLineMessage: pushLineMessage, testRunPushSample: testRunPushSample, setLineFetchImpl_: setLineFetchImpl_, lineWithRetry_: lineWithRetry_, lineHttpShouldRetry_: lineHttpShouldRetry_, LINE_PUSH_URL: LINE_PUSH_URL, LINE_MAX_MESSAGES: LINE_MAX_MESSAGES, LINE_MAX_TEXT_LENGTH: LINE_MAX_TEXT_LENGTH, LINE_PROP_DRY_RUN: LINE_PROP_DRY_RUN };'
)(
  mod,
  mod.exports,
  {
    getScriptProperties: function () {
      return { getProperty: function (k) { return props[k] || null; } };
    }
  },
  {},
  { sleep: function () {} }
);
const lineMod = mod.exports;

function parseCsv(file) {
  const text = fs.readFileSync(file, 'utf8').trim();
  const lines = text.split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).map(function (line) {
    const cells = line.split(',');
    const row = {};
    header.forEach(function (h, i) { row[h] = cells[i]; });
    return row;
  });
}

let pass = 0;
function t(name, fn) {
  fn();
  pass++;
  console.log('ok', name);
}

t('buildLineTextMessage', () => {
  assert.deepStrictEqual(lineMod.buildLineTextMessage_('hello'), { type: 'text', text: 'hello' });
  assert.throws(() => lineMod.buildLineTextMessage_('  '), /空/);
  const long = 'x'.repeat(lineMod.LINE_MAX_TEXT_LENGTH + 1);
  assert.throws(() => lineMod.buildLineTextMessage_(long), /5000/);
});

t('validateLinePushTexts count', () => {
  lineMod.validateLinePushTexts_(['a', 'b', 'c', 'd', 'e']);
  assert.throws(() => lineMod.validateLinePushTexts_(['1', '2', '3', '4', '5', '6']), /5 件/);
  assert.throws(() => lineMod.validateLinePushTexts_([]), /0件/);
});

t('validateLinePushTexts length', () => {
  const ok = 'y'.repeat(lineMod.LINE_MAX_TEXT_LENGTH);
  lineMod.validateLinePushTexts_([ok]);
  const bad = 'z'.repeat(lineMod.LINE_MAX_TEXT_LENGTH + 1);
  assert.throws(() => lineMod.validateLinePushTexts_([bad]), /5000/);
});

t('pushLineMessage posts expected payload', () => {
  const calls = [];
  lineMod.setLineFetchImpl_(function (url, opt) {
    calls.push({ url: url, payload: opt.payload, auth: opt.headers.Authorization });
    return { getResponseCode: function () { return 200; }, getContentText: function () { return '{}'; } };
  });
  const res = lineMod.pushLineMessage('架空の通知本文');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, lineMod.LINE_PUSH_URL);
  assert.strictEqual(calls[0].auth, 'Bearer token_demo');
  const body = JSON.parse(calls[0].payload);
  assert.strictEqual(body.to, 'Udemo0001');
  assert.strictEqual(body.messages.length, 1);
  assert.strictEqual(body.messages[0].text, '架空の通知本文');
});

t('pushLineMessage rejects sixth message before HTTP', () => {
  lineMod.setLineFetchImpl_(function () {
    throw new Error('fetch must not run');
  });
  const six = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
  assert.throws(() => lineMod.pushLineMessage(six), /5 件/);
});

t('sample_data push_queue.csv pushes each row as one message', () => {
  const rows = parseCsv(path.join(__dirname, '..', 'sample_data', 'push_queue.csv'));
  assert.strictEqual(rows.length, 3);
  const calls = [];
  lineMod.setLineFetchImpl_(function (url, opt) {
    calls.push(JSON.parse(opt.payload));
    return { getResponseCode: function () { return 200; }, getContentText: function () { return '{}'; } };
  });
  rows.forEach(function (row) {
    const res = lineMod.pushLineMessage(row.text);
    assert.strictEqual(res.statusCode, 200);
  });
  assert.strictEqual(calls.length, rows.length);
  calls.forEach(function (body, i) {
    assert.strictEqual(body.messages.length, 1);
    assert.strictEqual(body.messages[0].text, rows[i].text);
  });
});

t('lineWithRetry_ retries only errors marked retryable', () => {
  let calls = 0;
  const res = lineMod.lineWithRetry_(function () {
    calls++;
    if (calls < 2) {
      const e = new Error('LINE push HTTP 429: rate limited');
      e.retryable = true;
      throw e;
    }
    return 'ok';
  });
  assert.strictEqual(res, 'ok');
  assert.strictEqual(calls, 2);
});

t('lineWithRetry_ does not retry plain errors even if message contains digits like 500', () => {
  let calls = 0;
  assert.throws(() => lineMod.lineWithRetry_(function () {
    calls++;
    throw new Error('検証エラー: 最大 5000 文字です');
  }), /5000/);
  assert.strictEqual(calls, 1);
});

t('pushLineMessage retries on 429 then succeeds', () => {
  let calls = 0;
  lineMod.setLineFetchImpl_(function () {
    calls++;
    if (calls < 3) return { getResponseCode: () => 429, getContentText: () => '{"message":"rate limited"}' };
    return { getResponseCode: () => 200, getContentText: () => '{}' };
  });
  const res = lineMod.pushLineMessage('429再試行確認');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls, 3);
});

t('pushLineMessage retries on 503 then succeeds', () => {
  let calls = 0;
  lineMod.setLineFetchImpl_(function () {
    calls++;
    if (calls < 2) return { getResponseCode: () => 503, getContentText: () => '{"message":"unavailable"}' };
    return { getResponseCode: () => 200, getContentText: () => '{}' };
  });
  const res = lineMod.pushLineMessage('503再試行確認');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls, 2);
});

t('pushLineMessage throws with response body after exhausting retries', () => {
  let calls = 0;
  lineMod.setLineFetchImpl_(function () {
    calls++;
    return { getResponseCode: () => 500, getContentText: () => '{"message":"internal error detail"}' };
  });
  assert.throws(() => lineMod.pushLineMessage('再試行上限確認'), /internal error detail/);
  assert.strictEqual(calls, 4);
});

t('pushLineMessage fails immediately on 400 without retry', () => {
  let calls = 0;
  lineMod.setLineFetchImpl_(function () {
    calls++;
    return { getResponseCode: () => 400, getContentText: () => '{"message":"bad request"}' };
  });
  assert.throws(() => lineMod.pushLineMessage('400即時失敗確認'), /400/);
  assert.strictEqual(calls, 1);
});

t('pushLineMessage fails immediately on 401 without retry', () => {
  let calls = 0;
  lineMod.setLineFetchImpl_(function () {
    calls++;
    return { getResponseCode: () => 401, getContentText: () => '{"message":"unauthorized"}' };
  });
  assert.throws(() => lineMod.pushLineMessage('401即時失敗確認'), /401/);
  assert.strictEqual(calls, 1);
});

t('pushLineMessage options override script properties', () => {
  const calls = [];
  lineMod.setLineFetchImpl_(function (url, opt) {
    calls.push({ auth: opt.headers.Authorization, payload: opt.payload });
    return { getResponseCode: () => 200, getContentText: () => '{}' };
  });
  const res = lineMod.pushLineMessage('options上書き確認', { toUserId: 'Uoverride0001', accessToken: 'token_override' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls[0].auth, 'Bearer token_override');
  assert.strictEqual(JSON.parse(calls[0].payload).to, 'Uoverride0001');
});

t('pushLineMessage throws if script properties are missing', () => {
  lineMod.setLineFetchImpl_(function () {
    throw new Error('fetch must not run');
  });
  const savedToken = props.LINE_CHANNEL_ACCESS_TOKEN;
  delete props.LINE_CHANNEL_ACCESS_TOKEN;
  assert.throws(() => lineMod.pushLineMessage('見本'), /LINE_CHANNEL_ACCESS_TOKEN/);
  props.LINE_CHANNEL_ACCESS_TOKEN = savedToken;

  const savedTo = props.LINE_PUSH_TO_USER_ID;
  delete props.LINE_PUSH_TO_USER_ID;
  assert.throws(() => lineMod.pushLineMessage('見本'), /LINE_PUSH_TO_USER_ID/);
  props.LINE_PUSH_TO_USER_ID = savedTo;
});

t('pushLineMessage dryRun option skips the actual HTTP call', () => {
  let called = false;
  lineMod.setLineFetchImpl_(function () {
    called = true;
    return { getResponseCode: () => 200, getContentText: () => '{}' };
  });
  const res = lineMod.pushLineMessage('DRY_RUNオプション確認', { dryRun: true });
  assert.strictEqual(called, false);
  assert.strictEqual(res.dryRun, true);
});

t('pushLineMessage DRY_RUN script property skips the actual HTTP call', () => {
  let called = false;
  lineMod.setLineFetchImpl_(function () {
    called = true;
    return { getResponseCode: () => 200, getContentText: () => '{}' };
  });
  props[lineMod.LINE_PROP_DRY_RUN] = 'true';
  const res = lineMod.pushLineMessage('DRY_RUNプロパティ確認');
  delete props[lineMod.LINE_PROP_DRY_RUN];
  assert.strictEqual(called, false);
  assert.strictEqual(res.dryRun, true);
});

t('testRunPushSample runs via DRY_RUN without an HTTP call', () => {
  let called = false;
  lineMod.setLineFetchImpl_(function () {
    called = true;
    return { getResponseCode: () => 200, getContentText: () => '{}' };
  });
  const res = lineMod.testRunPushSample();
  assert.strictEqual(called, false);
  assert.strictEqual(res.dryRun, true);
});

console.log('\n' + pass + ' tests passed');
