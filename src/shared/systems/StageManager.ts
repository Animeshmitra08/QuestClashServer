import type { CommandResult, GameCommand, RejectReason } from "@/types/commands";
import type { ExitTrigger, Interactable, LevelDefinition, SpawnPoint, TrapTrigger, Vec2 } from "@/types/game";
import type {
  FailReason,
  FrameResult,
  GameEvent,
  LevelEvent,
  LevelStatus,
  MatchPlayer,
  MatchState,
  PlayerEvent,
  PlayerId,
  TrapState,
} from "@/types/state";

import { orderCommands } from "./commandOrder";
import { circleOverlapsRect } from "./CollisionSystem";
import { createInitialMatchState, listPlayers, withPlayer } from "./gameState";
import { type NoticeRequest, runInteraction } from "./interactionRules";
import { validateLevel } from "./levelValidation";
import { creditObjectives, isConditionMet, newlyCompletedObjectives } from "./ObjectiveSystem";
import { addPlayer, type JoinResult, type PlayerProfile, playerTransition, spawnFor } from "./PlayerRegistry";
import { answerPuzzle, getPuzzle } from "./PuzzleSystem";
import { wholeSeconds } from "./ScoreSystem";
import { nextState, type TransitionTable } from "./stateMachine";
import { TrapSystem } from "./TrapSystem";

/**
 * playing --pause--> paused --resume--> playing
 * playing --complete--> completed (final)
 * playing --fail--> failed (final: time ran out, or every player was eliminated)
 */
export const LEVEL_TRANSITIONS: TransitionTable<LevelStatus, LevelEvent> = {
  playing: { pause: "paused", complete: "completed", fail: "failed" },
  paused: { resume: "playing" },
  completed: {},
  failed: {},
};

/** Match-wide rules that aren't part of a level. */
export interface MatchRules {
  /**
   * Lives per player. Each trap hit costs one; at zero the player is eliminated.
   * null = unlimited (a hit only sends the player back), as in single player.
   */
  livesPerPlayer: number | null;
}

export const DEFAULT_MATCH_RULES: MatchRules = { livesPerPlayer: null };

const NOTICE_SECONDS = 2.5;
/**
 * How much of the player's body must touch a trigger. Smaller than the collision
 * radius so a toe brushing the spike strip doesn't count; that feels fairer.
 */
const TRIGGER_RADIUS = 0.25;
/**
 * Extra distance allowed when checking reach, because the position the match last
 * saw can trail the one on the player's screen by a frame (later: by network lag).
 */
const REACH_TOLERANCE = 0.75;

type Listener<T> = (value: T) => void;

/**
 * Runs one match of a level for up to five players. Pure TypeScript: no React,
 * no Three.js, no networking. Single player is simply a match with one player.
 *
 * Inputs:
 *  - commands (`dispatch`, or `resolve` for a batch): discrete actions, each
 *    naming the responsible player, validated before anything changes;
 *  - frames (`update`): time passing plus every player's position, which drives
 *    traps, exits and reach checks.
 * Outputs:
 *  - an immutable MatchState (`getState` / `subscribe`, for React), split into
 *    shared world state and personal per-player state;
 *  - GameEvents (`onEvent`), each naming the player responsible.
 *
 * Per-frame values (trap heights) live in mutable TrapSystem objects, read by the
 * renderer through `getTrap`, so they never trigger React renders.
 */
export class StageManager {
  private state: MatchState;
  private readonly rules: MatchRules;
  private readonly stateListeners = new Set<() => void>();
  private readonly eventListeners = new Set<Listener<GameEvent>>();
  private readonly traps = new Map<string, TrapSystem>();
  /** Last position seen for each player (from `update`, or their spawn on joining). */
  private readonly positions = new Map<PlayerId, Vec2>();
  private readonly noticeTimers = new Map<PlayerId, number>();
  /** Triggers each player stood in last frame, to tell "stepped in" from "still standing". */
  private readonly occupied = new Map<PlayerId, Set<string>>();
  private noticeCounter = 0;
  private elapsed = 0;

