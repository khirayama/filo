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

enum class AuthMode { SignIn, SignUp, ResetPasswordRequest, ResetPasswordVerify, ResetPasswordNewPassword }
data class AuthUiState(val isConfigured: Boolean = true, val isInitialized: Boolean = true, val initializationError: Boolean = false, val isSignedIn: Boolean = TokenStore.get() != null, val isSubmitting: Boolean = false, val mode: AuthMode = if (AuthLinkStore.resetToken != null) AuthMode.ResetPasswordNewPassword else AuthMode.SignIn, val email: String = "", val password: String = "", val confirmPassword: String = "", val code: String = "", val statusMessage: String? = null, val errorMessage: String? = null)

private object TokenStore { fun get() = SecureTokenStore.get(); fun set(value: String) = SecureTokenStore.set(value); fun clear() = SecureTokenStore.clear() }

class MainViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState = _uiState.asStateFlow()
    private var resetToken: String? = AuthLinkStore.resetToken

    init {
        viewModelScope.launch {
            AuthLinkStore.resetEvents.collect { verifyResetCode() }
        }
    }

    fun retryInitialization() = update { copy(isInitialized = true, initializationError = false) }
    fun setEmail(value: String) = update { copy(email = value, errorMessage = null) }
    fun setPassword(value: String) = update { copy(password = value, errorMessage = null) }
    fun setConfirmPassword(value: String) = update { copy(confirmPassword = value, errorMessage = null) }
    fun setCode(value: String) = update { copy(code = value) }
    fun setMode(value: AuthMode) = update { copy(mode = value, errorMessage = null) }
    fun backToSignIn() = update { copy(mode = AuthMode.SignIn, password = "", confirmPassword = "", code = "") }
    fun signIn() = authenticate(false)
    fun signUp() = authenticate(true)

    private fun authenticate(signUp: Boolean) {
        val state = _uiState.value
        if (state.email.isBlank() || state.password.length < 8) {
            update { copy(errorMessage = "メールアドレスと8文字以上のパスワードが必要です") }
            return
        }
        submit {
            val endpoint = if (signUp) "sign-up" else "sign-in"
            val body = JSONObject().apply {
                put("email", state.email.trim())
                put("password", state.password)
                put("name", "Filo user")
            }.toString()
            val connection = post("/api/auth/$endpoint/email", body)
            val token = connection.getHeaderField("set-auth-token")
            if (connection.responseCode !in 200..299) error("認証に失敗しました")
            if (token.isNullOrBlank()) error("認証トークンを取得できませんでした")
            TokenStore.set(token)
            update { copy(isSignedIn = true, isSubmitting = false, statusMessage = null) }
        }
    }

    fun sendResetCode() {
        val email = _uiState.value.email.trim()
        if (email.isBlank()) { update { copy(errorMessage = "メールアドレスを入力してください") }; return }
        submit {
            val body = JSONObject().apply { put("email", email); put("redirectTo", "filo://auth/reset") }.toString()
            val connection = post("/api/auth/request-password-reset", body)
            if (connection.responseCode !in 200..299) error("リセットメールを送信できませんでした")
            update { copy(isSubmitting = false, statusMessage = "パスワードリセットメールを送信しました") }
        }
    }

    fun verifyResetCode() {
        resetToken = AuthLinkStore.resetToken
        if (resetToken.isNullOrBlank()) {
            update { copy(mode = AuthMode.ResetPasswordVerify, errorMessage = "リセットリンクを開いてください") }
        } else {
            update { copy(mode = AuthMode.ResetPasswordNewPassword, statusMessage = "新しいパスワードを入力してください") }
        }
    }

    fun resetPassword() {
        val state = _uiState.value
        val token = resetToken
        if (token.isNullOrBlank() || state.password.length < 8 || state.password != state.confirmPassword) {
            update { copy(errorMessage = "リセットリンクと8文字以上のパスワードを確認してください") }
            return
        }
        submit {
            val body = JSONObject().apply { put("token", token); put("newPassword", state.password) }.toString()
            val connection = post("/api/auth/reset-password", body)
            if (connection.responseCode !in 200..299) error("パスワードを変更できませんでした")
            resetToken = null
            AuthLinkStore.resetToken = null
            update { copy(mode = AuthMode.SignIn, isSubmitting = false, password = "", confirmPassword = "", statusMessage = "パスワードを変更しました") }
        }
    }

    fun signOut() { TokenStore.clear(); update { AuthUiState() } }

    private fun post(path: String, body: String): HttpURLConnection = request(path, "POST", body)
    private fun request(path: String, method: String, body: String? = null): HttpURLConnection {
        val connection = URL(BuildConfig.API_BASE_URL.trimEnd('/') + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.setRequestProperty("Content-Type", "application/json")
        connection.setRequestProperty("Accept", "application/json")
        if (body != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }
        return connection
    }

    private fun submit(block: suspend () -> Unit) {
        update { copy(isSubmitting = true, errorMessage = null) }
        viewModelScope.launch(Dispatchers.IO) {
            try { block() } catch (error: Exception) { update { copy(isSubmitting = false, errorMessage = error.message ?: "認証に失敗しました") } }
        }
    }

    private fun update(block: AuthUiState.() -> AuthUiState) { _uiState.value = _uiState.value.block() }
}
