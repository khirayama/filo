package com.filo.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NamedNavArgument
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.filo.app.ui.ButtonKind
import com.filo.app.ui.Filo
import com.filo.app.ui.FiloBrand
import com.filo.app.ui.FiloButton
import com.filo.app.ui.FiloDrawer
import com.filo.app.ui.FiloSpinnerMark
import com.filo.app.ui.FiloTextField
import com.filo.app.ui.FiloTheme
import com.filo.app.ui.SidebarNav
import com.filo.app.ui.tr
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private var sharedUrl by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AuthLinkStore.accept(intent?.data)
        sharedUrl = extractSharedUrl(intent)
        LanguagePreference.load(this)
        ThemePreference.load(this)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }
        setContent {
            FiloTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = Filo.colors.bg,
                ) {
                    AuthRoot(sharedUrl = sharedUrl, onSharedUrlConsumed = { sharedUrl = null })
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        AuthLinkStore.accept(intent.data)
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

@Composable
private fun AuthRoot(
    sharedUrl: String? = null,
    onSharedUrlConsumed: () -> Unit = {},
    mainViewModel: MainViewModel = viewModel(),
) {
    val uiState by mainViewModel.uiState.collectAsState()

    if (!uiState.isConfigured) {
        CenteredMessage(
            title = tr("認証が設定されていません"),
            body = tr("APIの設定を確認してください。"),
        )
        return
    }

    if (!uiState.isInitialized) {
        if (uiState.initializationError) {
            CenteredMessage(
                title = tr("Unable to connect"),
                body = tr("Check your internet connection and try again."),
                actionLabel = tr("Retry"),
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
        onModeChanged = mainViewModel::setMode,
        onSignIn = mainViewModel::signIn,
        onSignUp = mainViewModel::signUp,
        onSendResetCode = mainViewModel::sendResetCode,
        onVerifyResetCode = mainViewModel::verifyResetCode,
        onResetPassword = mainViewModel::resetPassword,
        onBackToSignIn = mainViewModel::backToSignIn,
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
            onModeChanged = {},
            onSignIn = {},
            onSignUp = {},
            onSendResetCode = {},
            onVerifyResetCode = {},
            onResetPassword = {},
            onBackToSignIn = {},
        )
    }
}

// Mirrors the web's narrow auth layout (global.css `.auth-*`, ≤760px): brand
// at the top, then a vertically centred form with labels above the fields.
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AuthScreen(
    uiState: AuthUiState,
    onEmailChanged: (String) -> Unit,
    onPasswordChanged: (String) -> Unit,
    onConfirmPasswordChanged: (String) -> Unit,
    onCodeChanged: (String) -> Unit,
    onModeChanged: (AuthMode) -> Unit,
    onSignIn: () -> Unit,
    onSignUp: () -> Unit,
    onSendResetCode: () -> Unit,
    onVerifyResetCode: () -> Unit,
    onResetPassword: () -> Unit,
    onBackToSignIn: () -> Unit,
) {
    val colors = Filo.colors
    val submit = when (uiState.mode) {
        AuthMode.SignIn -> onSignIn
        AuthMode.SignUp -> onSignUp
        AuthMode.ResetPasswordRequest -> onSendResetCode
        AuthMode.ResetPasswordVerify -> onVerifyResetCode
        AuthMode.ResetPasswordNewPassword -> onResetPassword
    }
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bg)
            .drawBehind {
                drawRect(
                    Brush.radialGradient(
                        listOf(colors.accent.copy(alpha = 0.18f), Color.Transparent),
                        center = Offset(size.width * 0.1f, size.height * 0.12f),
                        radius = size.maxDimension * 0.4f,
                    ),
                )
                drawRect(
                    Brush.radialGradient(
                        listOf(Color(0xFFFF4DB8).copy(alpha = 0.14f), Color.Transparent),
                        center = Offset(size.width * 0.9f, size.height * 0.88f),
                        radius = size.maxDimension * 0.38f,
                    ),
                )
            }
            .safeDrawingPadding()
            .imePadding(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = maxHeight)
                .padding(horizontal = 22.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            FiloBrand(size = 40.dp, nameStyle = TextStyle(fontSize = 16.sp))
            Column(
                modifier = Modifier
                    .padding(vertical = 42.dp)
                    .widthIn(max = 420.dp)
                    .fillMaxWidth()
                    .align(Alignment.CenterHorizontally),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        when (uiState.mode) {
                            AuthMode.SignIn -> tr("サインイン")
                            AuthMode.SignUp -> tr("アカウント作成")
                            AuthMode.ResetPasswordRequest -> tr("パスワードをリセット")
                            AuthMode.ResetPasswordVerify -> tr("リセットコードを入力")
                            AuthMode.ResetPasswordNewPassword -> tr("新しいパスワードを設定")
                        },
                        fontSize = 36.sp,
                        lineHeight = 38.sp,
                        letterSpacing = (-0.045).em,
                        fontWeight = FontWeight.Bold,
                        color = colors.text,
                    )
                    Text(
                        when (uiState.mode) {
                            AuthMode.SignIn, AuthMode.SignUp -> tr("URLをリーディングリストに保存します。")
                            AuthMode.ResetPasswordRequest -> tr("登録済みのメールアドレスにリセット用のリンクを送信します。")
                            AuthMode.ResetPasswordVerify -> tr("メールに記載されたリセットコードを入力してください。")
                            AuthMode.ResetPasswordNewPassword -> tr("新しいパスワードを入力してください。")
                        },
                        fontSize = 16.sp,
                        lineHeight = 26.sp,
                        color = colors.muted,
                    )
                }

                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    when (uiState.mode) {
                        AuthMode.SignIn, AuthMode.SignUp -> {
                            EmailField(uiState.email, onEmailChanged)
                            PasswordField(
                                label = tr("パスワード"),
                                value = uiState.password,
                                onValueChange = onPasswordChanged,
                                hint = tr("8文字以上のパスワード"),
                                isNew = uiState.mode == AuthMode.SignUp,
                                onDone = submit,
                            )
                        }
                        AuthMode.ResetPasswordRequest -> EmailField(uiState.email, onEmailChanged, onDone = submit)
                        AuthMode.ResetPasswordVerify -> {
                            EmailField(uiState.email, onEmailChanged, enabled = false)
                            AuthField(tr("リセットコード")) {
                                AuthInput(
                                    value = uiState.code,
                                    onValueChange = onCodeChanged,
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                                    keyboardActions = KeyboardActions(onDone = { submit() }),
                                )
                            }
                        }
                        AuthMode.ResetPasswordNewPassword -> {
                            PasswordField(tr("新しいパスワード"), uiState.password, onPasswordChanged, isNew = true)
                            PasswordField(
                                tr("新しいパスワード（確認）"),
                                uiState.confirmPassword,
                                onConfirmPasswordChanged,
                                isNew = true,
                                onDone = submit,
                            )
                        }
                    }
                }

                uiState.errorMessage?.let { AuthNotice(tr(it), error = true) }
                uiState.statusMessage?.let { AuthNotice(tr(it), error = false) }

                AuthPrimaryButton(
                    text = when (uiState.mode) {
                        AuthMode.SignIn -> tr("サインイン")
                        AuthMode.SignUp -> tr("アカウント作成")
                        AuthMode.ResetPasswordRequest -> tr("リセットメールを送信")
                        AuthMode.ResetPasswordVerify -> tr("コードを確認")
                        AuthMode.ResetPasswordNewPassword -> tr("パスワードを変更")
                    },
                    isLoading = uiState.isSubmitting,
                    onClick = submit,
                )

                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    when (uiState.mode) {
                        AuthMode.SignIn -> {
                            AuthLink(tr("パスワードをお忘れですか？")) { onModeChanged(AuthMode.ResetPasswordRequest) }
                            AuthLink(tr("アカウントを作成")) { onModeChanged(AuthMode.SignUp) }
                        }
                        AuthMode.SignUp -> AuthLink(tr("サインインへ戻る")) { onModeChanged(AuthMode.SignIn) }
                        AuthMode.ResetPasswordRequest, AuthMode.ResetPasswordVerify -> AuthLink(tr("サインインへ戻る"), onBackToSignIn)
                        AuthMode.ResetPasswordNewPassword -> Unit
                    }
                }
            }
            Spacer(Modifier)
        }
    }
}

