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

    private var contentHorizontalPadding: CGFloat {
        isDesktop ? 24 : 8
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("RSS/Atom URL または サイトURL")
                    TextField("", text: $url, prompt: Text("https://example.com/feed.xml"))
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                }

                if !tags.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("タグ")
                        FlowLayout(spacing: 8) {
                            ForEach(tags) { tag in
                                tagChip(tag)
                            }
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("新規タグ（カンマ区切り）")
                    TextField("", text: $newTagNames, prompt: Text("AI, Engineering"))
                        .textFieldStyle(.roundedBorder)
                }

                Button(isSubmitting ? "フィードを確認中…" : "追加") {
                    Task { await submit() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSubmitting || url.trimmingCharacters(in: .whitespaces).isEmpty)

                if let errorMessage {
                    ErrorBanner(message: errorMessage)
                }

                if let created {
                    resultView(created)
                }
            }
            .padding(.horizontal, contentHorizontalPadding)
            .padding(.top, 16)
            .padding(.bottom, 48)
        }
        .background(FiloPalette.background)
        .navigationTitle("フィードを追加")
        .task {
            tags = (try? await APIClient.shared.listTags()) ?? []
        }
    }

    private func tagChip(_ tag: Tag) -> some View {
        let selected = selectedTagIds.contains(tag.id)
        return Button {
            if selected { selectedTagIds.remove(tag.id) } else { selectedTagIds.insert(tag.id) }
        } label: {
            Text(tag.name)
                .font(.system(size: 13))
                .foregroundStyle(selected ? FiloPalette.background : FiloPalette.text)
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .background(selected ? FiloPalette.text : Color.clear, in: Capsule())
                .overlay(Capsule().stroke(FiloPalette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func resultView(_ subscription: Subscription) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(subscription.displayTitle)
                .font(.body.weight(.semibold))

            switch subscription.initialFetchStatus {
            case "ready":
                StatusBadge(label: "追加完了", tone: .ok)
                Text("記事の取得が完了しています。")
            case "fetching":
                StatusBadge(label: "記事取得中")
                Text("購読の追加は完了しました。記事を取得しています。")
            default:
                StatusBadge(label: "初回取得失敗", tone: .danger)
                Text("購読は作成されましたが、\(ErrorMessages.initialFetchMessage(for: subscription.initialFetchErrorCode))")
                Button(isRetrying ? "再試行中…" : "再試行") {
                    Task { await retry() }
                }
                .disabled(isRetrying)
            }

            Button("記事一覧へ", action: onOpenArticles)
                .buttonStyle(.plain)
                .underline()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(FiloPalette.border, lineWidth: 1))
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

private struct FlowLayout: Layout {
    let spacing: CGFloat

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout (),
    ) -> CGSize {
        let maxWidth = proposal.width ?? .greatestFiniteMagnitude
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var widestRow: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + spacing + size.width > maxWidth {
                widestRow = max(widestRow, rowWidth)
                totalHeight += rowHeight + spacing
                rowWidth = 0
                rowHeight = 0
            }
            rowWidth += (rowWidth > 0 ? spacing : 0) + size.width
            rowHeight = max(rowHeight, size.height)
        }

        widestRow = max(widestRow, rowWidth)
        totalHeight += rowHeight
        return CGSize(width: proposal.width ?? widestRow, height: totalHeight)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout (),
    ) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        var isFirstInRow = true

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if !isFirstInRow, x + spacing + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
                isFirstInRow = true
            }
            if !isFirstInRow { x += spacing }
            subview.place(
                at: CGPoint(x: x, y: y),
                anchor: .topLeading,
                proposal: ProposedViewSize(size),
            )
            x += size.width
            rowHeight = max(rowHeight, size.height)
            isFirstInRow = false
        }
    }
}
