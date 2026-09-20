package com.futurestands.letsmeet.presentation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.futurestands.letsmeet.domain.model.Meeting

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    navController: NavController,
    viewModel: MeetingViewModel = viewModel(),
    authViewModel: AuthViewModel = viewModel()
) {
    val meetings by viewModel.meetings.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val error by viewModel.error.collectAsState()
    val isAuthenticated by authViewModel.isAuthenticated.collectAsState()

    LaunchedEffect(isAuthenticated) {
        if (!isAuthenticated) {
            navController.navigate("auth") {
                popUpTo("home") { inclusive = true }
            }
        }
    }

    LaunchedEffect(Unit) {
        viewModel.loadMeetings()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Your Meetings") },
                actions = {
                    TextButton(onClick = { authViewModel.logout() }) {
                        Text("Logout")
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { viewModel.createMeeting("New Android Meeting") }) {
                Text("+")
            }
        }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (isLoading && meetings.isEmpty()) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            } else if (error != null && meetings.isEmpty()) {
                Column(modifier = Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(error!!, color = MaterialTheme.colorScheme.error)
                    Button(onClick = { viewModel.loadMeetings() }) {
                        Text("Retry")
                    }
                }
            } else if (meetings.isEmpty()) {
                Text("No meetings found.", modifier = Modifier.align(Alignment.Center))
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(meetings) { meeting ->
                        MeetingItem(meeting) {
                            navController.navigate("room/${meeting.code}")
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun MeetingItem(meeting: Meeting, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(8.dp).clickable { onClick() }
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(meeting.title ?: "Untitled Meeting", style = MaterialTheme.typography.titleMedium)
            if (meeting.scheduled_for != null) {
                Text("Scheduled: ${meeting.scheduled_for}", style = MaterialTheme.typography.bodySmall)
            }
            Text("Code: ${meeting.code}", style = MaterialTheme.typography.bodySmall)
            Text("Status: ${meeting.status.uppercase()}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        }
    }
}
