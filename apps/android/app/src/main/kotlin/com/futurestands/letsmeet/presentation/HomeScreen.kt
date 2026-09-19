package com.futurestands.letsmeet.presentation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.futurestands.letsmeet.domain.model.Meeting

@Composable
fun HomeScreen(navController: NavController, viewModel: MeetingViewModel = viewModel()) {
    val meetings by viewModel.meetings.collectAsState()

    LaunchedEffect(Unit) {
        viewModel.loadMeetings()
    }

    Scaffold(
        topBar = {
            SmallTopAppBar(title = { Text("Your Meetings") })
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { viewModel.createMeeting("New Android Meeting") }) {
                Text("+")
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding)
        ) {
            items(meetings) { meeting ->
                MeetingItem(meeting) {
                    navController.navigate("room/${meeting.code}")
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
            Text("Code: ${meeting.code}", style = MaterialTheme.typography.bodySmall)
            Text("Status: ${meeting.status}", style = MaterialTheme.typography.bodySmall)
        }
    }
}
