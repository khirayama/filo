import { ApiRequestError } from "../api/client";

export const SUPPORTED_LANGUAGES = ["ja", "en", "zh", "ko", "es"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  ja: "日本語",
  en: "English",
  zh: "简体中文",
  ko: "한국어",
  es: "Español",
};

type MessageCatalog = Partial<Record<string, string>>;

const TRANSLATION_PROGRESS_MESSAGES: Record<SupportedLanguage, MessageCatalog> = {
  ja: {},
  en: {},
  zh: {
    "翻訳モデルをダウンロードしています…": "正在下载翻译模型…",
    "翻訳エンジンを初期化しています…": "正在初始化翻译引擎…",
    "翻訳モデルの準備が完了しました。": "翻译模型已准备就绪。",
    "翻訳モデルの準備に失敗しました。": "翻译模型准备失败。",
    "翻訳モデルの準備に失敗しました。通信状況を確認して、もう一度お試しください。": "翻译模型准备失败。请检查网络连接后重试。",
    "翻訳モデルを準備しています…": "正在准备翻译模型…",
    "進捗を確認しています…": "正在确认进度…",
  },
  ko: {
    "翻訳モデルをダウンロードしています…": "번역 모델을 다운로드하는 중…",
    "翻訳エンジンを初期化しています…": "번역 엔진을 초기화하는 중…",
    "翻訳モデルの準備が完了しました。": "번역 모델 준비가 완료되었습니다.",
    "翻訳モデルの準備に失敗しました。": "번역 모델 준비에 실패했습니다.",
    "翻訳モデルの準備に失敗しました。通信状況を確認して、もう一度お試しください。": "번역 모델 준비에 실패했습니다. 네트워크 상태를 확인하고 다시 시도하세요.",
    "翻訳モデルを準備しています…": "번역 모델 준비 중…",
    "進捗を確認しています…": "진행 상황 확인 중…",
  },
  es: {
    "翻訳モデルをダウンロードしています…": "Descargando el modelo de traducción…",
    "翻訳エンジンを初期化しています…": "Inicializando el motor de traducción…",
    "翻訳モデルの準備が完了しました。": "El modelo de traducción está listo.",
    "翻訳モデルの準備に失敗しました。": "No se pudo preparar el modelo de traducción.",
    "翻訳モデルの準備に失敗しました。通信状況を確認して、もう一度お試しください。": "No se pudo preparar el modelo de traducción. Comprueba la conexión y vuelve a intentarlo.",
    "翻訳モデルを準備しています…": "Preparando el modelo de traducción…",
    "進捗を確認しています…": "Comprobando el progreso…",
  },
};

