package com.futurestands.letsmeet.data.repository

import com.futurestands.letsmeet.BuildConfig
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.setBody
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable
data class LiveKitTokenResponse(
    val token: String,
    val room: String,
    val identity: String,
    val name: String
)

@Serializable
data class GuestSessionResponse(
    val access_token: String,
    val refresh_token: String,
    val expires_in: Int
)

class LiveKitRepository(private val authRepository: AuthRepository) {
    private val client = HttpClient {
        install(ContentNegotiation) {
            json(Json { ignoreUnknownKeys = true })
        }
    }

    private val apiBaseUrl: String
        get() = BuildConfig.LIVEKIT_TOKEN_ENDPOINT
            .removeSuffix("/api/livekit/token")
            .removeSuffix("/api/guest/session")
            .removeSuffix("/")

    suspend fun fetchToken(roomCode: String): LiveKitTokenResponse {
        val accessToken = authRepository.getCurrentAccessToken()
            ?: throw IllegalStateException("Not authenticated")

        return client.get("$apiBaseUrl/api/livekit/token") {
            header("Authorization", "Bearer $accessToken")
            parameter("room", roomCode)
        }.body()
    }

    suspend fun createGuestSession(roomCode: String, displayName: String): GuestSessionResponse {
        return client.post("$apiBaseUrl/api/guest/session") {
            header("Content-Type", "application/json")
            setBody(buildJsonObject {
                put("room", roomCode)
                put("displayName", displayName)
            })
        }.body()
    }
}
