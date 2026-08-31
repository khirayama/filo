package com.filo.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import com.filo.app.ui.AppStrings

class TtsMediaService : Service() {
    companion object {
        const val CHANNEL_ID = "filo_tts_playback"
        const val NOTIFICATION_ID = 1

        const val ACTION_UPDATE = "com.filo.app.TTS_UPDATE"
        const val ACTION_STOP = "com.filo.app.TTS_STOP"

        var onPlayPause: (() -> Unit)? = null
        var onDismiss: (() -> Unit)? = null
    }

    private var mediaSession: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        mediaSession = MediaSession(this, "FiloTTS").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() { onPlayPause?.invoke() }
                override fun onPause() { onPlayPause?.invoke() }
            })
            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_UPDATE -> {
                val title = intent.getStringExtra("title") ?: ""
                val state = intent.getStringExtra("playState") ?: "idle"
                val chunk = intent.getIntExtra("chunk", 0)
                val total = intent.getIntExtra("total", 0)
                updateNotification(title, state, chunk, total)
            }
            ACTION_STOP -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            "PLAY_PAUSE" -> onPlayPause?.invoke()
            "DISMISS" -> {
                onDismiss?.invoke()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun updateNotification(
        title: String,
        state: String,
        chunk: Int,
        total: Int,
    ) {
        val isPlaying = state == "playing"

        val pbState = PlaybackState.Builder()
            .setState(
                if (isPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                chunk.toLong(), 1f,
            )
            .setActions(PlaybackState.ACTION_PLAY_PAUSE)
            .build()
        mediaSession?.setPlaybackState(pbState)

        val metadata = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title.ifEmpty { "Filo" })
            .putString(MediaMetadata.METADATA_KEY_ARTIST, "Filo")
            .build()
        mediaSession?.setMetadata(metadata)

        val actions = mutableListOf<Notification.Action>()
        val compactIndices = mutableListOf<Int>()

        compactIndices.add(actions.size)
        actions.add(
            makeAction(
                if (isPlaying) R.drawable.ic_action_pause else R.drawable.ic_action_play,
                if (isPlaying) AppStrings.get("一時停止") else AppStrings.get("再生"),
                "PLAY_PAUSE",
            ),
        )

        val openAppIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                this.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE,
        )

        val dismissIntent = PendingIntent.getService(
            this, 10,
            Intent(this, TtsMediaService::class.java).apply { action = "DISMISS" },
            PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            Notification.Builder(this)
        }
        val notification = builder
            .setContentTitle(title.ifEmpty { "Filo" })
            .setContentText(if (isPlaying) AppStrings.format("再生中 %d/%d", chunk + 1, total) else AppStrings.get("一時停止中"))
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentIntent(openAppIntent)
            .setDeleteIntent(dismissIntent)
            .setStyle(
                Notification.MediaStyle()
                    .setMediaSession(mediaSession?.sessionToken)
                    .setShowActionsInCompactView(*compactIndices.toIntArray()),
            )
            .setOngoing(isPlaying)
            .also { builder -> actions.forEach { builder.addAction(it) } }
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun makeAction(iconRes: Int, label: String, actionName: String): Notification.Action {
        val intent = Intent(this, TtsMediaService::class.java).apply { action = actionName }
        val pending = PendingIntent.getService(
            this, actionName.hashCode(), intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Action.Builder(
            Icon.createWithResource(this, iconRes), label, pending,
        ).build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID, AppStrings.get("読み上げ"), NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = AppStrings.get("記事の読み上げ再生中に表示されます")
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        mediaSession?.isActive = false
        mediaSession?.release()
        mediaSession = null
        super.onDestroy()
    }
}