// Strings introduced by the auth, status, deletion, and extension surfaces.
// Keep these in the same source-key catalog so the native clients can use the
// same wording when their UI is backed by platform-specific resource files.
const EXTRA_MESSAGES: Record<SupportedLanguage, MessageCatalog> = {
  ja: {},
  en: {
    "サインアウト中…": "Signing out…", "記事を追加": "Add article", "URLをリーディングリストに保存します。": "Save the URL to your reading list.", "記事URL": "Article URL", "保存中…": "Saving…", "完了": "Done", "RSS/Atom URL または サイトURL": "RSS/Atom URL or site URL", "新規タグ（カンマ区切り）": "New tags (comma-separated)", "再試行中…": "Retrying…", "記事一覧へ": "View articles", "ショートカット": "Shortcuts", "タグ: {name} ✕": "Tag: {name} ✕",
    "認証に失敗しました。メールアドレスとパスワードを確認してください。": "Sign-in failed. Check your email address and password.", "認証に失敗しました。しばらくしてからもう一度お試しください。": "Authentication failed. Please try again later.", "メールアドレス": "Email address", "パスワード": "Password", "処理中…": "Working…", "サインイン": "Sign in", "パスワードをお忘れですか？": "Forgot your password?", "サインインへ戻る": "Back to sign in", "リセットメールを送信": "Send reset email", "送信中…": "Sending…", "パスワードリセット用のメールを送信しました。メール内のリンクを開いて新しいパスワードを設定してください。": "A password reset email was sent. Open the link in the email to set a new password.", "登録済みのメールアドレスにパスワードリセット用のリンクを送信します。": "We will send a password reset link to your registered email address.", "このリセットリンクは無効です。もう一度リセットをリクエストしてください。": "This reset link is invalid. Request a new reset link.", "パスワードが一致しません。": "Passwords do not match.", "パスワードを変更できませんでした。リンクの有効期限が切れている可能性があります。": "Could not change the password. The link may have expired.", "パスワードを変更できませんでした。しばらくしてからもう一度お試しください。": "Could not change the password. Please try again later.", "パスワードを変更しました。新しいパスワードでサインインしてください。": "Password changed. Sign in with your new password.", "サインインへ進む": "Continue to sign in", "新しいパスワード": "New password", "新しいパスワード（確認）": "New password (confirm)", "変更中…": "Changing…", "パスワードを変更": "Change password",
    "アカウントの削除が完了しました。ご利用ありがとうございました。": "Your account has been deleted. Thank you for using Filo.", "再ログインしてもデータは復元されません。": "Your data cannot be restored by signing in again.", "削除処理は自動的に再試行されます。時間をおいてもこの状態が続く場合はお問い合わせください。": "Deletion will be retried automatically. Contact support if this continues.", "進行中の削除処理はありません。": "There is no deletion in progress.", "削除処理中（{status}）…": "Deletion in progress ({status})…", "待機中": "waiting", "実行中": "running", "アカウントとデータを削除しています。このまましばらくお待ちください。": "Your account and data are being deleted. Please wait.", "この画面を閉じても削除処理は継続されます。再ログインでデータが復活することはありません。": "Deletion continues if you close this page. Signing in again will not restore your data.",
    "購読は作成されましたが、{message}": "The subscription was created, but {message}", "OPMLファイル": "OPML file", "追加 {created} / スキップ {skipped} / 失敗 {failed}": "Added {created} / Skipped {skipped} / Failed {failed}", "閲覧履歴は既読記事として扱われます。記事一覧の絞り込みから既読記事を確認できます。": "Reading history is treated as read articles. Use the article filters to view read articles.", "アカウントを削除すると購読・タグ・記事の状態がすべて削除され、再ログインしても復元されません。": "Deleting your account removes subscriptions, tags, and article state. Signing in again will not restore them.",
    "最終公開 {time}": "Last published {time}", "タグを編集": "Edit tags", "上へ": "Move up", "下へ": "Move down", "記事取得中": "Fetching articles", "更新停止中": "Updates paused", "しばらく更新なし": "No recent updates", "名前を変更": "Rename", "サイトを開く": "Open site", "初回取得を再試行": "Retry initial fetch", "購読一覧へ戻る": "Back to subscriptions", "購読詳細": "Subscription details", "購読名を変更（空欄でフィード名に戻す）": "Rename subscription (leave blank to use feed name)", "空欄でフィード名に戻す": "Leave blank to use feed name", "変更": "Change", "コピー": "Copy", "この購読を解除しますか？ブックマークした記事は残ります。": "Unsubscribe from this feed? Bookmarked articles will remain.", "購読が見つかりません": "Subscription not found", "この購読は削除されたか、表示できません。": "This subscription was deleted or cannot be displayed.", "購読は削除されません。": "Subscriptions will not be deleted.",
    "色": "Color", "色を解除": "Clear color", "編集": "Edit", "解除": "Clear", "{count}件の購読": "{count} subscriptions", "タグ「{name}」を削除しますか？購読は削除されません。": "Delete the tag \"{name}\"? Subscriptions will not be deleted.", "を削除しますか？購読は削除されません。": "? Subscriptions will not be deleted.", "検索": "Search", "購読名で検索": "Search subscriptions", "状態": "Status", "すべて": "All", "問題あり": "Needs attention", "取得中": "Fetching", "並び替え: {label}": "Sort: {label}", "最終取得": "Last fetched", "並び順": "Sort order", "既読状態": "Read status", "既読の扱い": "Read handling", "表示設定": "Display settings", "メインナビゲーション": "Main navigation", "サイドバー": "Sidebar", "記事一覧": "Article list",
    "現在のページ": "Current page", "読み上げるページを開いてください": "Open a page to read aloud", "読み上げを停止": "Stop reading aloud", "このページを読み上げ": "Read this page aloud", "読み上げできるページなし": "No readable page", "リストに追加": "Add to list", "読み上げ設定": "Reading settings", "内容": "Content", "本文を抽出": "Extract article", "表示中の文章": "Visible text", "ページ翻訳後に使うと、表示中の翻訳を読み上げます。": "Use this after translating a page to read the visible translation.", "速度": "Speed", "声": "Voice", "自動": "Automatic", "読み上げ中": "Reading aloud", "リスト": "List", "リーディングリストを読み込んでいます…": "Loading reading list…", "リーディングリストに記事がありません。": "There are no articles in the reading list.", "削除": "Delete", "ログイン": "Sign in", "登録": "Create account", "ログアウト": "Sign out", "アカウント作成": "Create account", "ログインへ戻る": "Back to sign in", "8文字以上のパスワード": "Password (8 or more characters)", "認証に失敗しました。": "Authentication failed.", "認証トークンを取得できませんでした。": "Could not obtain an authentication token.", "ログインが必要です。": "Please sign in.", "APIへの接続に失敗しました。": "Could not connect to the API.", "拡張機能を操作できませんでした。": "Could not control the extension.", "読み上げできるページがありません。": "There is no page to read aloud.", "追加できるページがありません。": "There is no page to add.", "ページ本文を読み込めませんでした。ページを再読み込みしてからもう一度お試しください。": "Could not read the page. Reload the page and try again.", "このページから読み上げる文章を取得できませんでした。": "Could not find text to read on this page.", "音声の再生を開始できませんでした。読み上げ音声の設定を確認してください。": "Could not start audio. Check the reading voice settings.", "再生中のセッションがありません。": "There is no active reading session.",
  },
  zh: {
    "サインアウト中…": "正在退出登录…", "記事を追加": "添加文章", "URLをリーディングリストに保存します。": "将 URL 保存到阅读列表。", "記事URL": "文章 URL", "保存中…": "保存中…", "完了": "完成", "RSS/Atom URL または サイトURL": "RSS/Atom URL 或网站 URL", "新規タグ（カンマ区切り）": "新标签（用逗号分隔）", "再試行中…": "重试中…", "記事一覧へ": "查看文章", "ショートカット": "快捷键", "タグ: {name} ✕": "标签：{name} ✕",
    "認証に失敗しました。メールアドレスとパスワードを確認してください。": "登录失败，请检查邮箱地址和密码。", "認証に失敗しました。しばらくしてからもう一度お試しください。": "认证失败，请稍后重试。", "メールアドレス": "邮箱地址", "パスワード": "密码", "処理中…": "处理中…", "サインイン": "登录", "パスワードをお忘れですか？": "忘记密码？", "サインインへ戻る": "返回登录", "リセットメールを送信": "发送重置邮件", "送信中…": "发送中…", "パスワードリセット用のメールを送信しました。メール内のリンクを開いて新しいパスワードを設定してください。": "已发送密码重置邮件。请打开邮件中的链接设置新密码。", "登録済みのメールアドレスにパスワードリセット用のリンクを送信します。": "我们会向已注册的邮箱发送密码重置链接。", "このリセットリンクは無効です。もう一度リセットをリクエストしてください。": "此重置链接无效，请重新请求。", "パスワードが一致しません。": "密码不一致。", "パスワードを変更できませんでした。リンクの有効期限が切れている可能性があります。": "无法修改密码，链接可能已过期。", "パスワードを変更できませんでした。しばらくしてからもう一度お試しください。": "无法修改密码，请稍后重试。", "パスワードを変更しました。新しいパスワードでサインインしてください。": "密码已修改，请使用新密码登录。", "サインインへ進む": "继续登录", "新しいパスワード": "新密码", "新しいパスワード（確認）": "确认新密码", "変更中…": "修改中…", "パスワードを変更": "修改密码",
    "アカウントの削除が完了しました。ご利用ありがとうございました。": "账户已删除。感谢您使用 Filo。", "再ログインしてもデータは復元されません。": "重新登录也无法恢复数据。", "削除処理は自動的に再試行されます。時間をおいてもこの状態が続く場合はお問い合わせください。": "删除操作会自动重试。如果长时间没有变化，请联系支持。", "進行中の削除処理はありません。": "没有正在进行的删除操作。", "削除処理中（{status}）…": "正在删除（{status}）…", "待機中": "等待中", "実行中": "执行中", "アカウントとデータを削除しています。このまましばらくお待ちください。": "正在删除账户和数据，请稍候。", "この画面を閉じても削除処理は継続されます。再ログインでデータが復活することはありません。": "关闭此页面后删除仍会继续。重新登录不会恢复数据。",
    "購読は作成されましたが、{message}": "订阅已创建，但{message}", "OPMLファイル": "OPML 文件", "追加 {created} / スキップ {skipped} / 失敗 {failed}": "添加 {created} / 跳过 {skipped} / 失败 {failed}", "閲覧履歴は既読記事として扱われます。記事一覧の絞り込みから既読記事を確認できます。": "阅读历史会作为已读文章处理。可在文章列表筛选已读文章。", "アカウントを削除すると購読・タグ・記事の状態がすべて削除され、再ログインしても復元されません。": "删除账户会删除订阅、标签和文章状态，重新登录也无法恢复。",
    "最終公開 {time}": "最后发布 {time}", "タグを編集": "编辑标签", "上へ": "上移", "下へ": "下移", "記事取得中": "正在获取文章", "更新停止中": "已暂停更新", "しばらく更新なし": "近期没有更新", "名前を変更": "重命名", "サイトを開く": "打开网站", "初回取得を再試行": "重试首次获取", "購読一覧へ戻る": "返回订阅列表", "購読詳細": "订阅详情", "購読名を変更（空欄でフィード名に戻す）": "重命名订阅（留空以使用订阅源名称）", "空欄でフィード名に戻す": "留空以使用订阅源名称", "変更": "修改", "コピー": "复制", "この購読を解除しますか？ブックマークした記事は残ります。": "要取消此订阅吗？已收藏的文章会保留。", "色": "颜色", "色を解除": "清除颜色", "編集": "编辑", "解除": "清除", "{count}件の購読": "{count} 个订阅", "タグ「{name}」を削除しますか？購読は削除されません。": "要删除标签“{name}”吗？订阅不会被删除。", "検索": "搜索", "購読名で検索": "搜索订阅", "状態": "状态", "すべて": "全部", "問題あり": "需要注意", "取得中": "获取中", "並び替え: {label}": "排序：{label}", "最終取得": "最后获取", "並び順": "排序方式", "既読状態": "阅读状态", "既読の扱い": "已读处理", "表示設定": "显示设置", "メインナビゲーション": "主导航", "サイドバー": "侧边栏", "記事一覧": "文章列表",
    "現在のページ": "当前页面", "読み上げるページを開いてください": "打开要朗读的页面", "読み上げを停止": "停止朗读", "このページを読み上げ": "朗读此页面", "読み上げできるページなし": "没有可朗读的页面", "リストに追加": "加入列表", "読み上げ設定": "朗读设置", "内容": "内容", "本文を抽出": "提取正文", "表示中の文章": "当前显示的文字", "ページ翻訳後に使うと、表示中の翻訳を読み上げます。": "页面翻译后使用此选项可朗读当前翻译。", "速度": "速度", "声": "声音", "自動": "自动", "読み上げ中": "正在朗读", "リスト": "列表", "リーディングリストを読み込んでいます…": "正在加载阅读列表…", "リーディングリストに記事がありません。": "阅读列表中没有文章。", "削除": "删除", "ログイン": "登录", "登録": "注册", "ログアウト": "退出登录", "アカウント作成": "创建账户", "ログインへ戻る": "返回登录", "8文字以上のパスワード": "密码（至少 8 个字符）", "認証に失敗しました。": "认证失败。", "認証トークンを取得できませんでした。": "无法获取认证令牌。", "ログインが必要です。": "请先登录。", "APIへの接続に失敗しました。": "无法连接 API。", "拡張機能を操作できませんでした。": "无法操作扩展。", "読み上げできるページがありません。": "没有可朗读的页面。", "追加できるページがありません。": "没有可添加的页面。", "ページ本文を読み込めませんでした。ページを再読み込みしてからもう一度お試しください。": "无法读取页面，请重新加载后重试。", "このページから読み上げる文章を取得できませんでした。": "无法获取页面中的朗读文字。", "音声の再生を開始できませんでした。読み上げ音声の設定を確認してください。": "无法开始播放音频，请检查朗读声音设置。", "再生中のセッションがありません。": "没有正在进行的朗读会话。",
  },
  ko: {
    "サインアウト中…": "로그아웃 중…", "記事を追加": "기사 추가", "URLをリーディングリストに保存します。": "URL을 읽기 목록에 저장합니다.", "記事URL": "기사 URL", "保存中…": "저장 중…", "完了": "완료", "RSS/Atom URL または サイトURL": "RSS/Atom URL 또는 사이트 URL", "新規タグ（カンマ区切り）": "새 태그(쉼표로 구분)", "再試行中…": "다시 시도하는 중…", "記事一覧へ": "기사 보기", "ショートカット": "단축키", "タグ: {name} ✕": "태그: {name} ✕",
    "認証に失敗しました。メールアドレスとパスワードを確認してください。": "로그인에 실패했습니다. 이메일과 비밀번호를 확인하세요.", "認証に失敗しました。しばらくしてからもう一度お試しください。": "인증에 실패했습니다. 잠시 후 다시 시도하세요.", "メールアドレス": "이메일 주소", "パスワード": "비밀번호", "処理中…": "처리 중…", "サインイン": "로그인", "パスワードをお忘れですか？": "비밀번호를 잊으셨나요?", "サインインへ戻る": "로그인으로 돌아가기", "リセットメールを送信": "재설정 이메일 보내기", "送信中…": "보내는 중…", "パスワードリセット用のメールを送信しました。メール内のリンクを開いて新しいパスワードを設定してください。": "비밀번호 재설정 이메일을 보냈습니다. 이메일의 링크를 열어 새 비밀번호를 설정하세요.", "登録済みのメールアドレスにパスワードリセット用のリンクを送信します。": "등록된 이메일 주소로 비밀번호 재설정 링크를 보냅니다.", "このリセットリンクは無効です。もう一度リセットをリクエストしてください。": "이 재설정 링크가 유효하지 않습니다. 다시 요청하세요.", "パスワードが一致しません。": "비밀번호가 일치하지 않습니다.", "パスワードを変更できませんでした。リンクの有効期限が切れている可能性があります。": "비밀번호를 변경하지 못했습니다. 링크가 만료되었을 수 있습니다.", "パスワードを変更できませんでした。しばらくしてからもう一度お試しください。": "비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도하세요.", "パスワードを変更しました。新しいパスワードでサインインしてください。": "비밀번호를 변경했습니다. 새 비밀번호로 로그인하세요.", "サインインへ進む": "로그인으로 이동", "新しいパスワード": "새 비밀번호", "新しいパスワード（確認）": "새 비밀번호(확인)", "変更中…": "변경 중…", "パスワードを変更": "비밀번호 변경",
    "アカウントの削除が完了しました。ご利用ありがとうございました。": "계정이 삭제되었습니다. Filo를 이용해 주셔서 감사합니다.", "再ログインしてもデータは復元されません。": "다시 로그인해도 데이터는 복구되지 않습니다.", "削除処理は自動的に再試行されます。時間をおいてもこの状態が続く場合はお問い合わせください。": "삭제 작업은 자동으로 재시도됩니다. 계속되면 지원팀에 문의하세요.", "進行中の削除処理はありません。": "진행 중인 삭제 작업이 없습니다.", "削除処理中（{status}）…": "삭제 처리 중({status})…", "待機中": "대기 중", "実行中": "실행 중", "アカウントとデータを削除しています。このまましばらくお待ちください。": "계정과 데이터를 삭제하고 있습니다. 잠시 기다려 주세요.", "この画面を閉じても削除処理は継続されます。再ログインでデータが復活することはありません。": "이 화면을 닫아도 삭제는 계속됩니다. 다시 로그인해도 데이터가 복구되지 않습니다.",
    "購読は作成されましたが、{message}": "구독은 생성되었지만 {message}", "OPMLファイル": "OPML 파일", "追加 {created} / スキップ {skipped} / 失敗 {failed}": "추가 {created} / 건너뜀 {skipped} / 실패 {failed}", "閲覧履歴は既読記事として扱われます。記事一覧の絞り込みから既読記事を確認できます。": "열람 기록은 읽은 기사로 처리됩니다. 기사 목록 필터에서 확인할 수 있습니다.", "アカウントを削除すると購読・タグ・記事の状態がすべて削除され、再ログインしても復元されません。": "계정을 삭제하면 구독, 태그, 기사 상태가 모두 삭제되며 다시 로그인해도 복구되지 않습니다.",
    "最終公開 {time}": "마지막 게시 {time}", "タグを編集": "태그 편집", "上へ": "위로", "下へ": "아래로", "記事取得中": "기사 가져오는 중", "更新停止中": "업데이트 중지됨", "しばらく更新なし": "최근 업데이트 없음", "名前を変更": "이름 변경", "サイトを開く": "사이트 열기", "初回取得を再試行": "첫 가져오기 다시 시도", "購読一覧へ戻る": "구독 목록으로 돌아가기", "購読詳細": "구독 상세", "購読名を変更（空欄でフィード名に戻す）": "구독 이름 변경(비우면 피드 이름 사용)", "空欄でフィード名に戻す": "비우면 피드 이름 사용", "変更": "변경", "コピー": "복사", "この購読を解除しますか？ブックマークした記事は残ります。": "이 구독을 취소할까요? 북마크한 기사는 유지됩니다.", "色": "색상", "色を解除": "색상 지우기", "編集": "편집", "解除": "지우기", "{count}件の購読": "구독 {count}개", "タグ「{name}」を削除しますか？購読は削除されません。": "태그 '{name}'을(를) 삭제할까요? 구독은 삭제되지 않습니다.", "検索": "검색", "購読名で検索": "구독 이름 검색", "状態": "상태", "すべて": "전체", "問題あり": "주의 필요", "取得中": "가져오는 중", "並び替え: {label}": "정렬: {label}", "最終取得": "마지막 가져오기", "並び順": "정렬 순서", "既読状態": "읽음 상태", "既読の扱い": "읽음 처리", "表示設定": "표시 설정", "メインナビゲーション": "주요 탐색", "サイドバー": "사이드바", "記事一覧": "기사 목록",
    "現在のページ": "현재 페이지", "読み上げるページを開いてください": "읽을 페이지를 열어 주세요", "読み上げを停止": "낭독 중지", "このページを読み上げ": "이 페이지 낭독", "読み上げできるページなし": "낭독할 페이지 없음", "リストに追加": "목록에 추가", "読み上げ設定": "낭독 설정", "内容": "내용", "本文を抽出": "본문 추출", "表示中の文章": "현재 표시된 텍스트", "ページ翻訳後に使うと、表示中の翻訳を読み上げます。": "페이지 번역 후 사용하면 현재 번역문을 낭독합니다.", "速度": "속도", "声": "음성", "自動": "자동", "読み上げ中": "낭독 중", "リスト": "목록", "リーディングリストを読み込んでいます…": "읽기 목록을 불러오는 중…", "リーディングリストに記事がありません。": "읽기 목록에 기사가 없습니다.", "削除": "삭제", "ログイン": "로그인", "登録": "가입", "ログアウト": "로그아웃", "アカウント作成": "계정 만들기", "ログインへ戻る": "로그인으로 돌아가기", "8文字以上のパスワード": "비밀번호(8자 이상)", "認証に失敗しました。": "인증에 실패했습니다.", "認証トークンを取得できませんでした。": "인증 토큰을 가져오지 못했습니다.", "ログインが必要です。": "로그인이 필요합니다.", "APIへの接続に失敗しました。": "API에 연결하지 못했습니다.", "拡張機能を操作できませんでした。": "확장 프로그램을 조작하지 못했습니다.", "読み上げできるページがありません。": "낭독할 페이지가 없습니다.", "追加できるページがありません。": "추가할 페이지가 없습니다.", "ページ本文を読み込めませんでした。ページを再読み込みしてからもう一度お試しください。": "페이지를 읽지 못했습니다. 페이지를 새로 고친 후 다시 시도하세요.", "このページから読み上げる文章を取得できませんでした。": "이 페이지에서 낭독할 텍스트를 찾지 못했습니다.", "音声の再生を開始できませんでした。読み上げ音声の設定を確認してください。": "오디오를 시작하지 못했습니다. 낭독 음성 설정을 확인하세요.", "再生中のセッションがありません。": "활성 낭독 세션이 없습니다.",
  },
  es: {
    "サインアウト中…": "Cerrando sesión…", "記事を追加": "Añadir artículo", "URLをリーディングリストに保存します。": "Guarda la URL en tu lista de lectura.", "記事URL": "URL del artículo", "保存中…": "Guardando…", "完了": "Completado", "RSS/Atom URL または サイトURL": "URL RSS/Atom o URL del sitio", "新規タグ（カンマ区切り）": "Nuevas etiquetas (separadas por comas)", "再試行中…": "Reintentando…", "記事一覧へ": "Ver artículos", "ショートカット": "Atajos", "タグ: {name} ✕": "Etiqueta: {name} ✕",
    "認証に失敗しました。メールアドレスとパスワードを確認してください。": "El inicio de sesión falló. Comprueba tu correo y contraseña.", "認証に失敗しました。しばらくしてからもう一度お試しください。": "La autenticación falló. Inténtalo de nuevo más tarde.", "メールアドレス": "Correo electrónico", "パスワード": "Contraseña", "処理中…": "Procesando…", "サインイン": "Iniciar sesión", "パスワードをお忘れですか？": "¿Olvidaste tu contraseña?", "サインインへ戻る": "Volver a iniciar sesión", "リセットメールを送信": "Enviar correo de restablecimiento", "送信中…": "Enviando…", "パスワードリセット用のメールを送信しました。メール内のリンクを開いて新しいパスワードを設定してください。": "Hemos enviado un correo para restablecer la contraseña. Abre el enlace para crear una nueva.", "登録済みのメールアドレスにパスワードリセット用のリンクを送信します。": "Enviaremos un enlace de restablecimiento a tu correo registrado.", "このリセットリンクは無効です。もう一度リセットをリクエストしてください。": "Este enlace no es válido. Solicita otro enlace.", "パスワードが一致しません。": "Las contraseñas no coinciden.", "パスワードを変更できませんでした。リンクの有効期限が切れている可能性があります。": "No se pudo cambiar la contraseña. El enlace puede haber caducado.", "パスワードを変更できませんでした。しばらくしてからもう一度お試しください。": "No se pudo cambiar la contraseña. Inténtalo más tarde.", "パスワードを変更しました。新しいパスワードでサインインしてください。": "Contraseña cambiada. Inicia sesión con la nueva contraseña.", "サインインへ進む": "Continuar al inicio de sesión", "新しいパスワード": "Nueva contraseña", "新しいパスワード（確認）": "Confirmar nueva contraseña", "変更中…": "Cambiando…", "パスワードを変更": "Cambiar contraseña",
    "アカウントの削除が完了しました。ご利用ありがとうございました。": "Tu cuenta se ha eliminado. Gracias por usar Filo.", "再ログインしてもデータは復元されません。": "Los datos no se pueden recuperar al volver a iniciar sesión.", "削除処理は自動的に再試行されます。時間をおいてもこの状態が続く場合はお問い合わせください。": "La eliminación se reintentará automáticamente. Contacta con soporte si continúa.", "進行中の削除処理はありません。": "No hay ninguna eliminación en curso.", "削除処理中（{status}）…": "Eliminación en curso ({status})…", "待機中": "en espera", "実行中": "en curso", "アカウントとデータを削除しています。このまましばらくお待ちください。": "Se están eliminando tu cuenta y tus datos. Espera un momento.", "この画面を閉じても削除処理は継続されます。再ログインでデータが復活することはありません。": "La eliminación continúa aunque cierres esta página. Volver a iniciar sesión no recuperará los datos.",
    "購読は作成されましたが、{message}": "La suscripción se creó, pero {message}", "OPMLファイル": "Archivo OPML", "追加 {created} / スキップ {skipped} / 失敗 {failed}": "Añadidos {created} / Omitidos {skipped} / Fallidos {failed}", "閲覧履歴は既読記事として扱われます。記事一覧の絞り込みから既読記事を確認できます。": "El historial de lectura se trata como artículos leídos. Usa los filtros para verlos.", "アカウントを削除すると購読・タグ・記事の状態がすべて削除され、再ログインしても復元されません。": "Eliminar la cuenta borra suscripciones, etiquetas y estados de artículos. No se pueden restaurar.",
    "最終公開 {time}": "Última publicación {time}", "タグを編集": "Editar etiquetas", "上へ": "Subir", "下へ": "Bajar", "記事取得中": "Obteniendo artículos", "更新停止中": "Actualizaciones pausadas", "しばらく更新なし": "Sin actualizaciones recientes", "名前を変更": "Cambiar nombre", "サイトを開く": "Abrir sitio", "初回取得を再試行": "Reintentar obtención inicial", "購読一覧へ戻る": "Volver a suscripciones", "購読詳細": "Detalles de la suscripción", "購読名を変更（空欄でフィード名に戻す）": "Cambiar nombre (vacío para usar el nombre del feed)", "空欄でフィード名に戻す": "Vacío para usar el nombre del feed", "変更": "Cambiar", "コピー": "Copiar", "この購読を解除しますか？ブックマークした記事は残ります。": "¿Cancelar esta suscripción? Los artículos guardados permanecerán.", "色": "Color", "色を解除": "Quitar color", "編集": "Editar", "解除": "Quitar", "{count}件の購読": "{count} suscripciones", "タグ「{name}」を削除しますか？購読は削除されません。": "¿Eliminar la etiqueta “{name}”? Las suscripciones no se eliminarán.", "検索": "Buscar", "購読名で検索": "Buscar suscripciones", "状態": "Estado", "すべて": "Todo", "問題あり": "Requiere atención", "取得中": "Obteniendo", "並び替え: {label}": "Ordenar: {label}", "最終取得": "Última obtención", "並び順": "Orden", "既読状態": "Estado de lectura", "既読の扱い": "Gestión de leídos", "表示設定": "Configuración de vista", "メインナビゲーション": "Navegación principal", "サイドバー": "Barra lateral", "記事一覧": "Lista de artículos",
    "現在のページ": "Página actual", "読み上げるページを開いてください": "Abre una página para leerla en voz alta", "読み上げを停止": "Detener lectura", "このページを読み上げ": "Leer esta página en voz alta", "読み上げできるページなし": "No hay ninguna página legible", "リストに追加": "Añadir a la lista", "読み上げ設定": "Configuración de lectura", "内容": "Contenido", "本文を抽出": "Extraer artículo", "表示中の文章": "Texto visible", "ページ翻訳後に使うと、表示中の翻訳を読み上げます。": "Úsalo después de traducir una página para leer la traducción visible.", "速度": "Velocidad", "声": "Voz", "自動": "Automático", "読み上げ中": "Leyendo en voz alta", "リスト": "Lista", "リーディングリストを読み込んでいます…": "Cargando lista de lectura…", "リーディングリストに記事がありません。": "No hay artículos en la lista de lectura.", "削除": "Eliminar", "ログイン": "Iniciar sesión", "登録": "Registrarse", "ログアウト": "Cerrar sesión", "アカウント作成": "Crear cuenta", "ログインへ戻る": "Volver a iniciar sesión", "8文字以上のパスワード": "Contraseña (8 caracteres o más)", "認証に失敗しました。": "La autenticación falló.", "認証トークンを取得できませんでした。": "No se pudo obtener el token de autenticación.", "ログインが必要です。": "Inicia sesión.", "APIへの接続に失敗しました。": "No se pudo conectar con la API.", "拡張機能を操作できませんでした。": "No se pudo controlar la extensión.", "読み上げできるページがありません。": "No hay ninguna página que leer.", "追加できるページがありません。": "No hay ninguna página que añadir.", "ページ本文を読み込めませんでした。ページを再読み込みしてからもう一度お試しください。": "No se pudo leer la página. Recárgala e inténtalo de nuevo.", "このページから読み上げる文章を取得できませんでした。": "No se encontró texto para leer en esta página.", "音声の再生を開始できませんでした。読み上げ音声の設定を確認してください。": "No se pudo iniciar el audio. Comprueba la configuración de voz.", "再生中のセッションがありません。": "No hay ninguna sesión de lectura activa.",
  },
};

