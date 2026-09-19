package com.futurestands.letsmeet

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.futurestands.letsmeet.presentation.AuthScreen
import com.futurestands.letsmeet.presentation.HomeScreen
import com.futurestands.letsmeet.presentation.MeetingRoomScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Handle deep link if present
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
                    val navController = rememberNavController()
                    val startDestination = if (deepLinkCode != null) "room/$deepLinkCode" else "auth"
                    
                    NavHost(navController = navController, startDestination = startDestination) {
                        composable("auth") { AuthScreen(navController) }
                        composable("home") { HomeScreen(navController) }
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

@Composable
fun LetsMeetTheme(content: @Composable () -> Unit) {
    MaterialTheme(content = content)
}
