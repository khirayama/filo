import Foundation

enum SharedURLInbox {
    static let groupIdentifier = "group.com.filo.app"
    private static let key = "filo.pendingSharedURLs"
    private static let legacyKey = "filo.pendingSharedURL"

    static func store(_ url: String, defaults: UserDefaults? = UserDefaults(suiteName: groupIdentifier)) {
        guard let defaults else { return }
        var urls = pendingURLs(defaults)
        if !urls.contains(url) { urls.append(url) }
        defaults.set(urls, forKey: key)
    }

    static func take(defaults: UserDefaults? = UserDefaults(suiteName: groupIdentifier)) -> String? {
        guard let defaults else { return nil }
        var urls = pendingURLs(defaults)
        guard !urls.isEmpty else { return nil }
        let value = urls.removeFirst()
        defaults.set(urls, forKey: key)
        return value
    }

    private static func pendingURLs(_ defaults: UserDefaults) -> [String] {
        var urls = defaults.stringArray(forKey: key) ?? []
        if let legacy = defaults.string(forKey: legacyKey) {
            if !urls.contains(legacy) { urls.insert(legacy, at: 0) }
            defaults.removeObject(forKey: legacyKey)
        }
        return urls
    }
}
