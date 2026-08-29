package com.filo.app

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object SecureTokenStore {
    private const val PREFS = "auth"; private const val TOKEN = "better_auth_token"; private const val KEY_ALIAS = "filo_better_auth_token"
    private fun key(): SecretKey { val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }; (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }; return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setUserAuthenticationRequired(false).build()) }.generateKey() }
    fun get(): String? { val raw = FiloApplication.context.getSharedPreferences(PREFS, 0).getString(TOKEN, null) ?: return null; return try { val bytes = Base64.decode(raw, Base64.NO_WRAP); Cipher.getInstance("AES/GCM/NoPadding").run { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))); String(doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8) } } catch (_: Exception) { clear(); null } }
    fun set(value: String) { val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }; val output = cipher.iv + cipher.doFinal(value.toByteArray()); FiloApplication.context.getSharedPreferences(PREFS, 0).edit().putString(TOKEN, Base64.encodeToString(output, Base64.NO_WRAP)).apply() }
    fun clear() { FiloApplication.context.getSharedPreferences(PREFS, 0).edit().remove(TOKEN).apply() }
}