const MORE_MESSAGES: Record<SupportedLanguage, MessageCatalog> = {
  ja: {},
  en: {
    "このフィードを更新": "Refresh this feed", "アカウントを作成": "Create account", "キャンセル": "Cancel", "ショートカットヘルプ": "Keyboard shortcuts", "ブックマークを解除": "Remove bookmark", "リセットメールを送信できませんでした。しばらくしてからもう一度お試しください。": "Could not send the reset email. Please try again later.", "リセットメールを送信できませんでした。メールアドレスを確認してください。": "Could not send the reset email. Check the email address.", "保存": "Save", "取得待ち": "Waiting to fetch", "操作": "Actions", "既読で並び替えない": "Do not sort by read status", "既読は上": "Read first", "既読は下": "Read last", "条件に一致する購読がありません。": "No subscriptions match the filters.", "約{seconds}秒ごとに自動更新": "Automatically refreshes about every {seconds} seconds", "購読一覧（{count}）": "Subscriptions ({count})", "更新異常": "Update error", "Webを開く": "Open web app", "ログイン状態を確認しています…": "Checking sign-in status…", "J / ↓  次の記事": "J / ↓  Next article", "K / ↑  前の記事": "K / ↑  Previous article", "Enter / O  記事を開く": "Enter / O  Open article", "V  元記事を開く": "V  Open original", "M  既読／未読": "M  Mark read / unread", "S  リーディングリストに追加": "S  Add to reading list", "B  ブックマーク": "B  Bookmark", "R  更新": "R  Refresh", "Shift+A  すべて既読": "Shift+A  Mark all as read", "Space  読み上げ開始／停止": "Space  Start / stop reading aloud", "Esc  ポップアップを閉じる": "Esc  Close popup", "English": "English", "简体中文": "Simplified Chinese", "한국어": "Korean", "Español": "Spanish",
  },
  zh: {
    "このフィードを更新": "刷新此订阅源", "アカウントを作成": "创建账户", "キャンセル": "取消", "ショートカットヘルプ": "键盘快捷键", "ブックマークを解除": "取消收藏", "リセットメールを送信できませんでした。しばらくしてからもう一度お試しください。": "无法发送重置邮件，请稍后重试。", "リセットメールを送信できませんでした。メールアドレスを確認してください。": "无法发送重置邮件，请检查邮箱地址。", "保存": "保存", "取得待ち": "等待获取", "操作": "操作", "既読で並び替えない": "不按已读状态排序", "既読は上": "已读优先", "既読は下": "已读置后", "条件に一致する購読がありません。": "没有符合条件的订阅。", "約{seconds}秒ごとに自動更新": "约每 {seconds} 秒自动刷新", "購読一覧（{count}）": "订阅列表（{count}）", "更新異常": "更新异常", "Webを開く": "打开 Web 应用", "ログイン状態を確認しています…": "正在检查登录状态…", "J / ↓  次の記事": "J / ↓  下一篇文章", "K / ↑  前の記事": "K / ↑  上一篇文章", "Enter / O  記事を開く": "Enter / O  打开文章", "V  元記事を開く": "V  打开原文", "M  既読／未読": "M  标记已读/未读", "S  リーディングリストに追加": "S  加入阅读列表", "B  ブックマーク": "B  收藏", "R  更新": "R  刷新", "Shift+A  すべて既読": "Shift+A  全部标记为已读", "Space  読み上げ開始／停止": "Space  开始/停止朗读", "Esc  ポップアップを閉じる": "Esc  关闭弹窗", "English": "英语", "简体中文": "简体中文", "한국어": "韩语", "Español": "西班牙语",
  },
  ko: {
    "このフィードを更新": "이 피드 새로고침", "アカウントを作成": "계정 만들기", "キャンセル": "취소", "ショートカットヘルプ": "키보드 단축키", "ブックマークを解除": "북마크 해제", "リセットメールを送信できませんでした。しばらくしてからもう一度お試しください。": "재설정 이메일을 보내지 못했습니다. 나중에 다시 시도하세요.", "リセットメールを送信できませんでした。メールアドレスを確認してください。": "재설정 이메일을 보내지 못했습니다. 이메일 주소를 확인하세요.", "保存": "저장", "取得待ち": "가져오기 대기", "操作": "작업", "既読で並び替えない": "읽음 상태로 정렬하지 않음", "既読は上": "읽은 항목 먼저", "既読は下": "읽은 항목 나중", "条件に一致する購読がありません。": "조건에 맞는 구독이 없습니다.", "約{seconds}秒ごとに自動更新": "약 {seconds}초마다 자동 새로고침", "購読一覧（{count}）": "구독 목록({count})", "更新異常": "업데이트 오류", "Webを開く": "웹 앱 열기", "ログイン状態を確認しています…": "로그인 상태 확인 중…", "J / ↓  次の記事": "J / ↓  다음 기사", "K / ↑  前の記事": "K / ↑  이전 기사", "Enter / O  記事を開く": "Enter / O  기사 열기", "V  元記事を開く": "V  원문 열기", "M  既読／未読": "M  읽음/읽지 않음 표시", "S  リーディングリストに追加": "S  읽기 목록에 추가", "B  ブックマーク": "B  북마크", "R  更新": "R  새로고침", "Shift+A  すべて既読": "Shift+A  모두 읽음으로 표시", "Space  読み上げ開始／停止": "Space  음성 읽기 시작/중지", "Esc  ポップアップを閉じる": "Esc  팝업 닫기", "English": "영어", "简体中文": "중국어(간체)", "한국어": "한국어", "Español": "스페인어",
  },
  es: {
    "このフィードを更新": "Actualizar este feed", "アカウントを作成": "Crear cuenta", "キャンセル": "Cancelar", "ショートカットヘルプ": "Atajos de teclado", "ブックマークを解除": "Quitar marcador", "リセットメールを送信できませんでした。しばらくしてからもう一度お試しください。": "No se pudo enviar el correo de restablecimiento. Inténtalo más tarde.", "リセットメールを送信できませんでした。メールアドレスを確認してください。": "No se pudo enviar el correo de restablecimiento. Comprueba la dirección.", "保存": "Guardar", "取得待ち": "Pendiente de obtención", "操作": "Acciones", "既読で並び替えない": "No ordenar por leído", "既読は上": "Leídos primero", "既読は下": "Leídos al final", "条件に一致する購読がありません。": "Ninguna suscripción coincide con los filtros.", "約{seconds}秒ごとに自動更新": "Se actualiza automáticamente cada {seconds} segundos aproximadamente", "購読一覧（{count}）": "Suscripciones ({count})", "更新異常": "Error de actualización", "Webを開く": "Abrir aplicación web", "ログイン状態を確認しています…": "Comprobando el estado de la sesión…", "J / ↓  次の記事": "J / ↓  Siguiente artículo", "K / ↑  前の記事": "K / ↑  Artículo anterior", "Enter / O  記事を開く": "Enter / O  Abrir artículo", "V  元記事を開く": "V  Abrir original", "M  既読／未読": "M  Marcar leído/no leído", "S  リーディングリストに追加": "S  Añadir a la lista de lectura", "B  ブックマーク": "B  Marcador", "R  更新": "R  Actualizar", "Shift+A  すべて既読": "Shift+A  Marcar todo como leído", "Space  読み上げ開始／停止": "Space  Iniciar/detener lectura", "Esc  ポップアップを閉じる": "Esc  Cerrar ventana emergente", "English": "Inglés", "简体中文": "Chino simplificado", "한국어": "Coreano", "Español": "Español",
  },
};