  constructor(
    readonly level: LevelDefinition,
    rules: Partial<MatchRules> = {},
  ) {
    const problems = validateLevel(level);
    if (problems.length > 0) {
      throw new Error(`Level "${level.id}" is invalid:\n- ${problems.join("\n- ")}`);
    }
    this.rules = { ...DEFAULT_MATCH_RULES, ...rules };
    this.state = createInitialMatchState(level);
    for (const trigger of level.triggers) {
      if (trigger.kind === "trap") {
        this.traps.set(trigger.id, new TrapSystem(trigger.timing, trigger.startOffset));
      }
    }
  }

  // --- Subscriptions ----------------------------------------------------------

  getState = (): MatchState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  onEvent(listener: Listener<GameEvent>): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** True while the game world should advance (not paused, not finished). */
  get isRunning() {
    return this.state.status === "playing";
  }

  /** The time limit in seconds, if the level has one. */
  get timeLimitSeconds(): number | null {
    return this.level.timeLimitSeconds ?? null;
  }

  /** Live trap state for the renderer. */
  getTrap(trapId: string): TrapState | undefined {
    return this.traps.get(trapId);
  }

  // --- Players ---------------------------------------------------------------

  /** Register a player (stable id, at most five). They appear at the level's start, side by side. */
  addPlayer(profile: PlayerProfile): JoinResult {
    const joined = addPlayer(this.state, profile, this.rules.livesPerPlayer);
    if (!joined.ok) return joined;
    this.positions.set(profile.id, this.spawnPointFor(profile.id, joined.state).position);
    this.commit(joined.state, [{ type: "playerJoined", playerId: profile.id }]);
    return joined;
  }

  /**
   * A player quits (or, later, disconnects). Their items go back where they were
   * found so the team can't be locked out, and the match may end if nobody is left.
   */
  removePlayer(playerId: PlayerId): boolean {
    const player = this.state.players[playerId];
    if (!player || !this.movePlayer(player, "leave")) return false;
    this.positions.delete(playerId);
    this.emit({ type: "playerLeft", playerId });
    this.checkMatchEnd(playerId);
    return true;
  }

  /** Where `playerId` starts (the level's start point, offset by their slot). */
  spawnPointFor(playerId: PlayerId, state: MatchState = this.state): SpawnPoint {
    return spawnFor(this.level, this.level.playerSpawnId, state.players[playerId]?.slot ?? 0);
  }

  // --- Match flow (state machine) ----------------------------------------------

  pause() {
    if (this.transition("pause")) this.emit({ type: "levelPaused" });
  }

  resume() {
    if (this.transition("resume")) this.emit({ type: "levelResumed" });
  }

  // --- Frames ------------------------------------------------------------------

  /**
   * One frame of play: timers, traps, and the trigger zones each active player
   * stands in. Only players whose position is reported this frame are checked
   * against traps and exits (a disconnected player standing still on the spikes
   * isn't hit over and over). Positions for unknown or inactive players are
   * ignored. Does nothing unless the match is running.
   */
  update(dt: number, positions: Readonly<Record<PlayerId, Vec2>>): FrameResult {
    const respawns: Record<PlayerId, SpawnPoint> = {};
    if (!this.isRunning) return { respawns };

    for (const [playerId, position] of Object.entries(positions)) {
      if (this.state.players[playerId]?.status === "active") this.positions.set(playerId, { ...position });
    }

    this.tickTimers(dt);
    if (!this.isRunning) return { respawns }; // the time limit just ran out
    this.traps.forEach((trap) => trap.update(dt));

    let lastToFinish: PlayerId | null = null;
    for (const playerId of this.state.playerOrder) {
      const position = this.positions.get(playerId);
      if (!position || !(playerId in positions) || this.state.players[playerId].status !== "active") continue;

      const inside = new Set<string>();
      for (const trigger of this.level.triggers) {
        if (!circleOverlapsRect(position, TRIGGER_RADIUS, trigger)) continue;
        inside.add(trigger.id);
        if (trigger.kind === "trap") {
          const respawn = this.hitByTrap(playerId, trigger);
          if (respawn) respawns[playerId] = respawn;
          if (respawn !== undefined) {
            if (respawn === null) lastToFinish = playerId;
            break; // hit: stop checking this player's other triggers
          }
        } else if (this.enterExit(playerId, trigger)) {
          lastToFinish = playerId;
          break;
        }
      }
      this.occupied.set(playerId, inside);
    }

    this.checkMatchEnd(lastToFinish);
    return { respawns };
  }

