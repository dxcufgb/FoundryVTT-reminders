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
 *   - Villain actions spend legendary points but can be used once per combat each.
 *   - Lair actions (2014 rules): a card when the turn order passes the lair's initiative count.
 *   - Legendary resistance: a whisper when a creature fails a saving throw and still has uses left,
 *     with a button that spends one.
 *
 * What counts as a reminder action:
 *   - dnd5e items whose activation is "legendary" or "lair" (setting "Also detect by activation type").
 *   - Items whose name matches an entry in the world's Reminder list (a world setting, filled from
 *     data/reminders.json: the legendary and lair actions of the 2014 and 2024 Monster Manuals).
 *     In dnd5e a list match for a legendary or lair entry also needs a legendary or lair activation,
 *     so a creature's ordinary "Bite" doesn't count just because the vampire's legendary Bite is listed.
 *   - Items named "... Villain Action ..." and list entries of kind "villain".
 *   - The item's own setting wins: sheet header button "Reminder" -> Automatic / Legendary / Villain /
 *     Lair / Never, or item.setFlag("dxcufgbs-reminders", "kind", "legendary" | "villain" | "lair" | "none").
 *
 * API: game.modules.get("dxcufgbs-reminders").api
 *   .findReminders(actor)        -> [{ item, kind, cost, entry }]
 *   .remindNow(combat)           -> posts the legendary / villain card now
 *   .legendaryPoints(actor)      -> { value, max } | null
 *   .kindOf(item)                -> { kind, reason, entry }
 *   .getList() / .isListed() / .addToList() / .removeFromList() / .exportList() / .importList() / .resetList()
 *   .configureItem(item)
 */

const MODULE_ID = "dxcufgbs-reminders";
const LIST_KEY = "ReminderList";
const DEFAULT_LIST_PATH = `modules/${MODULE_ID}/data/reminders.json`;
const KINDS = ["legendary", "villain", "lair"];
const VILLAIN_NAME = /villain\s+action/i;

/** Lair cards already posted, as "combatId:round". */
const lairDone = new Set();

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
  reg("DetectByActivation", { type: Boolean, default: true });
  reg("IgnorePlayerOwned", { type: Boolean, default: true });
  reg("WhisperGM", { type: Boolean, default: true });
  reg("DeletePrevious", { type: Boolean, default: true });
  reg("Sound", { type: String, default: "sounds/notify.wav", filePicker: "audio" });
  reg("Volume", {
    type: Number,
    default: 0.5,
    range: { min: 0, max: 1, step: 0.05 }
  });
});

Hooks.once("ready", async () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      findReminders, remindNow, legendaryPoints, legendaryResistance, kindOf, configureItem,
      getList, isListed, addToList, removeFromList, exportList, importList: importListFlow, resetList
    };
  }
  try {
    await ensureList();
  } catch (err) {
    console.error(`${MODULE_ID} | ensureList`, err);
  }
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

async function ensureList() {
  if (getList() || !isResponsibleGM()) return;
  const data = await loadDefaultList();
  if (!data) return;
  await saveList(data);
  ui.notifications.info(t("Notify.ListCreated", { count: data.features.length }));
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
  await saveList(data);
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
  const entry = bestEntry(entries, item?.actor);

  if (flag === "none") return { kind: null, reason: "never" };
  if (KINDS.includes(flag)) return { kind: flag, reason: "flag", entry, cost: act?.cost ?? entry?.cost ?? null };

  const villainEntry = entries.find(e => e.kind === "villain");
  if (VILLAIN_NAME.test(item?.name ?? "") || villainEntry) {
    return { kind: "villain", reason: "villain", entry: villainEntry ?? entry, cost: act?.cost ?? (villainEntry ?? entry)?.cost ?? null };
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
  const current = flag === "none" ? "never" : KINDS.includes(flag) ? flag : "auto";

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
  if (!mode || mode === "cancel" || mode === current) return;

  if (mode === "auto") await item.unsetFlag(MODULE_ID, "kind");
  else await item.setFlag(MODULE_ID, "kind", mode === "never" ? "none" : mode);
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
/*  Chat cards: sound, buttons, live labels     */
/* -------------------------------------------- */

Hooks.on("createChatMessage", message => {
  if (!game.user.isGM || !message.getFlag(MODULE_ID, "card")) return;
  const src = setting("Sound");
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
      if (kind === "lair") continue;
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
