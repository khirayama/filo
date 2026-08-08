import ClerkKit
import ClerkKitUI
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
    @Environment(Clerk.self) private var clerk
    @ObservedObject private var themeManager = ThemeManager.shared

    var body: some View {
        Group {
            if clerk.user != nil {
                AppNavigationView()
            } else {
                AuthView(mode: .signInOrUp, isDismissable: false)
            }
        }
        .preferredColorScheme(themeManager.colorScheme)
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
                    .navigationDestination(for: AppRoute.self) { route in
                        switch route {
                        case .subscriptions:
                            SubscriptionsScreen(onSelectTag: { tagId in
                                articlesModel.selectView(tagId: tagId)
                                path = NavigationPath()
                            })
                        case .settings:
                            SettingsScreen()
                        case .status:
                            StatusScreen()
                        case .addFeed:
                            AddFeedScreen()
                        case .tags:
                            TagsScreen()
                        case .subscriptionDetail(let id):
                            SubscriptionDetailScreen(subscriptionId: id)
                        case .accountDeletionStatus(let token):
                            AccountDeletionStatusScreen(deletionToken: token)
                        case .readingSession(let autoplay):
                            ReadingSessionScreen(autoplay: autoplay)
                        case .readingPage(let url):
                            ReadingSessionScreen(autoplay: false, temporaryUrl: url)
                        case .addArticle(let url):
                            AddArticleScreen(
                                initialUrl: url,
                                onDone: { if !path.isEmpty { path.removeLast() } },
                                onReadAloud: { sharedUrl in
                                    if !path.isEmpty { path.removeLast() }
                                    path.append(AppRoute.readingPage(sharedUrl))
                                },
                            )
                        }
                    }
            }
            // 翻訳セッションはアプリ全体で 1 つ。画面ごとに付けると同じバッチに
            // 複数のセッションが張られて互いを畳み合う。
            .titleTranslation(store: titleTranslations)
            .environmentObject(readingPlayer)
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
        case .muted: return .secondary
        case .warn: return .orange
        case .danger: return .red
        case .ok: return .green
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
                .foregroundStyle(.red)
            Spacer()
            if let onRetry {
                Button("再試行", action: onRetry)
                    .font(.callout)
            }
        }
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(.red.opacity(0.5), lineWidth: 1))
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
        .foregroundStyle(.secondary)
    }
}

struct MissingConfigurationView: View {
    var body: some View {
        VStack(spacing: 16) {
            Text("Clerk is not configured")
                .font(.title.bold())
            Text("Set your publishable key in LocalSecrets.plist.")
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
