package com.darkglobe87.mirage;

import android.os.Bundle;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Hosts the game WebView.
 *
 * Two native concerns are handled here that the web layer cannot reach:
 * edge-to-edge immersive layout (so the game owns the whole panel, including the
 * area behind a notch), and keeping the screen awake during a long run, since a
 * one-touch game can easily go a minute without an input event.
 *
 * The system bars use BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE deliberately: an
 * edge swipe still brings them back and the real back gesture keeps working.
 * Trapping the player in the app is exactly the sort of thing the gremlin rules
 * forbid.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Lets the WebView draw behind the cutout; CSS env() insets keep the HUD clear.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        applyImmersiveMode();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Returning from the recents screen or a notification shade re-shows the bars.
        if (hasFocus) {
            applyImmersiveMode();
        }
    }

    private void applyImmersiveMode() {
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
