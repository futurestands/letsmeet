package com.futurestands.letsmeet.domain.model

import kotlinx.serialization.Serializable

@Serializable
data class MeetingRecording(
    val id: String,
    val meeting_id: String,
    val status: String,
    val playback_url: String? = null,
    val error: String? = null,
    val created_at: String
)
