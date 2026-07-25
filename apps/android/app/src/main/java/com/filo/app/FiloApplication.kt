package com.filo.app

import android.app.Application
import com.clerk.api.Clerk
import com.clerk.api.ClerkConfigurationOptions

class FiloApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        if (BuildConfig.CLERK_PUBLISHABLE_KEY.isBlank()) {
            return
        }

        Clerk.initialize(
            this,
            publishableKey = BuildConfig.CLERK_PUBLISHABLE_KEY,
            options = ClerkConfigurationOptions(enableDebugMode = BuildConfig.DEBUG),
        )
    }
}
