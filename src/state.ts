import { readFileSync, writeFileSync, existsSync } from "fs";
import type { BotState, LotteryDraw } from "./types";
import { log } from "./logger";

const STATE_FILE = "state.json";
const MAX_DRAWS = 100;

function defaultState(): BotState {
  return {
    draws: [],
    totalDraws: 0,
    totalSolSpent: 0,
    holderCount: 0,
    currentPotUsdc: 0,
    floorPriceSol: 0,
    floorNftName: "",
    floorNftImage: "",
    lastCycleTimestamp: 0,
  };
}

export function loadState(): BotState {
  if (!existsSync(STATE_FILE)) return defaultState();
  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    log.warn("Could not load state file, starting fresh");
    return defaultState();
  }
}

export function saveState(state: BotState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function recordDraw(state: BotState, draw: LotteryDraw): void {
  state.draws.unshift(draw);
  if (state.draws.length > MAX_DRAWS) {
    state.draws = state.draws.slice(0, MAX_DRAWS);
  }
  state.totalDraws++;
  state.totalSolSpent += draw.solPrice;
  saveState(state);
}
