import Foundation

enum L10n {
    private static var language: String {
        UserDefaults.standard.string(forKey: "filo:language") ?? "ja"
    }

    private static var bundleLanguage: String {
        language == "zh" ? "zh-Hans" : language
    }

    static func string(_ key: String) -> String {
        guard let path = Bundle.main.path(forResource: bundleLanguage, ofType: "lproj"),
              let bundle = Bundle(path: path) else { return key }
        return bundle.localizedString(forKey: key, value: key, table: "Localizable")
    }

    static func format(_ key: String, _ arguments: CVarArg...) -> String {
        String(
            format: string(key),
            locale: Locale(identifier: language == "zh" ? "zh-Hans" : language),
            arguments: arguments,
        )
    }
}
