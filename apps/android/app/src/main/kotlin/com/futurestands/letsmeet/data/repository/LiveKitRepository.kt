package com.futurestands.letsmeet.data.repository

import com.futurestands.letsmeet.BuildConfig
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class LiveKitTokenResponse(
    val token: String,
    val room: String,
    val identity: String,
    val name: String
)

class LiveKitRepository(private val authRepository: AuthRepository) {
    private val client = HttpClient {
        install(ContentNegotiation) {
            json(Json { ignoreUnknownKeys = true })
        }
    }

    suspend fun fetchToken(roomCode: String): LiveKitTokenResponse {
        val accessToken = authRepository.getCurrentAccessToken()
            ?: throw IllegalStateException("Not authenticated")

        return client.get("${BuildConfig.LIVEKIT_TOKEN_ENDPOINT}/api/livekit/token") {
            header("Authorization", "Bearer $accessToken")
            parameter("room", roomCode)
        }.body()
    }
}
