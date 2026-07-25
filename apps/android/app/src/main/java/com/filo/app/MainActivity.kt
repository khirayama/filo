package com.filo.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        LanguagePreference.apply(this)
        ThemePreference.load(this)
        enableEdgeToEdge()
        setContent {
            FiloTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    AuthRoot()
                }
            }
        }
    }
}

private object WirePalette {
    val Background = Color.White
    val Text = Color(0xFF111111)
    val Border = Color(0xFFD7D7D7)
    val MutedBorder = Color(0xFFE0E0E0)
}

@Composable
private fun AuthRoot(mainViewModel: MainViewModel = viewModel()) {
    val uiState by mainViewModel.uiState.collectAsState()

    if (!uiState.isConfigured) {
        CenteredMessage(
            title = "Clerk is not configured",
            body = "Set clerkPublishableKey in apps/android/local.properties.",
        )
        return
    }

    if (!uiState.isInitialized) {
        CenteredLoading()
        return
    }

    if (uiState.isSignedIn) {
        AppNavigation(onSignOut = mainViewModel::signOut)
        return
    }

    AuthScreen(
        uiState = uiState,
        onEmailChanged = mainViewModel::setEmail,
        onPasswordChanged = mainViewModel::setPassword,
        onConfirmPasswordChanged = mainViewModel::setConfirmPassword,
        onCodeChanged = mainViewModel::setCode,
        onSecondFactorCodeChanged = mainViewModel::setSecondFactorCode,
        onModeChanged = mainViewModel::setMode,
        onSignIn = mainViewModel::signIn,
        onSelectSecondFactor = mainViewModel::selectSecondFactor,
        onSubmitSecondFactor = mainViewModel::submitSecondFactor,
        onSignUp = mainViewModel::signUp,
        onVerifySignUp = mainViewModel::verifySignUp,
        onSendResetCode = mainViewModel::sendResetCode,
        onVerifyResetCode = mainViewModel::verifyResetCode,
        onResetPassword = mainViewModel::resetPassword,
        onBackToSignIn = mainViewModel::backToSignIn,
        onResendVerificationCode = mainViewModel::resendVerificationCode,
        onResendSecondFactorCode = mainViewModel::resendSecondFactorCode,
    )
}

// settings.theme を描画へ反映する。サーバー設定が届く前のフラッシュを防ぐため、
// 最後に適用した値を SharedPreferences に保持する (web の lib/theme.ts と同じ方針)
object ThemePreference {
    var value by mutableStateOf("system")
        private set

    fun load(context: Context) {
        value = prefs(context).getString("theme", "system") ?: "system"
    }

    fun set(context: Context, theme: String) {
        value = theme
        prefs(context).edit().putString("theme", theme).apply()
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences("filo_theme", Context.MODE_PRIVATE)
}

@Composable
private fun FiloTheme(content: @Composable () -> Unit) {
    val darkTheme = when (ThemePreference.value) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }
    MaterialTheme(
        colorScheme =
            if (darkTheme) {
                darkColorScheme(
                    primary = Color.White,
                    secondary = Color.White,
                    background = Color(0xFF111111),
                    surface = Color(0xFF1A1A1A),
                    onPrimary = Color(0xFF111111),
                    onSecondary = Color(0xFF111111),
                    onBackground = Color.White,
                    onSurface = Color.White,
                )
            } else {
                lightColorScheme(
                    primary = WirePalette.Text,
                    secondary = WirePalette.Text,
                    background = WirePalette.Background,
                    surface = WirePalette.Background,
                    onPrimary = WirePalette.Background,
                    onSecondary = WirePalette.Background,
                    onBackground = WirePalette.Text,
                    onSurface = WirePalette.Text,
                )
            },
        content = content,
    )
}

@Preview(showBackground = true)
@Composable
private fun AuthScreenPreview() {
    FiloTheme {
        AuthScreen(
            uiState = AuthUiState(),
            onEmailChanged = {},
            onPasswordChanged = {},
            onConfirmPasswordChanged = {},
            onCodeChanged = {},
            onSecondFactorCodeChanged = {},
            onModeChanged = {},
            onSignIn = {},
            onSelectSecondFactor = {},
            onSubmitSecondFactor = {},
            onSignUp = {},
            onVerifySignUp = {},
            onSendResetCode = {},
            onVerifyResetCode = {},
            onResetPassword = {},
            onBackToSignIn = {},
            onResendVerificationCode = {},
            onResendSecondFactorCode = {},
        )
    }
}

