import SwiftUI

struct AddArticleScreen: View {
    let initialUrl: String
    let onDone: () -> Void
    let onSaved: (() -> Void)?
    @State private var url: String
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    init(initialUrl: String, onDone: @escaping () -> Void, onSaved: (() -> Void)? = nil) {
        self.initialUrl = initialUrl
        self.onDone = onDone
        self.onSaved = onSaved
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
            } footer: {
                Text("URLをリーディングリストに保存します。")
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
        errorMessage = nil
        do {
            let saved = try await APIClient.shared.importArticle(url: url.trimmingCharacters(in: .whitespacesAndNewlines))
            FiloAnalytics.track("add_to_reading_list", parameters: ["source": "manual_url", "created": saved.created])
            onSaved?()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isSubmitting = false
    }
}
