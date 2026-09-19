package com.futurestands.letsmeet.data.repository

import com.futurestands.letsmeet.data.SupabaseClientProvider
import com.futurestands.letsmeet.domain.model.Meeting
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class MeetingRepository {
    private val postgrest = SupabaseClientProvider.client.postgrest

    suspend fun getMeetings(): List<Meeting> = withContext(Dispatchers.IO) {
        postgrest.from("meetings")
            .select()
            .decodeList<Meeting>()
    }

    suspend fun getMeetingByCode(code: String): Meeting? = withContext(Dispatchers.IO) {
        val normalizedCode = code.trim().uppercase()
        // Use lookup_joinable_meeting RPC instead of direct select
        val response = postgrest.rpc("lookup_joinable_meeting", buildJsonObject {
            put("p_code", normalizedCode)
        })
        response.decodeSingleOrNull<Meeting>()
    }

    suspend fun createMeeting(title: String): Meeting = withContext(Dispatchers.IO) {
        // Use create_persistent_meeting RPC instead of direct insert
        val response = postgrest.rpc("create_persistent_meeting", buildJsonObject {
            put("p_title", title)
        })
        response.decodeSingle<Meeting>()
    }

    suspend fun joinMeeting(code: String) = withContext(Dispatchers.IO) {
        val normalizedCode = code.trim().uppercase()
        postgrest.rpc("join_persistent_meeting", buildJsonObject {
            put("p_code", normalizedCode)
        })
    }
}
