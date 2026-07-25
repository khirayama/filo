import Foundation

enum ClerkConfiguration {
    private static let placeholderKey = "pk_test_replace_me"

    static let publishableKey = {
        guard
            let path = Bundle.main.path(forResource: "LocalSecrets", ofType: "plist"),
            let values = NSDictionary(contentsOfFile: path),
            let key = values["CLERK_PUBLISHABLE_KEY"] as? String,
            !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return placeholderKey
        }

        return key
    }()

    static var isPlaceholderKey: Bool {
        publishableKey == placeholderKey
    }
}