@Composable
private fun AuthField(label: String, hint: String? = null, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Filo.colors.text)
        content()
        if (hint != null) Text(hint, fontSize = 12.sp, color = Filo.colors.muted)
    }
}

@Composable
private fun AuthInput(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    password: Boolean = false,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    val colors = Filo.colors
    FiloTextField(
        value = value,
        onValueChange = onValueChange,
        enabled = enabled,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        height = 52.dp,
        shape = RoundedCornerShape(14.dp),
        background = colors.bg.copy(alpha = 0.72f).compositeOver(colors.surface),
        textSize = 16,
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun EmailField(
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean = true,
    onDone: (() -> Unit)? = null,
) {
    AuthField(tr("メールアドレス")) {
        AuthInput(
            value = value,
            onValueChange = onValueChange,
            enabled = enabled,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Email,
                imeAction = if (onDone != null) ImeAction.Done else ImeAction.Next,
            ),
            keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
            modifier = Modifier.semantics { contentType = ContentType.EmailAddress },
        )
    }
}

@Composable
private fun PasswordField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    hint: String? = null,
    isNew: Boolean = false,
    onDone: (() -> Unit)? = null,
) {
    AuthField(label, hint) {
        AuthInput(
            value = value,
            onValueChange = onValueChange,
            password = true,
            keyboardOptions = KeyboardOptions(
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Password,
                imeAction = if (onDone != null) ImeAction.Done else ImeAction.Next,
            ),
            keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
            modifier = Modifier.semantics {
                contentType = if (isNew) ContentType.NewPassword else ContentType.Password
            },
        )
    }
}

