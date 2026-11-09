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
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The guard: while the school day is in focus and Anekio is not on screen, a full-screen view covers
 * whatever app is open. During one of the teacher's classes it has no break option. Nothing here
 * reads which app is open.
 */
object ClassLockOverlay {
  private const val PAGE = "#F6F8FC"
  private const val INK = "#0F172A"
  private const val INK_SOFT = "#475569"
  private const val INK_MUTED = "#94A3B8"
  private const val LINE = "#E2E8F0"
  private const val BLUE = "#2855F6"
  private const val BLUE_DARK = "#1F45C7"
  private const val BLUE_SOFT = "#EEF3FF"

  /** Anekio on screen? Starts false so a restart (no Anekio window yet) shows the guard. */
  private var appVisible = false
  private var view: View? = null
  /** "class:<start>" or "focus": rebuild the view when this changes. */
  private var shownVariant = ""
  private var timer: TextView? = null
  private val handler = Handler(Looper.getMainLooper())

  /** Set by ClassLockPackage when the teacher leaves with Home / Recents (not when Anekio opens an app). */
  @Volatile var userLeft = false

  /** Until this time (epoch ms) a leave hint means Anekio is opening another app, not Home / Recents. */
  @Volatile var openingUntil = 0L

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
        openingUntil = 0L
        FocusDayState.endPass()
        setAppVisible(app, true)
      }
      override fun onActivityStopped(activity: android.app.Activity) {
        started = (started - 1).coerceAtLeast(0)
        if (started == 0) {
          val power = app.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
          // Anekio opened another app (no Home/Recents, screen still on): a short pass, not the guard.
          if (!userLeft && power.isInteractive) FocusDayState.startPass(app)
          if (userLeft) FocusDayState.countLeft(app)
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
    if (inCall(app)) {
      // Never cover a phone or WhatsApp call; look again once it may have ended.
      hide(app)
      handler.removeCallbacks(recheck)
      handler.postDelayed(recheck, 5_000L)
      return
    }
    val slot = FocusDayState.classNow()
    val variant = if (slot != null) "class:${slot.start}" else "focus"
    if (view != null && variant != shownVariant) hide(app)
    if (view == null) show(app, slot, variant)
  }

  private var recheckContext: Context? = null
  private val recheck = Runnable { recheckContext?.let { refresh(it) } }

  /** A phone, WhatsApp or other call is on (audio mode; needs no permission). */
  private fun inCall(context: Context): Boolean {
    recheckContext = context
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
    return audio.mode == android.media.AudioManager.MODE_IN_CALL ||
      audio.mode == android.media.AudioManager.MODE_IN_COMMUNICATION ||
      audio.mode == android.media.AudioManager.MODE_RINGTONE
  }

  private fun dp(context: Context, v: Float) =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, context.resources.displayMetrics).toInt()

  private val fonts = HashMap<String, Typeface>()

  /** Anekio's own fonts (Inter, Ionicons), bundled with this module, so the guard looks like the app on every phone. */
  private fun font(context: Context, name: String): Typeface =
    fonts.getOrPut(name) {
      runCatching { Typeface.createFromAsset(context.assets, "classlock/$name.ttf") }.getOrDefault(Typeface.DEFAULT)
    }

  private fun label(context: Context, value: String, size: Float, color: String, weight: Int = 400) =
    TextView(context).apply {
      text = value
      setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
      setTextColor(Color.parseColor(color))
      gravity = Gravity.CENTER
      typeface = font(context, "inter-$weight")
      includeFontPadding = false
      setLineSpacing(0f, 1.2f)
    }

  /** One Ionicons glyph (same icons as the app). */
  private fun icon(context: Context, glyph: Int, size: Float, color: String) =
    TextView(context).apply {
      text = String(Character.toChars(glyph))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
      setTextColor(Color.parseColor(color))
      gravity = Gravity.CENTER
      typeface = font(context, "ionicons")
      includeFontPadding = false
    }

  private const val I_LOCK = 0xf3c7
  private const val I_BOOK = 0xf1a5
  private const val I_TIME = 0xf5de
  private const val I_CAFE = 0xf1ca
  private const val I_EXIT = 0xf2de
  private const val I_CALL = 0xf1d9
  private const val I_NEXT = 0xf1a6
  private const val I_ARROW = 0xf133

  private fun rounded(color: String, radius: Int, stroke: Int = 0, strokeColor: String = "#00000000") =
    GradientDrawable().apply {
      setColor(Color.parseColor(color))
      cornerRadius = radius.toFloat()
      if (stroke > 0) setStroke(stroke, Color.parseColor(strokeColor))
    }

  private fun gradient(top: String, bottom: String, radius: Int = 0) =
    GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Color.parseColor(top), Color.parseColor(bottom))).apply {
      cornerRadius = radius.toFloat()
    }

  private fun openAnekio(context: Context) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    context.startActivity(launch)
  }

  /** "2h 14m" / "35m" of school time today. */
  private fun focused(): String = span(FocusDayState.focusMs + (System.currentTimeMillis() - FocusDayState.since))

  private fun span(ms: Long): String {
    val m = (ms / 60_000).coerceAtLeast(0)
    return if (m >= 60) "${m / 60}h ${m % 60}m" else "${m}m"
  }

  private val tick = object : Runnable {
    override fun run() {
      timer?.text = focused()
      handler.postDelayed(this, 30_000)
    }
  }

  /** A small coloured tile: icon, big number, label. */
  private fun statTile(context: Context, glyph: Int, value: String, name: String, tint: String, soft: String): LinearLayout =
    LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.START
      background = rounded(soft, dp(context, 20f))
      setPadding(dp(context, 14f), dp(context, 14f), dp(context, 12f), dp(context, 14f))
      addView(icon(context, glyph, 18f, tint).apply {
        background = rounded("#FFFFFF", dp(context, 12f))
      }, LinearLayout.LayoutParams(dp(context, 32f), dp(context, 32f)))
      addView(label(context, value, 22f, INK, 700).apply {
        gravity = Gravity.START
        setPadding(0, dp(context, 12f), 0, 0)
      })
      addView(label(context, name, 12f, INK_SOFT, 400).apply {
        gravity = Gravity.START
        setPadding(0, dp(context, 3f), 0, 0)
      })
    }

  private fun show(context: Context, slot: FocusDayState.ClassSlot?, variant: String) {
    // Back does nothing here; Home cannot be blocked by any app, but the guard stays on top.
    val root = object : LinearLayout(context) {
      override fun dispatchKeyEvent(event: KeyEvent): Boolean =
        if (event.keyCode == KeyEvent.KEYCODE_BACK) true else super.dispatchKeyEvent(event)
    }
    root.orientation = LinearLayout.VERTICAL
    root.background = gradient("#E7EEFF", "#FFFFFF")
    root.isClickable = true
    root.setPadding(dp(context, 20f), dp(context, 48f), dp(context, 20f), dp(context, 24f))
    val wrap = LinearLayout.LayoutParams.WRAP_CONTENT
    val match = LinearLayout.LayoutParams.MATCH_PARENT

    // Brand.
    val brand = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      background = rounded("#FFFFFF", dp(context, 20f))
      setPadding(dp(context, 10f), dp(context, 6f), dp(context, 14f), dp(context, 6f))
    }
    brand.addView(ImageView(context).apply {
      setImageDrawable(context.packageManager.getApplicationIcon(context.applicationInfo))
    }, LinearLayout.LayoutParams(dp(context, 22f), dp(context, 22f)))
    brand.addView(label(context, "Anekio · School day", 13f, INK, 600).apply { setPadding(dp(context, 8f), 0, 0, 0) })
    root.addView(brand, LinearLayout.LayoutParams(wrap, wrap).apply { gravity = Gravity.CENTER_HORIZONTAL })

    // Hero.
    val middle = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
    }
    val halo = android.widget.FrameLayout(context).apply { background = rounded("#D6E2FF", dp(context, 52f)) }
    halo.addView(icon(context, if (slot != null) I_BOOK else I_LOCK, 34f, "#FFFFFF").apply {
      background = gradient("#3B6BFF", BLUE, dp(context, 38f))
    }, android.widget.FrameLayout.LayoutParams(dp(context, 76f), dp(context, 76f), Gravity.CENTER))
    middle.addView(halo, LinearLayout.LayoutParams(dp(context, 104f), dp(context, 104f)))
    middle.addView(label(context, if (slot != null) "Your class is on" else "It's school time", 30f, INK, 700).apply {
      setPadding(0, dp(context, 20f), 0, 0)
      letterSpacing = -0.02f
    })
    val line = when {
      slot != null && FocusDayState.breakInClass -> "Please go to your class.\nOther apps are off for now."
      slot != null -> "Please go to your class.\nOther apps open after it ends."
      else -> "Other apps are off until you\ntake a break or check out."
    }
    middle.addView(label(context, line, 16f, INK_SOFT, 400).apply { setPadding(0, dp(context, 10f), 0, 0) })

    if (slot != null) {
      val card = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.START
        background = gradient("#3B6BFF", BLUE_DARK, dp(context, 22f))
        setPadding(dp(context, 18f), dp(context, 16f), dp(context, 18f), dp(context, 16f))
      }
      card.addView(label(context, "NOW", 11f, "#C7D6FF", 600).apply { gravity = Gravity.START; letterSpacing = 0.12f })
      card.addView(label(context, slot.title, 20f, "#FFFFFF", 700).apply { gravity = Gravity.START; setPadding(0, dp(context, 6f), 0, 0) })
      card.addView(label(context, slot.subtitle, 14f, "#DCE6FF", 400).apply { gravity = Gravity.START; setPadding(0, dp(context, 4f), 0, 0) })
      middle.addView(card, LinearLayout.LayoutParams(match, wrap).apply { topMargin = dp(context, 22f) })
    }

    // Today: three tiles.
    val tiles = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
    val time = statTile(context, I_TIME, focused(), "School time", BLUE, "#EAF0FF")
    timer = time.getChildAt(1) as TextView
    val breakName = if (FocusDayState.breaks > 0) "Breaks · ${span(FocusDayState.breakMs)}" else "Breaks"
    val cell = { v: View, gap: Boolean ->
      tiles.addView(v, LinearLayout.LayoutParams(0, wrap, 1f).apply { if (gap) leftMargin = dp(context, 10f) })
    }
    cell(time, false)
    cell(statTile(context, I_CAFE, "${FocusDayState.breaks}", breakName, "#B45309", "#FEF3E2"), true)
    cell(statTile(context, I_EXIT, "${FocusDayState.leftToday()}", "Times left", "#BE123C", "#FFE8EC"), true)
    middle.addView(tiles, LinearLayout.LayoutParams(match, wrap).apply { topMargin = dp(context, if (slot != null) 12f else 26f) })

    if (slot == null) {
      val next = FocusDayState.nextClass()
      val row = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        background = rounded("#FFFFFF", dp(context, 18f), dp(context, 1f), LINE)
        setPadding(dp(context, 12f), dp(context, 12f), dp(context, 14f), dp(context, 12f))
      }
      row.addView(icon(context, I_NEXT, 18f, BLUE).apply { background = rounded(BLUE_SOFT, dp(context, 12f)) },
        LinearLayout.LayoutParams(dp(context, 36f), dp(context, 36f)))
      val texts = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(context, 12f), 0, 0, 0)
      }
      texts.addView(label(context, "Next class", 12f, INK_MUTED, 600).apply { gravity = Gravity.START })
      texts.addView(label(context, next?.title ?: "No more classes today", 15f, INK, 600).apply { gravity = Gravity.START; setPadding(0, dp(context, 2f), 0, 0) })
      row.addView(texts, LinearLayout.LayoutParams(0, wrap, 1f))
      if (next != null) {
        val at = java.text.SimpleDateFormat("h:mm a", java.util.Locale.US).format(java.util.Date(next.start))
        row.addView(label(context, at, 13f, BLUE_DARK, 600).apply {
          background = rounded(BLUE_SOFT, dp(context, 14f))
          setPadding(dp(context, 10f), dp(context, 6f), dp(context, 10f), dp(context, 6f))
        })
      }
      middle.addView(row, LinearLayout.LayoutParams(match, wrap).apply { topMargin = dp(context, 10f) })
    }
    root.addView(middle, LinearLayout.LayoutParams(match, 0, 1f))

    // Actions.
    val primary = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
      background = gradient("#3B6BFF", BLUE, dp(context, 28f))
      elevation = dp(context, 4f).toFloat()
      setOnClickListener { openAnekio(context) }
      addView(label(context, "Open Anekio", 17f, "#FFFFFF", 600))
      addView(icon(context, I_ARROW, 18f, "#FFFFFF").apply { setPadding(dp(context, 8f), 0, 0, 0) })
    }
    root.addView(primary, LinearLayout.LayoutParams(match, dp(context, 56f)))
    if (slot == null || FocusDayState.breakInClass) {
      val brk = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER
        background = rounded("#FFFFFF", dp(context, 28f), dp(context, 1f), LINE)
        setOnClickListener {
          breakRequested = true
          openAnekio(context)
        }
        addView(icon(context, I_CAFE, 18f, "#B45309").apply { setPadding(0, 0, dp(context, 8f), 0) })
        addView(label(context, "Take a break", 17f, INK, 600))
      }
      root.addView(brk, LinearLayout.LayoutParams(match, dp(context, 56f)).apply { topMargin = dp(context, 10f) })
    }
    val foot = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
      setPadding(0, dp(context, 14f), 0, 0)
      addView(icon(context, I_CALL, 13f, INK_MUTED).apply { setPadding(0, 0, dp(context, 6f), 0) })
      addView(label(context, "Calls are never blocked · Your school sees when you leave", 12f, INK_MUTED, 400))
    }
    root.addView(foot, LinearLayout.LayoutParams(match, wrap))

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
