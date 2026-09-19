package com.futurestands.letsmeet.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.futurestands.letsmeet.data.repository.AuthRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class AuthViewModel : ViewModel() {
    private val authRepository = AuthRepository()

    private val _isAuthenticated = MutableStateFlow(false)
    val isAuthenticated: StateFlow<Boolean> = _isAuthenticated

    init {
        viewModelScope.launch {
            authRepository.getSessionFlow().collect {
                _isAuthenticated.value = it
            }
        }
    }

    fun login(email: String, password: String) {
        viewModelScope.launch {
            try {
                authRepository.login(email, password)
            } catch (e: Exception) {
                // Handle error
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            authRepository.logout()
        }
    }
}
