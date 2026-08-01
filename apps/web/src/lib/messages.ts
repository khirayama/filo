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

// UI copy is keyed by the Japanese source phrase so existing call sites stay
// readable. Missing entries intentionally fall back to the source phrase;
// this also makes adding a new screen safe before its translations are ready.
const CATALOGS: Record<SupportedLanguage, MessageCatalog> = {
  ja: {},
  en: {
    "メニュー": "Menu", "閉じる": "Close", "戻る": "Back", "展開": "Expand", "折りたたむ": "Collapse",
    "フィードを追加": "Add feed", "全ての記事": "All articles", "リーディングリスト": "Reading list", "ブックマーク": "Bookmarks",
    "フィード": "Feeds", "購読管理": "Subscriptions", "タグ管理": "Tags", "処理ステータス": "Status", "設定": "Settings",
    "タグなし": "No tag", "未読": "Unread", "既読": "Read", "未読のみ": "Unread only", "既読のみ": "Read only",
    "未読にする": "Mark unread", "既読にする": "Mark read", "翻訳": "Translation", "原文": "Original", "タイトルを翻訳": "Translate titles", "翻訳の準備": "Prepare translation", "言語を確認": "Check languages", "タイトルの翻訳はこの端末の中で行います。はじめに、翻訳したい言語をダウンロードしてください。": "Titles are translated on this device. Start by downloading the languages you want to translate.", "確認しています…": "Checking…", "購読しているフィードに、翻訳が必要な言語はありません。": "None of your subscriptions need translation.", "準備済み": "Ready", "ダウンロード": "Download", "ダウンロード中…": "Downloading…", "このブラウザでは非対応": "Not supported in this browser", "ここに無い言語の記事は、翻訳せず原文のまま表示します。": "Articles in languages not listed here stay in their original language.", "一覧の翻訳トグルは、タイトルをこの言語へ翻訳します。": "The translate toggle in the list translates titles into this language.", "原文タイトルに戻す": "Show original titles",
    "リーディングリストから削除": "Remove from reading list", "リーディングリストに追加": "Add to reading list",
    "読み上げキューから削除": "Remove from speech queue", "読み上げキューに追加": "Add to speech queue",
    "元記事を開く": "Open original", "この記事から読み上げる": "Read from this article", "Extension で読み上げる": "Read in the extension", "読み上げには Extension が必要です": "Reading aloud needs the extension", "読み上げについて": "About reading aloud",
    "読み込み中…": "Loading…", "更新": "Refresh", "更新中…": "Refreshing…", "再読み込み": "Reload",
    "フィードを更新": "Refresh feeds", "フィードを更新しています…": "Refreshing feeds…", "すべて既読にする": "Mark all as read",
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
    "メニュー": "菜单", "閉じる": "关闭", "戻る": "返回", "展開": "展开", "折りたたむ": "收起", "フィードを追加": "添加订阅源", "全ての記事": "全部文章", "リーディングリスト": "阅读列表", "ブックマーク": "书签", "フィード": "订阅源", "購読管理": "订阅管理", "タグ管理": "标签管理", "処理ステータス": "处理状态", "設定": "设置", "タグなし": "无标签",
    "未読": "未读", "既読": "已读", "未読のみ": "仅未读", "既読のみ": "仅已读", "未読にする": "标为未读", "既読にする": "标为已读", "翻訳": "翻译", "原文": "原文", "タイトルを翻訳": "翻译标题", "翻訳の準備": "翻译准备", "言語を確認": "查看语言", "タイトルの翻訳はこの端末の中で行います。はじめに、翻訳したい言語をダウンロードしてください。": "标题翻译在本设备上进行。请先下载需要翻译的语言。", "確認しています…": "正在确认…", "購読しているフィードに、翻訳が必要な言語はありません。": "您的订阅中没有需要翻译的语言。", "準備済み": "已就绪", "ダウンロード": "下载", "ダウンロード中…": "下载中…", "このブラウザでは非対応": "此浏览器不支持", "ここに無い言語の記事は、翻訳せず原文のまま表示します。": "未列出语言的文章将以原文显示。", "一覧の翻訳トグルは、タイトルをこの言語へ翻訳します。": "列表中的翻译开关会将标题翻译成该语言。", "原文タイトルに戻す": "显示原文标题", "リーディングリストから削除": "从阅读列表移除", "リーディングリストに追加": "加入阅读列表", "読み上げキューから削除": "从朗读队列移除", "読み上げキューに追加": "加入朗读队列", "読み込み中…": "加载中…", "更新": "刷新", "更新中…": "刷新中…", "再読み込み": "重新加载", "フィードを更新": "刷新订阅源", "フィードを更新しています…": "正在刷新订阅源…", "すべて既読にする": "全部标为已读",
    "元記事を開く": "打开原文", "この記事から読み上げる": "从此文章开始朗读", "Extension で読み上げる": "在扩展中朗读", "読み上げには Extension が必要です": "朗读需要安装扩展", "読み上げについて": "关于朗读",
    "まだ購読がありません。": "还没有订阅。", "記事を取得しています…": "正在获取文章…", "表示できる記事がありません。": "没有可显示的文章。", "フィードを確認中…": "正在检查订阅源…", "追加": "添加", "追加完了": "已添加", "記事取得中": "正在获取文章", "タグ": "标签", "新しいタグ名": "新标签名称", "すべて取得": "全部获取", "取得中…": "获取中…", "翻訳中…": "翻译中…", "取得": "获取", "取得失敗": "获取失败", "購読一覧": "订阅列表", "購読がありません。": "没有订阅。", "購読が見つかりません": "找不到订阅", "購読解除": "取消订阅", "購読の操作": "订阅操作", "フィードURLを表示": "显示订阅源 URL", "フィードURL": "订阅源 URL", "アカウント削除": "删除账户", "削除完了": "已删除", "削除する": "删除", "サインアウト": "退出登录", "テーマ": "主题", "表示": "显示", "言語": "语言", "日本語": "日语", "原文のまま読む言語": "按原文阅读的语言", "記事の並び順": "文章排序", "システムに合わせる": "跟随系统", "ライト": "浅色", "ダーク": "深色", "公開日時が新しい順": "按发布时间从新到旧", "取得日時が新しい順": "按获取时间从新到旧", "リンクを常にブラウザで開く": "始终在浏览器中打开链接", "選択した言語の記事は翻訳せず原文で表示します。": "所选语言的文章将以原文显示。", "インポート": "导入", "エクスポート": "导出", "アップロード中…": "上传中…", "インポート処理中…": "导入中…", "インポート完了": "导入完成", "インポート失敗": "导入失败", "既読履歴について": "已读记录", "再試行": "重试", "読み上げキュー": "朗读队列", "キューから削除": "从队列移除", "前の記事": "上一篇", "次の記事": "下一篇", "キューを表示": "显示队列", "読み上げ速度": "朗读速度",
    "キューを空にする": "清空队列", "この記事から再生": "从此文章播放", "上へ移動": "上移", "下へ移動": "下移", "一時停止": "暂停", "再生": "播放", "自動": "自动", "読み上げ音声": "朗读语音", "セッション": "会话", "危険な操作": "危险操作", "状態を確認しています…": "正在检查状态…", "停止": "已暂停", "中断": "已中断", "失敗": "失败", "中": "进行中", "待ち": "等待中", "残り": "剩余", "購読": "订阅", "記事": "文章", "完了": "完成", "取得対象のフィードがありません。": "没有可获取的订阅源。", "フィードの取得を開始しました。": "已开始获取订阅源。", "このフィードを取得": "获取此订阅源", "タグ名を変更": "重命名标签", "フィード追加": "添加订阅源", "タグを上へ": "标签上移", "タグを下へ": "标签下移", "名前変更": "重命名", "アカウントを削除しますか？この操作は取り消せません。": "确定删除账户吗？此操作无法撤销。", "最近取得済みのため、今回の取得対象はありませんでした。": "最近已获取过，本次没有新的获取任务。", "取得に時間がかかっています。あとで再度更新してください。": "获取时间较长，请稍后重试。", "すべての購読": "全部订阅", "リーディングリストに保存した記事はありません。": "阅读列表中没有保存的文章。",
  },
  ko: {
    "メニュー": "메뉴", "閉じる": "닫기", "戻る": "뒤로", "展開": "펼치기", "折りたたむ": "접기", "フィードを追加": "피드 추가", "全ての記事": "모든 기사", "リーディングリスト": "읽기 목록", "ブックマーク": "북마크", "フィード": "피드", "購読管理": "구독 관리", "タグ管理": "태그 관리", "処理ステータス": "처리 상태", "設定": "설정", "タグなし": "태그 없음", "未読": "읽지 않음", "既読": "읽음", "未読のみ": "읽지 않은 항목만", "既読のみ": "읽은 항목만", "未読にする": "읽지 않음으로 표시", "既読にする": "읽음으로 표시", "翻訳": "번역", "原文": "원문", "タイトルを翻訳": "제목 번역", "翻訳の準備": "번역 준비", "言語を確認": "언어 확인", "タイトルの翻訳はこの端末の中で行います。はじめに、翻訳したい言語をダウンロードしてください。": "제목 번역은 이 기기에서 처리합니다. 먼저 번역할 언어를 다운로드하세요.", "確認しています…": "확인 중…", "購読しているフィードに、翻訳が必要な言語はありません。": "구독 중인 피드에 번역이 필요한 언어가 없습니다.", "準備済み": "준비됨", "ダウンロード": "다운로드", "ダウンロード中…": "다운로드 중…", "このブラウザでは非対応": "이 브라우저에서는 지원되지 않음", "ここに無い言語の記事は、翻訳せず原文のまま表示します。": "여기에 없는 언어의 기사는 원문으로 표시합니다.", "一覧の翻訳トグルは、タイトルをこの言語へ翻訳します。": "목록의 번역 토글은 제목을 이 언어로 번역합니다.", "原文タイトルに戻す": "원문 제목 보기", "リーディングリストから削除": "읽기 목록에서 삭제", "リーディングリストに追加": "읽기 목록에 추가", "読み上げキューから削除": "음성 큐에서 삭제", "読み上げキューに追加": "음성 큐에 추가", "読み込み中…": "로드 중…", "更新": "새로고침", "更新中…": "새로고침 중…", "再読み込み": "다시 로드", "フィードを更新": "피드 새로고침", "フィードを更新しています…": "피드를 새로고침하는 중…", "すべて既読にする": "모두 읽음으로 표시", "まだ購読がありません。": "아직 구독이 없습니다.", "記事を取得しています…": "기사를 가져오는 중…", "表示できる記事がありません。": "표시할 기사가 없습니다.", "フィードを確認中…": "피드를 확인하는 중…", "追加": "추가", "追加完了": "추가됨", "記事取得中": "기사 가져오는 중", "タグ": "태그", "新しいタグ名": "새 태그 이름", "すべて取得": "모두 가져오기", "取得中…": "가져오는 중…", "翻訳中…": "번역 중…", "取得": "가져오기", "取得失敗": "가져오기 실패", "購読一覧": "구독 목록", "購読がありません。": "구독이 없습니다.", "購読が見つかりません": "구독을 찾을 수 없습니다", "購読解除": "구독 취소", "購読の操作": "구독 작업", "フィードURLを表示": "피드 URL 보기", "フィードURL": "피드 URL", "アカウント削除": "계정 삭제", "削除完了": "삭제됨", "削除する": "삭제", "サインアウト": "로그아웃", "テーマ": "테마", "表示": "표시", "言語": "언어", "日本語": "일본어", "原文のまま読む言語": "원문으로 읽을 언어", "記事の並び順": "기사 정렬", "システムに合わせる": "시스템 설정", "ライト": "라이트", "ダーク": "다크", "公開日時が新しい順": "게시일 최신순", "取得日時が新しい順": "가져온 시간 최신순", "リンクを常にブラウザで開く": "항상 브라우저에서 링크 열기", "選択した言語の記事は翻訳せず原文で表示します。": "선택한 언어의 기사는 번역하지 않고 원문으로 표시합니다.", "インポート": "가져오기", "エクスポート": "내보내기", "アップロード中…": "업로드 중…", "インポート処理中…": "가져오는 중…", "インポート完了": "가져오기 완료", "インポート失敗": "가져오기 실패", "既読履歴について": "읽은 기록", "再試行": "다시 시도", "読み上げキュー": "음성 큐", "キューから削除": "큐에서 삭제", "前の記事": "이전 기사", "次の記事": "다음 기사", "キューを表示": "큐 표시", "読み上げ速度": "음성 속도",
    "キューを空にする": "큐 비우기", "この記事から再生": "이 기사부터 재생", "上へ移動": "위로 이동", "下へ移動": "아래로 이동", "一時停止": "일시정지", "再生": "재생", "自動": "자동", "読み上げ音声": "음성", "セッション": "세션", "危険な操作": "위험한 작업", "状態を確認しています…": "상태 확인 중…", "停止": "일시 중지됨", "中断": "중단됨", "失敗": "실패", "中": "진행 중", "待ち": "대기 중", "残り": "남음", "購読": "구독", "記事": "기사", "完了": "완료", "取得対象のフィードがありません。": "가져올 피드가 없습니다.", "フィードの取得を開始しました。": "피드 가져오기를 시작했습니다.", "このフィードを取得": "이 피드 가져오기", "タグ名を変更": "태그 이름 변경", "フィード追加": "피드 추가", "タグを上へ": "태그 위로", "タグを下へ": "태그 아래로", "名前変更": "이름 변경", "アカウントを削除しますか？この操作は取り消せません。": "계정을 삭제할까요? 되돌릴 수 없습니다.", "最近取得済みのため、今回の取得対象はありませんでした。": "최근에 가져와 이번에는 대상이 없습니다.", "取得に時間がかかっています。あとで再度更新してください。": "가져오는 데 시간이 걸립니다. 나중에 다시 시도하세요.", "すべての購読": "모든 구독", "リーディングリストに保存した記事はありません。": "저장된 기사가 없습니다.",
  },
  es: {
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