@Composable
private fun AuthNotice(message: String, error: Boolean) {
    val colors = Filo.colors
    Text(
        message,
        fontSize = 13.sp,
        lineHeight = 20.sp,
        color = if (error) colors.danger else colors.ok,
        modifier = Modifier
            .fillMaxWidth()
            .background(if (error) colors.dangerBg else colors.okBg, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
    )
}

@Composable
private fun AuthPrimaryButton(text: String, isLoading: Boolean, onClick: () -> Unit) {
    val colors = Filo.colors
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 54.dp)
            .shadow(12.dp, shape, ambientColor = colors.accent, spotColor = colors.accent)
            .clip(shape)
            .background(Brush.linearGradient(listOf(colors.accent, Color(0xFF7658E8))))
            .clickable(enabled = !isLoading, onClick = onClick)
            .padding(start = 19.dp, end = 17.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (isLoading) tr("処理中…") else text, color = colors.onAccent, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
        if (isLoading) FiloSpinnerMark() else Text("↗", color = colors.onAccent, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
private fun AuthLink(label: String, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        color = Filo.colors.accent,
        modifier = Modifier
            .clip(RoundedCornerShape(Filo.RadiusSm))
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp),
    )
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
    val articlesModel: com.filo.app.ui.ArticlesViewModel = viewModel()
    val currentBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = currentBackStackEntry?.destination?.route
    val isReadingBrowser = currentRoute?.startsWith("reading") == true
    var drawerOpen by remember { mutableStateOf(false) }

    fun navigateSingleTop(route: String) {
        navController.navigate(route) {
            launchSingleTop = true
        }
    }

    // Sidebar destinations are siblings of the articles view: they replace
    // whatever is stacked above it instead of piling up (iOS `navigate`).
    fun navigateFromSidebar(route: String) {
        navController.navigate(route) {
            popUpTo("articles")
            launchSingleTop = true
        }
    }

    LaunchedEffect(currentBackStackEntry?.destination?.route) {
        currentBackStackEntry?.destination?.route?.let { route ->
            Analytics.screen(route.substringBefore('/').substringBefore('?'))
            // The article screen loads unread counts as part of its initial
            // request. Refresh on return from another screen, but do not race
            // that first load with a duplicate request.
            if (route == "articles" && articlesModel.articles.isNotEmpty()) articlesModel.refreshUnreadCounts()
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
        if (sharedUrl != null) navigateSingleTop("addArticle")
    }

    Column(
        Modifier
            .fillMaxSize()
            .safeDrawingPadding(),
    ) {
        BoxWithConstraints(modifier = Modifier.weight(1f)) {
            val isDesktop = maxWidth >= 1024.dp
            // Top-level screens open the drawer from their header on phones;
            // on wide screens the sidebar is always visible.
            val openMenu: (() -> Unit)? = if (isDesktop) null else ({ drawerOpen = true })
            val sidebar: @Composable (onClose: (() -> Unit)?) -> Unit = { onClose ->
                fun go(action: () -> Unit) {
                    drawerOpen = false
                    action()
                }
                SidebarNav(
                    tags = articlesModel.tags,
                    subscriptions = articlesModel.subscriptions,
                    unreadCounts = articlesModel.unreadCounts,
                    selectedTagId = articlesModel.selectedTagId,
                    readingListOnly = articlesModel.readingListOnly,
                    bookmarkedOnly = articlesModel.bookmarkedOnly,
                    activeRoute = currentRoute,
                    activeSubscriptionId = currentBackStackEntry?.arguments?.getString("id")?.toIntOrNull(),
                    onClose = onClose,
                    onSelectView = { tagId, readingList, bookmarked ->
                        go {
                            articlesModel.selectedTagId = tagId
                            articlesModel.readingListOnly = readingList
                            articlesModel.bookmarkedOnly = bookmarked
                            navController.popBackStack("articles", false)
                        }
                    },
                    onOpenSubscription = { go { navigateFromSidebar("subscription/$it") } },
                    onOpenAddFeed = { go { navigateSingleTop("addFeed") } },
                    onOpenAddArticle = { go { navigateSingleTop("addArticle") } },
                    onOpenSubscriptions = { go { navigateFromSidebar("subscriptions") } },
                    onOpenTags = { go { navigateFromSidebar("tags") } },
                    onOpenStatus = { go { navigateFromSidebar("status") } },
                    onOpenSettings = { go { navigateFromSidebar("settings") } },
                )
            }
            val navContent: @Composable () -> Unit = {
                NavHost(
                    navController = navController,
                    startDestination = "articles",
                    modifier = Modifier.fillMaxSize(),
                    enterTransition = { slideInHorizontally(tween(280)) { it } },
                    exitTransition = { slideOutHorizontally(tween(280)) { -it / 3 } },
                    popEnterTransition = { slideInHorizontally(tween(280)) { -it / 3 } },
                    popExitTransition = { slideOutHorizontally(tween(280)) { it } },
                ) {
                    screen("articles") { entry ->
                        val selectedTagId by entry.savedStateHandle
                            .getStateFlow<Int?>("selectedTagId", null)
                            .collectAsState()
                        val initialReadingList by entry.savedStateHandle
                            .getStateFlow("readingList", false)
                            .collectAsState()
                        com.filo.app.ui.ArticlesScreen(
                            translations = titleTranslations,
                            model = articlesModel,
                            onOpenMenu = openMenu,
                            initialSelectedTagId = selectedTagId,
                            onInitialSelectedTagConsumed = {
                                entry.savedStateHandle.remove<Int>("selectedTagId")
                            },
                            initialReadingList = initialReadingList,
                            onInitialReadingListConsumed = {
                                entry.savedStateHandle.remove<Boolean>("readingList")
                            },
                            onOpenSubscription = { navigateSingleTop("subscription/$it") },
                            onOpenAddFeed = { navigateSingleTop("addFeed") },
                            onStartReading = { autoplay -> navigateSingleTop("reading/$autoplay") },
                            onOpenArticle = { article ->
                                Analytics.track("select_item", mapOf("article_id" to article.id))
                                article.canonicalUrl?.let { url ->
                                    navController.navigate(
                                        "reading-article/${article.id}?url=${Uri.encode(url)}" +
                                            "&title=${Uri.encode(article.title)}" +
                                            "&language=${Uri.encode(article.sourceLanguage ?: "")}",
                                    ) { launchSingleTop = true }
                                }
                            },
                        )
                    }
                    screen("reading/{autoplay}") { entry ->
                        com.filo.app.ui.ReadingSessionScreen(
                            player = readingPlayer,
                            autoplay = entry.arguments?.getString("autoplay").toBoolean(),
                            onBack = { navController.navigateUp() },
                        )
                    }
                    screen(
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
                    screen(
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
                            feedTitle = com.filo.app.ui.AppStrings.get("記事"),
                        )
                        com.filo.app.ui.ReadingSessionScreen(
                            player = readingPlayer,
                            autoplay = false,
                            directArticle = article,
                            onBack = { navController.navigateUp() },
                        )
                    }
                    screen("subscriptions") {
                        com.filo.app.ui.SubscriptionsScreen(
                            onOpenMenu = openMenu,
                            onOpenSubscription = { navigateSingleTop("subscription/$it") },
                            onOpenAddFeed = { navigateSingleTop("addFeed") },
                            onOpenTags = { navigateSingleTop("tags") },
                            onSelectTag = { tagId ->
                                navController.getBackStackEntry("articles")
                                    .savedStateHandle["selectedTagId"] = tagId
                                navController.popBackStack("articles", false)
                            },
                        )
                    }
                    screen("addFeed") {
                        com.filo.app.ui.AddFeedScreen(
                            onBack = { navController.navigateUp() },
                            onOpenArticles = { navController.popBackStack("articles", false) },
                            onCreated = { articlesModel.reload() },
                        )
                    }
                    screen("addArticle") {
                        com.filo.app.ui.AddArticleScreen(
                            initialUrl = sharedUrl.orEmpty(),
                            onBack = {
                                onSharedUrlConsumed()
                                navController.navigateUp()
                            },
                            onSaved = {
                                onSharedUrlConsumed()
                                scope.launch { articlesModel.reload() }
                                navController.getBackStackEntry("articles")
                                    .savedStateHandle["readingList"] = true
                                navController.popBackStack("articles", false)
                            },
                        )
                    }
                    screen("tags") { com.filo.app.ui.TagsScreen(onOpenMenu = openMenu) }
                    screen("status") {
                        com.filo.app.ui.StatusScreen(
                            onOpenMenu = openMenu,
                            onOpenSubscription = { navigateSingleTop("subscription/$it") },
                        )
                    }
                    screen("settings") {
                        com.filo.app.ui.SettingsScreen(
                            translations = titleTranslations,
                            onOpenMenu = openMenu,
                            onSignOut = onSignOut,
                            onDeletionAccepted = { token ->
                                navigateSingleTop("accountDeletion?token=${Uri.encode(token)}")
                            },
                        )
                    }
                    screen("subscription/{id}") { entry ->
                        val id = entry.arguments?.getString("id")?.toIntOrNull() ?: return@screen
                        com.filo.app.ui.SubscriptionDetailScreen(
                            translations = titleTranslations,
                            subscriptionId = id,
                            onBack = { navController.navigateUp() },
                            onSelectTag = { tagId ->
                                navController.getBackStackEntry("articles")
                                    .savedStateHandle["selectedTagId"] = tagId
                                navController.popBackStack("articles", false)
                            },
                            onOpenArticle = { article ->
                                article.canonicalUrl?.let { url ->
                                    navController.navigate(
                                        "reading-article/${article.id}?url=${Uri.encode(url)}" +
                                            "&title=${Uri.encode(article.title)}" +
                                            "&language=${Uri.encode(article.sourceLanguage ?: "")}",
                                    ) { launchSingleTop = true }
                                }
                            },
                        )
                    }
                    screen("accountDeletion?token={token}") { entry ->
                        com.filo.app.ui.AccountDeletionScreen(
                            deletionToken = entry.arguments?.getString("token"),
                            onSignOut = onSignOut,
                            onBackToSettings = { navController.navigateUp() },
                        )
                    }
                }
            }
            if (isDesktop) {
                val sidebarBorder = Filo.colors.mutedBorder
                Row(Modifier.fillMaxSize()) {
                    Box(
                        Modifier
                            .width(280.dp)
                            .fillMaxSize()
                            .background(Filo.colors.sidebar)
                            .drawBehind {
                                drawRect(
                                    sidebarBorder,
                                    topLeft = Offset(size.width - 1.dp.toPx(), 0f),
                                    size = size.copy(width = 1.dp.toPx()),
                                )
                            }
                            .padding(12.dp),
                    ) { sidebar(null) }
                    Box(Modifier.weight(1f)) { navContent() }
                }
            } else {
                navContent()
                FiloDrawer(open = drawerOpen && !isReadingBrowser, onClose = { drawerOpen = false }) {
                    sidebar { drawerOpen = false }
                }
            }
        }
        if (readingPlayer.isPlaying && !isReadingBrowser) {
            com.filo.app.ui.ReadingMiniPlayer(readingPlayer)
        }
    }
}

// Every destination paints the page background, so the slide transition never
// shows the outgoing screen through the incoming one (iOS `FiloPage` does the same).
private fun NavGraphBuilder.screen(
    route: String,
    arguments: List<NamedNavArgument> = emptyList(),
    content: @Composable (NavBackStackEntry) -> Unit,
) = composable(route, arguments) { entry ->
    Box(Modifier.fillMaxSize().background(Filo.colors.bg)) { content(entry) }
}

@Composable
private fun CenteredLoading() {
    Box(
        modifier = Modifier.fillMaxSize().safeDrawingPadding(),
        contentAlignment = Alignment.Center,
    ) {
        FiloSpinnerMark(size = 24.dp)
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
        modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Filo.colors.text)
        Text(body, fontSize = 14.sp, color = Filo.colors.muted)
        if (actionLabel != null && onAction != null) {
            FiloButton(actionLabel, onAction, kind = ButtonKind.Primary, modifier = Modifier.padding(top = 8.dp))
        }
    }
}
