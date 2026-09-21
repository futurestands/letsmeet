package com.futurestands.letsmeet.data.repository

import com.futurestands.letsmeet.data.SupabaseClientProvider
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.user.UserSession
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class AuthRepository {
    private val auth = SupabaseClientProvider.client.auth

    suspend fun login(email: String, password: String) {
        auth.signInWith(Email) {
            this.email = email
            this.password = password
        }
    }

    suspend fun logout() {
        auth.signOut()
    }

    fun getSessionFlow(): Flow<Boolean> {
        return auth.sessionStatus.map { status ->
            status is SessionStatus.Authenticated
        }
    }

    fun getCurrentAccessToken(): String? {
        return auth.currentAccessTokenOrNull()
    }

    fun getCurrentUserId(): String? {
        return auth.currentUserOrNull()?.id
    }

    suspend fun importSession(accessToken: String, refreshToken: String) {
        val session = UserSession(
            accessToken = accessToken,
            refreshToken = refreshToken,
            expiresIn = 3600L,
            tokenType = "bearer",
            user = null
        )
        auth.importSession(session)
    }
}
