import Foundation

enum SharedURLInbox {
    static let groupIdentifier = "group.com.filo.app"
    private static let key = "filo.pendingSharedURL"

    static func store(_ url: String) {
        UserDefaults(suiteName: groupIdentifier)?.set(url, forKey: key)
    }

    static func take() -> String? {
        let defaults = UserDefaults(suiteName: groupIdentifier)
        let value = defaults?.string(forKey: key)
        defaults?.removeObject(forKey: key)
        return value
    }
}
