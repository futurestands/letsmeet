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
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.*
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
    val chatMessages by viewModel.chatMessages.collectAsState()
    val reactions by viewModel.reactions.collectAsState()
    val handRaises by viewModel.handRaises.collectAsState()
    
    var isMicEnabled by remember { mutableStateOf(true) }
    var isCameraEnabled by remember { mutableStateOf(true) }
    var connectionStateText by remember { mutableStateOf("Connecting...") }
    
    var isChatOpen by remember { mutableStateOf(false) }
    var isParticipantsOpen by remember { mutableStateOf(false) }
    var chatMessageText by remember { mutableStateOf("") }

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

    // rememberTracks returns a State<List<TrackReference>> in 2.4.2 based on error logs.
    val trackReferencesState = rememberTracks(
        sources = listOf(Track.Source.CAMERA, Track.Source.SCREEN_SHARE),
        passedRoom = room
    )
    val trackReferences = trackReferencesState.value

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
                    IconButton(onClick = { isChatOpen = true }) {
                        BadgedBox(badge = {
                            if (chatMessages.isNotEmpty()) {
                                Badge { Text(chatMessages.size.toString()) }
                            }
                        }) {
                            Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = "Chat")
                        }
                    }
                    IconButton(onClick = { isParticipantsOpen = true }) {
                        Icon(Icons.Default.People, contentDescription = "Participants")
                    }
                    IconButton(onClick = { viewModel.toggleHandRaise() }) {
                        Icon(
                            Icons.Default.PanTool, 
                            contentDescription = "Hand Raise",
                            // Tint if local hand is raised
                            tint = if (handRaises.any { it.user_id == room.localParticipant.identity?.value }) Color.Yellow else LocalContentColor.current
                        )
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
            // Video Grid
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
                            Box(modifier = Modifier.fillMaxSize()) {
                                VideoTrackView(
                                    trackReference = trackRef,
                                    modifier = Modifier.fillMaxSize(),
                                    room = room,
                                    mirror = trackRef.participant is LocalParticipant,
                                    scaleType = ScaleType.Fill
                                )
                                // Participant name overlay
                                Row(
                                    modifier = Modifier
                                        .align(Alignment.BottomStart)
                                        .padding(8.dp)
                                        .background(Color.Black.copy(alpha = 0.5f), shape = MaterialTheme.shapes.small)
                                        .padding(horizontal = 4.dp, vertical = 2.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = trackRef.participant.name ?: "Unknown",
                                        color = Color.White,
                                        style = MaterialTheme.typography.bodySmall
                                    )
                                    if (handRaises.any { it.user_id == trackRef.participant.identity?.value }) {
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Icon(Icons.Default.PanTool, contentDescription = "Hand Raised", tint = Color.Yellow, modifier = Modifier.size(12.dp))
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Reactions Overlay
            Box(modifier = Modifier.fillMaxSize().padding(16.dp)) {
                reactions.takeLast(5).forEachIndexed { index, reaction ->
                    Text(
                        text = reaction.emoji,
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(bottom = (index * 40).dp),
                        style = MaterialTheme.typography.headlineLarge
                    )
                }
            }
            
            // Reaction Bar (Floating above bottom bar)
            Row(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 8.dp)
                    .background(Color.Black.copy(alpha = 0.5f), shape = CircleShape)
                    .padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                listOf("👍", "❤️", "👏", "😂", "😮").forEach { emoji ->
                    IconButton(onClick = { viewModel.sendReaction(emoji) }) {
                        Text(emoji)
                    }
                }
            }
        }
    }

    // Chat Bottom Sheet
    if (isChatOpen) {
        ModalBottomSheet(onDismissRequest = { isChatOpen = false }) {
            Column(modifier = Modifier.fillMaxHeight(0.6f).padding(16.dp)) {
                Text("Chat", style = MaterialTheme.typography.titleLarge)
                LazyColumn(modifier = Modifier.weight(1f)) {
                    items(chatMessages) { msg ->
                        Column(modifier = Modifier.padding(vertical = 4.dp)) {
                            Text(msg.user_name, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                            Text(msg.message, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = chatMessageText,
                        onValueChange = { chatMessageText = it },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text("Type a message...") }
                    )
                    IconButton(onClick = { 
                        if (chatMessageText.isNotBlank()) {
                            viewModel.sendChatMessage(chatMessageText)
                            chatMessageText = ""
                        }
                    }) {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
                    }
                }
            }
        }
    }

    // Participants Bottom Sheet
    if (isParticipantsOpen) {
        ModalBottomSheet(onDismissRequest = { isParticipantsOpen = false }) {
            Column(modifier = Modifier.fillMaxHeight(0.6f).padding(16.dp)) {
                Text("Participants", style = MaterialTheme.typography.titleLarge)
                LazyColumn {
                    val participants = room.remoteParticipants.values + room.localParticipant
                    items(participants.toList()) { participant ->
                        ListItem(
                            headlineContent = { Text(participant.name ?: "Unknown") },
                            supportingContent = { Text(participant.identity?.value ?: "") },
                            leadingContent = {
                                Icon(Icons.Default.Person, contentDescription = null)
                            },
                            trailingContent = {
                                if (handRaises.any { it.user_id == participant.identity?.value }) {
                                    Icon(Icons.Default.PanTool, contentDescription = "Hand Raised", tint = Color.Yellow)
                                }
                            }
                        )
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
