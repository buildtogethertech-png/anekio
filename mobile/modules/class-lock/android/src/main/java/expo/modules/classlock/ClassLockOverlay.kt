package expo.modules.classlock

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The guard: while the school day is in focus and Anekio is not on screen, a full-screen view covers
 * whatever app is open. During one of the teacher's classes it has no break option. Nothing here
 * reads which app is open.
 */
object ClassLockOverlay {
  private const val NAVY = "#0E1A3A"
  private const val NAVY_SOFT = "#1B2A55"

  /** Anekio on screen? Starts false so a restart (no Anekio window yet) shows the guard. */
  private var appVisible = false
  private var view: View? = null
  /** "class:<start>" or "focus": rebuild the view when this changes. */
  private var shownVariant = ""
  private var timer: TextView? = null
  private val handler = Handler(Looper.getMainLooper())

  /** Set by ClassLockPackage when the teacher leaves with Home / Recents (not when Anekio opens an app). */
  @Volatile var userLeft = false

  /** "Take a break" was tapped on the guard; the module reports it once Anekio is back. */
  @Volatile var breakRequested = false

  fun setAppVisible(context: Context, visible: Boolean) {
    appVisible = visible
    handler.post { refresh(context.applicationContext) }
  }

  private var tracking = false
  private var started = 0

  /** Count every Anekio screen (not only the main one), so any Anekio screen on top counts as "in Anekio". */
  fun track(context: Context, screenOpenNow: Boolean) {
    if (tracking) return
    val app = context.applicationContext as? android.app.Application ?: return
    tracking = true
    started = if (screenOpenNow) 1 else 0
    app.registerActivityLifecycleCallbacks(object : android.app.Application.ActivityLifecycleCallbacks {
      override fun onActivityStarted(activity: android.app.Activity) {
        started += 1
        userLeft = false
        FocusDayState.endPass()
        setAppVisible(app, true)
      }
      override fun onActivityStopped(activity: android.app.Activity) {
        started = (started - 1).coerceAtLeast(0)
        if (started == 0) {
          val power = app.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
          // Anekio opened another app (no Home/Recents, screen still on): a short pass, not the guard.
          if (!userLeft && power.isInteractive) FocusDayState.startPass(app)
          userLeft = false
          setAppVisible(app, false)
        }
      }
      override fun onActivityCreated(activity: android.app.Activity, savedInstanceState: android.os.Bundle?) {}
      override fun onActivityResumed(activity: android.app.Activity) {}
      override fun onActivityPaused(activity: android.app.Activity) {}
      override fun onActivitySaveInstanceState(activity: android.app.Activity, outState: android.os.Bundle) {}
      override fun onActivityDestroyed(activity: android.app.Activity) {}
    })
  }

  fun canDraw(context: Context) = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

  fun refresh(context: Context) {
    val app = context.applicationContext
    if (Looper.myLooper() != Looper.getMainLooper()) {
      handler.post { refresh(app) }
      return
    }
    ClassLockBreakChip.refresh(app, appVisible)
    val on = FocusDayState.status == "focus" && !FocusDayState.passActive() && !appVisible && canDraw(app)
    if (!on) {
      hide(app)
      return
    }
    val slot = FocusDayState.classNow()
    val variant = if (slot != null) "class:${slot.start}" else "focus"
    if (view != null && variant != shownVariant) hide(app)
    if (view == null) show(app, slot, variant)
  }

