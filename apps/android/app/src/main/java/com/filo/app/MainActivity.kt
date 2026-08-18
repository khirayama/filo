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
import androidx.compose.material3.AlertDialog
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
import androidx.compose.material3.Typography
import android.content.Context
import android.content.Intent
import android.net.Uri
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
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.NavType
import androidx.navigation.navArgument

class MainActivity : ComponentActivity() {
    private var sharedUrl by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sharedUrl = extractSharedUrl(intent)
        LanguagePreference.apply(this)
        ThemePreference.load(this)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }
        setContent {
            FiloTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    AuthRoot(sharedUrl = sharedUrl, onSharedUrlConsumed = { sharedUrl = null })
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        sharedUrl = extractSharedUrl(intent)
    }

    private fun extractSharedUrl(intent: Intent?): String? {
        val candidate = when (intent?.action) {
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            else -> intent?.dataString
        }?.trim() ?: return null
        return Regex("https?://\\S+", RegexOption.IGNORE_CASE).find(candidate)?.value?.trimEnd('.', ',', ')', ']', '"')
    }
}

internal object WirePalette {
    // Keep the native palette in lockstep with apps/web/src/global.css.
    val Background = Color(0xFFFFFFFF)
    val Surface = Color(0xFFFFFFFF)
    val Text = Color(0xFF222222)
    val Border = Color(0xFFD7D7D7)
    val MutedBorder = Color(0xFFE0E0E0)
    val Muted = Color(0xFF777777)
    val Accent = Color(0xFF1A56DB)
    val OnAccent = Color(0xFFFFFFFF)
    val Danger = Color(0xFFB3261E)
    val DangerBackground = Color(0xFFFFEBE9)
    val Star = Color(0xFFE8A100)
    val Ok = Color(0xFF2F6A3D)
    val Warn = Color(0xFF9A6700)
    val DarkBackground = Color(0xFF16181C)
    val DarkSurface = Color(0xFF1E2126)
    val DarkText = Color(0xFFE4E4E4)
    val DarkBorder = Color(0xFF464A52)
    val DarkMutedBorder = Color(0xFF33373E)
    val DarkMuted = Color(0xFF9AA0A8)
    val DarkAccent = Color(0xFF6A9BFF)
    val DarkOnAccent = Color(0xFF10233F)
    val DarkDanger = Color(0xFFEF7B74)
}

