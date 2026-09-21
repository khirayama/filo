import Foundation
import SwiftUI
import Security

@MainActor final class BetterAuth: ObservableObject {
    static let shared = BetterAuth()
    @Published private(set) var token: String?
    @Published var resetToken: String?
    @Published var statusMessage: String?
    @Published var errorMessage: String?
    @Published private(set) var isSubmitting = false
    private init() { token = KeychainToken.get(); resetToken = nil; statusMessage = nil; errorMessage = nil }
    func signOut() { token = nil; KeychainToken.remove() }
    func sendPasswordReset(email: String) async throws {
        isSubmitting = true
        defer { isSubmitting = false }
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
        isSubmitting = true
        defer { isSubmitting = false }
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
    @FocusState private var focusedField: AuthFocusField?

    var body: some View {
        ZStack {
            AuthBackdrop()
            ScrollView {
                VStack(spacing: 24) {
                    AuthBrandMark()
                    VStack(spacing: 8) {
                        Text("Filo")
                            .font(.system(size: 34, weight: .bold, design: .rounded))
                            .tracking(-1)
                        Text(L10n.string("リーディングリスト"))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(FiloPalette.muted)
                            .textCase(.uppercase)
                            .tracking(1.4)
                    }

                    VStack(alignment: .leading, spacing: 22) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(L10n.string(signUp ? "アカウント作成" : "サインイン"))
                                .font(.system(size: 30, weight: .bold, design: .rounded))
                                .tracking(-0.7)
                            Text(L10n.string("URLをリーディングリストに保存します。"))
                                .font(.subheadline)
                                .foregroundStyle(FiloPalette.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        VStack(spacing: 14) {
                            AuthInputField(label: L10n.string("メールアドレス"), icon: "envelope") {
                                TextField(L10n.string("メールアドレス"), text: $email)
                                    .textInputAutocapitalization(.never)
                                    .keyboardType(.emailAddress)
                                    .textContentType(.emailAddress)
                                    .focused($focusedField, equals: .email)
                            }
                            AuthInputField(label: L10n.string("パスワード"), icon: "lock") {
                                SecureField(L10n.string("パスワード"), text: $password)
                                    .textContentType(signUp ? .newPassword : .password)
                                    .focused($focusedField, equals: .password)
                            }
                            if signUp {
                                Text(L10n.string("8文字以上のパスワード"))
                                    .font(.caption)
                                    .foregroundStyle(FiloPalette.muted)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }

                        if let message = auth.statusMessage {
                            AuthMessage(message: message, tint: FiloPalette.ok, fill: FiloPalette.ok.opacity(0.12))
                        }
                        if let error {
                            AuthMessage(message: error, tint: FiloPalette.danger, fill: FiloPalette.dangerBackground)
                        }
                        if let message = auth.errorMessage {
                            AuthMessage(message: message, tint: FiloPalette.danger, fill: FiloPalette.dangerBackground)
                        }

                        Button {
                            Task {
                                error = nil
                                do {
                                    try await auth.authenticate(email: email, password: password, signUp: signUp)
                                } catch {
                                    self.error = L10n.string("認証に失敗しました")
                                }
                            }
                        } label: {
                            HStack {
                                Text(L10n.string(signUp ? "アカウント作成" : "サインイン"))
                                Spacer()
                                if auth.isSubmitting {
                                    ProgressView().tint(FiloPalette.onAccent)
                                } else {
                                    Image(systemName: "arrow.up.right")
                                        .font(.subheadline.weight(.bold))
                                }
                            }
                            .font(.headline)
                            .foregroundStyle(FiloPalette.onAccent)
                            .padding(.horizontal, 18)
                            .frame(maxWidth: .infinity, minHeight: 54)
                            .background(
                                LinearGradient(
                                    colors: [FiloPalette.accent, Color(hex: 0x7658E8)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing,
                                )
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .shadow(color: FiloPalette.accent.opacity(0.24), radius: 14, y: 8)
                        }
                        .disabled(auth.isSubmitting)
                        .opacity(auth.isSubmitting ? 0.65 : 1)

                        if !signUp {
                            Button(L10n.string("パスワードを忘れた場合")) {
                                Task {
                                    do {
                                        try await auth.sendPasswordReset(email: email)
                                        self.error = L10n.string("パスワードリセットメールを送信しました")
                                    } catch {
                                        self.error = L10n.string("メールを送信できませんでした")
                                    }
                                }
                            }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(FiloPalette.accent)
                            .frame(maxWidth: .infinity, alignment: .center)
                        }

                        HStack(spacing: 5) {
                            Text(L10n.string(signUp ? "すでにアカウントをお持ちですか？" : "はじめてご利用ですか？"))
                                .foregroundStyle(FiloPalette.muted)
                            Button(L10n.string(signUp ? "サインインへ" : "アカウントを作成")) {
                                withAnimation(.easeOut(duration: 0.2)) {
                                    signUp.toggle()
                                    error = nil
                                    focusedField = nil
                                }
                            }
                            .fontWeight(.semibold)
                            .foregroundStyle(FiloPalette.accent)
                        }
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, alignment: .center)
                    }
                    .padding(24)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .stroke(FiloPalette.border.opacity(0.65), lineWidth: 1)
                    )
                    .shadow(color: Color.black.opacity(0.10), radius: 26, y: 14)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 34)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
        }
    }
}

struct BetterAuthResetPasswordView: View {
    @EnvironmentObject private var auth: BetterAuth
    @State private var password = ""; @State private var confirmation = ""; @State private var message: String?
    var body: some View {
        ZStack {
            AuthBackdrop()
            VStack(alignment: .leading, spacing: 22) {
                AuthBrandMark()
                VStack(alignment: .leading, spacing: 8) {
                    Text(L10n.string("パスワードをリセット"))
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                    Text(L10n.string("新しいパスワードを入力してください。"))
                        .font(.subheadline)
                        .foregroundStyle(FiloPalette.muted)
                }
                AuthInputField(label: L10n.string("新しいパスワード"), icon: "lock") {
                    SecureField(L10n.string("新しいパスワード"), text: $password)
                }
                AuthInputField(label: L10n.string("新しいパスワード（確認）"), icon: "checkmark.shield") {
                    SecureField(L10n.string("確認"), text: $confirmation)
                }
                if let message {
                    AuthMessage(message: message, tint: FiloPalette.danger, fill: FiloPalette.dangerBackground)
                }
                Button(L10n.string("変更する")) {
                    guard password.count >= 8, password == confirmation, let token = auth.resetToken else {
                        message = L10n.string("8文字以上で同じパスワードを入力してください")
                        return
                    }
                    Task {
                        do {
                            try await auth.resetPassword(token: token, password: password)
                            message = L10n.string("パスワードを変更しました")
                        } catch {
                            message = L10n.string("変更に失敗しました")
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
            }
            .padding(24)
            .frame(maxWidth: 520)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).stroke(FiloPalette.border.opacity(0.65), lineWidth: 1))
            .shadow(color: Color.black.opacity(0.10), radius: 26, y: 14)
            .padding(20)
        }
    }
}

private enum AuthFocusField: Hashable {
    case email
    case password
}

private struct AuthBackdrop: View {
    var body: some View {
        ZStack {
            FiloPalette.background.ignoresSafeArea()
            Circle()
                .fill(LinearGradient(colors: [FiloPalette.accent.opacity(0.30), Color(hex: 0x7658E8).opacity(0.10)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 330, height: 330)
                .blur(radius: 10)
                .offset(x: 150, y: -310)
            Circle()
                .fill(Color(hex: 0xFF4DB8).opacity(0.12))
                .frame(width: 260, height: 260)
                .blur(radius: 12)
                .offset(x: -170, y: 330)
        }
    }
}

private struct AuthBrandMark: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(LinearGradient(colors: [Color(hex: 0x4FC3FF), Color(hex: 0x7C5CFF), Color(hex: 0xFF4DB8)], startPoint: .topLeading, endPoint: .bottomTrailing))
            Image(systemName: "bookmark.fill")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(.white)
        }
        .frame(width: 72, height: 72)
        .shadow(color: FiloPalette.accent.opacity(0.25), radius: 16, y: 8)
    }
}

private struct AuthInputField<Content: View>: View {
    let label: String
    let icon: String
    @ViewBuilder let content: Content

    init(label: String, icon: String, @ViewBuilder content: () -> Content) {
        self.label = label
        self.icon = icon
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(FiloPalette.text)
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(FiloPalette.muted)
                    .frame(width: 20)
                content
                    .font(.body)
                    .foregroundStyle(FiloPalette.text)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 52)
            .background(FiloPalette.background.opacity(0.72), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).stroke(FiloPalette.border, lineWidth: 1))
        }
    }
}

private struct AuthMessage: View {
    let message: String
    let tint: Color
    let fill: Color

    var body: some View {
        Text(message)
            .font(.caption)
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
