package com.futurestands.letsmeet.domain.model

import kotlinx.serialization.Serializable

@Serializable
data class ChatMessage(
    val id: String? = null,
    val meeting_id: String,
    val user_id: String? = null,
    val user_name: String,
    val message: String,
    val created_at: String? = null
)
