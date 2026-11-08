package expo.modules.classlock

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The school day as the phone sees it, kept natively so it still works with Anekio in the
 * background, swiped away, or after a restart.
 *
 *   off   → nothing (no guard, no notification, Anekio back in Recents)
 *   focus → other apps are covered by the guard
 *   break → phone is free, unless one of the teacher's classes is on: then the break ends by itself
 *
 * JS sends the whole state with setDay(); native may change it (class started during a break,
 * school closed) and tells JS through ClassLockModule.
 */
object FocusDayState {
  data class ClassSlot(val start: Long, val end: Long, val title: String, val subtitle: String)

  private const val PREFS = "anekio.focusDay"
  private const val KEY = "state"

  var status = "off"
  var focusMs = 0L
  var since = 0L
  var closesAt = 0L
  var date = ""
  /** School setting: a break may be taken (and kept) while a class is on. */
  var breakInClass = false
  /** Anekio itself opened another app (WhatsApp, call, camera…): no guard until this time. */
  var passUntil = 0L
  /** When Anekio opened another app today (sent to JS for the log, then cleared). */
  val outside = mutableListOf<Long>()

  private const val PASS_MS = 3 * 60_000L

  fun passActive(now: Long = System.currentTimeMillis()) = status == "focus" && now < passUntil

  /** Anekio opened another app: let it through for a few minutes, and note it. */
  fun startPass(context: Context) {
    if (status != "focus") return
    val now = System.currentTimeMillis()
    passUntil = now + PASS_MS
    outside.add(now)
    save(context)
    handler.postDelayed({ ClassLockOverlay.refresh(context) }, PASS_MS + 500)
  }

  fun endPass() {
    passUntil = 0L
  }

  /** JS has logged these "opened from Anekio" times. */
  fun clearOutside(context: Context, upTo: Long) {
    outside.removeAll { it <= upTo }
    save(context)
  }
  var classes: List<ClassSlot> = emptyList()

  /** Set when native changed the state on its own; JS reads it with getDay(). */
  @Volatile var changedByPhone: String? = null

  private val handler = Handler(Looper.getMainLooper())
  private var appContext: Context? = null

  private fun today() = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

  fun classNow(now: Long = System.currentTimeMillis()) = classes.firstOrNull { now >= it.start && now < it.end }

  fun toJson(): String = JSONObject()
    .put("status", status).put("focusMs", focusMs).put("since", since).put("closesAt", closesAt).put("date", date)
    .put("breakInClass", breakInClass)
    .put("outside", JSONArray(outside))
    .put("classes", JSONArray(classes.map { JSONObject().put("start", it.start).put("end", it.end).put("title", it.title).put("subtitle", it.subtitle) }))
    .put("changedByPhone", changedByPhone ?: JSONObject.NULL)
    .toString()

  private fun fromJson(raw: String) {
    val o = JSONObject(raw)
    status = o.optString("status", "off")
    focusMs = o.optLong("focusMs", 0)
    since = o.optLong("since", 0)
    closesAt = o.optLong("closesAt", 0)
    date = o.optString("date", "")
    breakInClass = o.optBoolean("breakInClass", false)
    val out = o.optJSONArray("outside")
    if (out != null) {
      outside.clear()
      for (i in 0 until out.length()) outside.add(out.optLong(i))
    }
    val arr = o.optJSONArray("classes") ?: JSONArray()
    classes = (0 until arr.length()).map {
      val c = arr.getJSONObject(it)
      ClassSlot(c.optLong("start"), c.optLong("end"), c.optString("title"), c.optString("subtitle"))
    }
  }

  /** From JS. */
  fun set(context: Context, raw: String) {
    fromJson(raw)
    changedByPhone = null
    save(context)
    apply(context)
  }

  /** After a restart or a fresh process: pick up today's saved day. */
  fun restore(context: Context) {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return
    runCatching { fromJson(raw) }
    if (date != today()) status = "off"
    apply(context)
  }

  private fun save(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, toJson()).apply()
  }

  fun apply(context: Context) {
    val app = context.applicationContext
    appContext = app
    check(app)
    // Anekio always stays in Recents (Play: monitoring apps must never hide). Earlier test builds hid the
    // task during the day; this undoes it on phones that still have it hidden.
    keepInRecents(app)
    val service = Intent(app, FocusDayService::class.java)
    if (status != "off") {
      runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(service) else app.startService(service)
      }
      handler.removeCallbacks(tick)
      handler.postDelayed(tick, 15_000)
    } else {
      runCatching { app.stopService(service) }
      handler.removeCallbacks(tick)
    }
    ClassLockOverlay.refresh(app)
  }

  /** Time-based changes the phone makes by itself. */
  private fun check(context: Context) {
    val now = System.currentTimeMillis()
    if (status != "off" && (date != today() || (closesAt > 0 && now >= closesAt))) {
      if (status == "focus") focusMs += now - since
      status = "off"
      since = now
      changedByPhone = "closed"
      save(context)
    } else if (status == "break" && !breakInClass && classNow(now) != null) {
      status = "focus"
      since = now
      changedByPhone = "class"
      save(context)
    }
  }

  /** "End break" tapped on the break line: back to focus right away (Anekio is told when it comes back). */
  fun endBreakFromPhone(context: Context) {
    if (status != "break") return
    status = "focus"
    since = System.currentTimeMillis()
    changedByPhone = "resumed"
    save(context)
    apply(context)
  }

  private val tick = object : Runnable {
    override fun run() {
      val app = appContext ?: return
      val before = status
      check(app)
      if (before != status) apply(app) else ClassLockOverlay.refresh(app)
      if (status != "off") handler.postDelayed(this, 15_000)
    }
  }

  private fun keepInRecents(context: Context) {
    runCatching {
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      am.appTasks.forEach { it.setExcludeFromRecents(false) }
    }
  }
}