  private fun dp(context: Context, v: Float) =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, context.resources.displayMetrics).toInt()

  private fun label(context: Context, value: String, size: Float, color: String, bold: Boolean = false) =
    TextView(context).apply {
      text = value
      setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
      setTextColor(Color.parseColor(color))
      gravity = Gravity.CENTER
      typeface = Typeface.create(Typeface.SANS_SERIF, if (bold) Typeface.BOLD else Typeface.NORMAL)
      setLineSpacing(0f, 1.15f)
    }

  private fun rounded(color: String, radius: Int, stroke: Int = 0, strokeColor: String = "#00000000") =
    GradientDrawable().apply {
      setColor(Color.parseColor(color))
      cornerRadius = radius.toFloat()
      if (stroke > 0) setStroke(stroke, Color.parseColor(strokeColor))
    }

  private fun openAnekio(context: Context) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    context.startActivity(launch)
  }

  private fun focused(): String {
    val s = ((FocusDayState.focusMs + (System.currentTimeMillis() - FocusDayState.since)) / 1000).coerceAtLeast(0)
    return String.format("%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
  }

  private val tick = object : Runnable {
    override fun run() {
      timer?.text = "${focused()}  focused today"
      handler.postDelayed(this, 1000)
    }
  }

  private fun show(context: Context, slot: FocusDayState.ClassSlot?, variant: String) {
    // Back does nothing here; Home cannot be blocked by any app, but the guard stays on top.
    val root = object : FrameLayout(context) {
      override fun dispatchKeyEvent(event: KeyEvent): Boolean =
        if (event.keyCode == KeyEvent.KEYCODE_BACK) true else super.dispatchKeyEvent(event)
    }
    root.setBackgroundColor(Color.parseColor(NAVY))
    root.isClickable = true
    root.addView(View(context).apply { background = rounded(NAVY_SOFT, dp(context, 220f)) },
      FrameLayout.LayoutParams(dp(context, 440f), dp(context, 440f)).apply { gravity = Gravity.TOP or Gravity.END; topMargin = -dp(context, 180f); rightMargin = -dp(context, 200f) })
    root.addView(View(context).apply { background = rounded(NAVY_SOFT, dp(context, 160f)) },
      FrameLayout.LayoutParams(dp(context, 320f), dp(context, 320f)).apply { gravity = Gravity.BOTTOM or Gravity.START; bottomMargin = -dp(context, 140f); leftMargin = -dp(context, 160f) })

    val column = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(dp(context, 32f), 0, dp(context, 32f), 0)
    }
    val tile = FrameLayout(context).apply {
      background = rounded("#FFFFFF", dp(context, 22f))
      elevation = dp(context, 6f).toFloat()
    }
    tile.addView(ImageView(context).apply {
      setImageDrawable(context.packageManager.getApplicationIcon(context.applicationInfo))
    }, FrameLayout.LayoutParams(dp(context, 56f), dp(context, 56f), Gravity.CENTER))
    column.addView(tile, LinearLayout.LayoutParams(dp(context, 76f), dp(context, 76f)))

    val full = { top: Float -> LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(context, 54f)).apply { topMargin = dp(context, top) } }
    if (slot != null) {
      column.addView(label(context, "YOUR CLASS IS ON", 12f, "#93A6D9", true).apply { setPadding(0, dp(context, 26f), 0, 0) })
      column.addView(label(context, slot.title, 30f, "#FFFFFF", true).apply { setPadding(0, dp(context, 6f), 0, 0) })
      column.addView(label(context, slot.subtitle, 15f, "#B8C4E6").apply { setPadding(0, dp(context, 8f), 0, 0) })
      column.addView(label(context, "Phone use during class is visible to your admin.", 13f, "#FFD7A8", true).apply {
        background = rounded("#33F59E0B", dp(context, 20f))
        setPadding(dp(context, 16f), dp(context, 9f), dp(context, 16f), dp(context, 9f))
      }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(context, 22f) })
      column.addView(label(context, "Back to Anekio", 16f, NAVY, true).apply {
        background = rounded("#FFFFFF", dp(context, 16f))
        setOnClickListener { openAnekio(context) }
      }, full(44f))
      if (FocusDayState.breakInClass) {
        column.addView(label(context, "Take a break", 15f, "#FFFFFF", true).apply {
          background = rounded("#00000000", dp(context, 16f), dp(context, 1f), "#4A5B8C")
          setOnClickListener {
            breakRequested = true
            openAnekio(context)
          }
        }, full(12f))
      }
      timer = null
    } else {
      column.addView(label(context, "Focus time", 30f, "#FFFFFF", true).apply { setPadding(0, dp(context, 26f), 0, 0) })
      column.addView(label(context, "Other apps are paused while your school day is on.", 15f, "#B8C4E6").apply { setPadding(0, dp(context, 10f), 0, 0) })
      timer = label(context, "${focused()}  focused today", 13f, "#DCE4FF", true).apply {
        background = rounded("#22FFFFFF", dp(context, 20f))
        setPadding(dp(context, 16f), dp(context, 8f), dp(context, 16f), dp(context, 8f))
      }
      column.addView(timer, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(context, 22f) })
      column.addView(label(context, "Back to Anekio", 16f, NAVY, true).apply {
        background = rounded("#FFFFFF", dp(context, 16f))
        setOnClickListener { openAnekio(context) }
      }, full(44f))
      column.addView(label(context, "Take a break", 15f, "#FFFFFF", true).apply {
        background = rounded("#00000000", dp(context, 16f), dp(context, 1f), "#4A5B8C")
        setOnClickListener {
          breakRequested = true
          openAnekio(context)
        }
      }, full(12f))
    }
    column.addView(label(context, "Leaving Anekio during the school day is recorded.", 12f, "#7F8DB8").apply { setPadding(0, dp(context, 22f), 0, 0) })
    root.addView(column, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      type,
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.OPAQUE
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }
    try {
      (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).addView(root, params)
      view = root
      shownVariant = variant
      handler.removeCallbacks(tick)
      if (timer != null) handler.post(tick)
    } catch (_: Exception) {
      view = null
      timer = null
    }
  }

  private fun hide(context: Context) {
    handler.removeCallbacks(tick)
    val v = view ?: return
    view = null
    timer = null
    shownVariant = ""
    try {
      (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(v)
    } catch (_: Exception) {
    }
  }
}
