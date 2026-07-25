import SwiftUI

// MARK: - Add feed

struct AddFeedScreen: View {
    @State private var url = ""
    @State private var tags: [Tag] = []
    @State private var selectedTagIds: Set<Int> = []
    @State private var newTagNames = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var created: Subscription?
    @State private var isRetrying = false

    var body: some View {
        Form {
            Section("フィード") {
                TextField("RSS/Atom URL または サイトURL", text: $url)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            if !tags.isEmpty {
                Section("タグ") {
                    ForEach(tags) { tag in
                        Button {
                            if selectedTagIds.contains(tag.id) { selectedTagIds.remove(tag.id) } else { selectedTagIds.insert(tag.id) }
                        } label: {
                            HStack {
                                Text(tag.name)
                                    .foregroundStyle(.primary)
                                Spacer()
                                if selectedTagIds.contains(tag.id) {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                }
            }
            Section("新規タグ（カンマ区切り）") {
                TextField("AI, Engineering", text: $newTagNames)
            }
            Section {
                Button(isSubmitting ? "フィードを確認中…" : "追加") {
                    Task { await submit() }
                }
                .disabled(isSubmitting || url.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if let errorMessage {
                Section {
                    ErrorBanner(message: errorMessage)
                }
            }
            if let created {
                Section("結果") {
                    Text(created.displayTitle)
                        .font(.body.weight(.medium))
                    switch created.initialFetchStatus {
                    case "ready":
                        StatusBadge(label: "追加完了", tone: .ok)
                        Text("記事の取得が完了しています。")
                    case "fetching":
                        StatusBadge(label: "記事取得中")
                        Text("購読の追加は完了しました。記事を取得しています。")
                    default:
                        StatusBadge(label: "初回取得失敗", tone: .danger)
                        Text("購読は作成されましたが、\(ErrorMessages.initialFetchMessage(for: created.initialFetchErrorCode))")
                        Button(isRetrying ? "再試行中…" : "再試行") {
                            Task { await retry() }
                        }
                        .disabled(isRetrying)
                    }
                }
            }
        }
        .navigationTitle("フィード追加")
        .task {
            tags = (try? await APIClient.shared.listTags()) ?? []
        }
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
                tagNames: names
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
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isRetrying = false
    }
}