  // --- Commands ----------------------------------------------------------------

  /** Apply one command now. Returns whether it was accepted, and what to show the player. */
  dispatch(command: GameCommand): CommandResult {
    const invalid = this.checkActor(command.playerId);
    if (invalid) return this.reject(command, invalid);

    switch (command.type) {
      case "interact":
      case "collectItem":
      case "activateObject": {
        const targetId =
          command.type === "interact" ? command.targetId : command.type === "collectItem" ? command.pickupId : command.objectId;
        const target = this.level.interactables.find((item) => item.id === targetId);
        if (!target) return this.reject(command, "unknownTarget");
        if (command.type === "collectItem" && target.kind !== "pickup") return this.reject(command, "wrongKind");
        if (command.type === "activateObject" && target.kind !== "door") return this.reject(command, "wrongKind");
        if (!this.inReach(command.playerId, target)) return this.reject(command, "outOfReach");

        const outcome = runInteraction(target, { state: this.state, level: this.level, actor: command.playerId });
        if (!outcome.accepted) return this.reject(command, outcome.reason, outcome.notices);
        this.commit(outcome.state, outcome.events, outcome.notices, command.playerId);
        return { accepted: true, command, result: outcome.result };
      }

      case "submitPuzzleAnswer":
        return this.submitAnswer(command);

      case "completeObjective": {
        const objective = this.level.objectives.find((o) => o.id === command.objectiveId);
        if (!objective) return this.reject(command, "unknownTarget");
        if (objective.id in this.state.world.completedObjectives) return this.reject(command, "alreadyCompleted");
        if (!isConditionMet(objective.completeWhen, this.state)) return this.reject(command, "conditionNotMet");
        this.commit(creditObjectives(this.state, [objective.id], command.playerId), [
          { type: "objectiveCompleted", playerId: command.playerId, objectiveId: objective.id },
        ]);
        return { accepted: true, command, result: { type: "none" } };
      }
    }
  }

  /**
   * Apply commands that arrived together (e.g. the same tick from several players)
   * in a deterministic order (see orderCommands). Results come back in that order.
   */
  resolve(commands: readonly GameCommand[]): CommandResult[] {
    return orderCommands(commands).map((command) => this.dispatch(command));
  }

  // --- Internals: commands -----------------------------------------------------

  private checkActor(playerId: PlayerId): RejectReason | null {
    const player = this.state.players[playerId];
    if (!player) return "unknownPlayer";
    if (player.status !== "active") return "playerNotActive";
    if (!this.isRunning) return "matchNotRunning";
    return null;
  }

  private inReach(playerId: PlayerId, target: Interactable): boolean {
    const position = this.positions.get(playerId);
    if (!position) return false;
    const distance = Math.hypot(position.x - target.position.x, position.z - target.position.z);
    return distance <= target.reach + REACH_TOLERANCE;
  }

