package expo.modules.classlock

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView

/**
 * During a break: a thin line just under the status bar over every other app, with a tiny "12m" at
 * its right end. Amber = on break; red and pulsing = one of the teacher's classes is on.
 * The line never takes touches (everything underneath works); only the small "12m · End break" tag
 * does: tapping it ends the break right there. The details ("2-A class · Admin is watching", live
 * break timer) are in the ongoing notification.
 *
 * Same line in blue while Anekio opened another app (WhatsApp, call, camera…): "From Anekio · 2:45 ·
 * Back" — the short pass before the guard comes back.
 */
object ClassLockBreakChip {
  private var view: View? = null
  private var tagView: View? = null
  private var line: View? = null
  private var time: TextView? = null
  private var pulse: ObjectAnimator? = null
  private var missing: Boolean? = null
  /** "break" or "pass" while shown. */
  private var mode: String? = null
  private val handler = Handler(Looper.getMainLooper())

  fun refresh(context: Context, appVisible: Boolean) {
    val app = context.applicationContext
    val want = when {
      appVisible || !ClassLockOverlay.canDraw(app) -> null
      FocusDayState.status == "break" -> "break"
      FocusDayState.passActive() -> "pass"
      else -> null
    }
    if (want == null) {
      hide(app)
      return
    }
    if (view != null && mode != want) hide(app)
    mode = want
    show(app)
  }

  private fun dp(context: Context, v: Float) =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, context.resources.displayMetrics).toInt()

  private fun statusBarHeight(context: Context): Int {
    val id = context.resources.getIdentifier("status_bar_height", "dimen", "android")
    return if (id > 0) context.resources.getDimensionPixelSize(id) else dp(context, 24f)
  }

  private fun minutes(): String {
    val m = ((System.currentTimeMillis() - FocusDayState.since) / 60_000).coerceAtLeast(0)
    return if (m >= 60) "${m / 60}h${m % 60}" else "${m}m"
  }

  private fun passLeft(): String {
    val s = ((FocusDayState.passUntil - System.currentTimeMillis()) / 1000).coerceAtLeast(0)
    return String.format("%d:%02d", s / 60, s % 60)
  }

  private fun openAnekio(context: Context) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    context.startActivity(launch)
  }

  private fun render(context: Context) {
    if (mode == "pass") {
      if (missing != false) {
        missing = false
        val blue = Color.parseColor("#2855F6")
        line?.setBackgroundColor(blue)
        time?.background = GradientDrawable().apply {
          cornerRadii = floatArrayOf(0f, 0f, 0f, 0f, dp(context, 8f).toFloat(), dp(context, 8f).toFloat(), dp(context, 8f).toFloat(), dp(context, 8f).toFloat())
          setColor(blue)
        }
      }
      time?.text = "From Anekio · ${passLeft()} · Back"
      if (!FocusDayState.passActive()) ClassLockOverlay.refresh(context)
      return
    }
    val isMissing = FocusDayState.classNow() != null
    if (missing != isMissing) {
      missing = isMissing
      val color = Color.parseColor(if (isMissing) "#DC2626" else "#F59E0B")
      line?.setBackgroundColor(color)
      time?.background = GradientDrawable().apply {
        cornerRadii = floatArrayOf(0f, 0f, 0f, 0f, dp(context, 8f).toFloat(), dp(context, 8f).toFloat(), dp(context, 8f).toFloat(), dp(context, 8f).toFloat())
        setColor(color)
      }
      pulse?.cancel()
      pulse = null
      line?.alpha = 1f
      if (isMissing) {
        pulse = ObjectAnimator.ofFloat(line, "alpha", 1f, 0.35f).apply {
          duration = 900
          repeatMode = ValueAnimator.REVERSE
          repeatCount = ValueAnimator.INFINITE
          start()
        }
      }
      FocusDayService.updateNotification(context)
    }
    time?.text = "${minutes()} · End break"
  }

  private val tick = object : Runnable {
    override fun run() {
      val v = view ?: return
      render(v.context)
      handler.postDelayed(this, 1_000)
    }
  }

  private fun show(context: Context) {
    if (view != null) return
    val root = FrameLayout(context)
    line = View(context)
    root.addView(line, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(context, 3f), Gravity.TOP))
    time = TextView(context).apply {
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
      setTextColor(Color.WHITE)
      typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
      gravity = Gravity.CENTER
      includeFontPadding = false
      setPadding(dp(context, 7f), dp(context, 2f), dp(context, 7f), dp(context, 3f))
    }
    time?.setPadding(dp(context, 10f), dp(context, 4f), dp(context, 10f), dp(context, 5f))
    time?.setOnClickListener { if (mode == "pass") openAnekio(context) else FocusDayState.endBreakFromPhone(context) }
    missing = null
    render(context)

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      // Never takes touches or focus: the app underneath works as if the line was not there.
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP
      y = statusBarHeight(context)
    }
    val tagParams = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.END
      x = dp(context, 12f)
      y = statusBarHeight(context) + dp(context, 3f)
    }
    try {
      val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
      wm.addView(root, params)
      view = root
      time?.let { t -> runCatching { wm.addView(t, tagParams) }.onSuccess { tagView = t } }
      handler.removeCallbacks(tick)
      handler.postDelayed(tick, 1_000)
    } catch (_: Exception) {
      view = null
    }
  }

  private fun hide(context: Context) {
    handler.removeCallbacks(tick)
    pulse?.cancel()
    pulse = null
    val v = view ?: return
    view = null
    mode = null
    val tag = tagView
    tagView = null
    line = null
    time = null
    if (missing != null) {
      missing = null
      FocusDayService.updateNotification(context)
    }
    val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    runCatching { wm.removeView(v) }
    if (tag != null) runCatching { wm.removeView(tag) }
  }
}
