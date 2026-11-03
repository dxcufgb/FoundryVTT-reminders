/**
 * Dxcufgb's Reminders (dxcufgbs-reminders)
 * Foundry VTT V13. Built for dnd5e (4.x / 5.x); other systems get name-based matching only.
 *
 * Keeps legendary actions, villain actions, lair actions and legendary resistances in the GM's chat
 * at the right moments:
 *   - After a player character's turn: one card listing every NPC in combat that still has
 *     legendary points left, with its legendary and villain actions, the cost of each and how many
 *     points remain. "Use an Action" expands native Use buttons (item.use()), so points are spent
 *     through the system's own pipeline.
 *   - Villain actions can be used once per combat each (used ones are left off later cards).
 *     The module spends no legendary points for them; Use runs the item's own pipeline.
 *   - Lair actions (2014 rules): a card when the turn order passes the lair's initiative count.
 *     In dnd5e the creature's lair setting (resources.lair.value) must be on.
 *   - Legendary resistance: a whisper when a creature fails a saving throw and still has uses left,
 *     with a button that spends one.
 *   - When hit (dnd5e): a whisper when a creature with a "hit" trait (Heated Body, Parry, Rust Metal...)
 *     is hit by an attack, read from the attack roll's chat message (its targets and their AC). Entries
 *     trigger on melee hits, or on any hit with attack: "any".
 *   - Death triggers: a whisper (with its own sound) when a creature with a "death" feature (Undead
 *     Fortitude, Death Burst, Relentless Endurance...) drops to 0 HP. HP comes from the HpPath setting or
 *     the system's primary token attribute, so this works in any system. This used to be the separate
 *     Death Trigger Alerts module (dxcufgbs-death-trigger): while that module is still on, these cards
 *     wait, and on the first start its world list is moved into the Reminder list once.
 *
 * What counts as a reminder action:
 *   - dnd5e items whose activation is "legendary" or "lair" (setting "Also detect by activation type").
 *   - Items whose name matches an entry in the world's Reminder list (a world setting, filled from
 *     data/reminders.json: the legendary and lair actions of the 2014 and 2024 Monster Manuals).
 *     In dnd5e a list match for a legendary or lair entry also needs a legendary or lair activation,
 *     so a creature's ordinary "Bite" doesn't count just because the vampire's legendary Bite is listed.
 *   - Items named "... Villain Action ..." and list entries of kind "villain".
 *   - List entries of kind "hit" (traits like Heated Body): matched by name, no activation needed; the
 *     entry's optional `activation` and `requires` (description text) tell same-named features apart.
 *   - List entries of kind "death": matched by name, no activation needed.
 *   - The item's own setting wins: sheet header button "Reminder" -> Automatic / Legendary / Villain /
 *     Lair / When hit / Death trigger / Never, or item.setFlag("dxcufgbs-reminders", "kind",
 *     "legendary" | "villain" | "lair" | "hit" | "death" | "none"). The old Death Trigger Alerts flag
 *     (flags["dxcufgbs-death-trigger"].trigger true / false) still counts when this one isn't set.
 *
 * API: game.modules.get("dxcufgbs-reminders").api (set on ready)
 *   .findReminders(actor)          -> [{ item, kind, cost, entry }] (cost defaults to 1, entry may be null)
 *   .kindOf(item)                  -> { kind, reason, entry, cost }
 *   .legendaryPoints(actor)        -> { value, max } | null (system.resources.legact)
 *   .legendaryResistance(actor)    -> { value, max } | null (system.resources.legres)
 *   .getList()                     -> this world's Reminder list | null
 *   .isListed(nameOrItem)          -> boolean
 *   .hpPathFor(actor)              -> the HP path inside actor.system that the death check watches
 *   GM only (players get false / null / nothing):
 *   .remindNow(combat = game.combat) -> Promise<ChatMessage | null>, posts the legendary / villain card now
 *   .deathAlert(actor, items?)     -> Promise<ChatMessage | null>, posts the death trigger card now
 *                                     (items: Item[] or findReminders() results; default: its death triggers)
 *   .addToList(itemOrName, kind?)  -> Promise<boolean>
 *   .removeFromList(nameOrItem)    -> Promise<boolean>
 *   .configureItem(item)           -> opens the item's Reminder dialog
 *   .exportList()                  -> downloads reminders-<world id>.json
 *   .importList()                  -> Promise<boolean>, file picker and confirmation, replaces the list
 *   .resetList()                   -> Promise<boolean>, replaces the list with the default one (no confirmation)
 *
 * On world start the active GM adds the default list's new entries to the world's list (setting
 * "Add new actions from the default list"). The list's knownDefaults holds the default ids already
 * offered, so actions the GM removed are not added again.
 */

const MODULE_ID = "dxcufgbs-reminders";
const LIST_KEY = "ReminderList";
const DEFAULT_LIST_PATH = `modules/${MODULE_ID}/data/reminders.json`;
const KINDS = ["legendary", "villain", "lair", "hit", "death"];
/** Kinds that need no activation and only count through their own check (attack hit, 0 HP). */
const PASSIVE_KINDS = ["hit", "death"];
const VILLAIN_NAME = /villain\s+action/i;

/** The old Death Trigger Alerts module, now part of this one (its list and item flags are read once). */
const DEATH_MODULE_ID = "dxcufgbs-death-trigger";
const PREV_HP_KEY = "dxrmPrevHp";
/** Death trigger groups as they appear in the default list's deathTriggers (the Trigger.* strings). */
const DEATH_TRIGGERS = [
  "creature_dies_nearby", "you_kill", "marked_target_dies", "ally_or_enemy_zero_hp_nearby",
  "self_would_drop_to_0", "self_dies", "companion_dies", "death_save"
];

/** Lair cards already posted, as "combatId:round". */
const lairDone = new Set();
/** Actors (by uuid) that already got a death card while at 0 HP. Cleared when their HP goes above 0. */
const deathAlerted = new Set();

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

class ExportListMenu extends foundry.applications.api.ApplicationV2 {
  async render() {
    exportList();
    return this;
  }
}

class ImportListMenu extends foundry.applications.api.ApplicationV2 {
  async render() {
    importListFlow();
    return this;
  }
}

Hooks.once("init", () => {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, {
    name: `DXRM.Settings.${key}.Name`,
    hint: `DXRM.Settings.${key}.Hint`,
    scope: "world",
    config: true,
    ...data
  });

  game.settings.register(MODULE_ID, LIST_KEY, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => { listCache = null; }
  });

  // Set once the old Death Trigger Alerts list of this world has been moved into the Reminder list.
  game.settings.register(MODULE_ID, "DeathMigrated", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.registerMenu(MODULE_ID, "ExportList", {
    name: "DXRM.Settings.ExportList.Name",
    label: "DXRM.Settings.ExportList.Label",
    hint: "DXRM.Settings.ExportList.Hint",
    icon: "fa-solid fa-file-export",
    type: ExportListMenu,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "ImportList", {
    name: "DXRM.Settings.ImportList.Name",
    label: "DXRM.Settings.ImportList.Label",
    hint: "DXRM.Settings.ImportList.Hint",
    icon: "fa-solid fa-file-import",
    type: ImportListMenu,
    restricted: true
  });

  reg("LegendaryReminders", { type: Boolean, default: true });
  reg("AfterPcOnly", { type: Boolean, default: true });
  reg("VillainReminders", { type: Boolean, default: true });
  reg("ResistanceReminders", { type: Boolean, default: true });
  reg("LairReminders", { type: Boolean, default: true });
  reg("HitReminders", { type: Boolean, default: true });
  reg("DeathReminders", { type: Boolean, default: true });
  reg("HpPath", { type: String, default: "" });
  reg("DetectByActivation", { type: Boolean, default: true });
  reg("MergeDefaultList", { type: Boolean, default: true });
  reg("IgnorePlayerOwned", { type: Boolean, default: true });
  reg("WhisperGM", { type: Boolean, default: true });
  reg("DeletePrevious", { type: Boolean, default: true });
  reg("Sound", { type: String, default: "sounds/notify.wav", filePicker: "audio" });
  reg("Volume", {
    type: Number,
    default: 0.5,
    range: { min: 0, max: 1, step: 0.05 }
  });
  reg("DeathSound", { type: String, default: "sounds/drums.wav", filePicker: "audio" });
});