@Composable
private fun AuthScreen(
    uiState: AuthUiState,
    onEmailChanged: (String) -> Unit,
    onPasswordChanged: (String) -> Unit,
    onConfirmPasswordChanged: (String) -> Unit,
    onCodeChanged: (String) -> Unit,
    onSecondFactorCodeChanged: (String) -> Unit,
    onModeChanged: (AuthMode) -> Unit,
    onSignIn: () -> Unit,
    onSelectSecondFactor: (SecondFactorMethod) -> Unit,
    onSubmitSecondFactor: () -> Unit,
    onSignUp: () -> Unit,
    onVerifySignUp: () -> Unit,
    onSendResetCode: () -> Unit,
    onVerifyResetCode: () -> Unit,
    onResetPassword: () -> Unit,
    onBackToSignIn: () -> Unit,
    onResendVerificationCode: () -> Unit,
    onResendSecondFactorCode: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        colors = listOf(Color(0xFFF5E9D7), Color(0xFFE7D6BE)),
                    ),
                )
                .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surface,
            modifier = Modifier.fillMaxWidth(),
            shadowElevation = 12.dp,
            tonalElevation = 4.dp,
        ) {
            Column(modifier = Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Text("Filo", style = MaterialTheme.typography.labelLarge)
                Text(
                    text =
                        when (uiState.mode) {
                            AuthMode.SignIn -> "Sign in"
                            AuthMode.SignInSecondFactor -> "Verify your identity"
                            AuthMode.SignUp -> "Create account"
                            AuthMode.VerifySignUp -> "Verify your email"
                            AuthMode.ResetPasswordRequest -> "Reset password"
                            AuthMode.ResetPasswordVerify -> "Enter reset code"
                            AuthMode.ResetPasswordNewPassword -> "Choose a new password"
                        },
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text =
                        when (uiState.mode) {
                            AuthMode.SignIn -> "Sign in with your email address and password."
                            AuthMode.SignInSecondFactor ->
                                when (uiState.selectedSecondFactor) {
                                    SecondFactorMethod.Totp -> "Enter the code from your authenticator app."
                                    SecondFactorMethod.BackupCode -> "Enter one of your backup codes."
                                    SecondFactorMethod.EmailCode -> "Enter the code sent to your email."
                                    SecondFactorMethod.PhoneCode -> "Enter the code sent to your phone."
                                    null -> "Complete multi-factor authentication to continue."
                                }
                            AuthMode.SignUp -> "Create an account, then confirm the email code from Clerk."
                            AuthMode.VerifySignUp -> "Enter the email verification code sent by Clerk."
                            AuthMode.ResetPasswordRequest -> "We will send a reset code to your email address."
                            AuthMode.ResetPasswordVerify -> "Enter the reset code from your email."
                            AuthMode.ResetPasswordNewPassword -> "Set a new password to finish the reset flow."
                        },
                    style = MaterialTheme.typography.bodyMedium,
                )

                if (uiState.mode == AuthMode.SignIn || uiState.mode == AuthMode.SignUp) {
                    androidx.compose.material3.TabRow(selectedTabIndex = if (uiState.mode == AuthMode.SignIn) 0 else 1) {
                        androidx.compose.material3.Tab(
                            selected = uiState.mode == AuthMode.SignIn,
                            onClick = { onModeChanged(AuthMode.SignIn) },
                            text = { Text("Sign in") },
                        )
                        androidx.compose.material3.Tab(
                            selected = uiState.mode == AuthMode.SignUp,
                            onClick = { onModeChanged(AuthMode.SignUp) },
                            text = { Text("Sign up") },
                        )
                    }
                }

                when (uiState.mode) {
                    AuthMode.SignIn -> {
                        EmailField(uiState.email, onEmailChanged)
                        PasswordField("Password", uiState.password, onPasswordChanged)
                        SubmitButton(
                            text = "Sign in",
                            isLoading = uiState.isSubmitting,
                            onClick = onSignIn,
                        )
                        TextButton(onClick = { onModeChanged(AuthMode.ResetPasswordRequest) }) {
                            Text("Forgot password?")
                        }
                    }

                    AuthMode.SignInSecondFactor -> {
                        if (uiState.availableSecondFactors.size > 1) {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                uiState.availableSecondFactors.forEach { method ->
                                    val isSelected = method == uiState.selectedSecondFactor
                                    if (isSelected) {
                                        Button(
                                            modifier = Modifier.fillMaxWidth(),
                                            onClick = {},
                                            enabled = !uiState.isSubmitting,
                                        ) {
                                            Text(secondFactorLabel(method))
                                        }
                                    } else {
                                        OutlinedButton(
                                            modifier = Modifier.fillMaxWidth(),
                                            onClick = { onSelectSecondFactor(method) },
                                            enabled = !uiState.isSubmitting,
                                        ) {
                                            Text(secondFactorLabel(method))
                                        }
                                    }
                                }
                            }
                        }
                        CodeField(uiState.secondFactorCode, onSecondFactorCodeChanged)
                        SubmitButton(
                            text = "Verify",
                            isLoading = uiState.isSubmitting,
                            onClick = onSubmitSecondFactor,
                        )
                        if (uiState.selectedSecondFactor == SecondFactorMethod.EmailCode ||
                            uiState.selectedSecondFactor == SecondFactorMethod.PhoneCode
                        ) {
                            TextButton(
                                onClick = onResendSecondFactorCode,
                                enabled = !uiState.isSubmitting,
                            ) {
                                Text("Resend code")
                            }
                        }
                        OutlinedButton(onClick = onBackToSignIn, enabled = !uiState.isSubmitting) {
                            Text("Back to sign in")
                        }
                    }

                    AuthMode.SignUp -> {
                        EmailField(uiState.email, onEmailChanged)
                        PasswordField("Password", uiState.password, onPasswordChanged)
                        PasswordField("Confirm password", uiState.confirmPassword, onConfirmPasswordChanged)
                        SubmitButton(
                            text = "Create account",
                            isLoading = uiState.isSubmitting,
                            onClick = onSignUp,
                        )
                    }

                    AuthMode.VerifySignUp -> {
                        EmailField(uiState.email, onEmailChanged, enabled = false)
                        CodeField(uiState.code, onCodeChanged)
                        SubmitButton(
                            text = "Verify email",
                            isLoading = uiState.isSubmitting,
                            onClick = onVerifySignUp,
                        )
                        TextButton(onClick = onResendVerificationCode) {
                            Text("Resend code")
                        }
                    }

                    AuthMode.ResetPasswordRequest -> {
                        EmailField(uiState.email, onEmailChanged)
                        SubmitButton(
                            text = "Send reset code",
                            isLoading = uiState.isSubmitting,
                            onClick = onSendResetCode,
                        )
                        OutlinedButton(onClick = onBackToSignIn) {
                            Text("Back to sign in")
                        }
                    }

                    AuthMode.ResetPasswordVerify -> {
                        EmailField(uiState.email, onEmailChanged, enabled = false)
                        CodeField(uiState.code, onCodeChanged)
                        SubmitButton(
                            text = "Verify code",
                            isLoading = uiState.isSubmitting,
                            onClick = onVerifyResetCode,
                        )
                        OutlinedButton(onClick = onBackToSignIn) {
                            Text("Back to sign in")
                        }
                    }

                    AuthMode.ResetPasswordNewPassword -> {
                        PasswordField("New password", uiState.password, onPasswordChanged)
                        PasswordField("Confirm password", uiState.confirmPassword, onConfirmPasswordChanged)
                        SubmitButton(
                            text = "Update password",
                            isLoading = uiState.isSubmitting,
                            onClick = onResetPassword,
                        )
                    }
                }

                uiState.statusMessage?.let {
                    Text(text = it, color = Color(0xFF2F6A3D), style = MaterialTheme.typography.bodyMedium)
                }
                uiState.errorMessage?.let {
                    Text(text = it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

private fun secondFactorLabel(method: SecondFactorMethod): String =
    when (method) {
        SecondFactorMethod.Totp -> "Authenticator app"
        SecondFactorMethod.BackupCode -> "Backup code"
        SecondFactorMethod.EmailCode -> "Email code"
        SecondFactorMethod.PhoneCode -> "Phone code"
    }

@Composable
private fun AppNavigation(onSignOut: () -> Unit) {
    val navController = rememberNavController()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val tts = remember { com.filo.app.ui.TtsPlayerController(context, scope) }
    var showQueueSheet by remember { mutableStateOf(false) }

    var viewingArticleUrl by remember { mutableStateOf<String?>(null) }
    var viewingArticleTitle by remember { mutableStateOf<String?>(null) }
    var viewingArticleText by remember { mutableStateOf<String?>(null) }
    var viewingArticleLang by remember { mutableStateOf<String?>(null) }
    var viewingArticleExtractionFailed by remember { mutableStateOf(false) }

    val isViewingUnqueuedArticle = viewingArticleUrl != null && tts.queue.none { it.url == viewingArticleUrl }
    val shouldShowPlayerBar = tts.hasArticle || viewingArticleUrl != null

    // サーバー共有キューの取り込み(iOS / Web / Extension と同期)
    LaunchedEffect(Unit) { tts.syncWithServer() }

    DisposableEffect(Unit) {
        onDispose {
            tts.shutdown()
            TtsMediaService.onPlayPause = null
            TtsMediaService.onNext = null
            TtsMediaService.onPrev = null
            TtsMediaService.onDismiss = null
            context.stopService(Intent(context, TtsMediaService::class.java))
        }
    }

    SideEffect {
        TtsMediaService.onPlayPause = { tts.playPause() }
        TtsMediaService.onNext = {
            val next = tts.currentIndex + 1
            if (next < tts.queue.size) tts.skipTo(next)
        }
        TtsMediaService.onPrev = {
            val prev = tts.currentIndex - 1
            if (prev >= 0) tts.skipTo(prev)
        }
        TtsMediaService.onDismiss = { tts.dismiss() }
    }

    LaunchedEffect(tts.hasArticle, tts.playState, tts.currentChunk, tts.totalChunks, tts.articleTitle, tts.currentIndex, tts.queue.size) {
        if (tts.hasArticle) {
            val intent = Intent(context, TtsMediaService::class.java).apply {
                action = TtsMediaService.ACTION_UPDATE
                putExtra("title", tts.articleTitle)
                putExtra("playState", tts.playState)
                putExtra("chunk", tts.currentChunk)
                putExtra("total", tts.totalChunks)
                putExtra("hasNext", tts.currentIndex + 1 < tts.queue.size)
                putExtra("hasPrev", tts.currentIndex > 0)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        } else {
            context.stopService(Intent(context, TtsMediaService::class.java))
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        NavHost(
            navController = navController,
            startDestination = "articles",
            modifier = Modifier.weight(1f),
            enterTransition = {
                slideInHorizontally(initialOffsetX = { it }, animationSpec = tween(300))
            },
            exitTransition = {
                slideOutHorizontally(targetOffsetX = { -it }, animationSpec = tween(300))
            },
            popEnterTransition = {
                slideInHorizontally(initialOffsetX = { -it }, animationSpec = tween(300))
            },
            popExitTransition = {
                slideOutHorizontally(targetOffsetX = { it }, animationSpec = tween(300))
            },
        ) {
            composable("articles") {
                com.filo.app.ui.ArticlesScreen(
                    tts = tts,
                    onOpenSubscription = { navController.navigate("subscription/$it") },
                    onOpenSubscriptions = { navController.navigate("subscriptions") },
                    onOpenAddFeed = { navController.navigate("addFeed") },
                    onOpenTags = { navController.navigate("tags") },
                    onOpenStatus = { navController.navigate("status") },
                    onOpenSettings = { navController.navigate("settings") },
                    onOpenReadingList = { navController.navigate("reading-list") },
                    onOpenArticle = { articleId -> navController.navigate("article/$articleId") },
                )
            }
            composable("reading-list") {
                com.filo.app.ui.ArticlesScreen(
                    tts = tts,
                    onOpenSubscription = { navController.navigate("subscription/$it") },
                    onOpenSubscriptions = { navController.navigate("subscriptions") },
                    onOpenAddFeed = { navController.navigate("addFeed") },
                    onOpenTags = { navController.navigate("tags") },
                    onOpenStatus = { navController.navigate("status") },
                    onOpenSettings = { navController.navigate("settings") },
                    onOpenArticle = { articleId -> navController.navigate("article/$articleId") },
                    readingListOnly = true,
                    onBack = { navController.navigateUp() },
                )
            }
            composable("subscriptions") {
                com.filo.app.ui.SubscriptionsScreen(
                    onBack = { navController.navigateUp() },
                    onOpenSubscription = { navController.navigate("subscription/$it") },
                    onOpenAddFeed = { navController.navigate("addFeed") },
                    onOpenTags = { navController.navigate("tags") },
                    onOpenSettings = { navController.navigate("settings") },
                    onSelectTag = { tagId ->
                        // 記事一覧(バックスタック上の articles エントリ)にタグ絞り込みを適用して戻る
                        val articlesEntry = navController.getBackStackEntry("articles")
                        ViewModelProvider(articlesEntry)[com.filo.app.ui.ArticlesViewModel::class.java].apply {
                            selectedTagId = tagId
                            bookmarkedOnly = false
                        }
                        navController.popBackStack("articles", inclusive = false)
                    },
                )
            }
            composable("addFeed") {
                com.filo.app.ui.AddFeedScreen(onBack = { navController.navigateUp() })
            }
            composable("tags") {
                com.filo.app.ui.TagsScreen(onBack = { navController.navigateUp() })
            }
            composable("status") {
                com.filo.app.ui.StatusScreen(
                    onBack = { navController.navigateUp() },
                    onOpenSubscription = { navController.navigate("subscription/$it") },
                )
            }
            composable("settings") {
                com.filo.app.ui.SettingsScreen(
                    onBack = { navController.navigateUp() },
                    onSignOut = onSignOut,
                    onDeletionAccepted = { token -> navController.navigate("accountDeletion?token=$token") },
                )
            }
            composable("subscription/{id}") { backStackEntry ->
                val id = backStackEntry.arguments?.getString("id")?.toIntOrNull() ?: return@composable
                com.filo.app.ui.SubscriptionDetailScreen(
                    subscriptionId = id,
                    tts = tts,
                    onBack = { navController.navigateUp() },
                    onOpenArticle = { articleId -> navController.navigate("article/$articleId") },
                )
            }
            composable("article/{id}") { backStackEntry ->
                val id = backStackEntry.arguments?.getString("id")?.toIntOrNull() ?: return@composable
                val isInQueue = viewingArticleUrl != null && tts.queue.any { it.url == viewingArticleUrl }

                DisposableEffect(id) {
                    onDispose {
                        viewingArticleUrl = null
                        viewingArticleTitle = null
                        viewingArticleText = null
                        viewingArticleLang = null
                        viewingArticleExtractionFailed = false
                    }
                }

                LaunchedEffect(viewingArticleText, isInQueue) {
                    val url = viewingArticleUrl
                    val text = viewingArticleText
                    if (isInQueue && url != null && text != null) {
                        tts.prepareArticle(url, text, viewingArticleLang)
                    }
                }
                LaunchedEffect(viewingArticleExtractionFailed, isInQueue) {
                    val url = viewingArticleUrl
                    if (isInQueue && url != null && viewingArticleExtractionFailed) {
                        tts.markExtractionFailed(url)
                    }
                }

                com.filo.app.ui.ArticleReadingScreen(
                    articleId = id,
                    onBack = { navController.navigateUp() },
                    onArticleLoaded = { url, title ->
                        viewingArticleUrl = url
                        viewingArticleTitle = title
                        viewingArticleText = null
                        viewingArticleLang = null
                        viewingArticleExtractionFailed = false
                    },
                    onTextExtracted = { text, lang ->
                        viewingArticleText = text
                        viewingArticleLang = lang
                    },
                    onExtractionFailed = { viewingArticleExtractionFailed = true },
                )
            }
            composable("accountDeletion?token={token}") { backStackEntry ->
                val token = backStackEntry.arguments?.getString("token")
                com.filo.app.ui.AccountDeletionScreen(deletionToken = token, onSignOut = onSignOut)
            }
        }

        if (shouldShowPlayerBar) {
            val barDisplayUrl = viewingArticleUrl ?: tts.currentItem?.url ?: ""
            val barDisplayTitle = if (viewingArticleUrl != null) viewingArticleTitle ?: "" else tts.articleTitle
            val barIsPlaying = barDisplayUrl == tts.currentItem?.url && tts.playState == "playing"
            val barCanPlay = when {
                isViewingUnqueuedArticle -> viewingArticleText != null
                viewingArticleUrl != null -> tts.queue.firstOrNull { it.url == viewingArticleUrl }?.extractionState == "ready"
                else -> tts.extractionState == "ready"
            }

            fun handleBarPlay() {
                if (isViewingUnqueuedArticle) {
                    val url = viewingArticleUrl ?: return
                    val title = viewingArticleTitle ?: return
                    tts.markArticleActive(url, title)
                    val text = viewingArticleText
                    if (text != null) tts.prepareArticle(url, text, viewingArticleLang)
                    val idx = tts.queue.indexOfFirst { it.url == url }
                    if (idx >= 0) tts.skipTo(idx)
                    return
                }
                val vUrl = viewingArticleUrl
                if (vUrl != null) {
                    val idx = tts.queue.indexOfFirst { it.url == vUrl }
                    if (idx >= 0 && idx != tts.currentIndex) {
                        tts.skipTo(idx)
                        return
                    }
                }
                tts.playPause()
            }

            fun handleBarAdd() {
                val url = viewingArticleUrl ?: return
                val title = viewingArticleTitle ?: return
                tts.markArticleActive(url, title)
                val text = viewingArticleText
                if (text != null) {
                    tts.prepareArticle(url, text, viewingArticleLang)
                } else if (viewingArticleExtractionFailed) {
                    tts.markExtractionFailed(url)
                }
            }

            // 音声メニューの対象言語。再生中(または表示中)記事の言語に従う
            val speechLang = tts.currentItem?.lang ?: viewingArticleLang
            com.filo.app.ui.TtsPlayerBar(
                displayUrl = barDisplayUrl,
                displayTitle = barDisplayTitle,
                isPlaying = barIsPlaying,
                canPlay = barCanPlay,
                queueCount = tts.queue.size,
                showAddButton = isViewingUnqueuedArticle && !viewingArticleExtractionFailed,
                speechRate = tts.speechRate,
                voiceOptions = tts.voiceOptions(speechLang).map { it.name },
                selectedVoice = tts.voicePrefs[tts.voiceLangKey(speechLang)],
                onSelectVoice = { tts.setVoice(speechLang, it) },
                onPlayPause = { handleBarPlay() },
                onAdd = { handleBarAdd() },
                onShowQueue = { showQueueSheet = true },
                onCycleRate = { tts.cycleRate() },
            )
        }

        if (showQueueSheet) {
            com.filo.app.ui.TtsQueueSheet(
                queue = tts.queue,
                currentIndex = tts.currentIndex,
                playState = tts.playState,
                onSkipTo = { tts.skipTo(it) },
                onRemove = { tts.removeFromQueue(it) },
                onMove = { index, direction -> tts.moveInQueue(index, direction) },
                onClearAll = { tts.clearAll() },
                onDismiss = { showQueueSheet = false },
            )
        }
    }
}

@Composable
private fun EmailField(value: String, onValueChange: (String) -> Unit, enabled: Boolean = true) {
    OutlinedTextField(
        enabled = enabled,
        label = { Text("Email") },
        modifier = Modifier.fillMaxWidth(),
        onValueChange = onValueChange,
        singleLine = true,
        value = value,
    )
}
@Composable
private fun PasswordField(label: String, value: String, onValueChange: (String) -> Unit) {
    OutlinedTextField(
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth(),
        onValueChange = onValueChange,
        singleLine = true,
        value = value,
        visualTransformation = PasswordVisualTransformation(),
    )
}
@Composable
private fun CodeField(value: String, onValueChange: (String) -> Unit) {
    OutlinedTextField(
        label = { Text("Code") },
        modifier = Modifier.fillMaxWidth(),
        onValueChange = onValueChange,
        singleLine = true,
        value = value,
    )
}
@Composable
private fun SubmitButton(text: String, isLoading: Boolean, onClick: () -> Unit) {
    Button(modifier = Modifier.fillMaxWidth(), enabled = !isLoading, onClick = onClick) {
        if (isLoading) {
            CircularProgressIndicator(color = Color.White, modifier = Modifier.height(18.dp))
        } else {
            Text(text)
        }
    }
}
@Composable
private fun CenteredLoading() {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
    }
}
@Composable
private fun CenteredMessage(title: String, body: String) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
        Spacer(modifier = Modifier.height(12.dp))
        Text(body, style = MaterialTheme.typography.bodyLarge)
    }
}
