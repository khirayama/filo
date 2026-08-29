package com.filo.app

import android.app.Application

class FiloApplication : Application() {
    companion object { lateinit var context: FiloApplication }
    override fun onCreate() {
        super.onCreate()
        context = this
        Analytics.initialize(this)

    }
}
