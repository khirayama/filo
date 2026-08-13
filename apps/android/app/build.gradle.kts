import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.google.services)
}

val localProperties =
    Properties().apply {
        val localPropertiesFile = rootProject.file("local.properties")
        if (localPropertiesFile.exists()) {
            localPropertiesFile.inputStream().use(::load)
        }
    }

fun configuredProperty(name: String, defaultValue: String = ""): String =
    providers.gradleProperty(name).orElse(localProperties.getProperty(name, defaultValue)).get()

val developmentClerkPublishableKey = configuredProperty("clerkPublishableKey")
val developmentApiBaseUrl = configuredProperty("apiBaseUrl", "http://10.0.2.2:8787")
val productionClerkPublishableKey = configuredProperty("productionClerkPublishableKey")
val productionApiBaseUrl = configuredProperty("productionApiBaseUrl")

fun asBuildConfigString(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

fun validateProductionConfiguration() {
    require(productionClerkPublishableKey.startsWith("pk_live_")) {
        "Release builds require productionClerkPublishableKey=pk_live_... in local.properties or -PproductionClerkPublishableKey=..."
    }
    require(productionApiBaseUrl == "https://api.filoreader.app") {
        "Release builds require productionApiBaseUrl=https://api.filoreader.app"
    }
}

gradle.taskGraph.whenReady {
    if (allTasks.any { it.name.contains("Release") }) {
        validateProductionConfiguration()
    }
}

android {
    namespace = "com.filo.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.filo.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "CLERK_PUBLISHABLE_KEY", asBuildConfigString(developmentClerkPublishableKey))
            buildConfigField("String", "API_BASE_URL", asBuildConfigString(developmentApiBaseUrl))
        }

        release {
            buildConfigField("String", "CLERK_PUBLISHABLE_KEY", asBuildConfigString(productionClerkPublishableKey))
            buildConfigField("String", "API_BASE_URL", asBuildConfigString(productionApiBaseUrl))
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_17)
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "META-INF/versions/9/OSGI-INF/MANIFEST.MF"
        }
    }
}

dependencies {
    coreLibraryDesugaring(libs.desugar.jdk.libs)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.core)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.clerk.android.api)
    implementation(libs.google.material)
    implementation(libs.mlkit.translate)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.analytics)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
