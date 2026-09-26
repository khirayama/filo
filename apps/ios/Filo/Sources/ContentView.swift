import SwiftUI

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
    @ObservedObject private var languageManager = LanguageManager.shared

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
        .environment(\.locale, languageManager.locale)
        .onAppear { FiloAnalytics.screen("auth") }
    }
}

struct AppNavigationView: View {
    @State private var path = NavigationPath()
    @State private var activeRoute: AppRoute?
    @State private var isDrawerOpen = false
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
        FiloResponsiveContainer { isDesktop in
            VStack(spacing: 0) {
                if isDesktop {
                    HStack(spacing: 0) {
                        sidebar(onClose: nil)
                            .frame(width: FiloMetrics.sidebarWidth)
                            .background(FiloPalette.sidebar)
                            .overlay(alignment: .trailing) {
                                Rectangle().fill(FiloPalette.mutedBorder).frame(width: 1)
                            }
                        navigationStack
                    }
                } else {
                    navigationStack
                        .environment(\.filoOpenDrawer, openDrawer)
                }
                if readingPlayer.isPlaying && !readingPlayer.isReadingBrowserVisible {
                    ReadingMiniPlayer(player: readingPlayer)
                }
            }
            .overlay {
                if !isDesktop { drawer }
            }
        }
        .sheet(isPresented: $titleTranslations.isShowingSetup) {
            TitleTranslationSetupView(store: titleTranslations)
        }
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

    private var navigationStack: some View {
        NavigationStack(path: $path) {
            ArticlesScreen(path: $path, model: articlesModel)
                .onAppear {
                    activeRoute = nil
                    FiloAnalytics.screen("articles")
                }
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                        .onAppear { if route.isShownInSidebar { activeRoute = route } }
                }
        }
        // 翻訳セッションはアプリ全体で 1 つ。画面ごとに付けると同じバッチに
        // 複数のセッションが張られて互いを畳み合う。
        .titleTranslation(store: titleTranslations)
        .environmentObject(readingPlayer)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func destination(for route: AppRoute) -> some View {
        switch route {
        case .subscriptions:
            SubscriptionsScreen(onSelectTag: { tagId in
                articlesModel.selectView(tagId: tagId)
                resetToArticles()
            })
            .onAppear { FiloAnalytics.screen("subscriptions") }
        case .settings:
            SettingsScreen().onAppear { FiloAnalytics.screen("settings") }
        case .status:
            StatusScreen().onAppear { FiloAnalytics.screen("status") }
        case .addFeed:
            AddFeedScreen(onOpenArticles: {
                articlesModel.selectView()
                resetToArticles()
            }, onCreated: {
                await articlesModel.load()
            })
            .onAppear { FiloAnalytics.screen("add_feed") }
        case .tags:
            TagsScreen().onAppear { FiloAnalytics.screen("tags") }
        case .subscriptionDetail(let id):
            SubscriptionDetailScreen(
                subscriptionId: id,
                onOpenArticle: { article in
                    path.append(AppRoute.readingArticle(ReadingSessionArticle(article)))
                },
                onSelectTag: { tagId in
                    articlesModel.selectView(tagId: tagId)
                    resetToArticles()
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
                onSaved: {
                    Task { await articlesModel.refreshUnreadCounts() }
                    articlesModel.selectView(readingList: true)
                    resetToArticles()
                },
            )
            .onAppear { FiloAnalytics.screen("add_article") }
        }
    }

    private func sidebar(onClose: (() -> Void)?) -> some View {
        SidebarNav(
            model: articlesModel,
            activeRoute: activeRoute,
            onSelectView: resetToArticles,
            onRoute: navigate,
            onClose: onClose,
        )
    }

    // Slides in from the leading edge over a scrim, like the web drawer.
    private var drawer: some View {
        ZStack(alignment: .leading) {
            if isDrawerOpen {
                FiloPalette.scrim
                    .ignoresSafeArea()
                    .onTapGesture(perform: closeDrawer)
                    .transition(.opacity)
                    .accessibilityHidden(true)
                sidebar(onClose: closeDrawer)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(FiloPalette.sidebar.ignoresSafeArea())
                    .shadow(color: FiloPalette.shadow, radius: 32)
                    .gesture(
                        DragGesture(minimumDistance: 20).onEnded { value in
                            if value.translation.width < -60 { closeDrawer() }
                        }
                    )
                    .transition(.move(edge: .leading))
                .accessibilityAddTraits(.isModal)
            }
        }
        .animation(.timingCurve(0.32, 0.72, 0, 1, duration: 0.2), value: isDrawerOpen)
    }

    private func openDrawer() {
        isDrawerOpen = true
    }

    private func closeDrawer() {
        isDrawerOpen = false
    }

    private func resetToArticles() {
        isDrawerOpen = false
        path = NavigationPath()
        activeRoute = nil
    }

    // Sidebar destinations replace the stack (they are siblings of the
    // articles view); task screens push onto what is showing.
    private func navigate(_ route: AppRoute) {
        isDrawerOpen = false
        if route.isShownInSidebar {
            activeRoute = route
            path = NavigationPath([route])
        } else {
            path.append(route)
        }
    }

    private func openPendingShare() {
        let url = pendingSharedUrl ?? SharedURLInbox.take()
        guard let url, !url.isEmpty else { return }
        pendingSharedUrl = nil
        path.append(AppRoute.addArticle(url))
    }
}

private extension AppRoute {
    var isShownInSidebar: Bool {
        switch self {
        case .subscriptions, .tags, .status, .settings, .subscriptionDetail: return true
        default: return false
        }
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
