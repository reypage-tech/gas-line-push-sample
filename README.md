# LINE Messaging API プッシュ通知(Google Apps Script 見本)

> 見本データのみを用いています。実在の個人・団体とは関係ありません。

## 概要

Google Apps Script から LINE Messaging API の push エンドポイント(`https://api.line.me/v2/bot/message/push`)へ JSON を送り、登録済みの宛先へテキストメッセージを届ける部品です。チャネルアクセストークンと宛先ユーザー ID はコードに書かず、スクリプトプロパティから読みます(関数の引数で上書きも可能)。送信前に件数・文字数を検査し、HTTP 429 や 5xx 応答時は指数バックオフで再試行します。

スプレッドシートの読み書きは含みません。どのシートから本文を取るか、送信結果をどこへ記録するかは呼び出し側(他の部品やスクリプト)で決める前提です。**実機(実際の LINE チャネル)での動作は未確認**で、Node 上でメッセージ組み立てと再試行ロジックのみ検証しています。

## ファイル構成

```
v1/
  src/
    LinePush.gs       push API 呼び出し・メッセージ検証
    Retry.gs          429 / 5xx 再試行(lineWithRetry_ ほか)
    appsscript.json   マニフェスト(OAuth スコープ)
  sample_data/
    push_queue.csv    架空の通知文の例(message_id, text)
  tests/
    logic_test.js     Node でのロジック確認
  README.md
  LICENSE
```

## 設定

1. LINE Developers でチャネルを用意し、Messaging API のチャネルアクセストークンと、送信先ユーザーの ID を取得します。
2. 拡張機能 > Apps Script に `src/LinePush.gs` と `src/Retry.gs` を貼り、マニフェストを `src/appsscript.json` に合わせます(clasp 利用可)。
3. スクリプトプロパティに次の2件を設定します。

| キー | 内容 |
|------|------|
| `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API チャネルアクセストークン |
| `LINE_PUSH_TO_USER_ID` | プッシュ先のユーザー ID(例 `Udemo0001` は架空) |
| `DRY_RUN`(任意) | `true` にすると HTTP 送信を行わずログ出力のみ(`options.dryRun` が優先) |

4. 必要な OAuth スコープ: `https://www.googleapis.com/auth/script.external_request`(`src/appsscript.json` に含めています)。
5. (任意) 誤送信を避けて組み立てとログだけ確認したい場合は、スクリプトプロパティに `DRY_RUN` を `true` で追加します。この場合 LINE への HTTP 呼び出しは行わず、ペイロードをログに出すだけで `{ statusCode: 0, body: '', dryRun: true }` を返します。呼び出し時に `options.dryRun` を指定すると、スクリプトプロパティより優先されます。

## 使い方

GAS エディタに貼った直後、非エンジニアの方でも引数なしの実行ボタンで試せるように `testRunPushSample()` を用意しています。この関数は DRY_RUN 固定で呼ぶため、設定2・3(トークン・宛先)さえ済んでいれば実際に LINE へは送信せずログだけ確認できます。GAS エディタで関数選択を `testRunPushSample` に切り替えて実行ボタンを押し、実行ログ(表示 > ログ)を見てください。

```javascript
// スクリプトプロパティの宛先へ1通
pushLineMessage('在庫しきい値を下回った SKU があります(見本)。');

// 宛先とトークンを呼び出し時に指定(デバッグ用、トークンはコードに書かない)
pushLineMessage('テスト通知', {
  toUserId: 'Udemo0002',
  accessToken: '呼び出し元で取得したトークン'
});

// 複数件まとめて送る場合は配列で渡す(1回の push で最大5件)
pushLineMessage(['1件目の本文', '2件目の本文']);

// 実際には送信せず、組み立てとログ出力だけ確認する
pushLineMessage('見本テキスト', { dryRun: true });
```

`sample_data/push_queue.csv` は、送信待ちの本文をシートやキューに並べた場合の例です。本部品自体はシートを読みませんが、行ごとに `text` 列を `pushLineMessage` へ渡す形を想定しています(`tests/logic_test.js` 内で実際に読み込んで確認しています)。