const STATUS_MESSAGES: Record<SupportedLanguage, MessageCatalog> = {
  ja: {},
  en: { "件のフィードの取得を開始しました。": " feeds queued for fetching." },
  zh: { "件のフィードの取得を開始しました。": " 个订阅源已开始获取。" },
  ko: { "件のフィードの取得を開始しました。": "개 피드 가져오기를 시작했습니다." },
  es: { "件のフィードの取得を開始しました。": " feeds añadidos a la cola." },
};

// UI copy is keyed by the Japanese source phrase so existing call sites stay
// readable. Missing entries intentionally fall back to the source phrase;
// this also makes adding a new screen safe before its translations are ready.
const CATALOGS: Record<SupportedLanguage, MessageCatalog> = {
  ja: {},
  en: {
    ...EXTRA_MESSAGES.en,
    ...MORE_MESSAGES.en,
    ...STATUS_MESSAGES.en,
    "閲覧開始": "Start reading", "読み上げ開始": "Start listening", "未読の記事がありません。": "There are no unread articles.",
    "メニュー": "Menu", "閉じる": "Close", "戻る": "Back", "展開": "Expand", "折りたたむ": "Collapse",
    "フィードを追加": "Add feed", "全ての記事": "All articles", "リーディングリスト": "Reading list", "ブックマーク": "Bookmarks",
    "フィード": "Feeds", "購読管理": "Subscriptions", "タグ管理": "Tags", "処理ステータス": "Status", "設定": "Settings",
    "タグなし": "No tag", "未読": "Unread", "既読": "Read", "未読のみ": "Unread only", "既読のみ": "Read only",
    "未読にする": "Mark unread", "既読にする": "Mark read", "翻訳": "Translation", "原文": "Original", "タイトルを翻訳": "Translate titles", "翻訳の準備": "Prepare translation", "言語を確認": "Check languages", "タイトルの翻訳はこの端末の中で行います。はじめに、翻訳したい言語をダウンロードしてください。": "Titles are translated on this device. Start by downloading the languages you want to translate.", "確認しています…": "Checking…", "購読しているフィードに、翻訳が必要な言語はありません。": "None of your subscriptions need translation.", "準備済み": "Ready", "ダウンロード": "Download", "ダウンロード中…": "Downloading…", "このブラウザでは非対応": "Not supported in this browser", "ここに無い言語の記事は、翻訳せず原文のまま表示します。": "Articles in languages not listed here stay in their original language.", "一覧の翻訳トグルは、タイトルをこの言語へ翻訳します。": "The translate toggle in the list translates titles into this language.", "原文タイトルに戻す": "Show original titles",
    "翻訳モデルをダウンロードしています…": "Downloading translation model…", "翻訳エンジンを初期化しています…": "Initializing translation engine…", "翻訳モデルの準備が完了しました。": "Translation model is ready.", "翻訳モデルの準備に失敗しました。": "Failed to prepare the translation model.", "翻訳モデルの準備に失敗しました。通信状況を確認して、もう一度お試しください。": "Failed to prepare the translation model. Check your connection and try again.", "翻訳モデルを準備しています…": "Preparing translation model…", "進捗を確認しています…": "Checking progress…",
    "リーディングリストから削除": "Remove from reading list", "リーディングリストに追加": "Add to reading list",
    "読み上げキューから削除": "Remove from speech queue", "読み上げキューに追加": "Add to speech queue",
    "元記事を開く": "Open original", "この記事から読み上げる": "Read from this article", "Extension で読み上げる": "Read in the extension", "読み上げには Extension が必要です": "Reading aloud needs the extension", "読み上げについて": "About reading aloud",
    "読み込み中…": "Loading…", "更新": "Refresh", "更新中…": "Refreshing…", "再読み込み": "Reload",
    "フィードを更新": "Refresh feeds", "フィードを更新しています…": "Refreshing feeds…", "すべて既読にする": "Mark all as read", "既読記事を削除": "Remove read articles", "既読の記事をリーディングリストから削除しますか？": "Remove read articles from the reading list?",
    "まだ購読がありません。": "You have no subscriptions yet.", "記事を取得しています…": "Fetching articles…", "表示できる記事がありません。": "No articles to display.",
    "フィードを確認中…": "Checking feed…", "追加": "Add", "追加完了": "Added", "記事の取得が完了しています。": "Articles are ready.",
    "記事取得中": "Fetching articles", "購読の追加は完了しました。記事を取得しています。": "Subscription added. Fetching articles.", "初回取得失敗": "Initial fetch failed",
    "タグ": "Tag", "新しいタグ名": "New tag name", "タグがありません。上の入力欄から作成できます。": "No tags. Create one above.",
    "すべて取得": "Fetch all", "取得中…": "Fetching…", "翻訳中…": "Translating…", "取得": "Fetch", "取得失敗": "Fetch failed", 
    "購読一覧": "Subscriptions", "購読がありません。": "No subscriptions.", "購読が見つかりません": "Subscription not found", "この購読は削除されたか、表示できません。": "This subscription was deleted or cannot be displayed.",
    "購読解除": "Unsubscribe", "購読の操作": "Subscription actions", "フィードURLを表示": "Show feed URL", "フィードURL": "Feed URL",
    "アカウント削除": "Delete account", "削除完了": "Deleted", "削除処理に失敗しました": "Deletion failed", "削除処理中": "Deleting", "設定へ戻る": "Back to settings",
    "削除する": "Delete", "サインアウト": "Sign out", "アカウント削除を実行": "Delete account", "テーマ": "Theme", "表示": "Display", "言語": "Language",
    "日本語": "Japanese", "原文のまま読む言語": "Languages to read in original", "記事の並び順": "Article order",
    "システムに合わせる": "System", "ライト": "Light", "ダーク": "Dark", "公開日時が新しい順": "Newest published first", "取得日時が新しい順": "Newest fetched first", "リンクを常にブラウザで開く": "Always open links in browser",
    "選択した言語の記事は翻訳せず原文で表示します。": "Articles in selected languages are shown in their original language.",
    "インポート": "Import", "エクスポート": "Export", "アップロード中…": "Uploading…", "インポート処理中…": "Importing…", "インポート完了": "Import complete", "インポート失敗": "Import failed", "既読履歴について": "Read history", "再試行": "Retry",
    "読み上げキュー": "Speech queue", "キューから削除": "Remove from queue", "前の記事": "Previous article", "次の記事": "Next article", "キューを表示": "Show queue", "読み上げ速度": "Speech speed",
    "キューを空にする": "Clear queue", "この記事から再生": "Play from this article", "上へ移動": "Move up", "下へ移動": "Move down", "一時停止": "Pause", "再生": "Play", "自動": "Automatic", "読み上げ音声": "Speech voice",
    "セッション": "Session", "危険な操作": "Dangerous actions", "状態を確認しています…": "Checking status…", "停止": "Paused", "中断": "stalled", "完了": "Done", "失敗": "failed", "中": "running", "待ち": "pending", "残り": "remaining", "購読": "subscriptions", "記事": "articles", "取得対象のフィードがありません。": "There are no feeds to fetch.", "件のフィードの取得を開始しました。": " feeds queued for fetching.", "フィードの取得を開始しました。": "Feed fetch started.", "このフィードを取得": "Fetch this feed", "タグ名を変更": "Rename tag", "フィード追加": "Add feed", "タグを上へ": "Move tag up", "タグを下へ": "Move tag down", "名前変更": "Rename",
    "アカウントを削除しますか？この操作は取り消せません。": "Delete your account? This cannot be undone.", "を削除しますか？購読は削除されません。": "? Subscriptions will not be deleted.", "を削除しますか？": "?", "最近取得済みのため、今回の取得対象はありませんでした。": "Everything was fetched recently; nothing was queued.", "取得に時間がかかっています。あとで再度更新してください。": "Fetching is taking longer than expected. Try again later.", "すべての購読": "all subscriptions", "の記事をすべて既読にしますか？": " articles? Mark all as read.", "リーディングリストに保存した記事はありません。": "There are no saved articles.",
    "ネットワークに接続できません。時間をおいて再試行してください。": "Unable to connect. Please try again later.",
    "サインインが必要です。": "Please sign in.", "入力内容を確認してください。": "Please check your input.", "対象が見つかりません。": "Not found.",
    "サーバーエラーが発生しました。時間をおいて再試行してください。": "A server error occurred. Please try again later.",
    "フィードに接続できませんでした。": "Unable to connect to the feed.", "フィードを見つけられませんでした。": "Could not find a feed.",
    "初回の記事取得に失敗しました。": "Initial article fetch failed.",
  },
  zh: {
    ...EXTRA_MESSAGES.zh,
    ...MORE_MESSAGES.zh,
    ...STATUS_MESSAGES.zh,
    ...TRANSLATION_PROGRESS_MESSAGES.zh,
    "閲覧開始": "开始阅读", "読み上げ開始": "开始朗读", "未読の記事がありません。": "没有未读文章。",
    "メニュー": "菜单", "閉じる": "关闭", "戻る": "返回", "展開": "展开", "折りたたむ": "收起", "フィードを追加": "添加订阅源", "全ての記事": "全部文章", "リーディングリスト": "阅读列表", "ブックマーク": "书签", "フィード": "订阅源", "購読管理": "订阅管理", "タグ管理": "标签管理", "処理ステータス": "处理状态", "設定": "设置", "タグなし": "无标签",
    "未読": "未读", "既読": "已读", "未読のみ": "仅未读", "既読のみ": "仅已读", "未読にする": "标为未读", "既読にする": "标为已读", "翻訳": "翻译", "原文": "原文", "タイトルを翻訳": "翻译标题", "翻訳の準備": "翻译准备", "言語を確認": "查看语言", "タイトルの翻訳はこの端末の中で行います。はじめに、翻訳したい言語をダウンロードしてください。": "标题翻译在本设备上进行。请先下载需要翻译的语言。", "確認しています…": "正在确认…", "購読しているフィードに、翻訳が必要な言語はありません。": "您的订阅中没有需要翻译的语言。", "準備済み": "已就绪", "ダウンロード": "下载", "ダウンロード中…": "下载中…", "このブラウザでは非対応": "此浏览器不支持", "ここに無い言語の記事は、翻訳せず原文のまま表示します。": "未列出语言的文章将以原文显示。", "一覧の翻訳トグルは、タイトルをこの言語へ翻訳します。": "列表中的翻译开关会将标题翻译成该语言。", "原文タイトルに戻す": "显示原文标题", "リーディングリストから削除": "从阅读列表移除", "リーディングリストに追加": "加入阅读列表", "読み上げキューから削除": "从朗读队列移除", "読み上げキューに追加": "加入朗读队列", "読み込み中…": "加载中…", "更新": "刷新", "更新中…": "刷新中…", "再読み込み": "重新加载", "フィードを更新": "刷新订阅源", "フィードを更新しています…": "正在刷新订阅源…", "すべて既読にする": "全部标为已读", "既読記事を削除": "移除已读文章", "既読の記事をリーディングリストから削除しますか？": "要从阅读列表中移除已读文章吗？",
    "元記事を開く": "打开原文", "この記事から読み上げる": "从此文章开始朗读", "Extension で読み上げる": "在扩展中朗读", "読み上げには Extension が必要です": "朗读需要安装扩展", "読み上げについて": "关于朗读",
    "まだ購読がありません。": "还没有订阅。", "記事を取得しています…": "正在获取文章…", "表示できる記事がありません。": "没有可显示的文章。", "フィードを確認中…": "正在检查订阅源…", "追加": "添加", "追加完了": "已添加", "記事取得中": "正在获取文章", "タグ": "标签", "新しいタグ名": "新标签名称", "すべて取得": "全部获取", "取得中…": "获取中…", "翻訳中…": "翻译中…", "取得": "获取", "取得失敗": "获取失败", "購読一覧": "订阅列表", "購読がありません。": "没有订阅。", "購読が見つかりません": "找不到订阅", "購読解除": "取消订阅", "購読の操作": "订阅操作", "フィードURLを表示": "显示订阅源 URL", "フィードURL": "订阅源 URL", "アカウント削除": "删除账户", "削除完了": "已删除", "削除する": "删除", "サインアウト": "退出登录", "テーマ": "主题", "表示": "显示", "言語": "语言", "日本語": "日语", "原文のまま読む言語": "按原文阅读的语言", "記事の並び順": "文章排序", "システムに合わせる": "跟随系统", "ライト": "浅色", "ダーク": "深色", "公開日時が新しい順": "按发布时间从新到旧", "取得日時が新しい順": "按获取时间从新到旧", "リンクを常にブラウザで開く": "始终在浏览器中打开链接", "選択した言語の記事は翻訳せず原文で表示します。": "所选语言的文章将以原文显示。", "インポート": "导入", "エクスポート": "导出", "アップロード中…": "上传中…", "インポート処理中…": "导入中…", "インポート完了": "导入完成", "インポート失敗": "导入失败", "既読履歴について": "已读记录", "再試行": "重试", "読み上げキュー": "朗读队列", "キューから削除": "从队列移除", "前の記事": "上一篇", "次の記事": "下一篇", "キューを表示": "显示队列", "読み上げ速度": "朗读速度",
    "キューを空にする": "清空队列", "この記事から再生": "从此文章播放", "上へ移動": "上移", "下へ移動": "下移", "一時停止": "暂停", "再生": "播放", "自動": "自动", "読み上げ音声": "朗读语音", "セッション": "会话", "危険な操作": "危险操作", "状態を確認しています…": "正在检查状态…", "停止": "已暂停", "中断": "已中断", "失敗": "失败", "中": "进行中", "待ち": "等待中", "残り": "剩余", "購読": "订阅", "記事": "文章", "完了": "完成", "取得対象のフィードがありません。": "没有可获取的订阅源。", "フィードの取得を開始しました。": "已开始获取订阅源。", "このフィードを取得": "获取此订阅源", "タグ名を変更": "重命名标签", "フィード追加": "添加订阅源", "タグを上へ": "标签上移", "タグを下へ": "标签下移", "名前変更": "重命名", "アカウントを削除しますか？この操作は取り消せません。": "确定删除账户吗？此操作无法撤销。", "最近取得済みのため、今回の取得対象はありませんでした。": "最近已获取过，本次没有新的获取任务。", "取得に時間がかかっています。あとで再度更新してください。": "获取时间较长，请稍后重试。", "すべての購読": "全部订阅", "リーディングリストに保存した記事はありません。": "阅读列表中没有保存的文章。",
  },
  ko: {
    ...EXTRA_MESSAGES.ko,
    ...MORE_MESSAGES.ko,
    ...STATUS_MESSAGES.ko,
    ...TRANSLATION_PROGRESS_MESSAGES.ko,
    "閲覧開始": "읽기 시작", "読み上げ開始": "낭독 시작", "未読の記事がありません。": "읽지 않은 기사가 없습니다.",
    "メニュー": "메뉴", "閉じる": "닫기", "戻る": "뒤로", "展開": "펼치기", "折りたたむ": "접기", "フィードを追加": "피드 추가", "全ての記事": "모든 기사", "リーディングリスト": "읽기 목록", "ブックマーク": "북마크", "フィード": "피드", "購読管理": "구독 관리", "タグ管理": "태그 관리", "処理ステータス": "처리 상태", "設定": "설정", "タグなし": "태그 없음", "未読": "읽지 않음", "既読": "읽음", "未読のみ": "읽지 않은 항목만", "既読のみ": "읽은 항목만", "未読にする": "읽지 않음으로 표시", "既読にする": "읽음으로 표시", "翻訳": "번역", "原文": "원문", "タイトルを翻訳": "제목 번역", "翻訳の準備": "번역 준비", "言語を確認": "언어 확인", "タイトルの翻訳はこの端末の中で行います。はじめに、翻訳したい言語をダウンロードしてください。": "제목 번역은 이 기기에서 처리합니다. 먼저 번역할 언어를 다운로드하세요.", "確認しています…": "확인 중…", "購読しているフィードに、翻訳が必要な言語はありません。": "구독 중인 피드에 번역이 필요한 언어가 없습니다.", "準備済み": "준비됨", "ダウンロード": "다운로드", "ダウンロード中…": "다운로드 중…", "このブラウザでは非対応": "이 브라우저에서는 지원되지 않음", "ここに無い言語の記事は、翻訳せず原文のまま表示します。": "여기에 없는 언어의 기사는 원문으로 표시합니다.", "一覧の翻訳トグルは、タイトルをこの言語へ翻訳します。": "목록의 번역 토글은 제목을 이 언어로 번역합니다.", "原文タイトルに戻す": "원문 제목 보기", "リーディングリストから削除": "읽기 목록에서 삭제", "リーディングリストに追加": "읽기 목록에 추가", "読み上げキューから削除": "음성 큐에서 삭제", "読み上げキューに追加": "음성 큐에 추가", "読み込み中…": "로드 중…", "更新": "새로고침", "更新中…": "새로고침 중…", "再読み込み": "다시 로드", "フィードを更新": "피드 새로고침", "フィードを更新しています…": "피드를 새로고침하는 중…", "すべて既読にする": "모두 읽음으로 표시", "まだ購読がありません。": "아직 구독이 없습니다.", "記事を取得しています…": "기사를 가져오는 중…", "表示できる記事がありません。": "표시할 기사가 없습니다.", "フィードを確認中…": "피드를 확인하는 중…", "追加": "추가", "追加完了": "추가됨", "記事取得中": "기사 가져오는 중", "タグ": "태그", "新しいタグ名": "새 태그 이름", "すべて取得": "모두 가져오기", "取得中…": "가져오는 중…", "翻訳中…": "번역 중…", "取得": "가져오기", "取得失敗": "가져오기 실패", "購読一覧": "구독 목록", "購読がありません。": "구독이 없습니다.", "購読が見つかりません": "구독을 찾을 수 없습니다", "購読解除": "구독 취소", "購読の操作": "구독 작업", "フィードURLを表示": "피드 URL 보기", "フィードURL": "피드 URL", "アカウント削除": "계정 삭제", "削除完了": "삭제됨", "削除する": "삭제", "サインアウト": "로그아웃", "テーマ": "테마", "表示": "표시", "言語": "언어", "日本語": "일본어", "原文のまま読む言語": "원문으로 읽을 언어", "記事の並び順": "기사 정렬", "システムに合わせる": "시스템 설정", "ライト": "라이트", "ダーク": "다크", "公開日時が新しい順": "게시일 최신순", "取得日時が新しい順": "가져온 시간 최신순", "リンクを常にブラウザで開く": "항상 브라우저에서 링크 열기", "選択した言語の記事は翻訳せず原文で表示します。": "선택한 언어의 기사는 번역하지 않고 원문으로 표시합니다.", "インポート": "가져오기", "エクスポート": "내보내기", "アップロード中…": "업로드 중…", "インポート処理中…": "가져오는 중…", "インポート完了": "가져오기 완료", "インポート失敗": "가져오기 실패", "既読履歴について": "읽은 기록", "再試行": "다시 시도", "読み上げキュー": "음성 큐", "キューから削除": "큐에서 삭제", "前の記事": "이전 기사", "次の記事": "다음 기사", "キューを表示": "큐 표시", "読み上げ速度": "음성 속도",
    "キューを空にする": "큐 비우기", "この記事から再生": "이 기사부터 재생", "上へ移動": "위로 이동", "下へ移動": "아래로 이동", "一時停止": "일시정지", "再生": "재생", "自動": "자동", "読み上げ音声": "음성", "セッション": "세션", "危険な操作": "위험한 작업", "状態を確認しています…": "상태 확인 중…", "停止": "일시 중지됨", "中断": "중단됨", "失敗": "실패", "中": "진행 중", "待ち": "대기 중", "残り": "남음", "購読": "구독", "記事": "기사", "完了": "완료", "取得対象のフィードがありません。": "가져올 피드가 없습니다.", "フィードの取得を開始しました。": "피드 가져오기를 시작했습니다.", "このフィードを取得": "이 피드 가져오기", "タグ名を変更": "태그 이름 변경", "フィード追加": "피드 추가", "タグを上へ": "태그 위로", "タグを下へ": "태그 아래로", "名前変更": "이름 변경", "アカウントを削除しますか？この操作は取り消せません。": "계정을 삭제할까요? 되돌릴 수 없습니다.", "最近取得済みのため、今回の取得対象はありませんでした。": "최근에 가져와 이번에는 대상이 없습니다.", "取得に時間がかかっています。あとで再度更新してください。": "가져오는 데 시간이 걸립니다. 나중에 다시 시도하세요.", "すべての購読": "모든 구독", "リーディングリストに保存した記事はありません。": "저장된 기사가 없습니다.",
  },
  es: {
    ...EXTRA_MESSAGES.es,
    ...MORE_MESSAGES.es,
    ...STATUS_MESSAGES.es,
    ...TRANSLATION_PROGRESS_MESSAGES.es,
    "閲覧開始": "Empezar a leer", "読み上げ開始": "Empezar a escuchar", "未読の記事がありません。": "No hay artículos sin leer.",
    "メニュー": "Menú", "閉じる": "Cerrar", "戻る": "Atrás", "展開": "Expandir", "折りたたむ": "Contraer", "フィードを追加": "Añadir feed", "全ての記事": "Todos los artículos", "リーディングリスト": "Lista de lectura", "ブックマーク": "Marcadores", "フィード": "Feeds", "購読管理": "Suscripciones", "タグ管理": "Etiquetas", "処理ステータス": "Estado", "設定": "Ajustes", "タグなし": "Sin etiqueta", "未読": "No leídos", "既読": "Leídos", "未読のみ": "Solo no leídos", "既読のみ": "Solo leídos", "未読にする": "Marcar como no leído", "既読にする": "Marcar como leído", "翻訳": "Traducción", "原文": "Original", "タイトルを翻訳": "Traducir títulos", "翻訳の準備": "Preparar traducción", "言語を確認": "Ver idiomas", "タイトルの翻訳はこの端末の中で行います。はじめに、翻訳したい言語をダウンロードしてください。": "Los títulos se traducen en este dispositivo. Empieza descargando los idiomas que quieras traducir.", "確認しています…": "Comprobando…", "購読しているフィードに、翻訳が必要な言語はありません。": "Ninguna de tus suscripciones necesita traducción.", "準備済み": "Listo", "ダウンロード": "Descargar", "ダウンロード中…": "Descargando…", "このブラウザでは非対応": "No compatible con este navegador", "ここに無い言語の記事は、翻訳せず原文のまま表示します。": "Los artículos en idiomas no listados se muestran en su idioma original.", "一覧の翻訳トグルは、タイトルをこの言語へ翻訳します。": "El conmutador de traducción de la lista traduce los títulos a este idioma.", "原文タイトルに戻す": "Mostrar títulos originales", "リーディングリストから削除": "Quitar de la lista de lectura", "リーディングリストに追加": "Añadir a la lista de lectura", "読み上げキューから削除": "Quitar de la cola de voz", "読み上げキューに追加": "Añadir a la cola de voz", "読み込み中…": "Cargando…", "更新": "Actualizar", "更新中…": "Actualizando…", "再読み込み": "Recargar", "フィードを更新": "Actualizar feeds", "フィードを更新しています…": "Actualizando feeds…", "すべて既読にする": "Marcar todo como leído", "まだ購読がありません。": "Aún no tienes suscripciones.", "記事を取得しています…": "Obteniendo artículos…", "表示できる記事がありません。": "No hay artículos para mostrar.", "フィードを確認中…": "Comprobando feed…", "追加": "Añadir", "追加完了": "Añadido", "記事取得中": "Obteniendo artículos", "タグ": "Etiqueta", "新しいタグ名": "Nombre de la nueva etiqueta", "すべて取得": "Obtener todo", "取得中…": "Obteniendo…", "翻訳中…": "Traduciendo…", "取得": "Obtener", "取得失敗": "Error al obtener", "購読一覧": "Suscripciones", "購読がありません。": "No hay suscripciones.", "購読が見つかりません": "Suscripción no encontrada", "購読解除": "Cancelar suscripción", "購読の操作": "Acciones de suscripción", "フィードURLを表示": "Mostrar URL del feed", "フィードURL": "URL del feed", "アカウント削除": "Eliminar cuenta", "削除完了": "Eliminada", "削除する": "Eliminar", "サインアウト": "Cerrar sesión", "テーマ": "Tema", "表示": "Visualización", "言語": "Idioma", "日本語": "Japonés", "原文のまま読む言語": "Idiomas para leer en original", "記事の並び順": "Orden de artículos", "システムに合わせる": "Sistema", "ライト": "Claro", "ダーク": "Oscuro", "公開日時が新しい順": "Publicados más recientemente", "取得日時が新しい順": "Obtenidos más recientemente", "リンクを常にブラウザで開く": "Abrir siempre los enlaces en el navegador", "選択した言語の記事は翻訳せず原文で表示します。": "Los artículos en los idiomas seleccionados se muestran en su idioma original.", "インポート": "Importar", "エクスポート": "Exportar", "アップロード中…": "Subiendo…", "インポート処理中…": "Importando…", "インポート完了": "Importación completada", "インポート失敗": "Error de importación", "既読履歴について": "Historial de lectura", "再試行": "Reintentar", "読み上げキュー": "Cola de voz", "キューから削除": "Quitar de la cola", "前の記事": "Artículo anterior", "次の記事": "Artículo siguiente", "キューを表示": "Mostrar cola", "読み上げ速度": "Velocidad de voz",
    "キューを空にする": "Vaciar cola", "この記事から再生": "Reproducir desde este artículo", "上へ移動": "Subir", "下へ移動": "Bajar", "一時停止": "Pausar", "再生": "Reproducir", "自動": "Automático", "読み上げ音声": "Voz", "セッション": "Sesión", "危険な操作": "Acciones peligrosas", "状態を確認しています…": "Comprobando estado…", "停止": "Pausado", "中断": "Interrumpido", "失敗": "Error", "中": "en curso", "待ち": "pendiente", "残り": "restantes", "購読": "suscripciones", "記事": "artículos", "完了": "Completado", "取得対象のフィードがありません。": "No hay feeds para obtener.", "フィードの取得を開始しました。": "Se inició la obtención del feed.", "このフィードを取得": "Obtener este feed", "タグ名を変更": "Cambiar nombre de etiqueta", "フィード追加": "Añadir feed", "タグを上へ": "Subir etiqueta", "タグを下へ": "Bajar etiqueta", "名前変更": "Cambiar nombre", "アカウントを削除しますか？この操作は取り消せません。": "¿Eliminar tu cuenta? No se puede deshacer.", "最近取得済みのため、今回の取得対象はありませんでした。": "Todo se obtuvo recientemente; no hay tareas nuevas.", "取得に時間がかかっています。あとで再度更新してください。": "La obtención está tardando. Inténtalo más tarde.", "すべての購読": "todas las suscripciones", "リーディングリストに保存した記事はありません。": "No hay artículos guardados.",
  },
};

