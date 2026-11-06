package expo.modules.classlock

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps Anekio alive during the school day (so the guard keeps working if Anekio is swiped away or
 * the phone is busy) and shows the ongoing "School day on" notification.
 */
class FocusDayService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = buildNotification(this)
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(ID, notification)
    }
    if (FocusDayState.status == "off") stopSelf()
    return START_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiped away: Anekio is no longer on screen, so the guard comes up.
    ClassLockOverlay.setAppVisible(this, false)
  }

  companion object {
    private const val ID = 4127
    private const val CHANNEL = "focus_day"

    fun buildNotification(context: Context): Notification {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "School day", NotificationManager.IMPORTANCE_LOW))
      }
      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL)
      else @Suppress("DEPRECATION") Notification.Builder(context)
      builder.setSmallIcon(context.applicationInfo.icon).setContentIntent(tap).setOngoing(true)
      if (FocusDayState.status == "break") {
        val slot = FocusDayState.classNow()
        builder
          .setUsesChronometer(true)
          .setWhen(FocusDayState.since)
          .setShowWhen(true)
          .setContentTitle(if (slot != null) "Class on · you are on break" else "On break")
          .setContentText(
            if (slot != null) "${slot.title.substringBefore(" · ")} class · Admin is watching"
            else "Other apps are open until you go back."
          )
      } else {
        builder
          .setUsesChronometer(false)
          .setShowWhen(false)
          .setContentTitle("School day on")
          .setContentText("Other apps are paused until your break or the end of the day.")
      }
      return builder.build()
    }

    /** Refresh the ongoing notification (break started, class started during a break…). */
    fun updateNotification(context: Context) {
      if (FocusDayState.status == "off") return
      runCatching {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(ID, buildNotification(context))
      }
    }
  }
}