@Composable
private fun AuthRoot(
    sharedUrl: String? = null,
    onSharedUrlConsumed: () -> Unit = {},
    mainViewModel: MainViewModel = viewModel(),
) {
    val uiState by mainViewModel.uiState.collectAsState()

    if (!uiState.isConfigured) {
        CenteredMessage(
            title = "Clerk is not configured",
            body = "Set clerkPublishableKey in apps/android/local.properties.",
        )
        return
    }

    if (!uiState.isInitialized) {
        if (uiState.initializationError) {
            CenteredMessage(
                title = "Unable to connect",
                body = "Check your internet connection and try again.",
                actionLabel = "Retry",
                onAction = mainViewModel::retryInitialization,
            )
        } else {
            CenteredLoading()
        }
        return
    }

    if (uiState.isSignedIn) {
        RssNavigation(
            onSignOut = mainViewModel::signOut,
            sharedUrl = sharedUrl,
            onSharedUrlConsumed = onSharedUrlConsumed,
        )
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
                    primary = WirePalette.DarkAccent,
                    onPrimary = WirePalette.DarkOnAccent,
                    secondary = WirePalette.DarkText,
                    onSecondary = WirePalette.DarkBackground,
                    background = WirePalette.DarkBackground,
                    onBackground = WirePalette.DarkText,
                    surface = WirePalette.DarkSurface,
                    onSurface = WirePalette.DarkText,
                    surfaceVariant = WirePalette.DarkSurface,
                    onSurfaceVariant = WirePalette.DarkMuted,
                    outline = WirePalette.DarkBorder,
                    outlineVariant = WirePalette.DarkMutedBorder,
                    error = WirePalette.DarkDanger,
                    onError = WirePalette.DarkBackground,
                    errorContainer = Color(0xFF3A1F1E),
                    onErrorContainer = WirePalette.DarkDanger,
                    secondaryContainer = Color(0xFF33373E),
                    onSecondaryContainer = WirePalette.DarkText,
                )
            } else {
                lightColorScheme(
                    primary = WirePalette.Accent,
                    onPrimary = WirePalette.OnAccent,
                    secondary = WirePalette.Text,
                    onSecondary = WirePalette.Background,
                    background = WirePalette.Background,
                    surface = WirePalette.Surface,
                    onBackground = WirePalette.Text,
                    onSurface = WirePalette.Text,
                    surfaceVariant = Color(0xFFF6F6F6),
                    onSurfaceVariant = WirePalette.Muted,
                    outline = WirePalette.Border,
                    outlineVariant = WirePalette.MutedBorder,
                    error = WirePalette.Danger,
                    onError = WirePalette.Background,
                    errorContainer = WirePalette.DangerBackground,
                    onErrorContainer = WirePalette.Danger,
                    secondaryContainer = Color(0xFFF0F0F0),
                    onSecondaryContainer = WirePalette.Text,
                )
            },
        typography = Typography(
            bodyLarge = androidx.compose.ui.text.TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
            bodyMedium = androidx.compose.ui.text.TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
            bodySmall = androidx.compose.ui.text.TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
            labelLarge = androidx.compose.ui.text.TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
            labelMedium = androidx.compose.ui.text.TextStyle(fontSize = 13.sp, lineHeight = 18.sp),
            labelSmall = androidx.compose.ui.text.TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
            titleLarge = androidx.compose.ui.text.TextStyle(fontSize = 20.sp, lineHeight = 24.sp),
            titleMedium = androidx.compose.ui.text.TextStyle(fontSize = 18.sp, lineHeight = 22.sp),
        ),
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
                .background(MaterialTheme.colorScheme.background)
                .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surface,
            modifier = Modifier.fillMaxWidth(),
            shadowElevation = 0.dp,
            tonalElevation = 0.dp,
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
private fun RssNavigation(
    onSignOut: () -> Unit,
    sharedUrl: String? = null,
    onSharedUrlConsumed: () -> Unit = {},
) {
    val navController = rememberNavController()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val titleTranslations = remember { com.filo.app.ui.TitleTranslationStore(context, scope) }
    val readingPlayer = remember { com.filo.app.ui.ReadingPlayerController(context.applicationContext, scope) }
    val currentBackStackEntry by navController.currentBackStackEntryAsState()
    val isReadingBrowser = currentBackStackEntry?.destination?.route?.startsWith("reading") == true

    LaunchedEffect(currentBackStackEntry?.destination?.route) {
        currentBackStackEntry?.destination?.route?.let { route ->
            Analytics.screen(route.substringBefore('/').substringBefore('?'))
        }
    }

    DisposableEffect(Unit) {
        onDispose { readingPlayer.shutdown() }
    }

    if (titleTranslations.isShowingSetup) {
        com.filo.app.ui.TitleTranslationSetupSheet(titleTranslations) {
            titleTranslations.isShowingSetup = false
        }
    }

    LaunchedEffect(sharedUrl) {
        if (sharedUrl != null) navController.navigate("addArticle")
    }

    Column(Modifier.fillMaxSize()) {
        NavHost(
            navController = navController,
            startDestination = "articles",
            modifier = Modifier.weight(1f),
            enterTransition = {
                slideInHorizontally(
                    initialOffsetX = { it },
                    animationSpec = tween(280),
                )
            },
            exitTransition = {
                slideOutHorizontally(
                    targetOffsetX = { -it / 3 },
                    animationSpec = tween(280),
                )
            },
            popEnterTransition = {
                slideInHorizontally(
                    initialOffsetX = { -it / 3 },
                    animationSpec = tween(280),
                )
            },
            popExitTransition = {
                slideOutHorizontally(
                    targetOffsetX = { it },
                    animationSpec = tween(280),
                )
            },
        ) {
        composable("articles") { entry ->
            val selectedTagId by entry.savedStateHandle
                .getStateFlow<Int?>("selectedTagId", null)
                .collectAsState()
            com.filo.app.ui.ArticlesScreen(
                translations = titleTranslations,
                initialSelectedTagId = selectedTagId,
                onInitialSelectedTagConsumed = {
                    entry.savedStateHandle.remove<Int>("selectedTagId")
                },
                onOpenSubscription = { navController.navigate("subscription/$it") },
                onOpenSubscriptions = { navController.navigate("subscriptions") },
                onOpenAddFeed = {
                    navController.navigate("addFeed")
                },
                onOpenAddArticle = {
                    navController.navigate("addArticle")
                },
                onOpenArticle = { article ->
                    Analytics.track("select_item", mapOf("article_id" to article.id))
                    article.canonicalUrl?.let { url ->
                        navController.navigate(
                            "reading-article/${article.id}?url=${Uri.encode(url)}" +
                                "&title=${Uri.encode(article.title)}" +
                                "&language=${Uri.encode(article.sourceLanguage ?: "")}",
                        )
                    }
                },
                onOpenTags = { navController.navigate("tags") },
                onOpenStatus = { navController.navigate("status") },
                onOpenSettings = { navController.navigate("settings") },
                onStartReading = { autoplay ->
                    Analytics.track("start_reading", mapOf("autoplay" to autoplay))
                    navController.navigate("reading/$autoplay")
                },
            )
        }
        composable("reading/{autoplay}") { entry ->
            com.filo.app.ui.ReadingSessionScreen(
                player = readingPlayer,
                autoplay = entry.arguments?.getString("autoplay").toBoolean(),
                onBack = { navController.navigateUp() },
            )
        }
        composable(
            "reading-page?url={url}",
            arguments = listOf(navArgument("url") { type = NavType.StringType }),
        ) { entry ->
            com.filo.app.ui.ReadingSessionScreen(
                player = readingPlayer,
                autoplay = false,
                temporaryUrl = entry.arguments?.getString("url"),
                onBack = { navController.navigateUp() },
            )
        }
        composable(
            "reading-article/{articleId}?url={url}&title={title}&language={language}",
            arguments = listOf(
                navArgument("articleId") { type = NavType.IntType },
                navArgument("url") { type = NavType.StringType },
                navArgument("title") { type = NavType.StringType },
                navArgument("language") { type = NavType.StringType },
            ),
        ) { entry ->
            val article = com.filo.app.api.ReadingSessionArticle(
                id = entry.arguments?.getInt("articleId") ?: 0,
                title = entry.arguments?.getString("title").orEmpty(),
                sourceLanguage = entry.arguments?.getString("language")?.takeIf { it.isNotBlank() },
                canonicalUrl = entry.arguments?.getString("url"),
                feedTitle = "記事",
            )
            com.filo.app.ui.ReadingSessionScreen(
                player = readingPlayer,
                autoplay = false,
                directArticle = article,
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
                    navController.previousBackStackEntry?.savedStateHandle?.set("selectedTagId", tagId)
                    navController.navigateUp()
                },
            )
        }
        composable("addFeed") { com.filo.app.ui.AddFeedScreen(onBack = { navController.navigateUp() }) }
        composable("addArticle") {
            com.filo.app.ui.AddArticleScreen(
                initialUrl = sharedUrl.orEmpty(),
                onBack = {
                    onSharedUrlConsumed()
                    navController.navigateUp()
                },
                onReadAloud = { url ->
                    onSharedUrlConsumed()
                    navController.navigate("reading-page?url=${Uri.encode(url)}") {
                        popUpTo("addArticle") { inclusive = true }
                    }
                },
            )
        }
        composable("tags") { com.filo.app.ui.TagsScreen(onBack = { navController.navigateUp() }) }
        composable("status") {
            com.filo.app.ui.StatusScreen(
                onBack = { navController.navigateUp() },
                onOpenSubscription = { navController.navigate("subscription/$it") },
            )
        }
        composable("settings") {
            com.filo.app.ui.SettingsScreen(
                translations = titleTranslations,
                onBack = { navController.navigateUp() },
                onSignOut = onSignOut,
                onDeletionAccepted = { token -> navController.navigate("accountDeletion?token=$token") },
            )
        }
        composable("subscription/{id}") { entry ->
            val id = entry.arguments?.getString("id")?.toIntOrNull() ?: return@composable
            com.filo.app.ui.SubscriptionDetailScreen(
                translations = titleTranslations,
                subscriptionId = id,
                onBack = { navController.navigateUp() },
                onOpenArticle = { article ->
                    article.canonicalUrl?.let { url ->
                        navController.navigate(
                            "reading-article/${article.id}?url=${Uri.encode(url)}" +
                                "&title=${Uri.encode(article.title)}" +
                                "&language=${Uri.encode(article.sourceLanguage ?: "")}",
                        )
                    }
                },
            )
        }
        composable("accountDeletion?token={token}") { entry ->
            com.filo.app.ui.AccountDeletionScreen(
                deletionToken = entry.arguments?.getString("token"),
                onSignOut = onSignOut,
            )
        }
        }
        if (readingPlayer.isPlaying && !isReadingBrowser) {
            com.filo.app.ui.ReadingMiniPlayer(readingPlayer)
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
private fun CenteredMessage(
    title: String,
    body: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
        Spacer(modifier = Modifier.height(12.dp))
        Text(body, style = MaterialTheme.typography.bodyLarge)
        if (actionLabel != null && onAction != null) {
            Spacer(modifier = Modifier.height(20.dp))
            Button(onClick = onAction) {
                Text(actionLabel)
            }
        }
    }
}
