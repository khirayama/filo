package com.filo.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject
import com.filo.app.api.ApiClient
import com.filo.app.ui.AppText

// Password reset finishes on the Web /reset-password page, so the app only requests the email.
enum class AuthMode { SignIn, SignUp, ResetPasswordRequest }
data class AuthUiState(val isSignedIn: Boolean = TokenStore.get() != null, val isSubmitting: Boolean = false, val mode: AuthMode = AuthMode.SignIn, val email: String = "", val password: String = "", val statusMessage: AppText? = null, val errorMessage: AppText? = null)

private class AuthMessageException(val text: AppText) : Exception()

private object TokenStore { fun get() = SecureTokenStore.get(); fun set(value: String) = SecureTokenStore.set(value); fun clear() = SecureTokenStore.clear() }

class MainViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState = _uiState.asStateFlow()

    init {
        // A token issued meanwhile by a new sign-in is kept.
        viewModelScope.launch {
            ApiClient.rejectedTokens.collect { rejected ->
                if (TokenStore.get() != rejected) return@collect
                TokenStore.clear()
                _uiState.value = AuthUiState(isSignedIn = false, errorMessage = AppText("サインインが必要です。"))
            }
        }
    }
    fun setEmail(value: String) = update { copy(email = value, errorMessage = null) }
    fun setPassword(value: String) = update { copy(password = value, errorMessage = null) }
    fun setMode(value: AuthMode) = update { copy(mode = value, errorMessage = null) }
    fun backToSignIn() = update { copy(mode = AuthMode.SignIn, password = "") }
    fun signIn() = authenticate(false)
    fun signUp() = authenticate(true)

    private fun authenticate(signUp: Boolean) {
        val state = _uiState.value
        if (state.email.isBlank() || state.password.length < 8) {
            update { copy(errorMessage = AppText("メールアドレスと8文字以上のパスワードが必要です")) }
            return
        }
        submit {
            val endpoint = if (signUp) "sign-up" else "sign-in"
            val body = JSONObject().apply {
                put("email", state.email.trim())
                put("password", state.password)
                put("name", state.email.substringBefore("@").ifBlank { "Filo user" })
            }.toString()
            val connection = post("/api/auth/$endpoint/email", body)
            val (status, token) = try {
                connection.responseCode to connection.getHeaderField("set-auth-token")
            } finally {
                connection.disconnect()
            }
            if (status !in 200..299) throw AuthMessageException(AppText("認証に失敗しました"))
            if (token.isNullOrBlank()) throw AuthMessageException(AppText("認証トークンを取得できませんでした"))
            TokenStore.set(token)
            update { copy(isSignedIn = true, isSubmitting = false, statusMessage = null) }
        }
    }

    fun sendResetCode() {
        val email = _uiState.value.email.trim()
        if (email.isBlank()) { update { copy(errorMessage = AppText("メールアドレスを入力してください")) }; return }
        submit {
            val resetUrl = BuildConfig.WEB_BASE_URL.trimEnd('/') + "/reset-password"
            val body = JSONObject().apply { put("email", email); put("redirectTo", resetUrl) }.toString()
            val connection = post("/api/auth/request-password-reset", body)
            val status = try { connection.responseCode } finally { connection.disconnect() }
            if (status !in 200..299) throw AuthMessageException(AppText("リセットメールを送信できませんでした"))
            update { copy(isSubmitting = false, statusMessage = AppText("パスワードリセットメールを送信しました")) }
        }
    }

    // Ends the session on the server as well, so the token stops working even
    // if it was copied. Local sign-out never waits for the network.
    fun signOut() = signOut(notice = null)

    // Signing out leaves the deletion screen, so the sign-in screen carries the result.
    fun accountDeleted() = signOut(AppText("アカウントの削除が完了しました。ご利用ありがとうございました。"))

    private fun signOut(notice: AppText?) {
        val token = TokenStore.get()
        TokenStore.clear()
        _uiState.value = AuthUiState(isSignedIn = false, statusMessage = notice)
        if (token != null) {
            viewModelScope.launch(Dispatchers.IO) {
                runCatching {
                    val connection = request("/api/auth/sign-out", "POST", "{}", bearer = token)
                    try { connection.responseCode } finally { connection.disconnect() }
                }
            }
        }
    }

    private fun post(path: String, body: String): HttpURLConnection = request(path, "POST", body)
    private fun request(path: String, method: String, body: String? = null, bearer: String? = null): HttpURLConnection {
        val connection = URL(BuildConfig.API_BASE_URL.trimEnd('/') + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.setRequestProperty("Content-Type", "application/json")
        connection.setRequestProperty("Accept", "application/json")
        if (bearer != null) connection.setRequestProperty("Authorization", "Bearer $bearer")
        if (body != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }
        return connection
    }

    private fun submit(block: suspend () -> Unit) {
        update { copy(isSubmitting = true, errorMessage = null) }
        viewModelScope.launch(Dispatchers.IO) {
            try {
                block()
            } catch (error: Exception) {
                val message = (error as? AuthMessageException)?.text ?: AppText("認証に失敗しました")
                update { copy(isSubmitting = false, errorMessage = message) }
            }
        }
    }

    private fun update(block: AuthUiState.() -> AuthUiState) { _uiState.value = _uiState.value.block() }
}
