package com.futurestands.letsmeet.data.repository

import com.futurestands.letsmeet.data.SupabaseClientProvider
import com.futurestands.letsmeet.domain.model.ChatMessage
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

    suspend fun getChatMessages(meetingId: String): List<ChatMessage> = withContext(Dispatchers.IO) {
        postgrest.from("chat_messages")
            .select {
                filter {
                    eq("meeting_id", meetingId)
                }
            }
            .decodeList<ChatMessage>()
    }

    suspend fun sendChatMessage(meetingId: String, message: String) = withContext(Dispatchers.IO) {
        postgrest.rpc("send_persistent_chat", buildJsonObject {
            put("p_meeting_id", meetingId)
            put("p_message", message)
        })
    }

    suspend fun sendReaction(meetingId: String, emoji: String) = withContext(Dispatchers.IO) {
        postgrest.rpc("send_meeting_reaction", buildJsonObject {
            put("p_meeting_id", meetingId)
            put("p_emoji", emoji)
        })
    }

    suspend fun setHandRaised(meetingId: String, raised: Boolean) = withContext(Dispatchers.IO) {
        postgrest.rpc("set_hand_raised", buildJsonObject {
            put("p_meeting_id", meetingId)
            put("p_raised", raised)
        })
    }
}
