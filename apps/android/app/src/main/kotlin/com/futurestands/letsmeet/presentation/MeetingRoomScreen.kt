package com.futurestands.letsmeet.presentation

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.futurestands.letsmeet.BuildConfig
import io.livekit.android.LiveKit
import io.livekit.android.compose.state.rememberTracks
import io.livekit.android.compose.ui.ScaleType
import io.livekit.android.compose.ui.VideoTrackView
import io.livekit.android.events.*
import io.livekit.android.room.Room
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import io.livekit.android.room.participant.LocalParticipant
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MeetingRoomScreen(
    navController: NavController,
    meetingCode: String,
    viewModel: MeetingViewModel = viewModel()
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val room = remember { LiveKit.create(context) }
    val roomToken by viewModel.roomToken.collectAsState()
    
    var isMicEnabled by remember { mutableStateOf(true) }
    var isCameraEnabled by remember { mutableStateOf(true) }
    var connectionStateText by remember { mutableStateOf("Connecting...") }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions.values.all { it }
        if (granted) {
            viewModel.joinMeeting(meetingCode)
        }
    }

    LaunchedEffect(Unit) {
        permissionLauncher.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO))
    }

    LaunchedEffect(roomToken) {
        val token = roomToken ?: return@LaunchedEffect
        try {
            room.connect(BuildConfig.LIVEKIT_URL, token)
            
            // Enable local tracks
            room.localParticipant.setMicrophoneEnabled(isMicEnabled)
            room.localParticipant.setCameraEnabled(isCameraEnabled)
            
            connectionStateText = "Connected"

            // Collect events
            room.events.collect { event ->
                when (event) {
                    is RoomEvent.Disconnected -> {
                        connectionStateText = "Disconnected"
                    }
                    is RoomEvent.Reconnecting -> {
                        connectionStateText = "Reconnecting..."
                    }
                    is RoomEvent.Reconnected -> {
                        connectionStateText = "Connected"
                    }
                    else -> {}
                }
            }
        } catch (e: Exception) {
            connectionStateText = "Error: ${e.message}"
        }
    }

    // rememberTracks returns a State in this version.
    val trackReferences by rememberTracks(
        sources = listOf(Track.Source.CAMERA, Track.Source.SCREEN_SHARE),
        passedRoom = room
    )

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { 
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Meeting: $meetingCode", style = MaterialTheme.typography.titleMedium)
                        Text(connectionStateText, style = MaterialTheme.typography.bodySmall)
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            )
        },
        bottomBar = {
            BottomAppBar(
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                actions = {
                    IconButton(onClick = { 
                        isMicEnabled = !isMicEnabled
                        scope.launch { room.localParticipant.setMicrophoneEnabled(isMicEnabled) }
                    }) {
                        Icon(if (isMicEnabled) Icons.Default.Mic else Icons.Default.MicOff, contentDescription = "Mic")
                    }
                    IconButton(onClick = { 
                        isCameraEnabled = !isCameraEnabled
                        scope.launch { room.localParticipant.setCameraEnabled(isCameraEnabled) }
                    }) {
                        Icon(if (isCameraEnabled) Icons.Default.Videocam else Icons.Default.VideocamOff, contentDescription = "Camera")
                    }
                },
                floatingActionButton = {
                    FloatingActionButton(
                        onClick = { 
                            room.disconnect()
                            navController.popBackStack() 
                        },
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = Color.White
                    ) {
                        Icon(Icons.Default.CallEnd, contentDescription = "Leave")
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(modifier = Modifier.padding(paddingValues).fillMaxSize().background(Color.Black)) {
            if (trackReferences.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Waiting for participants...", color = Color.White)
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(if (trackReferences.size > 1) 2 else 1),
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    items(trackReferences) { trackRef ->
                        Card(
                            modifier = Modifier.fillMaxWidth().aspectRatio(if (trackReferences.size > 1) 1f else 0.75f),
                            shape = MaterialTheme.shapes.medium
                        ) {
                            VideoTrackView(
                                trackReference = trackRef,
                                modifier = Modifier.fillMaxSize(),
                                room = room,
                                mirror = trackRef.participant is LocalParticipant,
                                scaleType = ScaleType.Fill
                            )
                        }
                    }
                }
            }
        }
    }

    DisposableEffect(room) {
        onDispose {
            room.disconnect()
            room.release()
        }
    }
}
