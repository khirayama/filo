import SwiftUI

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255
        )
    }

    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
        })
    }
}

enum FiloPalette {
    static let background = Color(light: Color(hex: 0xFFFFFF), dark: Color(hex: 0x16181C))
    static let surface = Color(light: Color(hex: 0xFFFFFF), dark: Color(hex: 0x1E2126))
    static let text = Color(light: Color(hex: 0x222222), dark: Color(hex: 0xE4E4E4))
    static let border = Color(light: Color(hex: 0xD7D7D7), dark: Color(hex: 0x464A52))
    static let mutedBorder = Color(light: Color(hex: 0xE0E0E0), dark: Color(hex: 0x33373E))
    static let muted = Color(light: Color(hex: 0x777777), dark: Color(hex: 0x9AA0A8))
    static let danger = Color(light: Color(hex: 0xB3261E), dark: Color(hex: 0xEF7B74))
    static let dangerBackground = Color(light: Color(hex: 0xFFEBE9), dark: Color(hex: 0x3A1F1E))
    static let accent = Color(light: Color(hex: 0x1A56DB), dark: Color(hex: 0x6A9BFF))
    static let onAccent = Color(light: Color(hex: 0xFFFFFF), dark: Color(hex: 0x10233F))
    static let star = Color(light: Color(hex: 0xE8A100), dark: Color(hex: 0xFFC94D))
    static let ok = Color(light: Color(hex: 0x2F6A3D), dark: Color(hex: 0x6BCB8A))
    static let warn = Color(light: Color(hex: 0x9A6700), dark: Color(hex: 0xE3B341))
}

enum AppRoute: Hashable {
    case subscriptions
    case settings
    case status
    case addFeed
    case tags
    case subscriptionDetail(Int)
    case accountDeletionStatus(String?)
    case readingSession(Bool)
    case readingPage(String)
    case readingArticle(ReadingSessionArticle)
    case addArticle(String)
}

// settings.theme を描画へ反映する。サーバー設定が届く前のフラッシュを防ぐため、
// 最後に適用した値を UserDefaults に保持する (web の lib/theme.ts と同じ方針)
@MainActor
final class ThemeManager: ObservableObject {
    static let shared = ThemeManager()

    @Published var theme: String {
        didSet { UserDefaults.standard.set(theme, forKey: "filo:theme") }
    }

    private init() {
        theme = UserDefaults.standard.string(forKey: "filo:theme") ?? "system"
    }

    var colorScheme: ColorScheme? {
        switch theme {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }
}

@MainActor
final class LanguageManager: ObservableObject {
    static let shared = LanguageManager()

    @Published var language: String {
        didSet { UserDefaults.standard.set(language, forKey: "filo:language") }
    }

    private init() { language = UserDefaults.standard.string(forKey: "filo:language") ?? "ja" }

    var locale: Locale {
        Locale(identifier: language == "zh" ? "zh-Hans" : language)
    }
}

struct ContentView: View {
    @EnvironmentObject private var auth: BetterAuth
    @ObservedObject private var themeManager = ThemeManager.shared

    var body: some View {
        Group {
            if auth.resetToken != nil {
                BetterAuthResetPasswordView()
            } else if auth.token != nil {
                AppNavigationView()
            } else {
                BetterAuthView()
            }
        }
        .preferredColorScheme(themeManager.colorScheme)
        .tint(FiloPalette.accent)
        .foregroundStyle(FiloPalette.text)
        .background(FiloPalette.background)
        .onAppear { FiloAnalytics.screen("auth") }
    }
}

struct AppNavigationView: View {
    @State private var path = NavigationPath()
    @StateObject private var articlesModel = ArticlesViewModel()
    @ObservedObject private var languageManager = LanguageManager.shared
    @ObservedObject private var titleTranslations = TitleTranslationStore.shared
    @StateObject private var readingPlayer = ReadingPlayerStore()
    @Environment(\.scenePhase) private var scenePhase
    @State private var pendingSharedUrl: String?

    init() {
        _pendingSharedUrl = State(initialValue: SharedURLInbox.take())
    }

