import {
  MAX_FAME,
  MIN_FAME,
  calculateFameTarget,
  getFameRank,
  isFameSuccess,
  normalizeFame
} from "./fame-utils.mjs";

const MODULE_ID = "fame-tracker";
const FAME_FLAG = "fame";
const TEST_FLAG = "test";
const SCHEMA_VERSION = 1;
const ARENA_SKILL_IDS = new Set(["prf", "dec", "itm", "per"]);
const ARENA_INTEREST_FIELD = `${MODULE_ID}.arena-interest`;
const LEGACY_ARENA_DIALOG_PATCH = "fameTrackerArenaDialogPatch";

const pendingUpdates = new WeakMap();
const activeRolls = new WeakSet();

Hooks.once("init", () => {
  console.info(`${MODULE_ID} | Initializing Fame Tracker`);
});

Hooks.on("renderActorSheet", injectFameControl);
Hooks.on("renderActorSheetV2", injectFameControl);
Hooks.on("renderApplicationV2", injectFameControl);
Hooks.on("renderApplicationV2", injectArenaInterestControl);
Hooks.on("dnd5e.buildSkillRollConfig", applyModernArenaInterestBonus);
Hooks.on("dnd5e.preRollSkill", configureLegacyArenaInterestDialog);
Hooks.once("ready", patchLegacyArenaInterestDialog);
Hooks.on("renderChatMessage", revealVisibleChatResult);
Hooks.on("renderChatMessageHTML", revealVisibleChatResult);

function injectFameControl(application, html) {
  if (game.system?.id !== "dnd5e") return;

  const actor = getApplicationActor(application);
  if (!actor || actor.type !== "character") return;

  const root = getHtmlRoot(html);
  if (!root || !isSupportedCharacterSheet(application, root)) return;

  const target = findHeaderTarget(root);
  if (!target) return;

  if (root.querySelector("[data-fame-tracker-control]")) return;

  const fame = normalizeFame(actor.getFlag(MODULE_ID, FAME_FLAG));
  const editable = Boolean(actor.isOwner);
  const busy = pendingUpdates.has(actor) || activeRolls.has(actor);
  target.append(buildFameControl(actor, fame, editable, busy));
}