export function normalizeLanguage(value: unknown): SupportedLanguage {
  const raw = typeof value === "string" ? value.toLowerCase() : "";
  if (raw.startsWith("zh")) return "zh";
  if (raw.startsWith("ko")) return "ko";
  if (raw.startsWith("es")) return "es";
  if (raw.startsWith("en")) return "en";
  return "ja";
}

export function translate(source: string, language: SupportedLanguage, values?: Record<string, string | number>): string {
  let result = CATALOGS[language][source] ?? source;
  for (const [key, value] of Object.entries(values ?? {})) result = result.replaceAll(`{${key}}`, String(value));
  return result;
}

const ERROR_MESSAGES: Record<string, string> = {
  network_error: "ネットワークに接続できません。時間をおいて再試行してください。",
  unauthorized: "サインインが必要です。",
  forbidden: "この操作を行う権限がありません。",
  validation_error: "入力内容を確認してください。",
  resource_not_found: "対象が見つかりません。",
  conflict: "操作が競合しました。最新の状態を確認してください。",
  internal_error: "サーバーエラーが発生しました。時間をおいて再試行してください。",
  rate_limited: "操作が混み合っています。少し待ってから再試行してください。",
  subscription_already_exists: "このフィードはすでに購読しています。",
  subscription_not_found: "購読が見つかりません。",
  tag_already_exists: "同じ名前のタグがすでにあります。",
  tag_not_found: "タグが見つかりません。",
  article_not_found: "記事が見つかりません。",
  invalid_cursor: "ページ情報が無効です。再読み込みしてください。",
  feed_discovery_failed: "このURLからフィードを見つけられませんでした。",
  feed_unreachable: "URLに接続できませんでした。アドレスを確認してください。",
  initial_fetch_retry_not_allowed: "この購読は再試行できる状態ではありません。",
  opml_import_not_found: "インポートジョブが見つかりません。",
  language_detection_failed: "原文の言語を判定できませんでした。",
  account_deletion_failed: "アカウント削除処理に失敗しました。再試行してください。",
};

export function errorMessage(error: unknown, language: SupportedLanguage = "ja"): string {
  if (error instanceof ApiRequestError) return translate(ERROR_MESSAGES[error.code] ?? ERROR_MESSAGES.internal_error!, language);
  return translate(ERROR_MESSAGES.internal_error!, language);
}

const INITIAL_FETCH_ERROR_MESSAGES: Record<string, string> = {
  feed_unreachable: "フィードに接続できませんでした。",
  feed_discovery_failed: "フィードを見つけられませんでした。",
};

export function initialFetchErrorMessage(code: string | null, language: SupportedLanguage = "ja"): string {
  return translate((code && INITIAL_FETCH_ERROR_MESSAGES[code]) || "初回の記事取得に失敗しました。", language);
}
