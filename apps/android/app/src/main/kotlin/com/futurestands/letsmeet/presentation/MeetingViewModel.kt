package com.futurestands.letsmeet.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.futurestands.letsmeet.data.SupabaseClientProvider
import com.futurestands.letsmeet.data.repository.AuthRepository
import com.futurestands.letsmeet.data.repository.LiveKitRepository
import com.futurestands.letsmeet.data.repository.MeetingRepository
import com.futurestands.letsmeet.domain.model.ChatMessage
import com.futurestands.letsmeet.domain.model.HandRaise
import com.futurestands.letsmeet.domain.model.Meeting
import com.futurestands.letsmeet.domain.model.MeetingReaction
import com.futurestands.letsmeet.domain.model.MeetingRecording
import io.github.jan.supabase.postgrest.query.filter.FilterOperation
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.decodeOldRecord
import io.github.jan.supabase.realtime.decodeRecord
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class MeetingViewModel : ViewModel() {
    private val authRepository = AuthRepository()
    private val meetingRepository = MeetingRepository()
    private val liveKitRepository = LiveKitRepository(authRepository)
    private val realtime = SupabaseClientProvider.client.realtime

    private val _meetings = MutableStateFlow<List<Meeting>>(emptyList())
    val meetings: StateFlow<List<Meeting>> = _meetings

    private val _roomToken = MutableStateFlow<String?>(null)
    val roomToken: StateFlow<String?> = _roomToken

    private val _chatMessages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val chatMessages: StateFlow<List<ChatMessage>> = _chatMessages

    private val _reactions = MutableStateFlow<List<MeetingReaction>>(emptyList())
    val reactions: StateFlow<List<MeetingReaction>> = _reactions

    private val _handRaises = MutableStateFlow<List<HandRaise>>(emptyList())
    val handRaises: StateFlow<List<HandRaise>> = _handRaises

    private val _isHost = MutableStateFlow(false)
    val isHost: StateFlow<Boolean> = _isHost

    private val _recordings = MutableStateFlow<List<MeetingRecording>>(emptyList())
    val recordings: StateFlow<List<MeetingRecording>> = _recordings

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    private var currentMeetingId: String? = null
    private var isHandRaisedLocal = false
    private var activeChannel: io.github.jan.supabase.realtime.RealtimeChannel? = null

    fun loadMeetings() {
        _isLoading.value = true
        viewModelScope.launch {
            try {
                _meetings.value = meetingRepository.getMeetings()
            } catch (e: Exception) {
                _error.value = "Failed to load meetings: ${e.message}"
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun joinMeeting(code: String) {
        _isLoading.value = true
        _error.value = null
        viewModelScope.launch {
            try {
                // First ensure participation in Supabase
                meetingRepository.joinMeeting(code)

                val meeting = meetingRepository.getMeetingByCode(code)
                if (meeting != null) {
                    currentMeetingId = meeting.id
                    _isHost.value = meeting.host_id == authRepository.getCurrentUserId()
                    loadChatMessages(meeting.id)
                    loadRecordings(meeting.id)
                    subscribeToMeetingEvents(meeting.id)
                }

                // Then fetch LiveKit token
                val response = liveKitRepository.fetchToken(code)
                _roomToken.value = response.token
            } catch (e: Exception) {
                _error.value = "Failed to join meeting: ${e.message}"
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun joinAsGuest(code: String, displayName: String, onJoined: () -> Unit) {
        _isLoading.value = true
        _error.value = null
        viewModelScope.launch {
            try {
                val guestSession = liveKitRepository.createGuestSession(code, displayName)
                authRepository.importSession(guestSession.access_token, guestSession.refresh_token)
                onJoined()
            } catch (e: Exception) {
                _error.value = "Guest join failed: ${e.message}"
            } finally {
                _isLoading.value = false
            }
        }
    }

    private fun loadChatMessages(meetingId: String) {
        viewModelScope.launch {
            try {
                _chatMessages.value = meetingRepository.getChatMessages(meetingId)
            } catch (e: Exception) {
                // Handle error
            }
        }
    }

    private fun loadRecordings(meetingId: String) {
        viewModelScope.launch {
            try {
                _recordings.value = meetingRepository.getRecordings(meetingId)
            } catch (e: Exception) {
                // Handle error
            }
        }
    }

    private fun subscribeToMeetingEvents(meetingId: String) {
        viewModelScope.launch {
            activeChannel?.let {
                realtime.removeChannel(it)
            }

            val channel = realtime.channel("meeting_$meetingId")
            activeChannel = channel

            // Chat
            val chatFlow = channel.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
                table = "chat_messages"
                filter("meeting_id", FilterOperator.EQ, meetingId)
            }

            // Reactions
            val reactionFlow = channel.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
                table = "meeting_reactions"
                filter("meeting_id", FilterOperator.EQ, meetingId)
            }

            // Hand Raises
            val handRaiseFlow = channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                table = "meeting_hand_raises"
                filter("meeting_id", FilterOperator.EQ, meetingId)
            }

            // Recordings
            val recordingFlow = channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                table = "meeting_recordings"
                filter("meeting_id", FilterOperator.EQ, meetingId)
            }

            channel.subscribe()

            launch {
                chatFlow.collect { action ->
                    val newMessage = action.decodeRecord<ChatMessage>()
                    _chatMessages.value = _chatMessages.value + newMessage
                }
            }

            launch {
                reactionFlow.collect { action ->
                    val newReaction = action.decodeRecord<MeetingReaction>()
                    _reactions.value = _reactions.value + newReaction
                    // Auto-remove reaction after 5 seconds
                    viewModelScope.launch {
                        kotlinx.coroutines.delay(5000)
                        _reactions.value = _reactions.value.filter { it.id != newReaction.id }
                    }
                }
            }

            launch {
                handRaiseFlow.collect { action ->
                    when (action) {
                        is PostgresAction.Insert -> {
                            val newHand = action.decodeRecord<HandRaise>()
                            _handRaises.value = _handRaises.value + newHand
                        }
                        is PostgresAction.Delete -> {
                            val oldHand = action.decodeOldRecord<HandRaise>()
                            _handRaises.value = _handRaises.value.filter { it.user_id != oldHand.user_id }
                        }
                        else -> {}
                    }
                }
            }

            launch {
                recordingFlow.collect { action ->
                    when (action) {
                        is PostgresAction.Insert -> {
                            val newRecording = action.decodeRecord<MeetingRecording>()
                            _recordings.value = listOf(newRecording) + _recordings.value
                        }
                        is PostgresAction.Update -> {
                            val updated = action.decodeRecord<MeetingRecording>()
                            _recordings.value = _recordings.value.map { if (it.id == updated.id) updated else it }
                        }
                        else -> {}
                    }
                }
            }
        }
    }

    fun sendChatMessage(message: String) {
        val meetingId = currentMeetingId ?: return
        viewModelScope.launch {
            try {
                meetingRepository.sendChatMessage(meetingId, message)
            } catch (e: Exception) {
                _error.value = "Failed to send message: ${e.message}"
            }
        }
    }

    fun sendReaction(emoji: String) {
        val meetingId = currentMeetingId ?: return
        viewModelScope.launch {
            try {
                meetingRepository.sendReaction(meetingId, emoji)
            } catch (e: Exception) {
                _error.value = "Failed to send reaction: ${e.message}"
            }
        }
    }

    fun toggleHandRaise() {
        val meetingId = currentMeetingId ?: return
        isHandRaisedLocal = !isHandRaisedLocal
        viewModelScope.launch {
            try {
                meetingRepository.setHandRaised(meetingId, isHandRaisedLocal)
            } catch (e: Exception) {
                _error.value = "Failed to toggle hand raise: ${e.message}"
                isHandRaisedLocal = !isHandRaisedLocal // Revert
            }
        }
    }

    fun startRecording() {
        val meetingId = currentMeetingId ?: return
        viewModelScope.launch {
            try {
                val recording = meetingRepository.requestRecording(meetingId)
                // We should refresh but realtime should also handle it.
                // However, we need to call the server endpoint to actually START the egress if configured.
                // We'll call LiveKitRepository.startRecording
                liveKitRepository.startRecording(recording.id)
            } catch (e: Exception) {
                _error.value = "Failed to start recording: ${e.message}"
            }
        }
    }

    fun stopRecording(recordingId: String) {
        viewModelScope.launch {
            try {
                meetingRepository.requestStopRecording(recordingId)
                liveKitRepository.stopRecording(recordingId)
            } catch (e: Exception) {
                _error.value = "Failed to stop recording: ${e.message}"
            }
        }
    }

    fun createMeeting(title: String) {
        _isLoading.value = true
        viewModelScope.launch {
            try {
                val meeting = meetingRepository.createMeeting(title)
                loadMeetings()
            } catch (e: Exception) {
                _error.value = "Failed to create meeting: ${e.message}"
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun clearError() {
        _error.value = null
    }

    override fun onCleared() {
        super.onCleared()
        activeChannel?.let { channel ->
            viewModelScope.launch(kotlinx.coroutines.NonCancellable) {
                realtime.removeChannel(channel)
            }
        }
    }
}