function getApplicationActor(application) {
  const document = application?.document
    ?? application?.object
    ?? application?.options?.document;

  // Item and feature applications can expose their owning Actor. Only accept
  // an application whose own document is the character Actor.
  if (document?.documentName) {
    return document.documentName === "Actor" ? document : null;
  }

  return application?.actor?.documentName === "Actor" ? application.actor : null;
}
function getHtmlRoot(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function injectArenaInterestControl(application, html) {
  const data = getArenaSkillDialogData(application);
  if (!data) return;

  const root = getHtmlRoot(html);
  if (!root || root.querySelector(`[name="${ARENA_INTEREST_FIELD}"]`)) return;

  const fieldset = root.querySelector("fieldset");
  if (!fieldset) return;
  fieldset.append(buildArenaInterestControl(root.ownerDocument, data.rank));
}

function applyModernArenaInterestBonus(application, config, formData) {
  const data = getArenaSkillDialogData(application);
  if (!data) return;

  config.parts = config.parts.filter(part => part !== "@fameArenaBonus");
  delete config.data.fameArenaBonus;
  if (!isArenaInterestSelected(formData)) return;
  if (!data.rank.bonus) return;

  config.parts.push("@fameArenaBonus");
  config.data.fameArenaBonus = data.rank.bonus;
}

function isArenaInterestSelected(formData) {
  const value = formData?.get?.(ARENA_INTEREST_FIELD);
  return value === true || value === "true" || value === "on" || value === 1 || value === "1";
}

function configureLegacyArenaInterestDialog(actor, rollData, skillId) {
  if (getDndMajorVersion() >= 4 || !isArenaSkill(actor, skillId)) return;

  const rank = getFameRank(normalizeFame(actor.getFlag(MODULE_ID, FAME_FLAG)));
  const existingRender = rollData.dialogOptions?.render;
  rollData.dialogOptions = {
    ...rollData.dialogOptions,
    render: html => {
      existingRender?.(html);
      const root = getHtmlRoot(html);
      const form = root?.querySelector("form");
      if (!form || form.querySelector(`[name="${ARENA_INTEREST_FIELD}"]`)) return;
      form.append(buildArenaInterestControl(form.ownerDocument, rank));
    }
  };
}

function patchLegacyArenaInterestDialog() {
  if (getDndMajorVersion() >= 4) return;

  const prototype = CONFIG.Dice?.D20Roll?.prototype;
  if (!prototype || prototype[LEGACY_ARENA_DIALOG_PATCH]) return;

  const originalSubmit = prototype._onDialogSubmit;
  if (typeof originalSubmit !== "function") return;

  prototype._onDialogSubmit = function (html, advantageMode) {
    const form = getHtmlRoot(html)?.querySelector("form");
    const checkbox = form?.querySelector(`[name="${ARENA_INTEREST_FIELD}"]`);
    const rankBonus = Number(form?.querySelector('[name="fame-tracker-arena-bonus"]')?.value ?? 0);
    const situationalBonus = form?.querySelector('[name="bonus"]');

    if (checkbox?.checked && rankBonus > 0 && situationalBonus) {
      const existing = situationalBonus.value.trim();
      situationalBonus.value = existing ? `(${existing}) + ${rankBonus}` : String(rankBonus);
    }

    return originalSubmit.call(this, html, advantageMode);
  };
  prototype[LEGACY_ARENA_DIALOG_PATCH] = true;
}

function getArenaSkillDialogData(application) {
  const actor = application?.config?.subject;
  const skillId = application?.config?.skill;
  const identity = application?.constructor?.name ?? "";

  if (!/skilltoolrollconfigurationdialog/i.test(identity)) return null;
  if (!isArenaSkill(actor, skillId)) return null;
  return { actor, skillId, rank: getFameRank(normalizeFame(actor.getFlag(MODULE_ID, FAME_FLAG))) };
}

function isArenaSkill(actor, skillId) {
  return actor?.documentName === "Actor"
    && actor.type === "character"
    && ARENA_SKILL_IDS.has(skillId);
}

function getDndMajorVersion() {
  return Number.parseInt(String(game.system.version ?? "0").split(".")[0], 10) || 0;
}

function buildArenaInterestControl(documentRef, rank) {
  const group = documentRef.createElement("div");
  group.className = "form-group fame-tracker-arena-interest";

  const label = documentRef.createElement("label");
  label.className = "checkbox";

  const input = documentRef.createElement("input");
  input.type = "checkbox";
  input.name = ARENA_INTEREST_FIELD;
  input.value = "true";

  const hiddenBonus = documentRef.createElement("input");
  hiddenBonus.type = "hidden";
  hiddenBonus.name = "fame-tracker-arena-bonus";
  hiddenBonus.value = String(rank.bonus);

  const rankKey = `FAME_TRACKER.Rank${rank.id[0].toUpperCase()}${rank.id.slice(1)}`;
  const text = documentRef.createTextNode(game.i18n.format("FAME_TRACKER.ArenaInterest", {
    rank: game.i18n.localize(rankKey), bonus: rank.bonus
  }));

  label.append(input, text);
  group.append(label, hiddenBonus);
  return group;
}
function isSupportedCharacterSheet(application, root) {
  const identity = [
    application?.constructor?.name,
    ...(application?.options?.classes ?? []),
    root.className
  ].join(" ").toLowerCase();

  if (identity.includes("tidy5e") || identity.includes("obsidian")) return false;
  if (!getCharacterSheetHeader(root)) return false;

  return /actorsheet5echaracter|characteractorsheet|charactersheet/.test(identity)
    || Boolean(root.matches(".dnd5e.sheet.actor.character, .dnd5e2.sheet.actor.character"));
}

function findHeaderTarget(root) {
  const header = getCharacterSheetHeader(root);
  if (!header) return null;

  const modernDetails = header.querySelector(":scope > .right > div:last-child");
  if (modernDetails) {
    let slot = modernDetails.querySelector(":scope > .sheet-header-buttons");
    if (!slot) {
      slot = document.createElement("div");
      slot.className = "sheet-header-buttons";
      modernDetails.prepend(slot);
    }
    slot.classList.add("fame-tracker-slot");
    return slot;
  }

  return header.querySelector(":scope .summary")
    ?? header.querySelector(":scope .header-details")
    ?? header;
}

function getCharacterSheetHeader(root) {
  const scopes = [
    root,
    root.querySelector?.(":scope > .window-content"),
    root.querySelector?.(":scope > form")
  ].filter(Boolean);

  for (const scope of scopes) {
    if (scope.matches?.(".sheet-header")) return scope;

    const header = scope.querySelector?.(":scope > .sheet-header, :scope > header.sheet-header, :scope > form > .sheet-header, :scope > form > header.sheet-header");
    if (header) return header;
  }

  return null;
}

function buildFameControl(actor, fame, editable, busy) {
  const rank = getFameRank(fame);
  const rankKey = `FAME_TRACKER.Rank${rank.id[0].toUpperCase()}${rank.id.slice(1)}`;
  const rankLabel = game.i18n.localize(rankKey);
  const rankSummary = game.i18n.format("FAME_TRACKER.RankBonus", { rank: rankLabel, bonus: rank.bonus });
  const container = document.createElement("div");
  container.className = "fame-tracker-control";
  container.dataset.fameTrackerControl = "";
  container.dataset.actorUuid = actor.uuid;
  container.setAttribute("aria-label", game.i18n.localize("FAME_TRACKER.ControlLabel"));

  if (editable) {
    container.append(createAdjustButton(actor, -1, "Decrease", "fa-minus", busy || fame <= MIN_FAME));
  }

  const score = document.createElement(editable ? "button" : "span");
  score.className = "fame-tracker-score";
  score.dataset.fameTrackerScore = "";
  score.innerHTML = `<span class="fame-tracker-label">${escapeHtml(game.i18n.localize("FAME_TRACKER.Fame"))}</span>`
    + `<span class="fame-tracker-value">${fame}</span>`
    + `<span class="fame-tracker-rank">${escapeHtml(rankSummary)}</span>`;

  if (editable) {
    score.type = "button";
    score.disabled = busy;
    score.setAttribute("aria-label", game.i18n.format("FAME_TRACKER.RollLabel", {
      fame, rank: rankLabel, bonus: rank.bonus
    }));
    score.dataset.tooltip = game.i18n.localize("FAME_TRACKER.RollHint");
    score.addEventListener("click", () => performFameTest(actor));
  } else {
    score.setAttribute("aria-label", game.i18n.format("FAME_TRACKER.ReadOnlyLabel", {
      fame, rank: rankLabel, bonus: rank.bonus
    }));
  }
  container.append(score);

  if (editable) {
    container.append(createAdjustButton(actor, 1, "Increase", "fa-plus", busy || fame >= MAX_FAME));
  }

  return container;
}
function createAdjustButton(actor, delta, labelKey, icon, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fame-tracker-adjust";
  button.disabled = disabled;
  button.setAttribute("aria-label", game.i18n.localize(`FAME_TRACKER.${labelKey}`));
  button.dataset.tooltip = `FAME_TRACKER.${labelKey}`;
  button.dataset.delta = String(delta);
  button.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i>`;
  button.addEventListener("click", () => queueFameAdjustment(actor, delta));
  return button;
}

function queueFameAdjustment(actor, delta) {
  const previous = pendingUpdates.get(actor) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      setActorControlsBusy(actor, true);
      const current = normalizeFame(actor.getFlag(MODULE_ID, FAME_FLAG));
      const updated = normalizeFame(current + delta);
      if (updated !== current) await actor.setFlag(MODULE_ID, FAME_FLAG, updated);
    })
    .catch(error => {
      console.error(`${MODULE_ID} | Failed to update Fame`, error);
      ui.notifications.error(game.i18n.localize("FAME_TRACKER.UpdateError"));
    })
    .finally(() => {
      if (pendingUpdates.get(actor) === next) {
        pendingUpdates.delete(actor);
        setActorControlsBusy(actor, false);
      }
    });

  pendingUpdates.set(actor, next);
  return next;
}

async function performFameTest(actor) {
  if (!actor.isOwner || activeRolls.has(actor)) return;

  activeRolls.add(actor);
  setActorControlsBusy(actor, true);

  try {
    const fame = normalizeFame(actor.getFlag(MODULE_ID, FAME_FLAG));
    const performanceRolls = await rollPerformanceWithoutMessage(actor);
    if (!performanceRolls.length) return;

    const performanceRoll = performanceRolls[0];
    const target = calculateFameTarget(performanceRoll.total, fame);
    const percentileRoll = await new Roll("1d100").evaluate();
    const success = isFameSuccess(percentileRoll.total, target);

    await createFameChatMessage({
      actor,
      fame,
      performanceRolls,
      performanceRoll,
      target,
      percentileRoll,
      success
    });
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to perform Fame test`, error);
    ui.notifications.error(game.i18n.localize("FAME_TRACKER.RollError"));
  } finally {
    activeRolls.delete(actor);
    setActorControlsBusy(actor, false);
  }
}
async function rollPerformanceWithoutMessage(actor) {
  const majorVersion = Number.parseInt(String(game.system.version ?? "0").split(".")[0], 10);
  // Force the system's normal roll-configuration dialog. This is where the
  // player selects advantage, normal, or disadvantage for Performance only.
  const dialogOptions = { configure: true, fastForward: false };
  let result;

  if (majorVersion >= 4) {
    result = await actor.rollSkill({ skill: "prf" }, dialogOptions, { create: false });
  } else {
    result = await actor.rollSkill("prf", { ...dialogOptions, chatMessage: false });
  }

  if (!result) return [];
  if (Array.isArray(result)) return result.filter(roll => Number.isFinite(Number(roll?.total)));
  if (Number.isFinite(Number(result.total))) return [result];
  if (Array.isArray(result.rolls)) {
    return result.rolls.filter(roll => Number.isFinite(Number(roll?.total)));
  }
  throw new Error("The D&D 5e Performance check did not return a usable roll.");
}
async function createFameChatMessage({
  actor,
  fame,
  performanceRolls,
  performanceRoll,
  target,
  percentileRoll,
  success
}) {
  const templateData = {
    fame,
    performanceTotal: performanceRoll.total,
    target,
    percentileTotal: percentileRoll.total,
    success,
    resultLabel: game.i18n.localize(success ? "FAME_TRACKER.Success" : "FAME_TRACKER.Failure"),
    performanceRollHtml: await performanceRoll.render(),
    percentileRollHtml: await percentileRoll.render()
  };
  const content = await renderTemplate(`modules/${MODULE_ID}/templates/fame-roll.hbs`, templateData);
  const rollMode = game.settings.get("core", "rollMode");
  const messageData = {
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: [...performanceRolls, percentileRoll],
    flags: {
      [MODULE_ID]: {
        [TEST_FLAG]: {
          actorUuid: actor.uuid,
          fame,
          performanceTotal: Number(performanceRoll.total),
          target,
          percentileTotal: Number(percentileRoll.total),
          success,
          schemaVersion: SCHEMA_VERSION
        }
      }
    }
  };

  applyCurrentRollMode(messageData, rollMode);
  const MessageClass = ChatMessage.implementation ?? ChatMessage;
  await MessageClass.create(messageData);
}

