import {
  MAX_FAME,
  MIN_FAME,
  calculateFameTarget,
  isFameSuccess,
  normalizeFame
} from "./fame-utils.mjs";

const MODULE_ID = "fame-tracker";
const FAME_FLAG = "fame";
const TEST_FLAG = "test";
const SCHEMA_VERSION = 1;

const pendingUpdates = new WeakMap();
const activeRolls = new WeakSet();

Hooks.once("init", () => {
  console.info(`${MODULE_ID} | Initializing Fame Tracker`);
});

Hooks.on("renderActorSheet", injectFameControl);
Hooks.on("renderActorSheetV2", injectFameControl);
Hooks.on("renderApplicationV2", injectFameControl);
Hooks.on("renderChatMessage", revealVisibleChatResult);
Hooks.on("renderChatMessageHTML", revealVisibleChatResult);

function injectFameControl(application, html) {
  if (game.system?.id !== "dnd5e") return;

  const actor = getApplicationActor(application);
  if (!actor || actor.type !== "character") return;

  const root = getHtmlRoot(html);
  if (!root || !isSupportedCharacterSheet(application, root)) return;
  if (root.querySelector("[data-fame-tracker-control]")) return;

  const target = findHeaderTarget(root);
  if (!target) return;

  const fame = normalizeFame(actor.getFlag(MODULE_ID, FAME_FLAG));
  const editable = Boolean(actor.isOwner);
  const busy = pendingUpdates.has(actor) || activeRolls.has(actor);
  target.append(buildFameControl(actor, fame, editable, busy));
}

function getApplicationActor(application) {
  const candidate = application?.actor
    ?? application?.document
    ?? application?.object
    ?? application?.options?.document;
  return candidate?.documentName === "Actor" ? candidate : null;
}

function getHtmlRoot(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function isSupportedCharacterSheet(application, root) {
  const identity = [
    application?.constructor?.name,
    ...(application?.options?.classes ?? []),
    root.className
  ].join(" ").toLowerCase();

  if (identity.includes("tidy5e") || identity.includes("obsidian")) return false;

  return Boolean(root.querySelector(".sheet-header"))
    && (
      /actorsheet5echaracter|characteractorsheet|dnd5e/.test(identity)
      || root.matches(".dnd5e.sheet.actor, .dnd5e2.sheet.actor")
      || root.querySelector(".dnd5e.sheet.actor, .dnd5e2.sheet.actor")
    );
}

function findHeaderTarget(root) {
  return root.querySelector(".sheet-header .right")
    ?? root.querySelector(".sheet-header .summary")
    ?? root.querySelector(".sheet-header .header-details")
    ?? root.querySelector(".sheet-header");
}

function buildFameControl(actor, fame, editable, busy) {
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
    + `<span class="fame-tracker-value">${fame}</span>`;

  if (editable) {
    score.type = "button";
    score.disabled = busy;
    score.setAttribute("aria-label", game.i18n.format("FAME_TRACKER.RollLabel", { fame }));
    score.dataset.tooltip = game.i18n.localize("FAME_TRACKER.RollHint");
    score.addEventListener("click", () => performFameTest(actor));
  } else {
    score.setAttribute("aria-label", game.i18n.format("FAME_TRACKER.ReadOnlyLabel", { fame }));
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
    const performanceRolls = await rollPerformanceWithoutMessage(actor);
    if (!performanceRolls.length) return;

    const performanceRoll = performanceRolls[0];
    const fame = normalizeFame(actor.getFlag(MODULE_ID, FAME_FLAG));
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
  let result;

  if (majorVersion >= 4) {
    result = await actor.rollSkill({ skill: "prf" }, {}, { create: false });
  } else {
    result = await actor.rollSkill("prf", { chatMessage: false });
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
