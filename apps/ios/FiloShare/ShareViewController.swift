import Social
import UniformTypeIdentifiers

final class ShareViewController: SLComposeServiceViewController {
    override func isContentValid() -> Bool { true }

    override func didSelectPost() {
        guard let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem else {
            complete()
            return
        }
        let providers = extensionItem.attachments ?? []
        let provider = providers.first { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }
            ?? providers.first { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }
        guard let provider else {
            complete()
            return
        }
        let type = provider.hasItemConformingToTypeIdentifier(UTType.url.identifier)
            ? UTType.url.identifier
            : UTType.plainText.identifier
        provider.loadItem(forTypeIdentifier: type, options: nil) { item, _ in
            let value: String?
            if let url = item as? URL { value = url.absoluteString }
            else if let text = item as? String {
                value = text.split(whereSeparator: { $0.isWhitespace })
                    .first(where: { $0.hasPrefix("http://") || $0.hasPrefix("https://") })
                    .map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: ".,)]\"")) }
            }
            else { value = nil }
            if let value, value.hasPrefix("http://") || value.hasPrefix("https://") {
                UserDefaults(suiteName: "group.com.filo.app")?.set(value, forKey: "filo.pendingSharedURL")
            }
            self.complete()
        }
    }

    private func complete() {
        DispatchQueue.main.async { self.extensionContext?.completeRequest(returningItems: nil) }
    }
}