  private submitAnswer(command: Extract<GameCommand, { type: "submitPuzzleAnswer" }>): CommandResult {
    const { playerId, puzzleId, optionIndex } = command;
    if (!this.level.puzzles.some((p) => p.id === puzzleId)) return this.reject(command, "unknownTarget");
    // Answer at the mechanism: the player must be in reach of an object that opens this puzzle.
    const stations = this.level.interactables.filter((i) => i.kind === "puzzle" && i.puzzleId === puzzleId);
    if (!stations.some((station) => this.inReach(playerId, station))) return this.reject(command, "outOfReach");

    const puzzle = getPuzzle(this.level.puzzles, puzzleId);
    const outcome = answerPuzzle(puzzle, this.state.world.puzzles[puzzleId], optionIndex, playerId);
    if (outcome.kind === "rejected") return this.reject(command, outcome.reason);

    const player = this.state.players[playerId];
    const withPuzzle: MatchState = {
      ...this.state,
      world: { ...this.state.world, puzzles: { ...this.state.world.puzzles, [puzzleId]: outcome.state } },
    };

    if (outcome.kind === "wrong") {
      this.commit(
        withPlayer(withPuzzle, playerId, { wrongAnswers: player.wrongAnswers + 1 }),
        [{ type: "puzzleFailed", playerId, puzzleId }],
        [],
        playerId,
      );
      return { accepted: true, command, result: { type: "none" }, correct: false };
    }

    const others = this.state.playerOrder.filter((id) => id !== playerId);
    this.commit(
      withPuzzle,
      [{ type: "puzzleSolved", playerId, puzzleId }],
      [
        { to: playerId, text: puzzle.solvedNotice, tone: "success" },
        ...others.map((id): NoticeRequest => ({ to: id, text: `${player.name} solved ${puzzle.title}.`, tone: "info" })),
      ],
      playerId,
    );
    return { accepted: true, command, result: { type: "none" }, correct: true };
  }

  private reject(command: GameCommand, reason: RejectReason, notices: NoticeRequest[] = []): CommandResult {
    if (notices.length > 0) this.commit(this.state, [], notices);
    this.emit({ type: "commandRejected", playerId: command.playerId, command: command.type, reason });
    return { accepted: false, command, reason };
  }

  // --- Internals: frames ----------------------------------------------------------

  /** Returns the respawn point after a hit, null if the hit eliminated the player, undefined if no hit. */
  private hitByTrap(playerId: PlayerId, trap: TrapTrigger): SpawnPoint | null | undefined {
    if (!this.traps.get(trap.id)?.lethal) return undefined;

    const player = this.state.players[playerId];
    const lives = player.livesRemaining === null ? null : player.livesRemaining - 1;
    this.commit(
      withPlayer(this.state, playerId, { trapHits: player.trapHits + 1, livesRemaining: lives }),
      [{ type: "trapHit", playerId, trapId: trap.id }],
      lives === 0 ? [] : [{ to: playerId, text: trap.hitMessage, tone: "danger" }],
      playerId,
    );

    if (lives === 0) {
      this.movePlayer(this.state.players[playerId], "eliminate");
      this.emit({ type: "playerEliminated", playerId });
      return null;
    }
    const respawn = spawnFor(this.level, trap.respawnPointId, player.slot);
    this.positions.set(playerId, respawn.position);
    return respawn;
  }

  /** Returns true if the player escaped. */
  private enterExit(playerId: PlayerId, exit: ExitTrigger): boolean {
    if (exit.requires && !isConditionMet(exit.requires, this.state)) {
      // Say so once when the player steps in, not on every frame they stand there.
      if (!this.occupied.get(playerId)?.has(exit.id)) {
        this.commit(
          this.state,
          [{ type: "exitLocked", playerId, exitId: exit.id }],
          exit.lockedMessage ? [{ to: playerId, text: exit.lockedMessage, tone: "info" }] : [],
        );
      }
      return false;
    }
    this.movePlayer(this.state.players[playerId], "escape");
    this.emit({ type: "playerEscaped", playerId });
    return true;
  }

  /**
   * Move a player through their status machine. Leaving or being eliminated puts
   * their items back in the world (where each was found).
   */
  private movePlayer(player: MatchPlayer, event: PlayerEvent): boolean {
    const status = playerTransition(player, event);
    if (status === null) return false;

    let next = withPlayer(this.state, player.id, { status, notice: null });
    const events: GameEvent[] = [];
    const notices: NoticeRequest[] = [];

    if ((event === "leave" || event === "eliminate") && player.inventory.length > 0) {
      const heldIds = new Set(player.inventory.map((item) => item.id));
      const pickupIds = this.level.interactables
        .filter((i) => i.kind === "pickup" && heldIds.has(i.item.id))
        .map((i) => i.id);
      const collected = { ...next.world.collectedPickups };
      for (const id of pickupIds) delete collected[id];
      next = withPlayer({ ...next, world: { ...next.world, collectedPickups: collected } }, player.id, { inventory: [] });
      events.push({ type: "itemsReturned", playerId: player.id, pickupIds });
      const names = player.inventory.map((item) => item.name).join(", ");
      for (const id of next.playerOrder) {
        if (id !== player.id) notices.push({ to: id, text: `${player.name}'s ${names} is back where it was found.`, tone: "info" });
      }
    }

    this.commit(next, events, notices, null);
    return true;
  }

