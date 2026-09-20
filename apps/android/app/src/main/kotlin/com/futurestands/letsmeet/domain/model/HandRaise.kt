package com.futurestands.letsmeet.domain.model

import kotlinx.serialization.Serializable

@Serializable
data class HandRaise(
    val meeting_id: String,
    val user_id: String,
    val user_name: String,
    val raised_at: String? = null
)
