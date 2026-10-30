import { BUNDLED_QUESTION_PACKS } from '../content/packRegistry';
import {
  AiDifficultyId,
  COURT_GEOMETRY,
  RoomPresetId,
  SessionLengthId,
} from '../shared/config/balance';
import {
  PublicDuelQuestion,
  QuestionPack,
  validateQuestionPack,
} from '../shared/content/question-schema';
import {
  AuthoritativeMatchStateSnapshot,
  ClientToServerMessage,
  RoomLobbySnapshot,
  ServerToClientMessage,
} from '../shared/protocol/messages';
import { computeDistance2D } from '../shared/rules/block';
import {
  AuthoritativeMatchEngine,
  FeedbackBannerState,
  MatchPhase,
  PlayerSimState,
} from '../shared/rules/matchStateMachine';
import {
  MatchAttemptEvent,
  PlayerLearningSummary,
  PlayerSlot,
} from '../shared/rules/possession';
import { classifyShotZone, computeBaseShotProbability } from '../shared/rules/shot';
import { SoundEngine } from './game/audio/soundEngine';
import { CourtIqRenderer, RenderQualityMode } from './game/engine';
import {
  DEFAULT_KEY_BINDINGS,
  InputGuardController,
  KeyBindingsConfig,
} from './game/input/controls';

class CourtIqApp {
  private renderer: CourtIqRenderer;
  private sound = new SoundEngine();
  private input: InputGuardController;

  private packs: QuestionPack[] = [...BUNDLED_QUESTION_PACKS];
  private soloEngine: AuthoritativeMatchEngine | null = null;

