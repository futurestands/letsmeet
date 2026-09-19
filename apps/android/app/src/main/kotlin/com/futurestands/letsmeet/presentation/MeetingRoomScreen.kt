package com.futurestands.letsmeet.presentation

import android.app.Activity
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.futurestands.letsmeet.BuildConfig
import io.livekit.android.LiveKit
import io.livekit.android.room.Room
import io.livekit.android.room.track.VideoTrack
import io.livekit.android.renderer.TextureViewRenderer
import kotlinx.coroutines.launch

@Composable
fun MeetingRoomScreen(
    navController: NavController,
    meetingCode: String,
    viewModel: MeetingViewModel = viewModel()
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val roomToken by viewModel.roomToken.collectAsState()
    
    // Simple state to hold the room and video tracks
    var room by remember { mutableStateOf<Room?>(null) }
    var remoteVideoTrack by remember { mutableStateOf<VideoTrack?>(null) }

    LaunchedEffect(meetingCode) {
        viewModel.joinMeeting(meetingCode)
    }

    LaunchedEffect(roomToken) {
        val token = roomToken ?: return@LaunchedEffect
        scope.launch {
            val r = LiveKit.connect(
                context = context,
                url = BuildConfig.LIVEKIT_URL,
                token = token
            )
            room = r
            
            // Basic track handling (simplified for foundation)
            // In a real app, use Room events to update participant list
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            room?.disconnect()
        }
    }

    Scaffold(
        topBar = {
            SmallTopAppBar(
                title = { Text("Meeting: $meetingCode") },
                actions = {
                    Button(onClick = { navController.popBackStack() }) {
                        Text("Leave")
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (room == null) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else {
                Text("Connected to LiveKit", modifier = Modifier.padding(16.dp))
                // Placeholder for Video Grid
                // Real implementation would iterate participants and render their VideoTracks
            }
        }
    }
}