  /**
   * The match ends when no player is still active: completed if at least one
   * escaped, failed if everyone was eliminated or left. An empty match (nobody
   * has joined yet) never ends this way.
   */
  private checkMatchEnd(lastActor: PlayerId | null) {
    const players = listPlayers(this.state);
    if (!this.isRunning || players.length === 0 || players.some((p) => p.status === "active")) return;

    if (players.some((p) => p.status === "escaped")) {
      if (this.transition("complete", { elapsedSeconds: this.elapsed }, lastActor)) {
        this.emit({ type: "levelCompleted", elapsedSeconds: this.elapsed });
      }
    } else {
      this.fail("allEliminated");
    }
  }

  private fail(reason: FailReason, changes: Partial<MatchState> = {}) {
    if (this.transition("fail", { ...changes, failReason: reason })) {
      this.emit({ type: "levelFailed", reason });
    }
  }

  /** Apply a match-flow event if it is allowed. Returns false (and changes nothing) if not. */
  private transition(event: LevelEvent, changes: Partial<MatchState> = {}, actor: PlayerId | null = null): boolean {
    const status = nextState(LEVEL_TRANSITIONS, this.state.status, event);
    if (status === null) return false;
    this.commit({ ...this.state, ...changes, status }, [], [], actor);
    return true;
  }

  private tickTimers(dt: number) {
    const previousSeconds = wholeSeconds(this.elapsed);
    this.elapsed += dt;
    let next = this.state;

    if (wholeSeconds(this.elapsed) !== previousSeconds) next = { ...next, elapsedSeconds: wholeSeconds(this.elapsed) };
    for (const [playerId, timeLeft] of this.noticeTimers) {
      const remaining = timeLeft - dt;
      if (remaining > 0) {
        this.noticeTimers.set(playerId, remaining);
      } else {
        this.noticeTimers.delete(playerId);
        if (next.players[playerId]?.notice) next = withPlayer(next, playerId, { notice: null });
      }
    }
    this.commit(next);

    const limit = this.level.timeLimitSeconds;
    if (limit !== undefined && this.elapsed >= limit) this.fail("timeUp", { elapsedSeconds: limit });
  }

  /**
   * Store a new state (if it changed), tell React, then tell event listeners.
   * Pop-ups are delivered to their players here, and objectives that just became
   * true are credited to `actor` (the player whose action caused the change).
   */
  private commit(next: MatchState, events: GameEvent[] = [], notices: NoticeRequest[] = [], actor: PlayerId | null = null) {
    for (const notice of notices) {
      const recipients = notice.to === "everyone" ? next.playerOrder : [notice.to];
      for (const id of recipients) {
        if (!next.players[id] || next.players[id].status === "left") continue;
        next = withPlayer(next, id, { notice: { id: ++this.noticeCounter, text: notice.text, tone: notice.tone } });
        this.noticeTimers.set(id, NOTICE_SECONDS);
      }
    }

    const completed = newlyCompletedObjectives(this.level, next);
    if (completed.length > 0) {
      next = creditObjectives(
        next,
        completed.map((o) => o.id),
        actor,
      );
      events = [...events, ...completed.map((o): GameEvent => ({ type: "objectiveCompleted", playerId: actor, objectiveId: o.id }))];
    }

    if (next !== this.state) {
      this.state = next;
      this.stateListeners.forEach((listener) => listener());
    }
    events.forEach((event) => this.emit(event));
  }

  private emit(event: GameEvent) {
    this.eventListeners.forEach((listener) => listener(event));
  }
}
