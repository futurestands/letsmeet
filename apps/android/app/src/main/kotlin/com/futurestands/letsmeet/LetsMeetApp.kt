package com.futurestands.letsmeet

import android.app.Application
import com.futurestands.letsmeet.data.SupabaseClientProvider

class LetsMeetApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Initialize Supabase Client
        SupabaseClientProvider.client
    }
}