Hooks.once("ready", async () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      findReminders, remindNow, legendaryPoints, legendaryResistance, kindOf, configureItem,
      getList, isListed, addToList, removeFromList, exportList, importList: importListFlow, resetList,
      deathAlert, hpPathFor
    };
  }
  try {
    await ensureList();
    await migrateDeathList();
  } catch (err) {
    console.error(`${MODULE_ID} | ensureList`, err);
  }
  if (isResponsibleGM() && deathModuleActive()) ui.notifications.warn(t("Notify.DeathModuleActive"), { permanent: true });
});

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const getProp = (obj, path) => foundry.utils.getProperty(obj, path);
const setting = key => game.settings.get(MODULE_ID, key);
const t = (key, data) => data ? game.i18n.format(`DXRM.${key}`, data) : game.i18n.localize(`DXRM.${key}`);
const DialogV2 = () => foundry.applications.api.DialogV2;

function escapeHTML(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only one client (the active GM) posts the turn cards. */
function isResponsibleGM() {
  return game.user.isGM && (game.users.activeGM?.isSelf ?? true);
}

function whisperTargets() {
  return setting("WhisperGM") ? game.users.filter(u => u.isGM).map(u => u.id) : [];
}

/** { value, max } of a resource pool, or null when the system has none. */
function pool(actor, key) {
  const res = getProp(actor?.system ?? {}, `resources.${key}`);
  if (!res || typeof res !== "object") return null;
  const max = Number(res.max);
  if (!Number.isFinite(max) || max <= 0) return null;
  const value = Number(res.value);
  return { value: Number.isFinite(value) ? value : 0, max };
}

const legendaryPoints = actor => pool(actor, "legact");
const legendaryResistance = actor => pool(actor, "legres");

function displayName(actor) {
  return actor?.token?.name ?? actor?.getActiveTokens?.()[0]?.name ?? actor?.name ?? "";
}

function displayImg(actor) {
  return actor?.token?.texture?.src ?? actor?.img ?? "icons/svg/mystery-man.svg";
}

/* -------------------------------------------- */
/*  The Reminder list                           */
/* -------------------------------------------- */

let listCache = null;

function getList() {
  const data = game.settings.get(MODULE_ID, LIST_KEY);
  return data && Array.isArray(data.features) ? data : null;
}

function normalizeName(str) {
  return String(str ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Wing Attack (Costs 2 Actions)" -> "wing attack". */
function withoutParens(str) {
  return str.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

function compileEntry(entry) {
  const aliases = Array.isArray(entry?.aliases) ? entry.aliases : [];
  const names = [entry?.name, ...aliases].map(normalizeName).filter(Boolean);
  return { entry, names, bases: names.map(withoutParens), contains: entry?.match === "contains" };
}

function entryMatches(compiled, itemName) {
  const name = normalizeName(itemName);
  if (!name) return false;
  if (compiled.contains) return compiled.bases.some(b => b && name.includes(b));
  const base = withoutParens(name);
  return compiled.names.some((n, i) => {
    const b = compiled.bases[i];
    return name === n || name === b || (base && (base === n || base === b));
  });
}

function compiledList() {
  listCache ??= (getList()?.features ?? []).map(compileEntry);
  return listCache;
}

const nameOf = nameOrItem => typeof nameOrItem === "string" ? nameOrItem : nameOrItem?.name;

function findEntries(nameOrItem) {
  const name = nameOf(nameOrItem);
  return compiledList().filter(c => entryMatches(c, name)).map(c => c.entry);
}

function isListed(nameOrItem) {
  const name = nameOf(nameOrItem);
  return compiledList().some(c => entryMatches(c, name));
}

async function saveList(data) {
  await game.settings.set(MODULE_ID, LIST_KEY, data);
  listCache = null;
}

async function loadDefaultList() {
  try {
    const res = await fetch(foundry.utils.getRoute(DEFAULT_LIST_PATH), { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.features)) throw new Error("no features array");
    return data;
  } catch (err) {
    console.error(`${MODULE_ID} | could not load ${DEFAULT_LIST_PATH}`, err);
    ui.notifications.error(t("Notify.ListLoadFailed"));
    return null;
  }
}

function customEntry(name, { item = null, kind = "legendary" } = {}) {
  const slug = (name.slugify?.({ strict: true }) || "item").slice(0, 40);
  return {
    id: `custom-${slug}-${foundry.utils.randomID(4)}`,
    name: name.trim(),
    kind,
    cost: null,
    edition: "custom",
    source: "custom",
    creatures: item?.actor ? [item.actor.name] : [],
    limit: null,
    effect: "",
    match: "exact",
    confirmed: true,
    addedFrom: item?.uuid ?? null
  };
}

/** Remember every default entry as offered, so a later merge doesn't bring back removed ones. */
function withKnownDefaults(data) {
  data.knownDefaults = data.features.map(f => f?.id).filter(Boolean);
  return data;
}

/**
 * Add the default list's new entries to a world's list. Each default entry (by id) is offered once:
 * entries the GM removed or edited stay that way. Without `knownDefaults` (lists from before this, or
 * imported files) the entries already in the list count as offered.
 * @returns {{data: object, added: object[], changed: boolean}}
 */
function mergeDefaults(current, defaults) {
  const data = foundry.utils.deepClone(current);
  const hadKnown = Array.isArray(data.knownDefaults);
  const known = new Set(hadKnown ? data.knownDefaults : data.features.map(f => f?.id).filter(Boolean));
  const ids = new Set(data.features.map(f => f?.id).filter(Boolean));
  const sameEntry = entry => data.features.some(f =>
    normalizeName(f?.name) === normalizeName(entry.name) && (f?.kind ?? "legendary") === (entry.kind ?? "legendary"));

  const added = [];
  for (const entry of defaults?.features ?? []) {
    if (!entry?.id || typeof entry.name !== "string" || known.has(entry.id)) continue;
    known.add(entry.id);
    // Already there (same id, or the GM added the same action by hand): nothing to add.
    if (ids.has(entry.id) || sameEntry(entry)) continue;
    const copy = foundry.utils.deepClone(entry);
    data.features.push(copy);
    added.push(copy);
  }

  let kindsAdded = false;
  if (defaults?.kinds && typeof defaults.kinds === "object") {
    data.kinds = data.kinds && typeof data.kinds === "object" ? data.kinds : {};
    for (const [key, text] of Object.entries(defaults.kinds)) {
      if (!(key in data.kinds)) {
        data.kinds[key] = text;
        kindsAdded = true;
      }
    }
  }

  const knownChanged = !hadKnown || known.size !== data.knownDefaults.length;
  data.knownDefaults = [...known];
  return { data, added, changed: added.length > 0 || kindsAdded || knownChanged };
}

/** On world start: create the list from the default one, or add the default list's new entries to it. */
async function ensureList() {
  if (!isResponsibleGM()) return;
  const current = getList();
  if (current && !setting("MergeDefaultList")) return;

  const defaults = await loadDefaultList();
  if (!defaults) return;
  if (!current) {
    await saveList(withKnownDefaults(defaults));
    ui.notifications.info(t("Notify.ListCreated", { count: defaults.features.length }));
    return;
  }

  const { data, added, changed } = mergeDefaults(current, defaults);
  if (!changed) return;
  await saveList(data);
  if (added.length) {
    ui.notifications.info(t("Notify.ListMerged", { count: added.length, names: added.map(e => e.name).join(", ") }));
  }
}

/** Is the old Death Trigger Alerts module still on? It posts its own death cards, so ours wait. */
function deathModuleActive() {
  return !!game.modules.get(DEATH_MODULE_ID)?.active;
}

/** A world setting stored by another (possibly disabled) module, parsed, or null. */
function storedWorldSetting(key) {
  try {
    const doc = game.settings.storage.get("world")?.getSetting?.(key);
    if (!doc) return null;
    let value = doc.value;
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { return null; }
    }
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Once per world: move the old Death Trigger Alerts list into the Reminder list. The GM's own entries
 * come over as death triggers, and default death triggers the GM had removed there are removed here too
 * (they are already in knownDefaults, so they don't come back). Item flags of the old module are read
 * directly by kindOf, so they need no migration.
 */
async function migrateDeathList() {
  if (!isResponsibleGM() || setting("DeathMigrated")) return;
  const current = getList();
  if (!current) return; // no list yet (the default list failed to load): try again on the next start

  const old = storedWorldSetting(`${DEATH_MODULE_ID}.TriggerList`);
  if (Array.isArray(old?.features)) {
    const defaults = await loadDefaultList();
    if (!defaults) return;
    const data = foundry.utils.deepClone(current);
    const oldIds = new Set(old.features.map(f => f?.id).filter(Boolean));
    const oldVersion = Number.isInteger(Number(old.version)) && Number(old.version) > 0 ? Number(old.version) : 1;
    const defaultDeath = defaults.features.filter(f => f?.kind === "death" && String(f.id ?? "").startsWith("death-"));
    const oldIdOf = entry => entry.id.slice("death-".length);
    const defaultOldIds = new Set(defaultDeath.map(oldIdOf));

    // Default death triggers that the old list had been offered but no longer has: the GM removed them.
    const removed = new Set(defaultDeath
      .filter(f => !oldIds.has(oldIdOf(f)) && (Number(f.deathListVersion) || 1) <= oldVersion)
      .map(f => f.id));
    const before = data.features.length;
    data.features = data.features.filter(f => !removed.has(f?.id));
    const removedCount = before - data.features.length;

    // Everything else in the old list (added from items, imported) comes over as a death trigger.
    const added = [];
    for (const entry of old.features) {
      if (!entry || typeof entry !== "object" || typeof entry.name !== "string" || !entry.name.trim()) continue;
      if (entry.id && defaultOldIds.has(entry.id)) continue;
      const id = `death-${entry.id ?? foundry.utils.randomID(8)}`;
      const exists = data.features.some(f => f?.id === id
        || (f?.kind === "death" && normalizeName(f?.name) === normalizeName(entry.name)));
      if (exists) continue;
      const copy = foundry.utils.deepClone(entry);
      copy.featureType = copy.type ?? null;
      delete copy.type;
      delete copy.listVersion;
      Object.assign(copy, { id, kind: "death", cost: null, creatures: copy.owner ? [copy.owner] : [] });
      data.features.push(copy);
      added.push(copy.name);
    }

    if (removedCount || added.length) {
      await saveList(data);
      ui.notifications.info(t("Notify.DeathMigrated", { added: added.length, removed: removedCount }));
    }
  }
  await game.settings.set(MODULE_ID, "DeathMigrated", true);
}

async function addToList(item, kind) {
  if (!game.user.isGM) return false;
  const name = String(nameOf(item) ?? "").trim();
  if (!name || isListed(name)) return false;

  const realItem = typeof item === "string" ? null : item;
  kind ??= (realItem && activationKind(realItem)?.kind) ?? (VILLAIN_NAME.test(name) ? "villain" : "legendary");
  const data = foundry.utils.deepClone(getList()) ?? await loadDefaultList() ?? { version: 1, kinds: {}, features: [] };
  data.features.push(customEntry(name, { item: realItem, kind }));

  await saveList(data);
  ui.notifications.info(t("Notify.Added", { item: name }));
  return true;
}

/** Remove entries with this name (exact ones first; "contains" ones only if no exact entry matched). */
async function removeFromList(nameOrItem) {
  if (!game.user.isGM) return false;
  const name = nameOf(nameOrItem);
  const current = getList();
  if (!name || !current) return false;

  const data = foundry.utils.deepClone(current);
  const before = data.features.length;
  const matching = data.features.map(compileEntry).filter(c => entryMatches(c, name));
  const exact = matching.filter(c => !c.contains);
  const doomed = new Set((exact.length ? exact : matching).map(c => c.entry.id ?? c.entry));
  data.features = data.features.filter(entry => !doomed.has(entry.id ?? entry));
  if (data.features.length === before) return false;

  await saveList(data);
  ui.notifications.info(t("Notify.Removed", { item: name }));
  return true;
}

function exportList() {
  if (!game.user.isGM) return;
  const data = getList();
  if (!data) {
    ui.notifications.warn(t("Notify.NoList"));
    return;
  }
  const file = `reminders-${game.world.id}.json`;
  foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", file);
  ui.notifications.info(t("Notify.Exported", { file, count: data.features.length }));
}

function validateImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t("Import.NotJson"));
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.features)) {
    throw new Error(t("Import.NoFeatures"));
  }
  const bad = data.features.findIndex(f => !f || typeof f !== "object" || typeof f.name !== "string" || !f.name.trim());
  if (bad !== -1) throw new Error(t("Import.BadEntry", { index: bad + 1 }));
  return data;
}

async function pickImportFile() {
  return DialogV2().wait({
    window: { title: t("Import.Title"), icon: "fa-solid fa-file-import" },
    content: `
      <div class="dxrm-import">
        <p>${t("Import.Choose")}</p>
        <div class="form-group">
          <input type="file" name="file" accept=".json,application/json">
        </div>
      </div>`,
    rejectClose: false,
    buttons: [
      {
        action: "next",
        label: t("Import.Next"),
        icon: "fa-solid fa-arrow-right",
        default: true,
        callback: async (event, button) => {
          const file = button.form.elements.file.files?.[0];
          if (!file) {
            ui.notifications.warn(t("Import.NoFile"));
            return null;
          }
          return { name: file.name, text: await foundry.utils.readTextFromFile(file) };
        }
      },
      { action: "cancel", label: game.i18n.localize("Cancel"), icon: "fa-solid fa-xmark" }
    ]
  });
}

async function importListFlow() {
  if (!game.user.isGM) return false;
  const picked = await pickImportFile();
  if (!picked || typeof picked !== "object") return false;

  let data;
  try {
    data = validateImport(picked.text);
  } catch (err) {
    ui.notifications.error(t("Import.Failed", { error: err.message }));
    return false;
  }

  const currentCount = getList()?.features.length ?? 0;
  const answer = await DialogV2().wait({
    window: { title: t("Import.ConfirmTitle"), icon: "fa-solid fa-triangle-exclamation" },
    content: `
      <div class="dxrm-import-warning">
        <p>${t("Import.Warning", { file: escapeHTML(picked.name), count: data.features.length, current: currentCount })}</p>
        <p><strong>${t("Import.Irreversible")}</strong></p>
        <p>${t("Import.Question")}</p>
      </div>`,
    rejectClose: false,
    buttons: [
      { action: "yes", label: t("Import.Yes"), icon: "fa-solid fa-check" },
      { action: "no", label: t("Import.No"), icon: "fa-solid fa-xmark", default: true }
    ]
  });
  if (answer !== "yes") return false;

  await saveList(data);
  ui.notifications.info(t("Import.Done", { file: picked.name, count: data.features.length }));
  return true;
}

async function resetList() {
  if (!game.user.isGM) return false;
  const data = await loadDefaultList();
  if (!data) return false;
  await saveList(withKnownDefaults(data));
  ui.notifications.info(t("Notify.ListCreated", { count: data.features.length }));
  return true;
}

/* -------------------------------------------- */
/*  Classification                              */
/* -------------------------------------------- */

/** dnd5e activities of an item (4.x+), as an array. */
function activitiesOf(item) {
  const acts = item?.system?.activities;
  if (!acts) return [];
  return typeof acts.values === "function" ? [...acts.values()] : Object.values(acts);
}

/** Does this system describe activations at all (dnd5e)? */
function systemHasActivations(item) {
  return !!item?.system?.activities || !!item?.system?.activation;
}

/**
 * The legendary / lair activation of an item and its cost, from dnd5e data.
 * @returns {{kind: "legendary"|"lair", cost: number|null}|null}
 */
function activationKind(item) {
  for (const act of activitiesOf(item)) {
    const type = act?.activation?.type;
    if (type === "legendary" || type === "lair") {
      const cost = Number(act.activation.value);
      return { kind: type, cost: Number.isFinite(cost) && cost > 0 ? cost : null };
    }
  }
  const legacy = item?.system?.activation; // dnd5e 3.x
  if (legacy?.type === "legendary" || legacy?.type === "lair") {
    const cost = Number(legacy.cost);
    return { kind: legacy.type, cost: Number.isFinite(cost) && cost > 0 ? cost : null };
  }
  return null;
}

/** The item's description as plain lower-case text, or null when the system has none. */
function descriptionText(item) {
  const desc = item?.system?.description;
  const html = typeof desc === "string" ? desc : desc?.value;
  if (typeof html !== "string" || !html.trim()) return null;
  return normalizeName(html.replace(/<[^>]*>/g, " "));
}

/**
 * Does a "hit" entry apply to this item? Optional entry fields narrow same-named features of other editions:
 * `activation` (dnd5e activation type the item must have, e.g. "reaction") and
 * `requires` (text the item's description must contain, e.g. "melee attack").
 */
function hitEntryApplies(entry, item) {
  if (entry.activation && systemHasActivations(item)) {
    const types = activitiesOf(item).map(a => a?.activation?.type);
    if (item?.system?.activation?.type) types.push(item.system.activation.type);
    if (!types.includes(entry.activation)) return false;
  }
  if (entry.requires) {
    const text = descriptionText(item);
    if (text !== null && !text.includes(normalizeName(entry.requires))) return false;
  }
  return true;
}

/** Does a "hit" reminder trigger on this attack? Entries with attack "any" trigger on ranged hits too. */
function hitTriggers(option, melee) {
  return melee || option.entry?.attack === "any";
}

/** Best list entry for this item: one that names the creature first. */
function bestEntry(entries, actor) {
  if (!entries.length) return null;
  const who = normalizeName(actor?.name);
  return entries.find(e => (e.creatures ?? []).some(c => normalizeName(c) === who)) ?? entries[0];
}

/**
 * What kind of reminder action is this item, and why?
 * @returns {{kind: string|null, reason: string, entry?: object, cost?: number|null}}
 *   reason: "flag" | "never" | "villain" | "activation" | "list" | "none"
 */
function kindOf(item) {
  const flag = item?.getFlag?.(MODULE_ID, "kind");
  const act = activationKind(item);
  const entries = findEntries(item?.name);
  const entriesOf = kind => entries.filter(e => e.kind === kind);
  // "hit" and "death" entries only count through their own checks below, never as a legendary / lair fallback.
  const entry = bestEntry(entries.filter(e => !PASSIVE_KINDS.includes(e.kind)), item?.actor);

  if (flag === "none") return { kind: null, reason: "never" };
  if (PASSIVE_KINDS.includes(flag)) {
    return { kind: flag, reason: "flag", entry: bestEntry(entriesOf(flag), item?.actor), cost: null };
  }
  if (KINDS.includes(flag)) return { kind: flag, reason: "flag", entry, cost: act?.cost ?? entry?.cost ?? null };

  // The old Death Trigger Alerts item setting: true = always a death trigger, false = never one.
  const oldDeath = oldDeathFlag(item);
  if (oldDeath === true) {
    return { kind: "death", reason: "flag", entry: bestEntry(entriesOf("death"), item?.actor), cost: null };
  }

  const villainEntry = entries.find(e => e.kind === "villain");
  if (VILLAIN_NAME.test(item?.name ?? "") || villainEntry) {
    return { kind: "villain", reason: "villain", entry: villainEntry ?? entry, cost: act?.cost ?? (villainEntry ?? entry)?.cost ?? null };
  }

  // Traits that trigger when the creature is hit (Heated Body) need no activation, only the entry's own
  // checks. A legendary or lair activation wins (the 2014 Mummy Lord's legendary Whirlwind of Sand).
  const hitEntries = entries.filter(e => e.kind === "hit" && hitEntryApplies(e, item));
  if (hitEntries.length && !act) {
    return { kind: "hit", reason: "list", entry: bestEntry(hitEntries, item?.actor), cost: null };
  }

  // Death triggers (Undead Fortitude, Death Burst) need no activation either; checked at 0 HP.
  const deathEntries = entriesOf("death");
  if (deathEntries.length && !act && oldDeath !== false) {
    return { kind: "death", reason: "list", entry: bestEntry(deathEntries, item?.actor), cost: null };
  }

  if (act && setting("DetectByActivation")) {
    return { kind: act.kind, reason: "activation", entry, cost: act.cost ?? entry?.cost ?? null };
  }

  if (entry) {
    // In dnd5e a listed legendary / lair name also needs that activation (generic names like "Bite").
    const listed = act ? entries.find(e => e.kind === act.kind) : null;
    if (systemHasActivations(item)) {
      if (listed) return { kind: act.kind, reason: "list", entry: listed, cost: act.cost ?? listed.cost ?? null };
      return { kind: null, reason: "none" };
    }
    return { kind: entry.kind ?? "legendary", reason: "list", entry, cost: entry.cost ?? null };
  }
  return { kind: null, reason: "none" };
}

/** The old Death Trigger Alerts flag on an item (read without getFlag: that module may be disabled). */
function oldDeathFlag(item) {
  const value = getProp(item ?? {}, `flags.${DEATH_MODULE_ID}.trigger`);
  return typeof value === "boolean" ? value : undefined;
}

/** All reminder actions on an actor. */
function findReminders(actor) {
  if (!actor?.items) return [];
  const out = [];
  for (const item of actor.items) {
    const status = kindOf(item);
    if (status.kind) out.push({ item, kind: status.kind, cost: status.cost ?? 1, entry: status.entry ?? null });
  }
  return out;
}

/* -------------------------------------------- */
/*  Villain actions: once per combat            */
/* -------------------------------------------- */

const VILLAIN_FLAG = "villainUsed";

function villainUsed(combat, item) {
  if (!combat || !item) return false;
  const used = combat.getFlag(MODULE_ID, VILLAIN_FLAG) ?? {};
  return !!used[villainKey(item)];
}

function villainKey(item) {
  return (item.uuid ?? `${item.actor?.uuid}.${item.id}`).replace(/\./g, "_");
}

async function markVillainUsed(item, combat = game.combat) {
  if (!combat || !item || !game.user.isGM) return;
  if (villainUsed(combat, item)) return;
  await combat.setFlag(MODULE_ID, VILLAIN_FLAG, { [villainKey(item)]: true });
}

/** Mark villain actions as used when they are used from anywhere (sheet, card, macro). */
Hooks.on("dnd5e.postUseActivity", activity => {
  try {
    const item = activity?.item;
    if (!item || !game.user.isGM) return;
    if (kindOf(item).kind !== "villain") return;
    const combat = game.combats?.find(c => c.combatants.some(cb => cb.actor?.uuid === item.actor?.uuid)) ?? game.combat;
    markVillainUsed(item, combat);
  } catch (err) {
    console.error(`${MODULE_ID} | postUseActivity`, err);
  }
});

/* -------------------------------------------- */
/*  Context menus: Add / Remove                 */
/* -------------------------------------------- */

const MENU_ADD = "DXRM.Context.Add";
const MENU_ADD_DEATH = "DXRM.Context.AddDeath";
const MENU_REMOVE = "DXRM.Context.Remove";

const elementOf = li => (li?.dataset ? li : li?.[0]) ?? null;

function listMenuOptions(resolve) {
  const target = li => {
    try {
      return resolve(li);
    } catch {
      return null;
    }
  };
  return [
    {
      name: MENU_ADD,
      icon: '<i class="fa-solid fa-crown"></i>',
      condition: li => {
        const tg = game.user.isGM && target(li);
        return !!tg?.name && !isListed(tg.name);
      },
      callback: async li => {
        const tg = target(li);
        if (!tg) return;
        const item = await tg.get?.().catch?.(() => null) ?? null;
        await addToList(item ?? tg.name);
      }
    },
    {
      name: MENU_ADD_DEATH,
      icon: '<i class="fa-solid fa-skull"></i>',
      condition: li => {
        const tg = game.user.isGM && target(li);
        return !!tg?.name && !isListed(tg.name);
      },
      callback: async li => {
        const tg = target(li);
        if (!tg) return;
        const item = await tg.get?.().catch?.(() => null) ?? null;
        await addToList(item ?? tg.name, "death");
      }
    },
    {
      name: MENU_REMOVE,
      icon: '<i class="fa-solid fa-crown"></i>',
      condition: li => {
        const tg = game.user.isGM && target(li);
        return !!tg?.name && isListed(tg.name);
      },
      callback: async li => {
        const tg = target(li);
        if (tg) await removeFromList(tg.name);
      }
    }
  ];
}

function addMenuOptions(options, resolve) {
  if (!Array.isArray(options) || options.some(o => o?.name === MENU_ADD)) return;
  options.push(...listMenuOptions(resolve));
}

function resolveDirectoryEntry(app, li) {
  const el = elementOf(li);
  if (!el?.dataset) return null;
  const id = el.dataset.entryId ?? el.dataset.documentId ?? el.dataset.itemId;
  const collection = app?.collection;

  if (id && collection?.metadata && collection.documentName === "Item") {
    const entry = collection.index?.get(id);
    return entry ? { name: entry.name, get: () => collection.getDocument(id) } : null;
  }
  if (id && (collection?.documentName === "Item" || app?.documentName === "Item")) {
    const item = game.items.get(id);
    return item ? { name: item.name, get: async () => item } : null;
  }
  const uuid = el.dataset.uuid ?? el.closest?.("[data-uuid]")?.dataset.uuid;
  const doc = uuid ? fromUuidSync(uuid) : null;
  if (doc?.documentName !== "Item" && !(doc instanceof Item)) return null;
  return { name: doc.name, get: async () => (doc instanceof Item ? doc : fromUuid(uuid)) };
}

for (const hook of [
  "getItemContextOptions",
  "getItemDirectoryEntryContext",
  "getCompendiumEntryContext",
  "getCompendiumContextOptions"
]) {
  Hooks.on(hook, (app, options) => addMenuOptions(options, li => resolveDirectoryEntry(app, li)));
}

Hooks.on("dnd5e.getItemContextOptions", (item, options) => {
  if (!(item instanceof Item)) return;
  addMenuOptions(options, () => ({ name: item.name, get: async () => item }));
});

/* -------------------------------------------- */
/*  Item sheet dialog and card exclusion        */
/* -------------------------------------------- */

function statusText(status) {
  if (status.reason === "never") return t("Status.never");
  if (!status.kind) return t("Status.none");
  return t(`Status.${status.reason}`, { kind: t(`Kind.${status.kind}`), detail: escapeHTML(status.entry?.name ?? "") });
}

async function configureItem(item) {
  if (!game.user.isGM || !item) return;
  const flag = item.getFlag(MODULE_ID, "kind");
  const oldDeath = oldDeathFlag(item);
  const current = flag === "none" ? "never" : KINDS.includes(flag) ? flag : oldDeath === true ? "death" : "auto";

  // What would happen without the item's own setting?
  const auto = kindOf({ name: item.name, actor: item.actor, system: item.system, getFlag: () => undefined });
  const opt = (value, label) =>
    `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;

  const mode = await DialogV2().wait({
    window: { title: t("Item.Title"), icon: "fa-solid fa-crown" },
    content: `
      <div class="dxrm-config">
        <p>${t("Item.Intro", { item: escapeHTML(item.name) })}</p>
        <div class="form-group">
          <label for="dxrm-mode">${t("Item.Mode")}</label>
          <select id="dxrm-mode" name="mode">
            ${opt("auto", t("Item.Auto"))}
            ${opt("legendary", t("Kind.legendary"))}
            ${opt("villain", t("Kind.villain"))}
            ${opt("lair", t("Kind.lair"))}
            ${opt("hit", t("Kind.hit"))}
            ${opt("death", t("Kind.death"))}
            ${opt("never", t("Item.Never"))}
          </select>
        </div>
        <p class="hint">${t("Item.AutoResult")} ${statusText(auto)}</p>
      </div>`,
    rejectClose: false,
    buttons: [
      {
        action: "save",
        label: t("Item.Save"),
        icon: "fa-solid fa-check",
        default: true,
        callback: (event, button) => button.form.elements.mode.value
      },
      { action: "cancel", label: game.i18n.localize("Cancel"), icon: "fa-solid fa-xmark" }
    ]
  });
  if (!mode || mode === "cancel" || (mode === current && oldDeath === undefined)) return;

  // Saving replaces the old Death Trigger Alerts setting of the item, if it has one.
  const update = mode === "auto"
    ? { [`flags.${MODULE_ID}.-=kind`]: null }
    : { [`flags.${MODULE_ID}.kind`]: mode === "never" ? "none" : mode };
  if (oldDeath !== undefined) update[`flags.${DEATH_MODULE_ID}.-=trigger`] = null;
  await item.update(update);
  ui.notifications.info(t("Notify.Set", { item: item.name }));
}

async function excludeFromCard(item) {
  const actor = item.actor;
  const baseActor = actor?.isToken ? game.actors.get(actor.id) : null;
  const baseItem = baseActor?.items.get(item.id) ?? null;

  const buttons = [];
  if (actor?.isToken) buttons.push({ action: "token", label: t("Exclude.Token"), icon: "fa-solid fa-user" });
  if (!actor?.isToken || baseItem) {
    buttons.push({ action: "actor", label: t("Exclude.Actor", { actor: (baseActor ?? actor)?.name ?? "" }), icon: "fa-solid fa-users" });
  }
  if (isListed(item.name)) {
    buttons.push({ action: "name", label: t("Exclude.Name", { item: item.name }), icon: "fa-solid fa-globe" });
  }
  buttons.push({ action: "cancel", label: game.i18n.localize("Cancel"), icon: "fa-solid fa-xmark", default: true });

  const choice = await DialogV2().wait({
    window: { title: t("Exclude.Title"), icon: "fa-solid fa-ban" },
    content: `<p>${t("Exclude.Question", { item: escapeHTML(item.name) })}</p>
              <p class="hint">${t("Exclude.Hint")}</p>`,
    classes: ["dxrm-exclude-dialog"],
    rejectClose: false,
    buttons
  });
  if (!choice || choice === "cancel") return false;

  if (choice === "token") await item.setFlag(MODULE_ID, "kind", "none");
  else if (choice === "actor") await (baseItem ?? item).setFlag(MODULE_ID, "kind", "none");
  else if (choice === "name") await removeFromList(item.name);
  if (choice !== "name") {
    ui.notifications.info(t(`Exclude.Done.${choice}`, { item: item.name, actor: (baseActor ?? actor)?.name ?? "" }));
  }
  return true;
}

Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const item = app.document;
  if (!game.user.isGM || !(item instanceof Item)) return;
  if (controls.some(c => c.action === "dxrmConfigure")) return;
  app.options.actions ??= {};
  app.options.actions.dxrmConfigure = function () { configureItem(this.document); };
  controls.push({ action: "dxrmConfigure", icon: "fa-solid fa-crown", label: t("Item.Title") });
});

Hooks.on("getItemSheetHeaderButtons", (app, buttons) => {
  if (!game.user.isGM || !(app.document instanceof Item)) return;
  buttons.unshift({
    label: t("Item.Title"),
    class: "dxrm-configure",
    icon: "fa-solid fa-crown",
    onclick: () => configureItem(app.document)
  });
});

/* -------------------------------------------- */
/*  Turn detection                              */
/* -------------------------------------------- */

function eligibleCombatants(combat) {
  const ignorePlayers = setting("IgnorePlayerOwned");
  return combat.combatants.filter(c => c.actor && !c.isDefeated && !(ignorePlayers && c.actor.hasPlayerOwner));
}

/** A player character's combatant: owned by a player. */
const isPcCombatant = c => !!c?.actor?.hasPlayerOwner || !!c?.hasPlayer;

// Foundry V13: fires on every client after the turn or round changes.
Hooks.on("combatTurnChange", (combat, prior, current) => {
  try {
    onTurnChange(combat, prior, current);
  } catch (err) {
    console.error(`${MODULE_ID} | combatTurnChange`, err);
  }
});

function onTurnChange(combat, prior, current) {
  if (!isResponsibleGM() || !combat?.started) return;
  // Only forward movement; skip going back a turn.
  const forward = (current.round > prior.round) || (current.round === prior.round && current.turn > prior.turn);
  if (!forward) return;

  const priorCombatant = prior.combatantId ? combat.combatants.get(prior.combatantId) : null;
  const currentCombatant = current.combatantId ? combat.combatants.get(current.combatantId) : null;

  if (setting("LairReminders")) checkLair(combat, prior, current, priorCombatant, currentCombatant);

  if (!setting("LegendaryReminders") && !setting("VillainReminders")) return;
  if (!priorCombatant) return;
  if (setting("AfterPcOnly") && !isPcCombatant(priorCombatant)) return;
  postTurnCard(combat, priorCombatant);
}

/**
 * Collect what each eligible NPC can do right now.
 * @param {Combat} combat
 * @param {Combatant|null} priorCombatant  whose turn just ended (it can't act right after its own turn)
 */
function gatherTurnOptions(combat, priorCombatant = null) {
  const groups = [];
  const wantLegendary = setting("LegendaryReminders");
  const wantVillain = setting("VillainReminders");

  for (const combatant of eligibleCombatants(combat)) {
    if (priorCombatant && combatant.actor === priorCombatant.actor) continue;
    const actor = combatant.actor;
    const points = legendaryPoints(actor);
    const options = findReminders(actor).filter(r => {
      if (r.kind === "legendary") return wantLegendary;
      if (r.kind === "villain") return wantVillain && !villainUsed(combat, r.item);
      return false;
    });
    if (!options.length) continue;
    // With a legendary pool: only when points remain. Without one (other systems): always remind.
    if (points && points.value <= 0) continue;
    if (points && !options.some(o => o.cost <= points.value)) continue;
    groups.push({ combatant, actor, points, options });
  }
  return groups;
}

async function postTurnCard(combat, priorCombatant) {
  const groups = gatherTurnOptions(combat, priorCombatant);
  if (!groups.length) return null;
  await deletePrevious(combat, "turn");

  const after = priorCombatant ? t("Chat.After", { name: escapeHTML(priorCombatant.token?.name ?? priorCombatant.name) }) : "";
  const content = `
    <div class="dxrm-card dxrm-turn">
      <h3 class="dxrm-title"><i class="fa-solid fa-crown"></i> ${t("Chat.TurnTitle")}</h3>
      ${after ? `<p class="dxrm-text">${after}</p>` : ""}
      ${groups.map(renderGroup).join("")}
    </div>`;

  return ChatMessage.implementation.create({
    content,
    speaker: { alias: t("Chat.Speaker") },
    whisper: whisperTargets(),
    flags: {
      [MODULE_ID]: {
        card: "turn",
        combatId: combat.id,
        round: combat.round,
        actorUuids: groups.map(g => g.actor.uuid)
      }
    }
  });
}

function pointsLabel(points) {
  return points ? t("Chat.Points", { value: points.value, max: points.max }) : "";
}

function resistanceLabel(actor) {
  const res = legendaryResistance(actor);
  return res ? t("Chat.Resistance", { value: res.value, max: res.max }) : "";
}

function renderGroup({ actor, points, options }) {
  const rows = options.map(o => renderOption(actor, o)).join("");
  const res = resistanceLabel(actor);
  return `
    <div class="dxrm-group" data-actor-uuid="${escapeHTML(actor.uuid)}">
      <div class="dxrm-header">
        <img src="${escapeHTML(displayImg(actor))}" alt="">
        <div class="dxrm-who">
          <strong>${escapeHTML(displayName(actor))}</strong>
          <span class="dxrm-points" data-points>${pointsLabel(points)}</span>
          ${res ? `<span class="dxrm-res" data-resistance>${res}</span>` : ""}
        </div>
      </div>
      <ul class="dxrm-summary">
        ${options.map(o => `<li class="dxrm-${o.kind}" data-item-uuid="${escapeHTML(o.item.uuid)}">
            ${escapeHTML(o.item.name)} <span class="dxrm-cost">${costText(o)}</span></li>`).join("")}
      </ul>
      <details class="dxrm-use-list">
        <summary>${t("Chat.UseAnAction")}</summary>
        ${rows}
      </details>
    </div>`;
}

function costText(option) {
  if (option.kind === "hit") return t(option.entry?.attack === "any" ? "Chat.OnHit" : "Chat.OnMeleeHit");
  if (option.kind === "death") {
    const trigger = option.entry?.trigger;
    return DEATH_TRIGGERS.includes(trigger) ? t(`Trigger.${trigger}`) : t("Chat.OnDeath");
  }
  const base = t("Chat.Cost", { cost: option.cost });
  return option.kind === "villain" ? `${base} · ${t("Chat.OncePerCombat")}` : base;
}

function renderOption(actor, option) {
  const { item, kind, cost, entry } = option;
  const effect = entry?.effect ? `<div class="dxrm-effect">${escapeHTML(entry.effect)}</div>` : "";
  return `
    <div class="dxrm-option dxrm-${kind}" data-item-uuid="${escapeHTML(item.uuid)}" data-kind="${kind}" data-cost="${cost}">
      <div class="dxrm-row">
        <button type="button" class="dxrm-use" data-item-uuid="${escapeHTML(item.uuid)}">
          <img src="${escapeHTML(item.img)}" alt="">
          <span class="dxrm-name">${escapeHTML(item.name)}</span>
          <span class="dxrm-label" data-label>${costText(option)}</span>
        </button>
        <button type="button" class="dxrm-open" data-item-uuid="${escapeHTML(item.uuid)}"
                data-tooltip="${escapeHTML(t("Chat.Open"))}"><i class="fa-solid fa-book-open"></i></button>
        <button type="button" class="dxrm-exclude" data-item-uuid="${escapeHTML(item.uuid)}"
                data-tooltip="${escapeHTML(t("Chat.Exclude"))}"><i class="fa-solid fa-ban"></i></button>
      </div>
      ${effect}
    </div>`;
}

/** Remove earlier cards of this type for this combat, so only the current one stays in chat. */
async function deletePrevious(combat, card) {
  if (!setting("DeletePrevious")) return;
  const old = game.messages.filter(m => {
    const f = m.flags?.[MODULE_ID];
    return f?.card === card && f.combatId === combat.id;
  });
  if (!old.length) return;
  try {
    await ChatMessage.implementation.deleteDocuments(old.map(m => m.id));
  } catch (err) {
    console.warn(`${MODULE_ID} | could not delete old reminder cards`, err);
  }
}

/** Post the legendary / villain card now (macro / API), regardless of whose turn it was. */
async function remindNow(combat = game.combat) {
  if (!game.user.isGM || !combat) return null;
  const current = combat.combatant ?? null;
  return postTurnCard(combat, current && isPcCombatant(current) ? null : current);
}

/* -------------------------------------------- */
/*  Lair actions (initiative count 20)          */
/* -------------------------------------------- */

function lairInitiative(actor) {
  const n = Number(getProp(actor?.system ?? {}, "resources.lair.initiative"));
  return Number.isFinite(n) && n > 0 ? n : 20;
}

function hasLair(actor) {
  const lair = getProp(actor?.system ?? {}, "resources.lair");
  // dnd5e: resources.lair.value = "has a lair" (2014 data). Without that field, any lair action counts.
  return lair && typeof lair === "object" && "value" in lair ? !!lair.value : true;
}

function checkLair(combat, prior, current, priorCombatant, currentCombatant) {
  const key = `${combat.id}:${current.round}`;
  if (lairDone.has(key)) return;

  const cur = Number(currentCombatant?.initiative);
  if (!Number.isFinite(cur)) return;
  const newRound = current.round > prior.round;
  const prev = newRound ? Infinity : Number(priorCombatant?.initiative);

  const groups = [];
  for (const combatant of eligibleCombatants(combat)) {
    const actor = combatant.actor;
    if (!hasLair(actor)) continue;
    const count = lairInitiative(actor);
    // Lair actions lose initiative ties: they happen once the order drops below the count.
    const passed = (Number.isFinite(prev) ? prev >= count : true) && cur < count;
    if (!passed) continue;
    const options = findReminders(actor).filter(r => r.kind === "lair");
    if (options.length && !groups.some(g => g.actor === actor)) groups.push({ actor, options, count });
  }
  if (!groups.length) return;
  lairDone.add(key);
  postLairCard(combat, groups);
}

async function postLairCard(combat, groups) {
  await deletePrevious(combat, "lair");
  const content = `
    <div class="dxrm-card dxrm-lair">
      <h3 class="dxrm-title"><i class="fa-solid fa-dungeon"></i> ${t("Chat.LairTitle")}</h3>
      ${groups.map(({ actor, options, count }) => `
        <div class="dxrm-group" data-actor-uuid="${escapeHTML(actor.uuid)}">
          <div class="dxrm-header">
            <img src="${escapeHTML(displayImg(actor))}" alt="">
            <div class="dxrm-who">
              <strong>${escapeHTML(displayName(actor))}</strong>
              <span class="dxrm-points">${t("Chat.LairCount", { count })}</span>
            </div>
          </div>
          <details class="dxrm-use-list" open>
            <summary>${t("Chat.UseAnAction")}</summary>
            ${options.map(o => renderOption(actor, { ...o, kind: "lair" })).join("")}
          </details>
        </div>`).join("")}
    </div>`;

  return ChatMessage.implementation.create({
    content,
    speaker: { alias: t("Chat.Speaker") },
    whisper: whisperTargets(),
    flags: { [MODULE_ID]: { card: "lair", combatId: combat.id, round: combat.round, actorUuids: groups.map(g => g.actor.uuid) } }
  });
}

/* -------------------------------------------- */
/*  Legendary resistance                        */
/* -------------------------------------------- */

/** Was this saving throw a failure? null when the DC isn't known. */
function saveFailed(roll) {
  if (!roll) return null;
  if (typeof roll.isFailure === "boolean" && roll.options?.target !== undefined) return roll.isFailure;
  const target = Number(roll.options?.target ?? roll.options?.dc);
  if (!Number.isFinite(target)) return null;
  return roll.total < target;
}

async function onSaveRolled(actor, roll, ability) {
  if (!game.user.isGM || !setting("ResistanceReminders") || !actor) return;
  if (setting("IgnorePlayerOwned") && actor.hasPlayerOwner) return;
  const res = legendaryResistance(actor);
  if (!res || res.value <= 0) return;
  if (saveFailed(roll) !== true) return;

  const abilityLabel = CONFIG.DND5E?.abilities?.[ability]?.label ?? String(ability ?? "").toUpperCase();
  const dc = roll.options?.target ?? roll.options?.dc;
  const content = `
    <div class="dxrm-card dxrm-resist">
      <div class="dxrm-header">
        <img src="${escapeHTML(displayImg(actor))}" alt="">
        <h3 class="dxrm-title"><i class="fa-solid fa-shield-halved"></i> ${t("Chat.ResistTitle")}</h3>
      </div>
      <p class="dxrm-text">${t("Chat.ResistText", {
        name: escapeHTML(displayName(actor)), ability: escapeHTML(abilityLabel), total: roll.total, dc: dc ?? "?"
      })}</p>
      <div class="dxrm-row">
        <button type="button" class="dxrm-resist-use" data-actor-uuid="${escapeHTML(actor.uuid)}">
          <i class="fa-solid fa-shield-halved"></i>
          <span>${t("Chat.ResistUse")}</span>
          <span class="dxrm-label" data-resistance>${t("Chat.Resistance", { value: res.value, max: res.max })}</span>
        </button>
      </div>
    </div>`;

  await ChatMessage.implementation.create({
    content,
    speaker: { alias: t("Chat.Speaker") },
    whisper: whisperTargets(),
    flags: { [MODULE_ID]: { card: "resist", actorUuids: [actor.uuid] } }
  });
}

// dnd5e 4.x / 5.x
Hooks.on("dnd5e.rollSavingThrow", (rolls, data) => {
  try {
    const roll = Array.isArray(rolls) ? rolls[0] : rolls;
    onSaveRolled(data?.subject, roll, data?.ability);
  } catch (err) {
    console.error(`${MODULE_ID} | rollSavingThrow`, err);
  }
});

// dnd5e 3.x
Hooks.on("dnd5e.rollAbilitySave", (actor, roll, ability) => {
  try {
    onSaveRolled(actor, roll, ability);
  } catch (err) {
    console.error(`${MODULE_ID} | rollAbilitySave`, err);
  }
});

/* -------------------------------------------- */
/*  When hit by a melee attack (Heated Body)    */
/* -------------------------------------------- */

/** Is this dnd5e attack a melee attack? null when the message doesn't say. */
function isMeleeAttack(message, roll) {
  // A thrown melee weapon is a ranged attack.
  if (/thrown/i.test(String(roll?.options?.attackMode ?? ""))) return false;
  const flags = message.flags?.dnd5e ?? {};
  const activity = message.getAssociatedActivity?.()
    ?? (flags.activity?.uuid ? fromUuidSync(flags.activity.uuid, { strict: false }) : null);
  const type = activity?.attack?.type?.value; // dnd5e 4.x+: "melee" | "ranged"
  if (type) return type === "melee";
  const item = activity?.item ?? message.getAssociatedItem?.() ?? null;
  const action = item?.system?.actionType; // dnd5e 3.x: "mwak" | "msak" | "rwak" | "rsak"
  if (action) return action === "mwak" || action === "msak";
  return null;
}

/** Does the attack roll hit this AC? null when the AC isn't known. */
function attackHits(roll, ac) {
  if (roll.isFumble === true) return false; // natural 1
  if (roll.isCritical === true) return true; // natural 20 (or the attacker's crit range)
  const target = Number(ac);
  if (ac === null || ac === undefined || !Number.isFinite(target)) return null;
  return roll.total >= target;
}

/** The attacker of an attack message, for the card text. */
function attackerName(message) {
  const actor = ChatMessage.implementation.getSpeakerActor?.(message.speaker);
  return message.speaker?.alias || displayName(actor) || message.alias || "";
}

// Fires on every client: only the active GM posts.
Hooks.on("createChatMessage", message => {
  try {
    onAttackMessage(message);
  } catch (err) {
    console.error(`${MODULE_ID} | attack message`, err);
  }
});

function onAttackMessage(message) {
  if (!isResponsibleGM() || !setting("HitReminders")) return;
  const flags = message.flags?.dnd5e;
  if (flags?.roll?.type !== "attack") return;
  const targets = Array.isArray(flags.targets) ? flags.targets : [];
  if (!targets.length) return;
  const roll = message.rolls?.[0];
  if (!roll || !Number.isFinite(roll.total)) return;
  const melee = isMeleeAttack(message, roll) === true;

  const ignorePlayers = setting("IgnorePlayerOwned");
  const groups = [];
  for (const target of targets) {
    if (attackHits(roll, target?.ac) !== true) continue;
    const actor = target?.uuid ? fromUuidSync(target.uuid, { strict: false }) : null;
    if (!(actor instanceof Actor)) continue;
    if (ignorePlayers && actor.hasPlayerOwner) continue;
    if (groups.some(g => g.actor === actor)) continue;
    const options = findReminders(actor).filter(r => r.kind === "hit" && hitTriggers(r, melee));
    if (options.length) groups.push({ actor, options, ac: target.ac });
  }
  if (groups.length) postHitCard(message, roll, groups, melee);
}

async function postHitCard(message, roll, groups, melee) {
  const attacker = escapeHTML(attackerName(message));
  const content = `
    <div class="dxrm-card dxrm-hit">
      <h3 class="dxrm-title"><i class="fa-solid fa-burst"></i> ${t(melee ? "Chat.HitTitle" : "Chat.HitTitleAny")}</h3>
      ${groups.map(({ actor, options, ac }) => `
        <div class="dxrm-group" data-actor-uuid="${escapeHTML(actor.uuid)}">
          <div class="dxrm-header">
            <img src="${escapeHTML(displayImg(actor))}" alt="">
            <div class="dxrm-who">
              <strong>${escapeHTML(displayName(actor))}</strong>
            </div>
          </div>
          <p class="dxrm-text">${t(melee ? "Chat.HitText" : "Chat.HitTextAny", {
            name: escapeHTML(displayName(actor)), attacker, total: roll.total, ac: escapeHTML(ac)
          })}</p>
          ${options.map(o => renderOption(actor, { ...o, kind: "hit" })).join("")}
        </div>`).join("")}
    </div>`;

  return ChatMessage.implementation.create({
    content,
    speaker: { alias: t("Chat.Speaker") },
    whisper: whisperTargets(),
    flags: { [MODULE_ID]: { card: "hit", actorUuids: groups.map(g => g.actor.uuid) } }
  });
}

/** Spend one legendary resistance: through the actor's Legendary Resistance item if it has one. */
async function useResistance(actor) {
  const res = legendaryResistance(actor);
  if (!res || res.value <= 0) {
    ui.notifications.warn(t("Notify.NoResistance", { name: displayName(actor) }));
    return;
  }
  const item = actor.items.find(i => /legendary resistance/i.test(i.name) && activitiesOf(i).length);
  if (item && typeof item.use === "function") {
    const result = await item.use();
    if (!result) return; // the GM cancelled the usage dialog
    if ((legendaryResistance(actor)?.value ?? res.value) < res.value) return; // the system spent it
    // The item was used but consumes nothing: spend the use by hand below.
  }
  await actor.update({ "system.resources.legres.value": res.value - 1 });
  ui.notifications.info(t("Notify.ResistanceUsed", { name: displayName(actor), value: res.value - 1, max: res.max }));
}

/* -------------------------------------------- */
/*  Death triggers (0 HP)                       */
/* -------------------------------------------- */

/**
 * Path inside actor.system that holds the current HP number: the HpPath setting, otherwise the
 * system's primary token attribute (dnd5e: attributes.hp.value).
 */
function hpPathFor(actor) {
  const custom = String(setting("HpPath") ?? "").trim();
  if (custom) return custom.replace(/^system\./, "");
  const attr = game.system.primaryTokenAttribute || "attributes.hp";
  const val = getProp(actor?.system ?? {}, attr);
  if (val && typeof val === "object" && "value" in val) return `${attr}.value`;
  return attr;
}

function currentHp(actor) {
  const v = Number(getProp(actor?.system ?? {}, hpPathFor(actor)));
  return Number.isFinite(v) ? v : null;
}

// Remember the HP before the update (on the client that makes it); it travels with the update options.
Hooks.on("preUpdateActor", (actor, changes, options) => {
  try {
    if (!foundry.utils.hasProperty(changes, `system.${hpPathFor(actor)}`)) return;
    options[PREV_HP_KEY] = currentHp(actor);
  } catch (err) {
    console.error(`${MODULE_ID} | preUpdateActor`, err);
  }
});

// Fires on every client: only the active GM posts.
Hooks.on("updateActor", (actor, changes, options) => {
  try {
    checkDeath(actor, changes, options);
  } catch (err) {
    console.error(`${MODULE_ID} | updateActor`, err);
  }
});

// Fallback for unlinked tokens, in case the actor hook doesn't fire for synthetic actors.
Hooks.on("updateToken", (tokenDoc, changes, options) => {
  try {
    if (tokenDoc.actorLink || !changes.delta?.system || !tokenDoc.actor) return;
    const system = { system: changes.delta.system };
    if (!foundry.utils.hasProperty(system, `system.${hpPathFor(tokenDoc.actor)}`)) return;
    checkDeath(tokenDoc.actor, system, options);
  } catch (err) {
    console.error(`${MODULE_ID} | updateToken`, err);
  }
});

function checkDeath(actor, changes, options) {
  if (!isResponsibleGM() || !actor || !setting("DeathReminders") || deathModuleActive()) return;
  if (!foundry.utils.hasProperty(changes, `system.${hpPathFor(actor)}`)) return;
  const hp = currentHp(actor);
  if (hp === null) return;

  const key = actor.uuid;
  if (hp > 0) {
    deathAlerted.delete(key);
    return;
  }
  // Already at 0 before this update: not a new drop.
  const prev = options?.[PREV_HP_KEY];
  if (typeof prev === "number" && prev <= 0) return;
  if (deathAlerted.has(key)) return;
  if (setting("IgnorePlayerOwned") && actor.hasPlayerOwner) return;

  const triggers = findReminders(actor).filter(r => r.kind === "death");
  if (!triggers.length) return;
  deathAlerted.add(key);
  postDeathCard(actor, triggers);
}

/**
 * Post the death trigger card for an actor (API: ignores HP and the other checks).
 * @param {Actor} actor
 * @param {object[]|Item[]} [options]  findReminders() results or items; default: the actor's death triggers
 */
async function deathAlert(actor, options) {
  if (!game.user.isGM || !actor) return null;
  options ??= findReminders(actor).filter(r => r.kind === "death");
  const list = options.map(o => (o instanceof Item ? { item: o, kind: "death", cost: 1, entry: kindOf(o).entry ?? null } : o));
  return postDeathCard(actor, list);
}

async function postDeathCard(actor, options) {
  if (!options?.length) return null;
  const content = `
    <div class="dxrm-card dxrm-death">
      <h3 class="dxrm-title"><i class="fa-solid fa-skull"></i> ${t("Chat.DeathTitle")}</h3>
      <div class="dxrm-group" data-actor-uuid="${escapeHTML(actor.uuid)}">
        <div class="dxrm-header">
          <img src="${escapeHTML(displayImg(actor))}" alt="">
          <div class="dxrm-who">
            <strong>${escapeHTML(displayName(actor))}</strong>
          </div>
        </div>
        <p class="dxrm-text">${t("Chat.DeathText", { name: escapeHTML(displayName(actor)) })}</p>
        ${options.map(o => renderOption(actor, { ...o, kind: "death" })).join("")}
      </div>
    </div>`;

  return ChatMessage.implementation.create({
    content,
    speaker: { alias: t("Chat.Speaker") },
    whisper: whisperTargets(),
    flags: { [MODULE_ID]: { card: "death", actorUuids: [actor.uuid] } }
  });
}

/* -------------------------------------------- */
/*  Chat cards: sound, buttons, live labels     */
/* -------------------------------------------- */

Hooks.on("createChatMessage", message => {
  const card = game.user.isGM ? message.getFlag(MODULE_ID, "card") : null;
  if (!card) return;
  const src = setting(card === "death" ? "DeathSound" : "Sound");
  if (!src) return;
  foundry.audio.AudioHelper.play({ src, volume: setting("Volume"), autoplay: true, loop: false }, false);
});

/** Fill in the live "cost / remaining" labels and disable what can't be afforded or was used. */
function refreshLabels(message, html) {
  const combat = game.combats?.get(message.getFlag(MODULE_ID, "combatId")) ?? null;
  for (const group of html.querySelectorAll(".dxrm-group[data-actor-uuid]")) {
    const actor = fromUuidSync(group.dataset.actorUuid);
    if (!actor) continue;
    const points = legendaryPoints(actor);
    const pointsEl = group.querySelector("[data-points]");
    if (pointsEl && points) pointsEl.textContent = pointsLabel(points);
    const resEl = group.querySelector("[data-resistance]");
    if (resEl) resEl.textContent = resistanceLabel(actor);

    for (const option of group.querySelectorAll(".dxrm-option")) {
      const kind = option.dataset.kind;
      if (kind === "lair" || PASSIVE_KINDS.includes(kind)) continue;
      const cost = Number(option.dataset.cost) || 1;
      const item = fromUuidSync(option.dataset.itemUuid);
      const used = kind === "villain" && villainUsed(combat, item);
      const short = points ? cost > points.value : false;
      const label = option.querySelector("[data-label]");
      if (label) {
        const left = points ? t("Chat.Left", { value: points.value }) : "";
        const base = t("Chat.Cost", { cost }) + (left ? ` · ${left}` : "");
        label.textContent = used ? t("Chat.Used") : kind === "villain" ? `${base} · ${t("Chat.OncePerCombat")}` : base;
      }
      option.classList.toggle("dxrm-short", short);
      option.classList.toggle("dxrm-spent", used);
      const use = option.querySelector("button.dxrm-use");
      if (use) use.disabled = !game.user.isGM || short || used;
    }
  }
  for (const btn of html.querySelectorAll("button.dxrm-resist-use")) {
    const actor = fromUuidSync(btn.dataset.actorUuid);
    const res = legendaryResistance(actor);
    const label = btn.querySelector("[data-resistance]");
    if (label && res) label.textContent = t("Chat.Resistance", { value: res.value, max: res.max });
    btn.disabled = !game.user.isGM || !res || res.value <= 0;
  }
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  if (!message.getFlag(MODULE_ID, "card")) return;
  refreshLabels(message, html);

  html.querySelectorAll("button.dxrm-use, button.dxrm-open, button.dxrm-exclude").forEach(btn => {
    if (!game.user.isGM) {
      btn.disabled = true;
      return;
    }
    btn.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const item = await fromUuid(btn.dataset.itemUuid);
      if (!item) {
        ui.notifications.warn(t("Notify.ItemMissing"));
        return;
      }
      if (btn.classList.contains("dxrm-open")) {
        item.sheet?.render(true);
        return;
      }
      if (btn.classList.contains("dxrm-exclude")) {
        if (await excludeFromCard(item)) btn.closest(".dxrm-option")?.classList.add("dxrm-excluded");
        return;
      }
      btn.disabled = true;
      try {
        const result = await useItem(item);
        const kind = btn.closest(".dxrm-option")?.dataset.kind;
        // Outside dnd5e the postUseActivity hook doesn't fire, so record villain use here.
        if (kind === "villain" && result !== null && !game.system.id.startsWith("dnd5e")) {
          const combat = game.combats?.get(message.getFlag(MODULE_ID, "combatId")) ?? game.combat;
          await markVillainUsed(item, combat);
        }
      } finally {
        rerenderFor(message);
      }
    });
  });

  html.querySelectorAll("button.dxrm-resist-use").forEach(btn => {
    if (!game.user.isGM) {
      btn.disabled = true;
      return;
    }
    btn.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const actor = await fromUuid(btn.dataset.actorUuid);
      if (!actor) {
        ui.notifications.warn(t("Notify.ItemMissing"));
        return;
      }
      btn.disabled = true;
      try {
        await useResistance(actor);
      } finally {
        rerenderFor(message);
      }
    });
  });
});

/** Re-render a card so its labels show the current points. */
function rerenderFor(message) {
  try {
    ui.chat?.updateMessage?.(message);
  } catch (err) {
    console.debug(`${MODULE_ID} | rerender`, err);
  }
}

/** When legendary points, resistances or villain use change, refresh the cards that show them. */
function refreshCardsFor(actorUuid) {
  for (const message of game.messages.contents.slice(-50)) {
    const uuids = message.getFlag(MODULE_ID, "actorUuids");
    if (Array.isArray(uuids) && (!actorUuid || uuids.includes(actorUuid))) rerenderFor(message);
  }
}

Hooks.on("updateActor", (actor, changes) => {
  if (!game.user.isGM) return;
  if (foundry.utils.hasProperty(changes, "system.resources")) refreshCardsFor(actor.uuid);
});

Hooks.on("updateToken", (tokenDoc, changes) => {
  if (!game.user.isGM || !changes.delta?.system?.resources || !tokenDoc.actor) return;
  refreshCardsFor(tokenDoc.actor.uuid);
});

Hooks.on("updateCombat", (combat, changes) => {
  if (!game.user.isGM) return;
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) refreshCardsFor(null);
});

/** Use an item in whatever way the current system supports (dnd5e: the native pipeline). */
async function useItem(item) {
  if (typeof item.use === "function") return item.use();
  if (typeof item.roll === "function") return item.roll();
  if (typeof item.toChat === "function") return item.toChat();
  if (typeof item.toMessage === "function") return item.toMessage();
  if (typeof item.displayCard === "function") return item.displayCard();

  const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;
  const raw = typeof item.system?.description === "string"
    ? item.system.description
    : item.system?.description?.value ?? "";
  const enriched = await TextEditorImpl.enrichHTML(raw, { relativeTo: item, rollData: item.getRollData?.() });
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: item.actor }),
    content: `<h3>${escapeHTML(item.name)}</h3>${enriched}`
  });
  ui.notifications.info(t("Notify.Posted", { item: item.name }));
  return true;
}
