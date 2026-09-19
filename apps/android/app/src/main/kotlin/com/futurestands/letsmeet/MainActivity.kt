package com.futurestands.letsmeet

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.futurestands.letsmeet.presentation.*

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Handle deep link
        val action: String? = intent?.action
        val data: android.net.Uri? = intent?.data
        val deepLinkCode = if (action == android.content.Intent.ACTION_VIEW && data != null) {
            data.pathSegments.lastOrNull()
        } else null

        setContent {
            LetsMeetTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val authViewModel: AuthViewModel = viewModel()
                    val isAuthenticated by authViewModel.isAuthenticated.collectAsState()
                    val isLoading by authViewModel.isLoading.collectAsState()
                    
                    if (isLoading) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    } else {
                        val navController = rememberNavController()
                        val startDestination = if (isAuthenticated) {
                            if (deepLinkCode != null) "room/$deepLinkCode" else "home"
                        } else {
                            if (deepLinkCode != null) "prejoin/$deepLinkCode" else "auth"
                        }
                        
                        NavHost(navController = navController, startDestination = startDestination) {
                            composable("auth") { AuthScreen(navController, authViewModel) }
                            composable("home") { HomeScreen(navController) }
                            composable("prejoin/{meetingCode}") { backStackEntry ->
                                val code = backStackEntry.arguments?.getString("meetingCode") ?: ""
                                PreJoinScreen(navController, code, viewModel())
                            }
                            composable("room/{meetingCode}") { backStackEntry ->
                                val meetingCode = backStackEntry.arguments?.getString("meetingCode") ?: ""
                                MeetingRoomScreen(navController, meetingCode)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun LetsMeetTheme(content: @Composable () -> Unit) {
    MaterialTheme(content = content)
}
