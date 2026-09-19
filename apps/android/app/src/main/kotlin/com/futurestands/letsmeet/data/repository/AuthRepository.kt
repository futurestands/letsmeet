package com.futurestands.letsmeet.data.repository

import com.futurestands.letsmeet.data.SupabaseClientProvider
import io.github.jan_tennert.supabase.gotrue.auth
import io.github.jan_tennert.supabase.gotrue.providers.builtin.Email
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
            status is io.github.jan_tennert.supabase.gotrue.SessionStatus.Authenticated
        }
    }

    fun getCurrentAccessToken(): String? {
        return auth.currentAccessTokenOrNull()
    }
}
