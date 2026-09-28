import SwiftUI

// MARK: - Add feed

struct AddFeedScreen: View {
    var onOpenArticles: () -> Void = {}
    var onCreated: () async -> Void = {}

    @Environment(\.filoIsDesktop) private var isDesktop
    @State private var url = ""
    @State private var tags: [Tag] = []
    @State private var selectedTagIds: Set<Int> = []
    @State private var newTagNames = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var created: Subscription?
    @State private var isRetrying = false

    var body: some View {
        FiloPage("フィードを追加", showsBack: true) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 20) {
                        FiloField(label: "RSS/Atom URL または サイトURL") {
                            FiloTextField(placeholder: "https://example.com/feed.xml", text: $url, isURL: true) {
                                Task { await submit() }
                            }
                        }
                        if !tags.isEmpty {
                            FiloField(label: "タグ") {
                                FlowLayout(spacing: 6) {
                                    ForEach(tags) { tag in
                                        FiloChip(label: tag.name, isOn: selectedTagIds.contains(tag.id), localize: false) {
                                            if selectedTagIds.contains(tag.id) { selectedTagIds.remove(tag.id) } else { selectedTagIds.insert(tag.id) }
                                        }
                                    }
                                }
                            }
                        }
                        FiloField(label: "新規タグ（カンマ区切り）") {
                            FiloTextField(placeholder: "AI, Engineering", text: $newTagNames)
                        }
                        FiloButton(isSubmitting ? "フィードを確認中…" : "追加", icon: .plus, kind: .primary) {
                            Task { await submit() }
                        }
                        .disabled(isSubmitting || url.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    if let errorMessage {
                        FiloErrorBox(message: errorMessage)
                    }
                    if let created {
                        resultView(created)
                    }
                }
                .frame(maxWidth: FiloMetrics.contentWidth, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, isDesktop ? FiloMetrics.desktopGutter : FiloMetrics.gutter)
                .padding(.top, 24)
                .padding(.bottom, 64)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .task {
            tags = (try? await APIClient.shared.listTags()) ?? []
        }
    }

    private func resultView(_ subscription: Subscription) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Text(subscription.displayTitle)
                    .filoFont(14, .semibold)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                switch subscription.initialFetchStatus {
                case "ready": FiloBadge(label: "追加完了", tone: .ok)
                case "fetching": FiloBadge(label: "記事取得中")
                default: FiloBadge(label: "初回取得失敗", tone: .danger)
                }
            }
            Group {
                switch subscription.initialFetchStatus {
                case "ready": Text(localized: "記事の取得が完了しています。")
                case "fetching": Text(localized: "購読の追加は完了しました。記事を取得しています。")
                default: Text(L10n.format("購読は作成されましたが、%@", ErrorMessages.initialFetchMessage(for: subscription.initialFetchErrorCode)))
                }
            }
            .filoFont(13)
            .lineSpacing(4)
            .foregroundStyle(FiloPalette.muted)
            HStack(spacing: 8) {
                if subscription.initialFetchStatus == "failed" {
                    FiloButton(isRetrying ? "再試行中…" : "再試行") { Task { await retry() } }
                        .disabled(isRetrying)
                }
                FiloButton("記事一覧へ", action: onOpenArticles)
            }
        }
        .foregroundStyle(FiloPalette.text)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: FiloMetrics.radiusLarge).fill(FiloPalette.surface))
        .overlay(RoundedRectangle(cornerRadius: FiloMetrics.radiusLarge).strokeBorder(FiloPalette.mutedBorder, lineWidth: 1))
    }

    private func submit() async {
        guard !isSubmitting else { return }
        isSubmitting = true
        errorMessage = nil
        created = nil
        let names = newTagNames
            .split(whereSeparator: { $0 == "," || $0 == "、" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        do {
            created = try await APIClient.shared.createSubscription(
                feedUrl: url.trimmingCharacters(in: .whitespaces),
                tagIds: Array(selectedTagIds),
                tagNames: names,
            )
            await onCreated()
            FiloAnalytics.track(
                "add_feed",
                parameters: [
                    "has_custom_tags": !names.isEmpty,
                    "tag_count": selectedTagIds.count + names.count,
                ],
            )
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isSubmitting = false
    }

    private func retry() async {
        guard let created, !isRetrying else { return }
        isRetrying = true
        do {
            self.created = try await APIClient.shared.retryInitialFetch(created.id)
            FiloAnalytics.track("retry_feed_fetch")
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isRetrying = false
    }
}
