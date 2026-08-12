import SwiftUI

struct AddArticleScreen: View {
    let initialUrl: String
    let onDone: () -> Void
    let onReadAloud: (String) -> Void
    @State private var url: String
    @State private var isSubmitting = false
    @State private var result: String?
    @State private var errorMessage: String?

    init(initialUrl: String, onDone: @escaping () -> Void, onReadAloud: @escaping (String) -> Void = { _ in }) {
        self.initialUrl = initialUrl
        self.onDone = onDone
        self.onReadAloud = onReadAloud
        _url = State(initialValue: initialUrl)
    }

    var body: some View {
        Form {
            Section {
                TextField("記事URL", text: $url)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button(isSubmitting ? "保存中…" : "追加") {
                    Task { await submit() }
                }
                .disabled(isSubmitting || url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("保存せずに読み上げ") {
                    onReadAloud(url.trimmingCharacters(in: .whitespacesAndNewlines))
                }
                .disabled(isSubmitting || url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } footer: {
                Text("共有されたURLを保存または読み上げます。")
            }
            if let result {
                Section { Text(result).foregroundStyle(.green) }
            }
            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) }
            }
        }
        .navigationTitle("記事を追加")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Button("完了", action: onDone) }
        }
    }

    private func submit() async {
        isSubmitting = true
        result = nil
        errorMessage = nil
        do {
            let saved = try await APIClient.shared.importArticle(url: url.trimmingCharacters(in: .whitespacesAndNewlines))
            FiloAnalytics.track("add_to_reading_list", parameters: ["source": "manual_url", "created": saved.created])
            result = saved.created ? "リーディングリストに追加しました。" : "リーディングリストに保存済みです。"
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isSubmitting = false
    }
}
