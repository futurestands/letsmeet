package com.futurestands.letsmeet.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.futurestands.letsmeet.data.repository.AuthRepository
import com.futurestands.letsmeet.data.repository.LiveKitRepository
import com.futurestands.letsmeet.data.repository.MeetingRepository
import com.futurestands.letsmeet.domain.model.Meeting
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class MeetingViewModel : ViewModel() {
    private val authRepository = AuthRepository()
    private val meetingRepository = MeetingRepository()
    private val liveKitRepository = LiveKitRepository(authRepository)

    private val _meetings = MutableStateFlow<List<Meeting>>(emptyList())
    val meetings: StateFlow<List<Meeting>> = _meetings

    private val _roomToken = MutableStateFlow<String?>(null)
    val roomToken: StateFlow<String?> = _roomToken

    fun loadMeetings() {
        viewModelScope.launch {
            try {
                _meetings.value = meetingRepository.getMeetings()
            } catch (e: Exception) {
                // Handle error
            }
        }
    }

    fun joinMeeting(code: String) {
        viewModelScope.launch {
            try {
                // First ensure participation in Supabase
                meetingRepository.joinMeeting(code)
                // Then fetch LiveKit token
                val response = liveKitRepository.fetchToken(code)
                _roomToken.value = response.token
            } catch (e: Exception) {
                // Handle error
            }
        }
    }

    fun joinAsGuest(code: String, displayName: String, onJoined: () -> Unit) {
        viewModelScope.launch {
            try {
                val guestSession = liveKitRepository.createGuestSession(code, displayName)
                authRepository.importSession(guestSession.access_token, guestSession.refresh_token)
                onJoined()
            } catch (e: Exception) {
                // Handle error
            }
        }
    }

    fun createMeeting(title: String) {
        viewModelScope.launch {
            try {
                val meeting = meetingRepository.createMeeting(title)
                loadMeetings()
            } catch (e: Exception) {
                // Handle error
            }
        }
    }
}
