import Foundation

enum AppConfig {
    static let apiBaseURL: URL = {
        if
            let path = Bundle.main.path(forResource: "LocalSecrets", ofType: "plist"),
            let values = NSDictionary(contentsOfFile: path),
            let raw = values["API_BASE_URL"] as? String,
            let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
            !raw.isEmpty
        {
            return url
        }
        return URL(string: "http://localhost:8787")!
    }()

    static let webBaseURL: URL = {
        if
            let path = Bundle.main.path(forResource: "LocalSecrets", ofType: "plist"),
            let values = NSDictionary(contentsOfFile: path),
            let raw = values["WEB_BASE_URL"] as? String,
            let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
            !raw.isEmpty
        {
            return url
        }
        if let host = apiBaseURL.host, ["localhost", "127.0.0.1"].contains(host) {
            return URL(string: "http://localhost:5173")!
        }
        return URL(string: "https://filoreader.app")!
    }()
}