    var body: some View {
        VStack(spacing: 0) {
            NavigationStack(path: $path) {
                ArticlesScreen(
                    path: $path,
                    model: articlesModel,
                )
                .onAppear { FiloAnalytics.screen("articles") }
                    .navigationDestination(for: AppRoute.self) { route in
                        switch route {
                        case .subscriptions:
                            SubscriptionsScreen(onSelectTag: { tagId in
                                articlesModel.selectView(tagId: tagId)
                                path = NavigationPath()
                            })
                            .onAppear { FiloAnalytics.screen("subscriptions") }
                        case .settings:
                            SettingsScreen().onAppear { FiloAnalytics.screen("settings") }
                        case .status:
                            StatusScreen().onAppear { FiloAnalytics.screen("status") }
                        case .addFeed:
                            AddFeedScreen().onAppear { FiloAnalytics.screen("add_feed") }
                        case .tags:
                            TagsScreen().onAppear { FiloAnalytics.screen("tags") }
                        case .subscriptionDetail(let id):
                            SubscriptionDetailScreen(
                                subscriptionId: id,
                                onOpenArticle: { article in
                                    path.append(AppRoute.readingArticle(ReadingSessionArticle(article)))
                                },
                            )
                            .onAppear { FiloAnalytics.screen("subscription_detail") }
                        case .accountDeletionStatus(let token):
                            AccountDeletionStatusScreen(deletionToken: token)
                        case .readingSession(let autoplay):
                            ReadingSessionScreen(autoplay: autoplay).onAppear { FiloAnalytics.screen("reading") }
                        case .readingPage(let url):
                            ReadingSessionScreen(autoplay: false, temporaryUrl: url).onAppear { FiloAnalytics.screen("reading_page") }
                        case .readingArticle(let article):
                            ReadingSessionScreen(autoplay: false, article: article).onAppear {
                                FiloAnalytics.screen("reading_article")
                            }
                        case .addArticle(let url):
                            AddArticleScreen(
                                initialUrl: url,
                                onDone: { if !path.isEmpty { path.removeLast() } },
                                onReadAloud: { sharedUrl in
                                    if !path.isEmpty { path.removeLast() }
                                    path.append(AppRoute.readingPage(sharedUrl))
                                },
                            )
                            .onAppear { FiloAnalytics.screen("add_article") }
                        }
                    }
            }
            // 翻訳セッションはアプリ全体で 1 つ。画面ごとに付けると同じバッチに
            // 複数のセッションが張られて互いを畳み合う。
            .titleTranslation(store: titleTranslations)
            .environmentObject(readingPlayer)
            if readingPlayer.isPlaying && !readingPlayer.isReadingBrowserVisible {
                ReadingMiniPlayer(player: readingPlayer)
            }
        }
        .sheet(isPresented: $titleTranslations.isShowingSetup) {
            TitleTranslationSetupView(store: titleTranslations)
        }
        .environment(\.locale, languageManager.locale)
        .onAppear { openPendingShare() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { openPendingShare() }
        }
        .task {
            if let settings = try? await APIClient.shared.getSettings() {
                languageManager.language = settings.language
            }
        }
    }

    private func openPendingShare() {
        let url = pendingSharedUrl ?? SharedURLInbox.take()
        guard let url, !url.isEmpty else { return }
        pendingSharedUrl = nil
        path.append(AppRoute.addArticle(url))
    }
}

// MARK: - Shared UI

struct StatusBadge: View {
    enum Tone {
        case muted, warn, danger, ok
    }

    let label: String
    var tone: Tone = .muted

    private var color: Color {
        switch tone {
        case .muted: return FiloPalette.muted
        case .warn: return FiloPalette.warn
        case .danger: return FiloPalette.danger
        case .ok: return FiloPalette.ok
        }
    }

    var body: some View {
        Text(label)
            .font(.caption)
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .overlay(Capsule().stroke(color.opacity(0.6), lineWidth: 1))
    }
}

struct ErrorBanner: View {
    let message: String
    var onRetry: (() -> Void)?

    var body: some View {
        HStack {
            Text(message)
                .font(.callout)
                .foregroundStyle(FiloPalette.danger)
            Spacer()
            if let onRetry {
                Button("再試行", action: onRetry)
                    .font(.callout)
            }
        }
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(FiloPalette.danger.opacity(0.5), lineWidth: 1))
    }
}

struct EmptyStateView<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 12) {
            content
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .foregroundStyle(FiloPalette.muted)
    }
}

struct MissingConfigurationView: View {
    var body: some View {
        VStack(spacing: 16) {
            Text("認証が設定されていません")
                .font(.title.bold())
            Text("APIの設定を確認してください。")
                .font(.body)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }
}

#Preview {
    MissingConfigurationView()
}
