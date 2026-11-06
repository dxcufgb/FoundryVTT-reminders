/**
 * Optional integration with Dxcufgb's Debug Recorder (module id `dxcufgbs-debug-recorder`).
 *
 * The recorder is NOT a dependency: when it isn't installed or active, nothing here does anything and
 * the module works exactly as without it. While the GM records, the recorder asks for `snapshot()` and
 * collects the breadcrumbs sent through `crumb()`.
 *
 * Privacy: snapshot and breadcrumb data hold only counts, booleans, numbers and this module's own fixed
 * values (reminder kinds, card types, reasons). Never creature, item, actor, token or user names, list
 * entry text (`effect`, `limit`, names, aliases), uuids, image or sound paths, or chat content.
 */

/** Same value as MODULE_ID in reminders.js, which keeps it private (a copy avoids a circular import). */
const MODULE_ID = "dxcufgbs-reminders";
const RECORDER_ID = "dxcufgbs-debug-recorder";

/** The recorder's API once this module registered with it. */
let recorder = null;
/** Builds the snapshot; set from reminders.js on ready. Until then the snapshot only says "not ready". */
let buildSnapshot = () => ({ ready: false });

/** Built-in error classes reported as themselves; anything else (custom classes) becomes "other". */
const ERROR_CODES = new Set([
  "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "AbortError", "TimeoutError",
  "NetworkError", "NotAllowedError", "NotFoundError", "SecurityError", "InvalidStateError"
]);

/** A fixed error code for debug data: a built-in error class name or "other", never a message. */
export function errorCode(err) {
  try {
    const name = err?.name;
    return typeof name === "string" && ERROR_CODES.has(name) ? name : "other";
  } catch {
    return "other"; // e.g. a throwing `name` getter
  }
}

/** The recorder's API: the one registered with, else the installed recorder's (null without one). */
function recorderApi() {
  return recorder ?? game.modules?.get(RECORDER_ID)?.api ?? null;
}

/**
 * Register this module's snapshot with the recorder, once; does nothing for a missing or odd API. The API is kept
 * only when register() succeeds (it returns false on failure), so the fallback on ready can try again.
 */
function register(rec) {
  if (recorder || !rec || typeof rec.register !== "function") return;
  try {
    if (rec.register(MODULE_ID, {
      snapshot: () => {
        try {
          return buildSnapshot();
        } catch (err) {
          return { snapshotFailed: true, error: errorCode(err) };
        }
      }
    }) !== false) recorder = rec;
  } catch (err) {
    console.debug(`${MODULE_ID} | debug recorder registration failed`, err);
  }
}

// The recorder may become ready before or after this module; either way it is registered once.
Hooks.once(`${RECORDER_ID}.ready`, rec => register(rec));

/**
 * Called from this module's ready hook: sets the snapshot builder and registers with a recorder that was
 * ready before this module.
 * @param {() => object} snapshot  returns plain JSON-serialisable data
 */
export function registerDebugRecorder(snapshot) {
  if (typeof snapshot === "function") buildSnapshot = snapshot;
  register(game.modules?.get(RECORDER_ID)?.api);
}

/**
 * Leave a breadcrumb while the recorder records; a no-op otherwise. Never throws.
 * @param {string} key   dot-namespaced, e.g. "card.post"
 * @param {object} [data] small, flat, no names, uuids or free text
 */
export function crumb(key, data) {
  try {
    const rec = recorderApi();
    if (rec?.isRecording?.()) rec.breadcrumb(MODULE_ID, key, data);
  } catch (err) {
    // A recorder problem must never break the reminders.
  }
}
