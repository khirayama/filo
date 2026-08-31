import Foundation
import SwiftUI
import Security

@MainActor final class BetterAuth: ObservableObject {
    static let shared = BetterAuth()
    @Published private(set) var token: String?
    @Published var resetToken: String?
    @Published var statusMessage: String?
    @Published var errorMessage: String?
    private init() { token = KeychainToken.get(); resetToken = nil; statusMessage = nil; errorMessage = nil }
    func signOut() { token = nil; KeychainToken.remove() }
    func sendPasswordReset(email: String) async throws {
        var request = URLRequest(url: endpoint("api/auth/request-password-reset")); request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "redirectTo": "filo://auth/reset"]); let (_, response) = try await URLSession.shared.data(for: request); guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
    }
    func handleAuthURL(_ url: URL) async {
        guard url.scheme == "filo", url.host == "auth" else { return }
        guard url.path.localizedCaseInsensitiveContains("reset") else { return }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = items.first(where: { $0.name == "token" || $0.name == "code" })?.value
        guard let value, !value.isEmpty else { errorMessage = L10n.string("リセットリンクが無効です"); return }
        resetToken = value
        statusMessage = L10n.string("新しいパスワードを入力してください")
    }
    func resetPassword(token: String, password: String) async throws {
        var request = URLRequest(url: endpoint("api/auth/reset-password")); request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject: ["token": token, "newPassword": password]); let (_, response) = try await URLSession.shared.data(for: request); guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }; resetToken = nil
    }
    func authenticate(email: String, password: String, signUp: Bool) async throws {
        var request = URLRequest(url: endpoint("api/auth/\(signUp ? "sign-up" : "sign-in")/email"))
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": password, "name": email.split(separator: "@").first.map(String.init) ?? "Filo user"])
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.userAuthenticationRequired) }
        guard let value = http.value(forHTTPHeaderField: "set-auth-token"), !value.isEmpty else { throw URLError(.userAuthenticationRequired) }
        token = value; KeychainToken.set(value)
    }

    private func endpoint(_ path: String, query: [String: String] = [:]) -> URL {
        var components = URLComponents(url: AppConfig.apiBaseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        return components.url!
    }
}

private enum KeychainToken {
    static let service = "com.filo.app.better-auth"
    static func get() -> String? { var result: CFTypeRef?; let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecReturnData as String: true]; guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }; return String(data: data, encoding: .utf8) }
    static func set(_ value: String) { remove(); let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]; SecItemAdd(query as CFDictionary, nil) }
    static func remove() { SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary) }
}

struct BetterAuthView: View {
    @EnvironmentObject private var auth: BetterAuth
    @State private var email = ""; @State private var password = ""; @State private var signUp = false; @State private var error: String?
    var body: some View {
        VStack(spacing: 16) { Text("Filo").font(.largeTitle.bold()); TextField("メールアドレス", text: $email).textInputAutocapitalization(.never).keyboardType(.emailAddress).textFieldStyle(.roundedBorder); SecureField("パスワード", text: $password).textFieldStyle(.roundedBorder)
            if let message = auth.statusMessage { Text(message).foregroundStyle(.green) }
            if let error { Text(error).foregroundStyle(.red) }
            if let message = auth.errorMessage { Text(message).foregroundStyle(.red) }
            Button { Task { do { try await auth.authenticate(email: email, password: password, signUp: signUp) } catch { self.error = L10n.string("認証に失敗しました") } } } label: {
                Text(L10n.string(signUp ? "アカウント作成" : "サインイン"))
            }.buttonStyle(.borderedProminent)
            if !signUp { Button("パスワードを忘れた場合") { Task { do { try await auth.sendPasswordReset(email: email); self.error = L10n.string("パスワードリセットメールを送信しました") } catch { self.error = L10n.string("メールを送信できませんでした") } } } }
            Button { signUp.toggle() } label: {
                Text(L10n.string(signUp ? "サインインへ" : "アカウントを作成"))
            }
        }.padding(24)
    }
}

struct BetterAuthResetPasswordView: View {
    @EnvironmentObject private var auth: BetterAuth
    @State private var password = ""; @State private var confirmation = ""; @State private var message: String?
    var body: some View { VStack(spacing: 16) { Text("パスワードを再設定").font(.title.bold()); SecureField("新しいパスワード", text: $password).textFieldStyle(.roundedBorder); SecureField("確認", text: $confirmation).textFieldStyle(.roundedBorder); if let message { Text(message) }; Button("変更する") { guard password.count >= 8, password == confirmation, let token = auth.resetToken else { message = L10n.string("8文字以上で同じパスワードを入力してください"); return }; Task { do { try await auth.resetPassword(token: token, password: password); message = L10n.string("パスワードを変更しました") } catch { message = L10n.string("変更に失敗しました") } } }.buttonStyle(.borderedProminent) }.padding(24) }
}
