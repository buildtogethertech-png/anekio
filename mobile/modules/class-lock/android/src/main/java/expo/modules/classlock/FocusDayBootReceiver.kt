package expo.modules.classlock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Phone restarted during the school day: bring the day (and its guard) back. */
class FocusDayBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_LOCKED_BOOT_COMPLETED) {
      FocusDayState.restore(context)
    }
  }
}
