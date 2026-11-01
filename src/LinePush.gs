/**
 * LINE Messaging API プッシュ通知（https://api.line.me/v2/bot/message/push）
 * トークンと宛先 ID はスクリプトプロパティから読む（引数で上書き可）。
 */

var LINE_PROP_TOKEN = 'LINE_CHANNEL_ACCESS_TOKEN';
var LINE_PROP_TO = 'LINE_PUSH_TO_USER_ID';
var LINE_PROP_DRY_RUN = 'DRY_RUN';
var LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
var LINE_MAX_MESSAGES = 5;
var LINE_MAX_TEXT_LENGTH = 5000;

/** @type {null | function(string, Object=): {getResponseCode:function():number,getContentText:function():string}} */
var lineFetchImpl_ = null;

function setLineFetchImpl_(fn) {
  lineFetchImpl_ = fn;
}

function lineLog_(msg) {
  if (typeof Logger !== 'undefined') Logger.log(msg);
}

/**
 * DRY_RUN（API を呼ばずペイロード検証とログ出力のみ行う）かどうかを判定する。
 * options.dryRun が boolean で指定されていればそれを優先し、未指定ならスクリプトプロパティ DRY_RUN を見る。
 * @param {{dryRun?:boolean}} options
 */
function lineIsDryRun_(options) {
  if (typeof options.dryRun === 'boolean') return options.dryRun;
  return PropertiesService.getScriptProperties().getProperty(LINE_PROP_DRY_RUN) === 'true';
}

/**
 * 再試行対象（429 / 5xx）の HTTP エラーを表すエラーオブジェクトを作る。
 * レスポンス本文を message に残すため、再試行に失敗しても詳細が消えない。
 * @param {number} code
 * @param {string} body
 */
function lineRetryableHttpError_(code, body) {
  var err = new Error('LINE push HTTP ' + code + ': ' + String(body).slice(0, 200));
  err.retryable = true;
  err.statusCode = code;
  return err;
}

/**
 * 再試行対象外（4xx など）の HTTP エラーを表すエラーオブジェクトを作る。
 * @param {number} code
 * @param {string} body
 */
function lineFatalHttpError_(code, body) {
  var err = new Error('LINE push failed ' + code + ': ' + String(body).slice(0, 200));
  err.retryable = false;
  err.statusCode = code;
  return err;
}

/**
 * テキスト1通のメッセージオブジェクト。
 * @param {string} text
 * @returns {{type:string,text:string}}
 */
function buildLineTextMessage_(text) {
  if (!String(text || '').trim()) throw new Error('テキストが空です');
  var s = String(text);
  if (s.length > LINE_MAX_TEXT_LENGTH) {
    throw new Error('LINE テキストは最大 ' + LINE_MAX_TEXT_LENGTH + ' 文字です（現在 ' + s.length + ' 文字）');
  }
  return { type: 'text', text: s };
}

/**
 * プッシュ前の件数・文字数チェック（Messaging API の text メッセージ上限）。
 * @param {string[]} texts
 */
function validateLinePushTexts_(texts) {
  if (!texts || !texts.length) throw new Error('メッセージが0件です');
  if (texts.length > LINE_MAX_MESSAGES) {
    throw new Error('LINE messages は最大 ' + LINE_MAX_MESSAGES + ' 件です（現在 ' + texts.length + ' 件）');
  }
  for (var i = 0; i < texts.length; i++) {
    buildLineTextMessage_(texts[i]);
  }
}

/**
 * プッシュ API を呼ぶ（送信のみ。シートログはこの部品の範囲外）。
 * @param {string|string[]} textOrTexts 1件または複数テキスト（各1メッセージ）
 * @param {{toUserId?:string,accessToken?:string,dryRun?:boolean}} options
 * @returns {{statusCode:number, body:string, dryRun?:boolean}}
 */
function pushLineMessage(textOrTexts, options) {
  options = options || {};
  var token = options.accessToken || PropertiesService.getScriptProperties().getProperty(LINE_PROP_TOKEN);
  var to = options.toUserId || PropertiesService.getScriptProperties().getProperty(LINE_PROP_TO);
  if (!token) throw new Error('スクリプトプロパティ未設定: ' + LINE_PROP_TOKEN);
  if (!to) throw new Error('スクリプトプロパティ未設定: ' + LINE_PROP_TO);

  var texts = Array.isArray(textOrTexts) ? textOrTexts : [textOrTexts];
  validateLinePushTexts_(texts);
  var messages = texts.map(buildLineTextMessage_);
  var payload = JSON.stringify({ to: to, messages: messages });

  if (lineIsDryRun_(options)) {
    lineLog_('DRY_RUN: push をスキップしました。to=' + to + ' payload=' + payload);
    return { statusCode: 0, body: '', dryRun: true };
  }

  return lineWithRetry_(function () {
    var resp = lineFetchImpl_
      ? lineFetchImpl_(LINE_PUSH_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        payload: payload,
        muteHttpExceptions: true
      })
      : (function () {
        var r = UrlFetchApp.fetch(LINE_PUSH_URL, {
          method: 'post',
          contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + token },
          payload: payload,
          muteHttpExceptions: true
        });
        return { getResponseCode: function () { return r.getResponseCode(); }, getContentText: function () { return r.getContentText(); } };
      })();
    var code = resp.getResponseCode();
    var body = resp.getContentText();
    if (lineHttpShouldRetry_(code)) throw lineRetryableHttpError_(code, body);
    if (code !== 200) throw lineFatalHttpError_(code, body);
    return { statusCode: code, body: body };
  });
}

/**
 * GAS エディタの実行ボタンから引数なしで試すためのサンプル関数。
 * DRY_RUN で呼ぶため実際には LINE へ送信しない（ペイロード組み立てとログ出力のみ）。
 * 事前にスクリプトプロパティ（LINE_CHANNEL_ACCESS_TOKEN / LINE_PUSH_TO_USER_ID）の設定が必要。
 */
function testRunPushSample() {
  var result = pushLineMessage('見本テキスト:GAS エディタからの動作確認用(DRY_RUN)', { dryRun: true });
  lineLog_('testRunPushSample result: ' + JSON.stringify(result));
  return result;
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildLineTextMessage_: buildLineTextMessage_,
    validateLinePushTexts_: validateLinePushTexts_,
    pushLineMessage: pushLineMessage,
    testRunPushSample: testRunPushSample,
    setLineFetchImpl_: setLineFetchImpl_,
    LINE_PUSH_URL: LINE_PUSH_URL,
    LINE_MAX_MESSAGES: LINE_MAX_MESSAGES,
    LINE_MAX_TEXT_LENGTH: LINE_MAX_TEXT_LENGTH,
    LINE_PROP_DRY_RUN: LINE_PROP_DRY_RUN
  };
}
