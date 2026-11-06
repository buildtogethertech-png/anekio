package expo.modules.classlock

import android.app.Activity
import android.content.Context
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/**
 * Tells the guard whether the teacher left Anekio themselves (Home / Recents: onUserLeaveHint) or
 * Anekio opened another app (WhatsApp, phone call, camera, file picker, share, UPI…), which gets a
 * short pass instead of the guard.
 */
class ClassLockPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> =
    listOf(object : ReactActivityLifecycleListener {
      override fun onUserLeaveHint(activity: Activity) {
        ClassLockOverlay.userLeft = true
      }
    })
}