### API 制限(text メッセージ)

- 1 回の push で最大 **5** 件(`validateLinePushTexts_` で検査、超えると送信前に例外)
- 1 件あたり最大 **5000** 文字(`buildLineTextMessage_` で検査)

## テスト

```bash
cd v1
node tests/logic_test.js
```

結果(ローカル環境の Node.js で実行して確認済み):

```
ok buildLineTextMessage
ok validateLinePushTexts count
ok validateLinePushTexts length
ok pushLineMessage posts expected payload
ok pushLineMessage rejects sixth message before HTTP
ok sample_data push_queue.csv pushes each row as one message
ok lineWithRetry_ retries only errors marked retryable
ok lineWithRetry_ does not retry plain errors even if message contains digits like 500
ok pushLineMessage retries on 429 then succeeds
ok pushLineMessage retries on 503 then succeeds
ok pushLineMessage throws with response body after exhausting retries
ok pushLineMessage fails immediately on 400 without retry
ok pushLineMessage fails immediately on 401 without retry
ok pushLineMessage options override script properties
ok pushLineMessage throws if script properties are missing
ok pushLineMessage dryRun option skips the actual HTTP call
ok pushLineMessage DRY_RUN script property skips the actual HTTP call
ok testRunPushSample runs via DRY_RUN without an HTTP call

18 tests passed
```

検証しているのは `LinePush.gs`(メッセージの組み立て・件数と文字数の検査・push 呼び出し・DRY_RUN・スクリプトプロパティと options の優先順位)と `Retry.gs`(429 / 5xx での再試行成功、再試行上限到達時の例外、400 / 401 での即時失敗、エラーメッセージに判定用の文字列が含まれていても誤って再試行しないこと)です。`UrlFetchApp.fetch` は `setLineFetchImpl_` で差し替え、実際に LINE サーバーへは接続していません。`sample_data/push_queue.csv` の架空の通知文3件についても、各行が1通として送信され本文が一致することを確認しています。

## 扱える行数の目安(未検証)

架空データ3件でロジックの整合のみ確認しました。実際の LINE Messaging API への送信件数・応答時間・レート制限時の挙動は未検証です。1回の push で送れるのは最大5件までという API 側の上限があるため、件数が多い場合は呼び出し側で分割する必要があります。

設計上の目安として、以下の制約も踏まえて呼び出し側を組む必要があります(いずれも仕様値で、本部品では未検証)。

- GAS の1回の実行時間には上限があり(一般的なトリガー実行で6分程度)、件数が多いとこの上限内で終わらない可能性があります。
- `UrlFetchApp` の呼び出し回数には Google アカウントの種類ごとに1日あたりの上限があります(上限はGoogle公式の割り当て表を確認)。
- LINE Messaging API 側にも無料枠の月間通数上限やレート制限があります。
- これらの上限により、何百行を超えるような量を1回の実行でまとめて送ろうとすると、件数を分けて複数回のトリガー実行に分割する設計が必要になります。具体的な上限値は Google・LINE 公式の最新情報を確認してください。

## 制約

- スプレッドシートの読み書き・送信ログの記録は含みません。どこから本文を取るか、結果をどう記録するかは呼び出し側の実装が必要です。
- LINE の宛先 ID は Messaging API 側で発行されるものを使う前提で、ID の取得方法自体は本部品の範囲外です。
- テキストメッセージのみを対象にしています。画像・スタンプ・Flex Message などの他のメッセージタイプには対応していません。
- `lineWithRetry_` は HTTP ステータスコードが 429 または 5xx の場合のみ再試行します(エラーメッセージの文字列照合ではなくエラーオブジェクトの `retryable` フラグで判定)。実際の LINE サーバーからの応答形式での動作確認はしていません。
- チャネルアクセストークンの有効期限切れ・権限エラー時の挙動は未確認です。