  // Online client state
  private ws: WebSocket | null = null;
  private httpTransportActive = false;
  private httpClientId = `cid-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  private httpOutgoingQueue: ClientToServerMessage[] = [];
  private httpSyncInFlight = false;
  private httpPollTimer: number | null = null;
  private onlineSlot: PlayerSlot = 0;
  private onlineRoomCode: string | null = null;
  private onlineReconnectToken: string | null = null;
  private onlineLobby: RoomLobbySnapshot | null = null;
  private onlineSnapshot: AuthoritativeMatchStateSnapshot | null = null;
  private onlineReady = false;
  private pingTimer: number | null = null;

  // Preferences
  private reducedMotion = false;
  private touchOverlayEnabled = false;
  private activeRemapField: keyof KeyBindingsConfig | null = null;

  // Transition tracking for sound triggers
  private lastPhase: MatchPhase = 'Lobby';
  private lastFeedbackDuelId: string | null = null;

  constructor() {
    const viewport = document.getElementById('viewport-container')!;
    this.renderer = new CourtIqRenderer(viewport);

    const savedBindings = this.loadSavedBindings();
    this.input = new InputGuardController(savedBindings, {
      onAnswer: (duelId, optionId) => this.handlePlayerAnswer(duelId, optionId),
      onPauseToggle: () => this.toggleSettingsModal(),
    });

    this.loadPreferences();
    this.populatePackDropdown();
    this.bindUiEvents();
    this.renderRemapGrid();

    // Create an idle preview match in Lobby so the opening view immediately shows
    // the complete 3D arena, hoop, scoreboard, and two players on court!
    this.initLobbyPreviewEngine();

    let lastTime = performance.now();
    const animate = (now: number) => {
      const deltaMs = Math.min(100, Math.max(1, now - lastTime));
      lastTime = now;
      this.tickFrame(deltaMs, now);
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  private initLobbyPreviewEngine(): void {
    this.soloEngine = new AuthoritativeMatchEngine({
      matchId: 'lobby-preview',
      mode: 'solo',
      pack: this.packs[0],
      roomPresetId: 'standard',
      sessionLengthId: 'standard',
      aiDifficulty: 'intermediate',
      player0: {
        id: 'p0',
        pseudonym:
          (document.getElementById('input-pseudonym') as HTMLInputElement)
            ?.value || 'Student A',
        appearancePreset: Number(
          (document.getElementById('select-appearance') as HTMLSelectElement)
            ?.value || 0
        ),
      },
      player1: {
        id: 'bot',
        pseudonym: 'CourtBot',
        isAi: true,
        appearancePreset: 1,
      },
    });
  }

  private populatePackDropdown(): void {
    const sel = document.getElementById('select-pack') as HTMLSelectElement;
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '';
    for (const p of this.packs) {
      const approvedCount = p.questions.filter(
        (q) => q.status === 'approved'
      ).length;
      const opt = document.createElement('option');
      opt.value = p.packId;
      opt.textContent = `${p.title} (${approvedCount} Approved Qs • v${p.packVersion})`;
      sel.appendChild(opt);
    }
    if (currentVal && this.packs.some((p) => p.packId === currentVal)) {
      sel.value = currentVal;
    }
  }

  private bindUiEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (this.activeRemapField) {
        e.preventDefault();
        this.input.bindings[this.activeRemapField] = e.code;
        this.activeRemapField = null;
        this.saveBindings();
        this.renderRemapGrid();
        return;
      }
      // Do not intercept typing inside text inputs or textareas
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return;
      }
      this.input.handleKeyDown(e);
    });

    window.addEventListener('keyup', (e) => {
      this.input.handleKeyUp(e);
    });

    // Mode tabs
    const tabs: Array<[string, string]> = [
      ['tab-solo', 'panel-solo-actions'],
      ['tab-online', 'panel-online-actions'],
      ['tab-content', 'panel-content-validator'],
    ];
    for (const [tabId, panelId] of tabs) {
      document.getElementById(tabId)?.addEventListener('click', () => {
        for (const [t, p] of tabs) {
          const isTarget = t === tabId;
          const tabEl = document.getElementById(t);
          const panelEl = document.getElementById(p);
          tabEl?.classList.toggle('active', isTarget);
          tabEl?.setAttribute('aria-selected', String(isTarget));
          panelEl?.classList.toggle('hidden', !isTarget);
        }
        const aiGroup = document.getElementById('ai-difficulty-group');
        aiGroup?.classList.toggle('hidden', tabId !== 'tab-solo');
      });
    }

    // Appearance selector live preview
    document
      .getElementById('select-appearance')
      ?.addEventListener('change', (e) => {
        const preset = Number((e.target as HTMLSelectElement).value || 0);
        if (this.soloEngine && this.soloEngine.phase === 'Lobby') {
          this.soloEngine.players[0].appearancePreset = preset;
        }
      });

    // Start Solo Match
    document
      .getElementById('btn-start-solo')
      ?.addEventListener('click', () => this.startSoloMatch(false));

    // Quick Demo Shot Duel Preview
    document
      .getElementById('btn-quick-demo-shot')
      ?.addEventListener('click', () => this.startSoloMatch(true));

    // Answer option buttons (0..3)
    for (let idx = 0; idx < 4; idx++) {
      document
        .getElementById(`btn-opt-${idx}`)
        ?.addEventListener('click', () => {
          this.input.trySelectDisplayedOptionIndex(idx);
        });
    }

    // Next Possession button on Feedback card
    document
      .getElementById('btn-next-possession')
      ?.addEventListener('click', () => {
        if (this.soloEngine && this.soloEngine.phase === 'Feedback') {
          this.soloEngine.advanceFromFeedback();
        }
      });

    // Return to Lobby button
    document
      .getElementById('btn-return-lobby')
      ?.addEventListener('click', () => this.returnToLobby());

    // Results screen buttons
    document
      .getElementById('btn-results-play-again')
      ?.addEventListener('click', () => this.returnToLobby());
    document
      .getElementById('btn-practice-missed')
      ?.addEventListener('click', () => this.startMissedQuestionsPractice());
    document
      .getElementById('btn-export-json')
      ?.addEventListener('click', () => this.exportMatchData('json'));
    document
      .getElementById('btn-export-csv')
      ?.addEventListener('click', () => this.exportMatchData('csv'));

    // Online Room controls
    document
      .getElementById('btn-create-room')
      ?.addEventListener('click', () => this.createOnlineRoom());
    document
      .getElementById('btn-join-room')
      ?.addEventListener('click', () => this.joinOnlineRoom());
    document
      .getElementById('btn-copy-room-code')
      ?.addEventListener('click', () => {
        if (this.onlineRoomCode) {
          navigator.clipboard?.writeText(this.onlineRoomCode).catch(() => {});
        }
      });
    document
      .getElementById('btn-toggle-ready')
      ?.addEventListener('click', () => {
        this.onlineReady = !this.onlineReady;
        this.sendWsMessage({ type: 'SET_READY', ready: this.onlineReady });
      });

    // Content validator & custom JSON import
    document
      .getElementById('btn-validate-pack')
      ?.addEventListener('click', () => this.validateAndImportCustomPack());
    document
      .getElementById('btn-load-sample-pack-json')
      ?.addEventListener('click', () => {
        const ta = document.getElementById(
          'textarea-custom-pack'
        ) as HTMLTextAreaElement;
        if (ta) {
          const sample: QuestionPack = {
            packId: 'custom-spx101-pilot',
            packVersion: 1,
            title: 'Custom SPX101 Pilot Pack',
            course: 'SPX101',
            description: 'Teacher-approved custom pilot question pack.',
            approvedBy: 'Course Coordinator',
            approvedAtIso: new Date().toISOString(),
            questions: this.packs[0].questions.slice(0, 6),
          };
          ta.value = JSON.stringify(sample, null, 2);
        }
      });

    // Top bar modals & audio toggles
    document
      .getElementById('btn-open-tutorial')
      ?.addEventListener('click', () => {
        document.getElementById('tutorial-modal')?.classList.remove('hidden');
      });
    document
      .getElementById('btn-close-tutorial')
      ?.addEventListener('click', () => {
        document.getElementById('tutorial-modal')?.classList.add('hidden');
      });

    document
      .getElementById('btn-open-settings')
      ?.addEventListener('click', () => this.toggleSettingsModal(true));
    document
      .getElementById('btn-close-settings')
      ?.addEventListener('click', () => this.toggleSettingsModal(false));

    document
      .getElementById('btn-toggle-mute')
      ?.addEventListener('click', () => {
        this.sound.setMuted(!this.sound.muted);
        this.syncAudioMuteUi();
        this.savePreferences();
      });

    // Settings checkboxes & quality mode
    document
      .getElementById('chk-reduced-motion')
      ?.addEventListener('change', (e) => {
        this.reducedMotion = (e.target as HTMLInputElement).checked;
        this.savePreferences();
      });
    document
      .getElementById('chk-mute-audio')
      ?.addEventListener('change', (e) => {
        this.sound.setMuted((e.target as HTMLInputElement).checked);
        this.syncAudioMuteUi();
        this.savePreferences();
      });
    document
      .getElementById('chk-touch-overlay')
      ?.addEventListener('change', (e) => {
        this.touchOverlayEnabled = (e.target as HTMLInputElement).checked;
        this.savePreferences();
      });
    document
      .getElementById('select-quality-mode')
      ?.addEventListener('change', (e) => {
        const mode = (e.target as HTMLSelectElement).value as RenderQualityMode;
        this.renderer.setQualityMode(mode);
        this.savePreferences();
      });
    document
      .getElementById('btn-reset-bindings')
      ?.addEventListener('click', () => {
        this.input.bindings = { ...DEFAULT_KEY_BINDINGS };
        this.saveBindings();
        this.renderRemapGrid();
      });

    // Touch controls wiring
    this.bindTouchControls();
  }

  private bindTouchControls(): void {
    const base = document.getElementById('touch-joystick-base');
    const stick = document.getElementById('touch-joystick-stick');
    const sprintBtn = document.getElementById('btn-touch-sprint');
    const shootBtn = document.getElementById('btn-touch-shoot');

    if (base && stick) {
      let dragging = false;
      const updateStick = (clientX: number, clientY: number) => {
        const rect = base.getBoundingClientRect();
        const cx = rect.left + rect.width * 0.5;
        const cy = rect.top + rect.height * 0.5;
        const maxR = rect.width * 0.42;
        let dx = clientX - cx;
        let dy = clientY - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > maxR) {
          dx = (dx / dist) * maxR;
          dy = (dy / dist) * maxR;
        }
        stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        this.input.setTouchMove(dx / maxR, dy / maxR);
      };

      const resetStick = () => {
        dragging = false;
        stick.style.transform = 'translate(-50%, -50%)';
        this.input.setTouchMove(0, 0);
      };

      base.addEventListener('pointerdown', (e) => {
        dragging = true;
        base.setPointerCapture(e.pointerId);
        updateStick(e.clientX, e.clientY);
      });
      base.addEventListener('pointermove', (e) => {
        if (dragging) updateStick(e.clientX, e.clientY);
      });
      base.addEventListener('pointerup', resetStick);
      base.addEventListener('pointercancel', resetStick);
    }

    sprintBtn?.addEventListener('pointerdown', () =>
      this.input.setTouchSprint(true)
    );
    sprintBtn?.addEventListener('pointerup', () =>
      this.input.setTouchSprint(false)
    );
    sprintBtn?.addEventListener('pointercancel', () =>
      this.input.setTouchSprint(false)
    );

    shootBtn?.addEventListener('click', () => this.input.triggerTouchShoot());
  }

  private getSelectedConfig() {
    const pseudonym =
      (
        document.getElementById('input-pseudonym') as HTMLInputElement
      )?.value.trim() || 'Student A';
    const appearancePreset = Number(
      (document.getElementById('select-appearance') as HTMLSelectElement)
        ?.value || 0
    );
    const packId =
      (document.getElementById('select-pack') as HTMLSelectElement)?.value ||
      this.packs[0].packId;
    const roomPresetId = ((
      document.getElementById('select-room-preset') as HTMLSelectElement
    )?.value || 'standard') as RoomPresetId;
    const sessionLengthId = ((
      document.getElementById('select-session-length') as HTMLSelectElement
    )?.value || 'standard') as SessionLengthId;
    const aiDifficulty = ((
      document.getElementById('select-ai-difficulty') as HTMLSelectElement
    )?.value || 'intermediate') as AiDifficultyId;

    const pack =
      this.packs.find((p) => p.packId === packId) ?? this.packs[0];
    return {
      pseudonym,
      appearancePreset,
      pack,
      roomPresetId,
      sessionLengthId,
      aiDifficulty,
    };
  }

  private startSoloMatch(instantShotPreview = false, overridePack?: QuestionPack): void {
    this.closeOnlineConnection();
    this.onlineSnapshot = null;

    const cfg = this.getSelectedConfig();
    const activePack = overridePack ?? cfg.pack;

    this.soloEngine = new AuthoritativeMatchEngine({
      matchId: `solo-${Date.now()}`,
      mode: 'solo',
      pack: activePack,
      roomPresetId: cfg.roomPresetId,
      sessionLengthId: cfg.sessionLengthId,
      aiDifficulty: cfg.aiDifficulty,
      player0: {
        id: 'student-local',
        pseudonym: cfg.pseudonym,
        appearancePreset: cfg.appearancePreset,
      },
      player1: {
        id: 'ai-opponent',
        pseudonym: `CourtBot (${cfg.aiDifficulty.slice(0, 3).toUpperCase()})`,
        isAi: true,
        appearancePreset: (cfg.appearancePreset + 1) % 4,
      },
    });

    this.soloEngine.startMatch();

    if (instantShotPreview) {
      // Position player at a clean mid-range wing spot and immediately trigger a shot duel
      this.soloEngine.players[0].x = -2.1;
      this.soloEngine.players[0].z = -2.1;
      this.soloEngine.players[1].x = -1.1;
      this.soloEngine.players[1].z = -2.9;
      this.soloEngine.initiateShotAttempt();
    }
  }

  private returnToLobby(): void {
    this.closeOnlineConnection();
    this.onlineSnapshot = null;
    this.sound.stopSlowMoAtmosphere();
    this.initLobbyPreviewEngine();
  }

  private handlePlayerAnswer(duelId: string, optionId: string): void {
    this.sound.playAnswerLock();

    if (
      this.onlineSnapshot &&
      (this.ws?.readyState === WebSocket.OPEN || this.httpTransportActive)
    ) {
      this.sendWsMessage({
        type: 'SUBMIT_ANSWER',
        duelId,
        optionId,
      });
      return;
    }

    if (this.soloEngine) {
      this.soloEngine.submitAnswer({
        slot: 0,
        duelId,
        optionId,
      });
    }
  }

  private tickFrame(realDeltaMs: number, nowMs: number): void {
    const realDeltaSec = realDeltaMs / 1000;
    const nowSec = nowMs / 1000;

    // Determine whether we are rendering an active online match or the local solo engine
    if (this.onlineSnapshot) {
      const snap = this.onlineSnapshot;
      this.syncInputAndOverlaysFromOnline(snap);

      const moveIntent = this.input.consumeMoveInput(snap.phase);
      if (snap.phase === 'Possession') {
        this.sendWsMessage({ type: 'MOVE_INTENT', input: moveIntent });
      }

      this.renderer.renderFrame(
        {
          phase: snap.phase,
          players: snap.players,
          attackerSlot: snap.scoreState.currentAttacker,
          scores: snap.scoreState.scores,
          shotClockSec: Math.ceil(snap.movementClockRemainingMs / 1000),
          ballPos: snap.ballPosition,
          blockEligible: snap.liveBlockEligibility.eligible,
          reducedMotion: this.reducedMotion,
        },
        realDeltaSec,
        nowSec
      );
      return;
    }

    if (!this.soloEngine) return;

    const eng = this.soloEngine;
    const activeDuel = eng.activeDuel;
    const readingProtected =
      eng.phase === 'QuestionReady' ||
      (activeDuel !== null &&
        activeDuel.elapsedRealMs < activeDuel.config.readingMs);

    this.input.syncDuelContext({
      phase: eng.phase,
      duelId: activeDuel?.duelId ?? null,
      readingProtected,
      displayedOptions: activeDuel?.displayedOptionsBySlot[0] ?? [],
    });

    const moveInput0 = this.input.consumeMoveInput(eng.phase);
    const neutralInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };

    if (eng.phase !== 'Lobby') {
      eng.step(realDeltaMs, [moveInput0, neutralInput]);
    }

    // Trigger sound effects on phase/outcome transitions
    this.handlePhaseAudioEffects(
      eng.phase,
      eng.players,
      eng.feedbackState,
      nowMs
    );

    const liveBlock = eng.getLiveBlockEligibility();
    this.updateDomOverlaysForSolo(eng, liveBlock.eligible);

    this.renderer.renderFrame(
      {
        phase: eng.phase,
        players: eng.players,
        attackerSlot: eng.scoreState.currentAttacker,
        scores: eng.scoreState.scores,
        shotClockSec: Math.ceil(eng.movementClockRemainingMs / 1000),
        ballPos: eng.getBallPosition3D(),
        blockEligible: liveBlock.eligible,
        reducedMotion: this.reducedMotion,
      },
      realDeltaSec,
      nowSec
    );
  }

  private handlePhaseAudioEffects(
    phase: MatchPhase,
    players: [PlayerSimState, PlayerSimState],
    feedback: FeedbackBannerState | null,
    nowMs: number
  ): void {
    if (
      phase === 'Possession' &&
      (players[0].animState === 'dribble' || players[1].animState === 'dribble')
    ) {
      this.sound.maybePlayDribbleStep(nowMs);
    }

    if (this.lastPhase === 'Possession' && phase === 'QuestionReady') {
      this.sound.playShotRelease();
      this.sound.startSlowMoAtmosphere();
    }

    if (
      (this.lastPhase === 'Duel' || this.lastPhase === 'QuestionReady') &&
      phase === 'Resolution'
    ) {
      this.sound.stopSlowMoAtmosphere();
    }

    if (
      phase === 'Feedback' &&
      feedback &&
      this.lastFeedbackDuelId !== feedback.duelId
    ) {
      this.lastFeedbackDuelId = feedback.duelId;
      this.sound.stopSlowMoAtmosphere();
      if (feedback.outcome === 'basket') {
        this.sound.playSwish();
        this.renderer.triggerBasketCelebration();
      } else if (feedback.outcome === 'block') {
        this.sound.playBlockSwat();
        this.renderer.triggerBlockEffect();
      } else if (feedback.outcome === 'miss') {
        this.sound.playRimClank();
      } else {
        this.sound.playBuzzer();
      }
    }

    this.lastPhase = phase;
  }

  private updateDomOverlaysForSolo(
    eng: AuthoritativeMatchEngine,
    blockEligible: boolean
  ): void {
    const att = eng.scoreState.currentAttacker;
    const activeDuel = eng.activeDuel;
    const readingProtected =
      eng.phase === 'QuestionReady' ||
      (activeDuel !== null &&
        activeDuel.elapsedRealMs < activeDuel.config.readingMs);

    this.updateTopHud({
      phase: eng.phase,
      yourSlot: 0,
      players: eng.players,
      scores: eng.scoreState.scores,
      possessionsCompleted: eng.scoreState.possessionsCompleted,
      maxPossessions: eng.rules.maxPossessionsPerPlayer,
      isOvertime: eng.scoreState.isOvertime,
      overtimeRound: eng.scoreState.overtimeRound,
      attackerSlot: att,
      movementClockMs: eng.movementClockRemainingMs,
      blockEligible,
    });

    // Show/hide overlays by phase
    document
      .getElementById('lobby-overlay')
      ?.classList.toggle('hidden', eng.phase !== 'Lobby');
    document
      .getElementById('btn-return-lobby')
      ?.classList.toggle('hidden', eng.phase === 'Lobby');
    document
      .getElementById('possession-hint-pill')
      ?.classList.toggle('hidden', eng.phase !== 'Possession');

    const showTouch =
      eng.phase === 'Possession' &&
      (this.touchOverlayEnabled || 'ontouchstart' in window);
    document
      .getElementById('touch-controls')
      ?.classList.toggle('hidden', !showTouch);

    // Question panel
    const inQuestion =
      (eng.phase === 'QuestionReady' || eng.phase === 'Duel') &&
      activeDuel !== null;
    document
      .getElementById('question-overlay')
      ?.classList.toggle('hidden', !inQuestion);

    if (inQuestion && activeDuel) {
      this.renderQuestionPanel({
        publicQuestion: activeDuel.publicQuestionsBySlot[0],
        elapsedRealMs: activeDuel.elapsedRealMs,
        readingProtected,
        yourSubmittedOptionId: activeDuel.answersBySlot[0]?.optionId ?? null,
        opponentSubmitted: activeDuel.answersBySlot[1] !== null,
        blockEligibleAtRelease:
          activeDuel.releaseSnapshot.blockEligibility.eligible,
        youAreAttacker: att === 0,
      });
    }

    // Feedback overlay
    document
      .getElementById('feedback-overlay')
      ?.classList.toggle('hidden', eng.phase !== 'Feedback');
    if (eng.phase === 'Feedback' && eng.feedbackState) {
      this.renderFeedbackPanel(eng.feedbackState);
    }

    // Results overlay
    const inResults = eng.phase === 'MatchEnd';
    document
      .getElementById('results-overlay')
      ?.classList.toggle('hidden', !inResults);
    if (inResults) {
      const summaries = eng.getLearningSummaries();
      this.renderResultsScreen(
        0,
        eng.scoreState.winner,
        summaries,
        eng.attemptEvents
      );
    }
  }

  private syncInputAndOverlaysFromOnline(
    snap: AuthoritativeMatchStateSnapshot
  ): void {
    const slot = snap.yourSlot;
    const att = snap.scoreState.currentAttacker;

    this.input.syncDuelContext({
      phase: snap.phase,
      duelId: snap.activeDuel?.duelId ?? null,
      readingProtected: snap.activeDuel?.readingProtected ?? true,
      displayedOptions: snap.activeDuel?.publicQuestion.options ?? [],
    });

    this.handlePhaseAudioEffects(
      snap.phase,
      snap.players,
      snap.feedbackState,
      performance.now()
    );

    this.updateTopHud({
      phase: snap.phase,
      yourSlot: slot,
      players: snap.players,
      scores: snap.scoreState.scores,
      possessionsCompleted: snap.scoreState.possessionsCompleted,
      maxPossessions: snap.rules.maxPossessionsPerPlayer,
      isOvertime: snap.scoreState.isOvertime,
      overtimeRound: snap.scoreState.overtimeRound,
      attackerSlot: att,
      movementClockMs: snap.movementClockRemainingMs,
      blockEligible: snap.liveBlockEligibility.eligible,
    });

    document.getElementById('lobby-overlay')?.classList.add('hidden');
    document.getElementById('btn-return-lobby')?.classList.remove('hidden');
    document
      .getElementById('possession-hint-pill')
      ?.classList.toggle('hidden', snap.phase !== 'Possession');

    const inQuestion =
      (snap.phase === 'QuestionReady' || snap.phase === 'Duel') &&
      snap.activeDuel !== null;
    document
      .getElementById('question-overlay')
      ?.classList.toggle('hidden', !inQuestion);

    if (inQuestion && snap.activeDuel) {
      this.renderQuestionPanel({
        publicQuestion: snap.activeDuel.publicQuestion,
        elapsedRealMs: snap.activeDuel.elapsedRealMs,
        readingProtected: snap.activeDuel.readingProtected,
        yourSubmittedOptionId: snap.activeDuel.yourSubmittedOptionId,
        opponentSubmitted: snap.activeDuel.opponentSubmitted,
        blockEligibleAtRelease: snap.activeDuel.blockEligibleAtRelease,
        youAreAttacker: att === slot,
      });
    }

    document
      .getElementById('feedback-overlay')
      ?.classList.toggle('hidden', snap.phase !== 'Feedback');
    if (snap.phase === 'Feedback' && snap.feedbackState) {
      this.renderFeedbackPanel(snap.feedbackState);
    }

    const inResults = snap.phase === 'MatchEnd';
    document
      .getElementById('results-overlay')
      ?.classList.toggle('hidden', !inResults);
    if (inResults && snap.learningSummaries && snap.attemptEvents) {
      this.renderResultsScreen(
        slot,
        snap.scoreState.winner,
        snap.learningSummaries,
        snap.attemptEvents
      );
    }
  }

  private updateTopHud(params: {
    phase: MatchPhase;
    yourSlot: PlayerSlot;
    players: [PlayerSimState, PlayerSimState];
    scores: readonly [number, number];
    possessionsCompleted: readonly [number, number];
    maxPossessions: number;
    isOvertime: boolean;
    overtimeRound: number;
    attackerSlot: PlayerSlot;
    movementClockMs: number;
    blockEligible: boolean;
  }): void {
    const p0Card = document.getElementById('hud-p0-card');
    const p1Card = document.getElementById('hud-p1-card');
    p0Card?.classList.toggle('active-attacker', params.attackerSlot === 0);
    p1Card?.classList.toggle('active-attacker', params.attackerSlot === 1);

    const setTxt = (id: string, val: string) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== val) el.textContent = val;
    };

    setTxt('hud-p0-name', params.players[0].pseudonym);
    setTxt('hud-p1-name', params.players[1].pseudonym);
    setTxt('hud-p0-score', String(params.scores[0]));
    setTxt('hud-p1-score', String(params.scores[1]));
    setTxt(
      'hud-p0-role',
      params.attackerSlot === 0 ? '🏀 ATT' : '🛡️ DEF'
    );
    setTxt(
      'hud-p1-role',
      params.attackerSlot === 1 ? '🏀 ATT' : '🛡️ DEF'
    );

    const currentRound =
      Math.min(
        params.possessionsCompleted[0],
        params.possessionsCompleted[1]
      ) + 1;
    setTxt(
      'hud-possession-label',
      params.isOvertime
        ? `OVERTIME PAIR ${params.overtimeRound}`
        : `POSS ${Math.min(currentRound, params.maxPossessions)} / ${params.maxPossessions}`
    );

    const clockSec = (params.movementClockMs / 1000).toFixed(1);
    const clockEl = document.getElementById('hud-shot-clock');
    if (clockEl) {
      clockEl.textContent = `${clockSec}s`;
      clockEl.classList.toggle('urgent', params.movementClockMs <= 4000);
    }

    // Current attacker distance & base probability
    const attPlayer = params.players[params.attackerSlot];
    const dist = computeDistance2D(
      { x: attPlayer.x, z: attPlayer.z },
      { x: COURT_GEOMETRY.hoopX, z: COURT_GEOMETRY.hoopZ }
    );
    const { zone, pointValue } = classifyShotZone(dist);
    const baseProb = Math.round(
      computeBaseShotProbability({
        zone,
        heavilyContested: params.blockEligible,
        releasedWhileSprinting: attPlayer.isSprinting,
      }) * 100
    );
    setTxt(
      'hud-zone-badge',
      `${pointValue}PT ${zone.toUpperCase()} • Base ${baseProb}%`
    );

    // Subtle "Block available" indicator (Section 8)
    const blockInd = document.getElementById('hud-block-indicator');
    blockInd?.classList.toggle(
      'hidden',
      params.phase === 'Lobby' || !params.blockEligible
    );

    // Sprint stamina bar for local player
    const staminaFill = document.getElementById('hud-stamina-fill');
    if (staminaFill) {
      const pct = Math.round(
        params.players[params.yourSlot].sprintStamina * 100
      );
      staminaFill.style.width = `${pct}%`;
    }
  }

  private renderQuestionPanel(params: {
    publicQuestion: PublicDuelQuestion;
    elapsedRealMs: number;
    readingProtected: boolean;
    yourSubmittedOptionId: string | null;
    opponentSubmitted: boolean;
    blockEligibleAtRelease: boolean;
    youAreAttacker: boolean;
  }): void {
    const q = params.publicQuestion;
    const setTxt = (id: string, val: string) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== val) el.textContent = val;
    };

    setTxt('q-course-badge', `${q.course} • Week ${q.week}`);
    setTxt('q-topic-badge', q.topic);
    setTxt(
      'q-contest-badge',
      params.blockEligibleAtRelease
        ? '🛡️ Defender in Block Range (≤1.8m)'
        : '📏 Defender Out of Block Range (Open Shot)'
    );

    const readingPill = document.getElementById('q-reading-pill');
    if (readingPill) {
      if (params.readingProtected) {
        const readRem = Math.max(
          0,
          (q.readingMs - params.elapsedRealMs) / 1000
        ).toFixed(1);
        readingPill.textContent = `📖 Reading Period (${readRem}s)...`;
        readingPill.classList.remove('hidden');
      } else {
        readingPill.classList.add('hidden');
      }
    }

    const remSec = Math.max(
      0,
      (q.answerWindowMs - params.elapsedRealMs) / 1000
    ).toFixed(1);
    setTxt('q-timer-text', `${remSec}s`);

    const timerBar = document.getElementById('q-timer-bar');
    if (timerBar) {
      const pct = Math.max(
        0,
        Math.min(100, ((q.answerWindowMs - params.elapsedRealMs) / q.answerWindowMs) * 100)
      );
      timerBar.style.width = `${pct}%`;
    }

    setTxt('q-stem-text', q.stem);

    const letters = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < 4; i++) {
      const btn = document.getElementById(`btn-opt-${i}`) as HTMLButtonElement | null;
      const opt = q.options[i];
      if (!btn || !opt) continue;

      const keySpan = btn.querySelector('.opt-key');
      const txtSpan = btn.querySelector('.opt-text');
      const iconSpan = btn.querySelector('.opt-status-icon');

      if (keySpan) keySpan.textContent = `${i + 1} / ${letters[i]}`;
      if (txtSpan) txtSpan.textContent = opt.text;

      const isSelected = params.yourSubmittedOptionId === opt.id;
      btn.classList.toggle('selected-locked', isSelected);
      btn.disabled =
        params.readingProtected || params.yourSubmittedOptionId !== null;

      if (iconSpan) {
        iconSpan.textContent = isSelected
          ? '✓ Locked'
          : params.readingProtected
            ? '🔒'
            : '';
      }
    }

    const yourStatus = document.getElementById('q-your-status');
    if (yourStatus) {
      yourStatus.classList.toggle(
        'submitted',
        params.yourSubmittedOptionId !== null
      );
      yourStatus.textContent =
        params.yourSubmittedOptionId !== null
          ? '✓ Answer submitted (Locked)'
          : params.readingProtected
            ? '📖 Read carefully — buttons unlock after reading period'
            : params.youAreAttacker
              ? '🏀 You are Shooting: Answer accurately & quickly to boost shot %!'
              : params.blockEligibleAtRelease
                ? '🛡️ You are Contesting: Answer correctly first to BLOCK!'
                : '📏 Out of block range: Answer correctly for your learning record!';
    }

    const oppStatus = document.getElementById('q-opponent-status');
    if (oppStatus) {
      oppStatus.classList.toggle('submitted', params.opponentSubmitted);
      oppStatus.textContent = params.opponentSubmitted
        ? '✓ Opponent submitted'
        : '⏳ Opponent deciding...';
    }
  }

  private renderFeedbackPanel(fb: FeedbackBannerState): void {
    const setTxt = (id: string, val: string) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== val) el.textContent = val;
    };

    setTxt('fb-outcome-pill', fb.headline);
    setTxt('fb-subheadline', fb.subheadline);
    setTxt(
      'fb-prob-badge',
      fb.outcome === 'block'
        ? 'Blocked Override'
        : fb.outcome === 'shot-clock-turnover'
          ? 'Turnover'
          : `Shot Probability: ${Math.round(fb.finalProbability * 100)}%`
    );
    setTxt('fb-correct-text', fb.correctOptionText);
    setTxt('fb-explanation-text', fb.explanation);
    setTxt('fb-source-ref', `Source: ${fb.sourceRef}`);
  }

  private lastRenderedMatchId: string | null = null;

  private renderResultsScreen(
    yourSlot: PlayerSlot,
    winner: PlayerSlot | null,
    summaries: [PlayerLearningSummary, PlayerLearningSummary],
    events: readonly MatchAttemptEvent[]
  ): void {
    const matchKey = `${events.length}-${summaries[0].basketballScore}-${summaries[1].basketballScore}`;
    if (this.lastRenderedMatchId === matchKey) return;
    this.lastRenderedMatchId = matchKey;

    const oppSlot: PlayerSlot = yourSlot === 0 ? 1 : 0;
    const you = summaries[yourSlot];
    const opp = summaries[oppSlot];

    const headlineEl = document.getElementById('res-winner-headline');
    if (headlineEl) {
      headlineEl.textContent =
        winner === yourSlot
          ? `🏆 Victory! ${you.playerPseudonym} Wins the Court Duel!`
          : winner === oppSlot
            ? `${opp.playerPseudonym} Wins the Match — Review Your SPX101 Insights!`
            : 'Match Complete!';
    }

    const bScore = document.getElementById('res-basketball-scoreline');
    if (bScore) {
      bScore.textContent = `${you.basketballScore} – ${opp.basketballScore}`;
    }

    const bDetails = document.getElementById('res-basketball-details');
    if (bDetails) {
      const blocks = events.filter((e) => e.basketballOutcome === 'block').length;
      bDetails.textContent = `${you.playerPseudonym} (${you.basketballScore} pts) vs ${opp.playerPseudonym} (${opp.basketballScore} pts) • ${events.length} total possessions (${blocks} blocks).`;
    }

    const lScore = document.getElementById('res-learning-scoreline');
    if (lScore) {
      lScore.textContent = `${you.overallAccuracyPercent}% (${you.correctAnswers} / ${you.totalQuestions})`;
    }

    const lDetails = document.getElementById('res-learning-details');
    if (lDetails) {
      const avgSec =
        you.averageResponseTimeMs !== null
          ? `${(you.averageResponseTimeMs / 1000).toFixed(1)}s avg response`
          : 'No timed responses';
      lDetails.textContent = `${you.correctAnswers} correct, ${you.incorrectAnswers} incorrect, ${you.unansweredCount} unanswered • ${avgSec} (Speed affects shot bonus, not course mastery).`;
    }

    // Topic table
    const tbody = document.getElementById('res-topic-tbody');
    if (tbody) {
      tbody.innerHTML = '';
      for (const t of you.byTopic) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>W${t.week}:</strong> ${this.escapeHtml(t.topic)}</td>
          <td>${t.correct} / ${t.attempted}</td>
          <td><strong>${t.accuracyPercent}%</strong></td>
        `;
        tbody.appendChild(tr);
      }
    }

    // Missed questions & full review list
    const reviewList = document.getElementById('res-review-list');
    if (reviewList) {
      reviewList.innerHTML = '';
      for (const ev of events) {
        if (!ev.questionId) continue;
        const rec = ev.playerRecords[yourSlot];
        const div = document.createElement('div');
        div.className = `review-item ${rec.status === 'correct' ? 'correct' : ''}`;
        div.innerHTML = `
          <div><strong>[${rec.status.toUpperCase()}] W${ev.week} • ${this.escapeHtml(ev.topic)}:</strong> ${this.escapeHtml(ev.stem)}</div>
          <div style="margin-top:4px; color:#93c5fd;">Your Answer: ${this.escapeHtml(rec.selectedOptionText ?? 'Unanswered')} | <strong>Correct: ${this.escapeHtml(ev.correctOptionText)}</strong></div>
          <div style="margin-top:4px; color:#cbd5e1;">${this.escapeHtml(ev.explanation)} <span style="color:#94a3b8;">(${this.escapeHtml(ev.sourceRef)})</span></div>
        `;
        reviewList.appendChild(div);
      }
    }

    const practiceBtn = document.getElementById('btn-practice-missed');
    practiceBtn?.classList.toggle('hidden', you.missedQuestions.length === 0);
  }

  private startMissedQuestionsPractice(): void {
    const events =
      this.onlineSnapshot?.attemptEvents ?? this.soloEngine?.attemptEvents ?? [];
    const yourSlot = this.onlineSnapshot?.yourSlot ?? 0;
    const missedIds = new Set(
      events
        .filter(
          (e) => e.questionId && e.playerRecords[yourSlot].status !== 'correct'
        )
        .map((e) => e.questionId)
    );
    if (missedIds.size === 0) return;

    const cfg = this.getSelectedConfig();
    const missedQuestions = cfg.pack.questions.filter((q) =>
      missedIds.has(q.id)
    );
    if (missedQuestions.length === 0) return;

    const reviewPack: QuestionPack = {
      ...cfg.pack,
      packId: `${cfg.pack.packId}-missed-review`,
      title: `Missed Questions Review (${missedQuestions.length} Qs)`,
      questions: missedQuestions,
    };

    const roomPresetSelect = document.getElementById(
      'select-room-preset'
    ) as HTMLSelectElement | null;
    if (roomPresetSelect) roomPresetSelect.value = 'practice';

    this.lastRenderedMatchId = null;
    this.startSoloMatch(false, reviewPack);
  }

  private exportMatchData(format: 'json' | 'csv'): void {
    const events =
      this.onlineSnapshot?.attemptEvents ?? this.soloEngine?.attemptEvents ?? [];
    const summaries =
      this.onlineSnapshot?.learningSummaries ??
      this.soloEngine?.getLearningSummaries() ??
      null;

    if (format === 'json') {
      const payload = {
        exportedAtIso: new Date().toISOString(),
        summaries,
        events,
      };
      this.downloadBlob(
        JSON.stringify(payload, null, 2),
        `courtiq-session-${Date.now()}.json`,
        'application/json'
      );
      return;
    }

    const headers = [
      'matchId',
      'possessionIndex',
      'duelId',
      'questionId',
      'questionVersion',
      'week',
      'topic',
      'playerPseudonym',
      'role',
      'selectedOptionId',
      'status',
      'acceptedResponseTimeMs',
      'shotZone',
      'blockEligible',
      'basketballOutcome',
      'pointsAwarded',
    ];
    const rows: string[] = [headers.join(',')];
    for (const ev of events) {
      for (const rec of ev.playerRecords) {
        rows.push(
          [
            ev.matchId,
            ev.possessionIndex,
            ev.duelId,
            ev.questionId,
            ev.questionVersion,
            ev.week,
            `"${ev.topic.replace(/"/g, '""')}"`,
            `"${rec.playerPseudonym.replace(/"/g, '""')}"`,
            rec.role,
            rec.selectedOptionId ?? '',
            rec.status,
            rec.acceptedResponseTimeMs ?? '',
            ev.shotZone,
            ev.blockEligible,
            ev.basketballOutcome,
            ev.pointsAwarded,
          ].join(',')
        );
      }
    }
    this.downloadBlob(
      rows.join('\n'),
      `courtiq-session-${Date.now()}.csv`,
      'text/csv'
    );
  }

  private downloadBlob(content: string, filename: string, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ==========================================================================
  // Online Multiplayer Client (Sections 13 & 14)
  // ==========================================================================

  private ensureWebSocketConnected(onOpen: () => void): void {
    if (this.httpTransportActive) {
      onOpen();
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      onOpen();
      return;
    }

    let settled = false;
    const fallbackTimer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        this.ws = null;
        this.activateHttpRoomTransport(onOpen);
      }
    }, 550);

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.addEventListener('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer);
      this.showConnectionBanner(null);
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        this.sendWsMessage({ type: 'PING', clientSendMs: Date.now() });
      }, 2500);
      onOpen();
    });

    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerToClientMessage;
        this.handleServerMessage(msg);
      } catch {
        // ignore malformed packet
      }
    });

    ws.addEventListener('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(fallbackTimer);
        this.ws = null;
        this.activateHttpRoomTransport(onOpen);
        return;
      }

      if (this.onlineRoomCode && this.onlineReconnectToken) {
        this.showConnectionBanner(
          'Connection interrupted — Attempting automatic reconnect...'
        );
        setTimeout(() => {
          if (this.onlineRoomCode && this.onlineReconnectToken) {
            this.ensureWebSocketConnected(() => {
              this.sendWsMessage({
                type: 'RECONNECT_ROOM',
                roomCode: this.onlineRoomCode!,
                reconnectToken: this.onlineReconnectToken!,
              });
            });
          }
        }, 1200);
      }
    });

    ws.addEventListener('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(fallbackTimer);
        this.ws = null;
        this.activateHttpRoomTransport(onOpen);
      }
    });
  }

  private activateHttpRoomTransport(onOpen: () => void): void {
    this.httpTransportActive = true;
    this.showConnectionBanner(null);
    if (this.httpPollTimer) {
      clearInterval(this.httpPollTimer);
    }
    this.httpPollTimer = window.setInterval(() => {
      if (this.onlineRoomCode || this.httpOutgoingQueue.length > 0) {
        void this.flushHttpRoomSync();
      }
    }, 140);
    onOpen();
  }

  private async flushHttpRoomSync(): Promise<void> {
    if (!this.httpTransportActive || this.httpSyncInFlight) {
      return;
    }
    this.httpSyncInFlight = true;
    const batch = this.httpOutgoingQueue.splice(
      0,
      this.httpOutgoingQueue.length
    );
    try {
      const res = await fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: this.httpClientId,
          roomCode: this.onlineRoomCode,
          reconnectToken: this.onlineReconnectToken,
          messages: batch,
        }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        serverTimeMs: number;
        messages: ServerToClientMessage[];
      };
      if (Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          this.handleServerMessage(msg);
        }
      }
    } catch {
      this.showConnectionBanner(
        'Could not reach multiplayer room service. Start `npm run server` or play Solo mode.'
      );
    } finally {
      this.httpSyncInFlight = false;
      // If high-priority messages arrived while in flight, flush immediately
      if (
        this.httpOutgoingQueue.some(
          (m) => m.type !== 'MOVE_INTENT' && m.type !== 'PING'
        )
      ) {
        void this.flushHttpRoomSync();
      }
    }
  }

  private sendWsMessage(msg: ClientToServerMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return;
    }
    if (this.httpTransportActive) {
      if (msg.type === 'MOVE_INTENT') {
        const existingIdx = this.httpOutgoingQueue.findIndex(
          (m) => m.type === 'MOVE_INTENT'
        );
        if (existingIdx >= 0) {
          const prev = this.httpOutgoingQueue[existingIdx] as Extract<
            ClientToServerMessage,
            { type: 'MOVE_INTENT' }
          >;
          if (prev.input.shoot) {
            msg = {
              type: 'MOVE_INTENT',
              input: { ...msg.input, shoot: true },
            };
          }
          this.httpOutgoingQueue.splice(existingIdx, 1);
        }
      }
      this.httpOutgoingQueue.push(msg);
      const isUrgent =
        msg.type !== 'MOVE_INTENT' ||
        (msg.type === 'MOVE_INTENT' && msg.input.shoot);
      if (isUrgent) {
        void this.flushHttpRoomSync();
      }
    }
  }

  private closeOnlineConnection(): void {
    this.onlineRoomCode = null;
    this.onlineReconnectToken = null;
    this.onlineLobby = null;
    this.onlineReady = false;
    this.httpTransportActive = false;
    this.httpOutgoingQueue = [];
    if (this.httpPollTimer) {
      clearInterval(this.httpPollTimer);
      this.httpPollTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.showConnectionBanner(null);
  }

  private createOnlineRoom(): void {
    const cfg = this.getSelectedConfig();
    this.ensureWebSocketConnected(() => {
      this.sendWsMessage({
        type: 'CREATE_ROOM',
        pseudonym: cfg.pseudonym,
        packId: cfg.pack.packId,
        roomPresetId: cfg.roomPresetId,
        sessionLengthId: cfg.sessionLengthId,
        appearancePreset: cfg.appearancePreset,
      });
    });
  }

  private joinOnlineRoom(): void {
    const codeInput = document.getElementById(
      'input-join-code'
    ) as HTMLInputElement | null;
    const code = codeInput?.value.trim().toUpperCase() || '';
    if (!code) {
      this.showConnectionBanner('Enter a valid 6-character room code.');
      return;
    }
    const cfg = this.getSelectedConfig();
    this.ensureWebSocketConnected(() => {
      this.sendWsMessage({
        type: 'JOIN_ROOM',
        roomCode: code,
        pseudonym: cfg.pseudonym,
        appearancePreset: cfg.appearancePreset,
      });
    });
  }

  private handleServerMessage(msg: ServerToClientMessage): void {
    if (msg.type === 'ROOM_JOINED') {
      this.onlineRoomCode = msg.roomCode;
      this.onlineSlot = msg.yourSlot;
      this.onlineReconnectToken = msg.reconnectToken;
      this.onlineLobby = msg.lobby;
      this.renderOnlineWaitingRoom(msg.lobby);
      return;
    }

    if (msg.type === 'LOBBY_UPDATE') {
      this.onlineLobby = msg.lobby;
      this.renderOnlineWaitingRoom(msg.lobby);
      return;
    }

    if (msg.type === 'DUEL_PRELOAD') {
      this.sendWsMessage({ type: 'DUEL_PRELOAD_ACK', duelId: msg.duelId });
      return;
    }

    if (msg.type === 'MATCH_SNAPSHOT') {
      this.onlineSnapshot = msg.snapshot;
      return;
    }

    if (msg.type === 'CONNECTION_STATUS') {
      if (msg.status === 'opponent-reconnected') {
        this.showConnectionBanner(null);
      } else {
        this.showConnectionBanner(msg.message);
      }
      return;
    }

    if (msg.type === 'ERROR') {
      this.showConnectionBanner(msg.message);
    }
  }

  private renderOnlineWaitingRoom(lobby: RoomLobbySnapshot): void {
    const waitEl = document.getElementById('online-waiting-room');
    waitEl?.classList.remove('hidden');

    const codeEl = document.getElementById('display-room-code');
    if (codeEl) codeEl.textContent = lobby.roomCode;

    const listEl = document.getElementById('online-players-list');
    if (listEl) {
      listEl.innerHTML = [0, 1]
        .map((slot) => {
          const p = lobby.players[slot as 0 | 1];
          if (!p) {
            return `<div class="online-box" style="flex:1">Slot ${slot + 1}: <em>Waiting for student to join...</em></div>`;
          }
          return `<div class="online-box" style="flex:1"><strong>${this.escapeHtml(p.pseudonym)}</strong> (${p.ready ? '✅ Ready' : '⏳ Not Ready'})</div>`;
        })
        .join('');
    }
  }

  private showConnectionBanner(message: string | null): void {
    const el = document.getElementById('connection-banner');
    if (!el) return;
    if (!message) {
      el.classList.add('hidden');
      el.textContent = '';
    } else {
      el.textContent = message;
      el.classList.remove('hidden');
    }
  }

  // ==========================================================================
  // Custom Question-Pack Validator & Preferences
  // ==========================================================================

  private validateAndImportCustomPack(): void {
    const ta = document.getElementById(
      'textarea-custom-pack'
    ) as HTMLTextAreaElement | null;
    const out = document.getElementById('pack-validation-output');
    if (!ta || !out) return;

    try {
      const parsed = JSON.parse(ta.value);
      const res = validateQuestionPack(parsed);
      if (!res.valid) {
        out.innerHTML = `<div style="color:#f43f5e;font-weight:800;">❌ Validation Failed (${res.errors.length} error(s)):</div>
          <ul style="padding-left:18px;margin-top:4px;">${res.errors.map((e) => `<li>${this.escapeHtml(e)}</li>`).join('')}</ul>`;
        return;
      }

      const validPack = parsed as QuestionPack;
      const existingIdx = this.packs.findIndex(
        (p) => p.packId === validPack.packId
      );
      if (existingIdx >= 0) {
        this.packs[existingIdx] = validPack;
      } else {
        this.packs.push(validPack);
      }
      this.populatePackDropdown();
      const sel = document.getElementById('select-pack') as HTMLSelectElement;
      if (sel) sel.value = validPack.packId;

      out.innerHTML = `<div style="color:#10b981;font-weight:800;">✅ Pack "${this.escapeHtml(validPack.title)}" Validated &amp; Loaded (${res.approvedQuestionCount} approved questions)!</div>
        ${res.warnings.length > 0 ? `<div style="color:#fdb913;margin-top:4px;">Note: ${this.escapeHtml(res.warnings.join(' '))}</div>` : ''}`;
    } catch (err) {
      out.innerHTML = `<div style="color:#f43f5e;font-weight:800;">❌ Invalid JSON syntax: ${this.escapeHtml((err as Error).message)}</div>`;
    }
  }

  private toggleSettingsModal(forceOpen?: boolean): void {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    const willOpen = forceOpen ?? modal.classList.contains('hidden');
    modal.classList.toggle('hidden', !willOpen);
  }

  private renderRemapGrid(): void {
    const grid = document.getElementById('remap-grid');
    if (!grid) return;

    const labels: Array<[keyof KeyBindingsConfig, string]> = [
      ['moveUp', 'Move Up'],
      ['moveDown', 'Move Down'],
      ['moveLeft', 'Move Left'],
      ['moveRight', 'Move Right'],
      ['sprint', 'Sprint'],
      ['shoot', 'Shoot Ball'],
      ['answer1', 'Answer Option 1'],
      ['answer2', 'Answer Option 2'],
      ['answer3', 'Answer Option 3'],
      ['answer4', 'Answer Option 4'],
    ];

    grid.innerHTML = '';
    for (const [field, label] of labels) {
      const row = document.createElement('div');
      row.className = 'remap-item';
      const isWaiting = this.activeRemapField === field;
      row.innerHTML = `<span>${label}</span>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'small-btn';
      btn.textContent = isWaiting
        ? 'Press any key...'
        : this.input.bindings[field];
      btn.addEventListener('click', () => {
        this.activeRemapField = field;
        this.renderRemapGrid();
      });
      row.appendChild(btn);
      grid.appendChild(row);
    }
  }

  private syncAudioMuteUi(): void {
    const btn = document.getElementById('btn-toggle-mute');
    if (btn) {
      btn.textContent = this.sound.muted ? '🔇 Muted' : '🔊 Audio';
      btn.setAttribute('aria-pressed', String(this.sound.muted));
    }
    const chk = document.getElementById(
      'chk-mute-audio'
    ) as HTMLInputElement | null;
    if (chk) chk.checked = this.sound.muted;
  }

  private loadSavedBindings(): KeyBindingsConfig {
    try {
      const raw = localStorage.getItem('courtiq_bindings_v1');
      if (raw) {
        return { ...DEFAULT_KEY_BINDINGS, ...JSON.parse(raw) };
      }
    } catch {
      // ignore storage errors
    }
    return { ...DEFAULT_KEY_BINDINGS };
  }

  private saveBindings(): void {
    try {
      localStorage.setItem(
        'courtiq_bindings_v1',
        JSON.stringify(this.input.bindings)
      );
    } catch {
      // ignore
    }
  }

  private loadPreferences(): void {
    try {
      const raw = localStorage.getItem('courtiq_prefs_v1');
      if (!raw) return;
      const p = JSON.parse(raw);
      this.reducedMotion = Boolean(p.reducedMotion);
      this.touchOverlayEnabled = Boolean(p.touchOverlayEnabled);
      this.sound.setMuted(Boolean(p.muted));

      const chkRm = document.getElementById(
        'chk-reduced-motion'
      ) as HTMLInputElement | null;
      if (chkRm) chkRm.checked = this.reducedMotion;

      const chkTouch = document.getElementById(
        'chk-touch-overlay'
      ) as HTMLInputElement | null;
      if (chkTouch) chkTouch.checked = this.touchOverlayEnabled;

      this.syncAudioMuteUi();
    } catch {
      // ignore
    }
  }

  private savePreferences(): void {
    try {
      localStorage.setItem(
        'courtiq_prefs_v1',
        JSON.stringify({
          reducedMotion: this.reducedMotion,
          touchOverlayEnabled: this.touchOverlayEnabled,
          muted: this.sound.muted,
        })
      );
    } catch {
      // ignore
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new CourtIqApp();
});
