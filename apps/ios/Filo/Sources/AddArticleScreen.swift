import SwiftUI

struct AddArticleScreen: View {
    let onSaved: () -> Void
    @State private var url: String
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @Environment(\.filoIsDesktop) private var isDesktop

    init(initialUrl: String, onSaved: @escaping () -> Void) {
        self.onSaved = onSaved
        _url = State(initialValue: initialUrl)
    }

    var body: some View {
        FiloPage("記事を追加", showsBack: true) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 20) {
                        FiloField(label: "記事URL", hint: "URLをリーディングリストに保存します。") {
                            FiloTextField(placeholder: "https://example.com/article", text: $url, isURL: true) {
                                Task { await submit() }
                            }
                        }
                        FiloButton(isSubmitting ? "保存中…" : "追加", icon: .plus, kind: .primary) {
                            Task { await submit() }
                        }
                        .disabled(isSubmitting || url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    if let errorMessage {
                        FiloErrorBox(message: errorMessage)
                    }
                }
                .frame(maxWidth: FiloMetrics.contentWidth, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, isDesktop ? FiloMetrics.desktopGutter : FiloMetrics.gutter)
                .padding(.top, 24)
                .padding(.bottom, 64)
            }
        }
    }

    private func submit() async {
        guard !isSubmitting else { return }
        isSubmitting = true
        errorMessage = nil
        do {
            let saved = try await APIClient.shared.importArticle(url: url.trimmingCharacters(in: .whitespacesAndNewlines))
            FiloAnalytics.track("add_to_reading_list", parameters: ["source": "manual_url", "created": saved.created])
            onSaved()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isSubmitting = false
    }
}