function applyCurrentRollMode(messageData, rollMode) {
  const MessageClass = ChatMessage.implementation ?? ChatMessage;
  const applyRollMode = MessageClass.applyRollMode ?? ChatMessage.applyRollMode;
  if (typeof applyRollMode === "function") {
    applyRollMode.call(MessageClass, messageData, rollMode);
    return;
  }

  if (rollMode === "gmroll" || rollMode === "blindroll") {
    messageData.whisper = ChatMessage.getWhisperRecipients("GM").map(user => user.id);
  } else if (rollMode === "selfroll") {
    messageData.whisper = [game.user.id];
  }
  if (rollMode === "blindroll") messageData.blind = true;
}

function revealVisibleChatResult(message, html) {
  if (!message.getFlag(MODULE_ID, TEST_FLAG)) return;

  const root = getHtmlRoot(html);
  if (!root) return;

  const card = root.querySelector(".fame-tracker-card");
  const result = root.querySelector("[data-fame-tracker-results]");
  const hidden = root.querySelector("[data-fame-tracker-hidden]");
  if (!card || !result || !hidden) return;

  if (message.isContentVisible) {
    card.classList.add("is-revealed");
    result.hidden = false;
    hidden.hidden = true;
  } else {
    card.classList.remove("is-revealed");
    result.hidden = true;
    hidden.hidden = false;
  }
}

function setActorControlsBusy(actor, busy) {
  const selector = `[data-fame-tracker-control][data-actor-uuid="${CSS.escape(actor.uuid)}"]`;
  const fame = normalizeFame(actor.getFlag(MODULE_ID, FAME_FLAG));
  for (const element of document.querySelectorAll(selector)) {
    for (const button of element.querySelectorAll("button")) {
      const delta = Number(button.dataset.delta ?? 0);
      button.disabled = busy
        || (delta < 0 && fame <= MIN_FAME)
        || (delta > 0 && fame >= MAX_FAME);
    }
    element.classList.toggle("is-busy", busy);
  }
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
