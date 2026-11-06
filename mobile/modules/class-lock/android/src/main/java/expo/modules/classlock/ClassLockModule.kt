package expo.modules.classlock

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * School day guard. JS side: modules/class-lock/index.ts. Android only.
 * JS owns the day (start, break with reason, end) and sends it with setDay(); the phone keeps it,
 * covers other apps while in focus, and ends a break when a class starts or the day at closing time.
 */
class ClassLockModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No React context")

  override fun definition() = ModuleDefinition {
    Name("ClassLock")
    Events("onBreakRequest")

    OnCreate {
      // Anekio is on screen when its JS starts; say so before the saved day can bring up the guard.
      ClassLockOverlay.setAppVisible(context, true)
      ClassLockOverlay.track(context, appContext.currentActivity != null)
      FocusDayState.restore(context)
    }

    Function("canDrawOverlays") { ClassLockOverlay.canDraw(context) }

    Function("openOverlaySettings") {
      val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    /** JSON: { status: off|focus|break, focusMs, since, closesAt, date, classes: [{start,end,title,subtitle}] } */
    Function("setDay") { json: String -> FocusDayState.set(context, json) }

    /** The phone's view of the day, including `changedByPhone` ("class" / "closed") when it changed it. */
    Function("getDay") { FocusDayState.toJson() }

    /** JS logged the "opened from Anekio" times up to `upTo` (epoch ms). */
    Function("clearOutside") { upTo: Double -> FocusDayState.clearOutside(context, upTo.toLong()) }

    OnActivityEntersForeground {
      if (ClassLockOverlay.breakRequested) {
        ClassLockOverlay.breakRequested = false
        sendEvent("onBreakRequest", mapOf<String, Any>())
      }
    }
  }
}
