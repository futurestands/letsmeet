package com.futurestands.letsmeet.data.repository

import com.futurestands.letsmeet.data.SupabaseClientProvider
import com.futurestands.letsmeet.domain.model.Meeting
import io.github.jan_tennert.supabase.postgrest.postgrest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class MeetingRepository {
    private val postgrest = SupabaseClientProvider.client.postgrest

    suspend fun getMeetings(): List<Meeting> = withContext(Dispatchers.IO) {
        postgrest.from("meetings")
            .select()
            .decodeList<Meeting>()
    }

    suspend fun getMeetingByCode(code: String): Meeting? = withContext(Dispatchers.IO) {
        val normalizedCode = code.trim().uppercase()
        postgrest.from("meetings")
            .select()
            .eq("code", normalizedCode)
            .decodeSingleOrNull<Meeting>()
    }

    suspend fun createMeeting(title: String): Meeting = withContext(Dispatchers.IO) {
        // This assumes the backend/Supabase handles ID and Code generation via defaults or triggers
        postgrest.from("meetings")
            .insert(mapOf("title" to title))
            .select()
            .decodeSingle<Meeting>()
    }
}
