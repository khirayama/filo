package com.filo.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clerk.api.Clerk
import com.clerk.api.network.model.factor.Factor
import com.clerk.api.network.serialization.errorMessage
import com.clerk.api.network.serialization.onFailure
import com.clerk.api.network.serialization.onSuccess
import com.clerk.api.signin.SignIn
import com.clerk.api.signin.attemptFirstFactor
import com.clerk.api.signin.attemptSecondFactor
import com.clerk.api.signin.prepareFirstFactor
import com.clerk.api.signin.prepareSecondFactor
import com.clerk.api.signin.resetPassword
import com.clerk.api.signup.SignUp
import com.clerk.api.signup.attemptVerification
import com.clerk.api.signup.prepareVerification
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

enum class AuthMode {
    SignIn,
    SignInSecondFactor,
    SignUp,
    VerifySignUp,
    ResetPasswordRequest,
    ResetPasswordVerify,
    ResetPasswordNewPassword,
}

enum class SecondFactorMethod {
    Totp,
    BackupCode,
    EmailCode,
    PhoneCode,
}

data class AuthUiState(
    val isConfigured: Boolean = BuildConfig.CLERK_PUBLISHABLE_KEY.isNotBlank(),
    val isInitialized: Boolean = false,
    val isSignedIn: Boolean = false,
    val isSubmitting: Boolean = false,
    val mode: AuthMode = AuthMode.SignIn,
    val email: String = "",
    val password: String = "",
    val confirmPassword: String = "",
    val code: String = "",
    val secondFactorCode: String = "",
    val availableSecondFactors: List<SecondFactorMethod> = emptyList(),
    val selectedSecondFactor: SecondFactorMethod? = null,
    val statusMessage: String? = null,
    val errorMessage: String? = null,
)

class MainViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState = _uiState.asStateFlow()
    private var pendingSignIn: SignIn? = null
    private var pendingSignUp: SignUp? = null
    private var pendingResetSignIn: SignIn? = null

    init {
        if (_uiState.value.isConfigured) {
            combine(Clerk.isInitialized, Clerk.userFlow) { initialized, user ->
                initialized to user
            }.onEach { (initialized, user) ->
                _uiState.value =
                    _uiState.value.copy(
                        isInitialized = initialized,
                        isSignedIn = user != null,
                        mode = if (user != null) _uiState.value.mode else normalizeSignedOutMode(_uiState.value.mode),
                    )
            }.launchIn(viewModelScope)
        }
    }

    fun setEmail(value: String) = updateForm { copy(email = value, errorMessage = null, statusMessage = null) }

    fun setPassword(value: String) =
        updateForm { copy(password = value, errorMessage = null, statusMessage = null) }

    fun setConfirmPassword(value: String) =
        updateForm { copy(confirmPassword = value, errorMessage = null, statusMessage = null) }

    fun setCode(value: String) = updateForm { copy(code = value, errorMessage = null, statusMessage = null) }

    fun setSecondFactorCode(value: String) =
        updateForm { copy(secondFactorCode = value, errorMessage = null, statusMessage = null) }

    fun setMode(mode: AuthMode) = updateForm { copy(mode = mode, errorMessage = null, statusMessage = null) }

    fun backToSignIn() {
        pendingSignIn = null
        _uiState.value =
            _uiState.value.copy(
                mode = AuthMode.SignIn,
                password = "",
                confirmPassword = "",
                code = "",
                secondFactorCode = "",
                availableSecondFactors = emptyList(),
                selectedSecondFactor = null,
                statusMessage = null,
                errorMessage = null,
            )
    }

    fun signIn() {
        val state = _uiState.value
        if (state.email.isBlank() || state.password.isBlank()) {
            showError("Email and password are required.")
            return
        }

        submit {
            SignIn.create(
                SignIn.CreateParams.Strategy.Identifier(
                    identifier = state.email.trim(),
                ),
            ).onSuccess { signIn ->
                signIn.attemptFirstFactor(
                    SignIn.AttemptFirstFactorParams.Password(
                        password = state.password,
                    ),
                ).onSuccess { updatedSignIn ->
                    when (updatedSignIn.status) {
                        SignIn.Status.COMPLETE -> activateSession(updatedSignIn, clearPendingSignIn = true)
                        SignIn.Status.NEEDS_SECOND_FACTOR -> {
                            pendingSignIn = updatedSignIn
                            val supportedFactors =
                                updatedSignIn.supportedSecondFactors.orEmpty().mapNotNull(::toSecondFactorMethod)
                            val selectedFactor = supportedFactors.firstOrNull()
                            if (selectedFactor == null) {
                                finishFailure("No supported multi-factor authentication methods are available.")
                                return@onSuccess
                            }

                            handleSecondFactorSelection(
                                signIn = updatedSignIn,
                                method = selectedFactor,
                                isRetry = false,
                            )
                        }
                        else -> {
                            finishFailure("Unexpected sign-in state: ${updatedSignIn.status}")
                        }
                    }
                }.onFailure {
                    finishFailure(it.errorMessage ?: "Unable to verify the password.")
                }
            }.onFailure {
                finishFailure(it.errorMessage ?: "Unable to start sign in.")
            }
        }
    }

    fun selectSecondFactor(method: SecondFactorMethod) {
        val signIn = pendingSignIn
        if (signIn == null) {
            showError("Restart sign in to continue.")
            return
        }

        submit {
            handleSecondFactorSelection(signIn = signIn, method = method, isRetry = false)
        }
    }

    fun resendSecondFactorCode() {
        val signIn = pendingSignIn
        val method = _uiState.value.selectedSecondFactor
        if (signIn == null || method == null) {
            showError("Restart sign in to continue.")
            return
        }

        submit {
            handleSecondFactorSelection(signIn = signIn, method = method, isRetry = true)
        }
    }

    fun submitSecondFactor() {
        val signIn = pendingSignIn
        val state = _uiState.value
        val method = state.selectedSecondFactor
        val code = state.secondFactorCode.trim()
        if (signIn == null || method == null) {
            showError("Restart sign in to continue.")
            return
        }
        if (code.isBlank()) {
            showError("Enter your verification code.")
            return
        }

        submit {
            signIn.attemptSecondFactor(method.toAttemptParams(code))
                .onSuccess { updatedSignIn ->
                    pendingSignIn = updatedSignIn
                    when (updatedSignIn.status) {
                        SignIn.Status.COMPLETE -> activateSession(updatedSignIn, clearPendingSignIn = true)
                        SignIn.Status.NEEDS_SECOND_FACTOR ->
                            _uiState.value =
                                _uiState.value.copy(
                                    isSubmitting = false,
                                    secondFactorCode = "",
                                    errorMessage = null,
                                    statusMessage = null,
                                )
                        else -> finishFailure("Unexpected sign-in state: ${updatedSignIn.status}")
                    }
                }.onFailure {
                    finishFailure(it.errorMessage ?: "Unable to verify the second factor.")
                }
        }
    }

    fun signUp() {
        val state = _uiState.value
        if (state.email.isBlank() || state.password.isBlank() || state.confirmPassword.isBlank()) {
            showError("Email, password, and confirmation are required.")
            return
        }
        if (state.password != state.confirmPassword) {
            showError("Passwords do not match.")
            return
        }

        submit {
            SignUp.create(
                SignUp.CreateParams.Standard(
                    emailAddress = state.email.trim(),
                    password = state.password,
                ),
            ).onSuccess { signUp ->
                pendingSignUp = signUp
                signUp.prepareVerification(
                    SignUp.PrepareVerificationParams.Strategy.EmailCode(),
                ).onSuccess {
                    _uiState.value =
                        _uiState.value.copy(
                            isSubmitting = false,
                            mode = AuthMode.VerifySignUp,
                            code = "",
                            errorMessage = null,
                            statusMessage = "A verification code was sent to your email.",
                        )
                }.onFailure {
                    finishFailure(it.errorMessage ?: "Unable to send verification code.")
                }
            }.onFailure {
                finishFailure(it.errorMessage ?: "Unable to create your account.")
            }
        }
    }

    fun resendVerificationCode() {
        val signUp = pendingSignUp
        val email = _uiState.value.email.trim()
        if (signUp == null || email.isBlank()) {
            showError("Start sign up again to resend the code.")
            return
        }

        submit {
            signUp.prepareVerification(
                SignUp.PrepareVerificationParams.Strategy.EmailCode(),
            )
                .onSuccess {
                    _uiState.value =
                        _uiState.value.copy(
                            isSubmitting = false,
                            errorMessage = null,
                            statusMessage = "A new verification code was sent.",
                        )
                }.onFailure {
                    finishFailure(it.errorMessage ?: "Unable to resend the verification code.")
                }
        }
    }

    fun verifySignUp() {
        val signUp = pendingSignUp
        val code = _uiState.value.code.trim()
        if (signUp == null || code.isBlank()) {
            showError("Enter the verification code.")
            return
        }

        submit {
            signUp.attemptVerification(
                SignUp.AttemptVerificationParams.EmailCode(code = code),
            ).onSuccess { completedSignUp ->
                pendingSignUp = completedSignUp
                completedSignUp.createdSessionId?.let { sessionId ->
                    Clerk.setActive(sessionId = sessionId, organizationId = null)
                        .onSuccess {
                            pendingSignUp = null
                            _uiState.value =
                                _uiState.value.copy(
                                    isSubmitting = false,
                                    errorMessage = null,
                                    statusMessage = null,
                                    code = "",
                                    password = "",
                                    confirmPassword = "",
                                )
                        }.onFailure {
                            finishFailure(it.errorMessage ?: "Unable to activate the session.")
                        }
                } ?: finishFailure("Verification completed without a session.")
            }.onFailure {
                finishFailure(it.errorMessage ?: "Unable to verify the code.")
            }
        }
    }

    fun sendResetCode() {
        val email = _uiState.value.email.trim()
        if (email.isBlank()) {
            showError("Enter your email address.")
            return
        }

        submit {
            SignIn.create(
                SignIn.CreateParams.Strategy.ResetPasswordEmailCode(identifier = email),
            ).onSuccess { signIn ->
                pendingResetSignIn = signIn
                signIn.prepareFirstFactor(
                    SignIn.PrepareFirstFactorParams.ResetPasswordEmailCode(),
                ).onSuccess { updatedSignIn ->
                    pendingResetSignIn = updatedSignIn
                    handleResetStatus(updatedSignIn.status, "A reset code was sent to your email.")
                }.onFailure {
                    finishFailure(it.errorMessage ?: "Unable to send reset code.")
                }
            }.onFailure {
                finishFailure(it.errorMessage ?: "Unable to start password reset.")
            }
        }
    }

    fun verifyResetCode() {
        val signIn = pendingResetSignIn
        val code = _uiState.value.code.trim()
        if (signIn == null || code.isBlank()) {
            showError("Enter the reset code.")
            return
        }

        submit {
            signIn.attemptFirstFactor(
                SignIn.AttemptFirstFactorParams.ResetPasswordEmailCode(code = code),
            ).onSuccess { updatedSignIn ->
                pendingResetSignIn = updatedSignIn
                handleResetStatus(updatedSignIn.status, "Code accepted. Choose a new password.")
            }.onFailure {
                finishFailure(it.errorMessage ?: "Unable to verify the reset code.")
            }
        }
    }

    fun resetPassword() {
        val signIn = pendingResetSignIn
        val state = _uiState.value
        if (signIn == null) {
            showError("Restart the password reset flow.")
            return
        }
        if (state.password.isBlank() || state.confirmPassword.isBlank()) {
            showError("Enter and confirm the new password.")
            return
        }
        if (state.password != state.confirmPassword) {
            showError("Passwords do not match.")
            return
        }

        submit {
            signIn.resetPassword(state.password)
                .onSuccess { updatedSignIn ->
                    pendingResetSignIn = updatedSignIn
                    updatedSignIn.createdSessionId?.let { sessionId ->
                        Clerk.setActive(sessionId = sessionId, organizationId = null)
                            .onSuccess {
                                pendingResetSignIn = null
                                handleResetStatus(updatedSignIn.status, null)
                            }.onFailure {
                                finishFailure(it.errorMessage ?: "Unable to activate the session.")
                            }
                    } ?: handleResetStatus(updatedSignIn.status, null)
                }.onFailure {
                    finishFailure(it.errorMessage ?: "Unable to update the password.")
                }
        }
    }

    fun signOut() {
        submit {
            Clerk.signOut()
                .onSuccess {
                    pendingSignIn = null
                    pendingSignUp = null
                    pendingResetSignIn = null
                    _uiState.value =
                        _uiState.value.copy(
                            isSubmitting = false,
                            isSignedIn = false,
                            mode = AuthMode.SignIn,
                            password = "",
                            confirmPassword = "",
                            code = "",
                            secondFactorCode = "",
                            availableSecondFactors = emptyList(),
                            selectedSecondFactor = null,
                            statusMessage = "You have been signed out.",
                            errorMessage = null,
                        )
                }.onFailure {
                    finishFailure(it.errorMessage ?: "Unable to sign out.")
                }
        }
    }

    private suspend fun handleSecondFactorSelection(signIn: SignIn, method: SecondFactorMethod, isRetry: Boolean) {
        when (method) {
            SecondFactorMethod.EmailCode -> {
                val factor = signIn.supportedSecondFactors.orEmpty().firstOrNull { toSecondFactorMethod(it) == method }
                val emailAddressId = factor?.emailAddressId
                if (emailAddressId.isNullOrBlank()) {
                    finishFailure("No email second factor is available for this account.")
                    return
                }
                signIn.prepareSecondFactor(emailAddressId = emailAddressId).onSuccess { updatedSignIn ->
                    pendingSignIn = updatedSignIn
                    showSecondFactorStep(
                        method = method,
                        signIn = updatedSignIn,
                        message = if (isRetry) "A new email code was sent." else "A verification code was sent to your email.",
                    )
                }.onFailure {
                    finishFailure(it.errorMessage ?: "Unable to send an email verification code.")
                }
            }

            SecondFactorMethod.PhoneCode -> {
                val factor = signIn.supportedSecondFactors.orEmpty().firstOrNull { toSecondFactorMethod(it) == method }
                val phoneNumberId = factor?.phoneNumberId
                if (phoneNumberId.isNullOrBlank()) {
                    finishFailure("No phone second factor is available for this account.")
                    return
                }
                signIn.prepareSecondFactor(phoneNumberId = phoneNumberId).onSuccess { updatedSignIn ->
                    pendingSignIn = updatedSignIn
                    showSecondFactorStep(
                        method = method,
                        signIn = updatedSignIn,
                        message = if (isRetry) "A new phone code was sent." else "A verification code was sent to your phone.",
                    )
                }.onFailure {
                    finishFailure(it.errorMessage ?: "Unable to send a phone verification code.")
                }
            }

            SecondFactorMethod.Totp,
            SecondFactorMethod.BackupCode,
            -> {
                showSecondFactorStep(method = method, signIn = signIn, message = null)
            }
        }
    }

    private fun showSecondFactorStep(method: SecondFactorMethod, signIn: SignIn, message: String?) {
        _uiState.value =
            _uiState.value.copy(
                isSubmitting = false,
                mode = AuthMode.SignInSecondFactor,
                availableSecondFactors = signIn.supportedSecondFactors.orEmpty().mapNotNull(::toSecondFactorMethod),
                selectedSecondFactor = method,
                secondFactorCode = "",
                errorMessage = null,
                statusMessage = message,
            )
    }

    private suspend fun activateSession(signIn: SignIn, clearPendingSignIn: Boolean) {
        signIn.createdSessionId?.let { sessionId ->
            Clerk.setActive(sessionId = sessionId, organizationId = null)
                .onSuccess {
                    if (clearPendingSignIn) {
                        pendingSignIn = null
                    }
                    _uiState.value =
                        _uiState.value.copy(
                            isSubmitting = false,
                            password = "",
                            confirmPassword = "",
                            code = "",
                            secondFactorCode = "",
                            availableSecondFactors = emptyList(),
                            selectedSecondFactor = null,
                            errorMessage = null,
                            statusMessage = null,
                        )
                }.onFailure {
                    finishFailure(it.errorMessage ?: "Unable to activate the session.")
                }
        } ?: finishFailure("Sign-in completed without a session.")
    }

    private fun handleResetStatus(status: SignIn.Status, message: String?) {
        _uiState.value =
            when (status) {
                SignIn.Status.COMPLETE ->
                    _uiState.value.copy(
                        isSubmitting = false,
                        password = "",
                        confirmPassword = "",
                        code = "",
                        errorMessage = null,
                        statusMessage = null,
                    )
                SignIn.Status.NEEDS_FIRST_FACTOR ->
                    _uiState.value.copy(
                        isSubmitting = false,
                        mode = AuthMode.ResetPasswordVerify,
                        errorMessage = null,
                        statusMessage = message,
                    )
                SignIn.Status.NEEDS_NEW_PASSWORD ->
                    _uiState.value.copy(
                        isSubmitting = false,
                        mode = AuthMode.ResetPasswordNewPassword,
                        code = "",
                        password = "",
                        confirmPassword = "",
                        errorMessage = null,
                        statusMessage = message,
                    )
                else ->
                    _uiState.value.copy(
                        isSubmitting = false,
                        errorMessage = "Unexpected password reset state: $status",
                        statusMessage = null,
                    )
            }
    }

    private fun submit(block: suspend () -> Unit) {
        _uiState.value = _uiState.value.copy(isSubmitting = true, errorMessage = null)
        viewModelScope.launch { block() }
    }

    private fun finishFailure(message: String) {
        _uiState.value = _uiState.value.copy(isSubmitting = false, errorMessage = message, statusMessage = null)
    }

    private fun showError(message: String) {
        _uiState.value = _uiState.value.copy(errorMessage = message, statusMessage = null)
    }

    private fun updateForm(transform: AuthUiState.() -> AuthUiState) {
        _uiState.value = _uiState.value.transform()
    }

    private fun normalizeSignedOutMode(mode: AuthMode): AuthMode =
        when (mode) {
            AuthMode.VerifySignUp,
            AuthMode.ResetPasswordRequest,
            AuthMode.ResetPasswordVerify,
            AuthMode.ResetPasswordNewPassword,
            -> mode
            AuthMode.SignIn,
            AuthMode.SignInSecondFactor,
            AuthMode.SignUp,
            -> AuthMode.SignIn
        }

    private fun toSecondFactorMethod(factor: Factor): SecondFactorMethod? =
        when (factor.strategy) {
            "totp" -> SecondFactorMethod.Totp
            "backup_code" -> SecondFactorMethod.BackupCode
            "email_code" -> SecondFactorMethod.EmailCode
            "phone_code" -> SecondFactorMethod.PhoneCode
            else -> null
        }

    private fun SecondFactorMethod.toAttemptParams(code: String): SignIn.AttemptSecondFactorParams =
        when (this) {
            SecondFactorMethod.Totp -> SignIn.AttemptSecondFactorParams.TOTP(code = code)
            SecondFactorMethod.BackupCode -> SignIn.AttemptSecondFactorParams.BackupCode(code = code)
            SecondFactorMethod.EmailCode -> SignIn.AttemptSecondFactorParams.EmailCode(code = code)
            SecondFactorMethod.PhoneCode -> SignIn.AttemptSecondFactorParams.PhoneCode(code = code)
        }
}
