package com.futurestands.letsmeet.domain.model

import kotlinx.serialization.Serializable

@Serializable
data class Meeting(
    val id: String,
    val code: String,
    val title: String? = null,
    val status: String,
    val host_id: String? = null
)
