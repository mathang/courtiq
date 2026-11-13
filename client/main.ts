import { isDrivingInPaint } from '../shared/rules/finishing';
import { MULTIPLAYER_ENABLED } from '../shared/config/features';
import { appearanceFor, characterForAppearance, opponentAppearance, paletteForAppearance, type CharacterId } from '../shared/config/appearance';
import { DUNK_LABELS } from '../shared/rules/dunks';
import { STREET_MOVES } from '../shared/rules/streetMoves';
import { BUNDLED_QUESTION_PACKS } from '../content/packRegistry';
import {
  AiDifficultyId,
  COURT_GEOMETRY,
  RoomPresetId,
  SessionLengthId,
  STREET_FLOW_CONFIG,
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
import type { QuestionAnswerReview } from '../shared/rules/learningFeedback';
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
import { PossessionCueTracker } from './game/presentation/possessionCues';
import { HttpControlRetry, isTransientRoomMiss } from './game/network/httpControlRetry';
import { ShowcasePossession } from './game/presentation/showcasePossession';
import type { Vector3D } from '../shared/rules/shot';
import { CourtIqRenderer, RenderQualityMode } from './game/engine';
import {
  DEFAULT_KEY_BINDINGS,
  normaliseKeyBindings,
  InputGuardController,
  KeyBindingsConfig,
} from './game/input/controls';

class CourtIqApp {
  private renderer: CourtIqRenderer;
  private sound = new SoundEngine();
  private cueTracker = new PossessionCueTracker();
  private showcase: ShowcasePossession | null = null;
  private input: InputGuardController;

  private packs: QuestionPack[] = [...BUNDLED_QUESTION_PACKS];
  private soloPackSelection: string | null = null;
  private selectedCharacter: CharacterId = 0;
  private soloEngine: AuthoritativeMatchEngine | null = null;

  // Online client state
  private ws: WebSocket | null = null;
  private httpTransportActive = false;
  private httpClientId = `cid-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  private httpOutgoingQueue: ClientToServerMessage[] = [];
  private httpControlRetry = new HttpControlRetry();
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
  private dunkImpactPlayed = false;
  private lastComboBySlot: [number, number] = [0, 0];
  private lastOnFireBySlot: [boolean, boolean] = [false, false];

  constructor() {
    const viewport = document.getElementById('viewport-container')!;
    this.renderer = new CourtIqRenderer(viewport);

    const savedBindings = this.loadSavedBindings();
    this.input = new InputGuardController(savedBindings, {
      onAnswer: (duelId, optionId) => this.handlePlayerAnswer(duelId, optionId),
      onPauseToggle: () => this.toggleSettingsModal(),
    });

    this.loadPreferences();
    this.configureMultiplayerAvailability();
    window.addEventListener('pointerdown', () => this.sound.unlock(), { once: true, capture: true });
    window.addEventListener('keydown', () => this.sound.unlock(), { once: true, capture: true });
    this.populatePackDropdown();
    this.bindUiEvents();
    this.renderRemapGrid();

    // Create an idle preview match in Lobby so the opening view immediately shows
    // the complete 3D arena, hoop, scoreboard, and two players on court!
    this.initLobbyPreviewEngine();

    let lastTime = performance.now();
    let manualClock = false;
    let manualNow = lastTime;
    const hooks = window as unknown as { advanceTime: (ms: number) => void; render_game_to_text: () => string };
    hooks.advanceTime = (ms) => {
      manualClock = true;
      const frames = Math.max(1, Math.ceil(ms / (1000 / 60)));
      for (let i = 0; i < frames; i++) {
        manualNow += ms / frames;
        this.tickFrame(ms / frames, manualNow, i === frames - 1);
      }
    };
    hooks.render_game_to_text = () => {
      const eng = this.soloEngine;
      const online = this.onlineSnapshot;
      const players = online?.players ?? eng?.players;
      return JSON.stringify({
        coordinates: 'metres; x right, z towards camera, y up; hoop (0,3.05,-5.25)',
        phase: online?.phase ?? eng?.phase,
        features: { multiplayer: MULTIPLAYER_ENABLED },
        questionTiming: eng?.getQuestionTimingState(),
        possessionCountdownMs: eng?.possessionCountdownRemainingMs ?? 0,
        score: online?.scoreState.scores ?? eng?.scoreState.scores,
        attacker: online?.scoreState.currentAttacker ?? eng?.scoreState.currentAttacker,
        clockMs: online?.movementClockRemainingMs ?? eng?.movementClockRemainingMs,
        players, ball: online?.ballPosition ?? eng?.getBallPosition3D(),
        characters: players?.map(p => characterForAppearance(p.appearancePreset).label),
        playerModels: this.renderer.getPlayerAssetStates(),
        presentation: this.renderer.getPresentationState(),
        audio: this.sound.diagnostics(),
        showcase: Boolean(this.showcase?.active),
        trickSelection: this.input.getTrickSelection(),
        paused: !document.getElementById('settings-modal')?.classList.contains('hidden'),
        learningReview: document.getElementById('feedback-overlay')?.classList.contains('hidden') ? null : {
          status: document.getElementById('fb-learning-verdict')?.dataset.status,
          waiting: (document.getElementById('btn-next-possession') as HTMLButtonElement)?.disabled,
          detailOpen: (document.getElementById('fb-detail') as HTMLDetailsElement)?.open,
        },
        duel: online?.activeDuel ? { id: online.activeDuel.duelId, reading: online.activeDuel.readingProtected, physicalBlock: online.activeDuel.physicalBlock } : eng?.activeDuel ? {
          id: eng.activeDuel.duelId, elapsedMs: eng.activeDuel.elapsedRealMs,
          readingMs: eng.activeDuel.config.readingMs, answerWindowMs: eng.activeDuel.config.answerWindowMs,
          physicalBlock: eng.activeDuel.physicalBlock, submitted: eng.activeDuel.answersBySlot.map(Boolean),
        } : null,
      });
    };
    const animate = (now: number) => {
      const deltaMs = Math.min(100, Math.max(1, now - lastTime));
      lastTime = now;
      if (!manualClock) this.tickFrame(deltaMs, now);
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
            ?.value || 'Hoopster',
        appearancePreset: this.getSelectedAppearance(),
      },
      player1: {
        id: 'bot',
        pseudonym: 'CourtBot',
        isAi: true,
        appearancePreset: opponentAppearance(this.getSelectedAppearance()),
      },
    });
  }

  private configureMultiplayerAvailability(): void {
    const tabs = document.getElementById('lobby-mode-tabs');
    const onlinePanel = document.getElementById('panel-online-actions');
    tabs?.classList.toggle('hidden', !MULTIPLAYER_ENABLED);
    tabs?.toggleAttribute('hidden', !MULTIPLAYER_ENABLED);
    if (tabs) tabs.inert = !MULTIPLAYER_ENABLED;
    onlinePanel?.toggleAttribute('hidden', !MULTIPLAYER_ENABLED);
    if (onlinePanel) onlinePanel.inert = !MULTIPLAYER_ENABLED;
    if (MULTIPLAYER_ENABLED) {
      const soloPanel = document.getElementById('panel-solo-actions');
      soloPanel?.setAttribute('role', 'tabpanel');
      soloPanel?.setAttribute('aria-labelledby', 'tab-solo');
      soloPanel?.removeAttribute('aria-label');
    }
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
      opt.textContent = p.title.replace(/^SPX101\s+/, '').replace(/\s*\(.*/, '');
      opt.title = `${p.title} · ${approvedCount} approved questions · v${p.packVersion}`;
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
      // Menu buttons and native disclosures keep their normal Space/Enter behaviour.
      if ((this.onlineSnapshot?.phase ?? this.soloEngine?.phase) === 'Lobby') {
        if (e.code === this.input.bindings.pause) {
          document.getElementById('settings-modal')?.classList.add('hidden');
          document.getElementById('tutorial-modal')?.classList.add('hidden');
        }
        return;
      }
      if (e.code !== this.input.bindings.pause && ['settings-modal', 'tutorial-modal'].some((id) => !document.getElementById(id)?.classList.contains('hidden'))) return;
      this.input.handleKeyDown(e);
    });

    window.addEventListener('keyup', (e) => {
      this.input.handleKeyUp(e);
    });

    window.addEventListener('blur', () => this.input.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.input.reset(); });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && !e.repeat && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
      }
    });
    document.getElementById('btn-touch-trick')?.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.input.triggerTouchTrick();
    });
    const modes: readonly ('solo' | 'online')[] = MULTIPLAYER_ENABLED ? ['solo', 'online'] : [];
    for (const mode of modes) {
      const tab = document.getElementById(`tab-${mode}`);
      tab?.addEventListener('click', () => this.selectLobbyMode(mode));
      tab?.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 'solo' : e.key === 'End' ? 'online' : mode === 'solo' ? 'online' : 'solo';
        this.selectLobbyMode(next);
        document.getElementById(`tab-${next}`)?.focus();
      });
    }
    document.getElementById('btn-lobby-settings')?.addEventListener('click', () => this.toggleSettingsModal(true));
    document.getElementById('btn-lobby-help')?.addEventListener('click', () => {
      this.input.reset();
      document.getElementById('tutorial-modal')?.classList.remove('hidden');
    });
    document.getElementById('btn-leave-room')?.addEventListener('click', () => this.sendWsMessage({ type: 'LEAVE_ROOM' }));

    for (const button of document.querySelectorAll<HTMLButtonElement>('#lobby-character-picker [data-character]')) {
      button.addEventListener('click', () => {
        this.selectedCharacter = Number(button.dataset.character) as CharacterId;
        for (const choice of document.querySelectorAll('#lobby-character-picker [data-character]')) {
          choice.setAttribute('aria-pressed', String(choice === button));
        }
        this.updateLobbyAppearance();
      });
    }
    // Character and colour palette are independent choices.
    document
      .getElementById('select-appearance')
      ?.addEventListener('change', () => this.updateLobbyAppearance());

    // Start Solo Match
    document
      .getElementById('btn-start-solo')
      ?.addEventListener('click', () => this.startSoloMatch(false));

    // Full possession preview; normal movement immediately takes control.
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
        if (this.onlineSnapshot?.phase === 'Feedback' && this.onlineSnapshot.feedbackState) {
          this.sendWsMessage({ type: 'CONTINUE_FEEDBACK', duelId: this.onlineSnapshot.feedbackState.duelId });
        } else if (this.soloEngine && this.soloEngine.phase === 'Feedback') {
          this.soloEngine.acknowledgeFeedback(0, this.soloEngine.feedbackState!.duelId);
          this.updateDomOverlaysForSolo(this.soloEngine, this.soloEngine.getLiveBlockEligibility().eligible);
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

    shootBtn?.addEventListener('pointerdown', e => {
      e.preventDefault();
      shootBtn.setPointerCapture(e.pointerId);
      this.input.setTouchPrimary(true);
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      shootBtn?.addEventListener(event, () => this.input.setTouchPrimary(false));
    }
  }

  private getSelectedAppearance(): number {
    return appearanceFor(this.selectedCharacter, Number((document.getElementById('select-appearance') as HTMLSelectElement)?.value || 0));
  }

  private updateLobbyAppearance(): void {
    const palette = paletteForAppearance(this.getSelectedAppearance());
    for (const choice of document.querySelectorAll<HTMLButtonElement>('#lobby-character-picker [data-character]')) {
      const character = characterForAppearance(appearanceFor(Number(choice.dataset.character), palette));
      const image = choice.querySelector('img');
      if (image) image.src = `/assets/player/portrait-${character.key}${palette ? `-${palette}` : ''}.png`;
    }
    if (this.soloEngine?.phase === 'Lobby') {
      this.soloEngine.players[0].appearancePreset = this.getSelectedAppearance();
      this.soloEngine.players[1].appearancePreset = opponentAppearance(this.getSelectedAppearance());
    }
  }

  private getSelectedConfig() {
    const pseudonym =
      (
        document.getElementById('input-pseudonym') as HTMLInputElement
      )?.value.trim() || 'Hoopster';
    const appearancePreset = this.getSelectedAppearance();
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
      adaptiveQuestionTiming: (document.getElementById('chk-adaptive-timing') as HTMLInputElement)?.checked ?? true,
    };
  }

  private startSoloMatch(previewPossession = false, overridePack?: QuestionPack): void {
    this.closeOnlineConnection();
    this.onlineSnapshot = null;
    this.input.reset();
    this.cueTracker.reset();
    this.sound.stopSlowMoAtmosphere();
    this.showcase = previewPossession ? new ShowcasePossession() : null;

    const cfg = this.getSelectedConfig();
    const activePack = overridePack ?? cfg.pack;

    this.soloEngine = new AuthoritativeMatchEngine({
      matchId: `solo-${Date.now()}`,
      mode: 'solo',
      ...(previewPossession ? { seed: 42 } : {}),
      pack: activePack,
      roomPresetId: cfg.roomPresetId,
      sessionLengthId: cfg.sessionLengthId,
      aiDifficulty: previewPossession ? 'beginner' : cfg.aiDifficulty,
      adaptiveQuestionTiming: !previewPossession && cfg.adaptiveQuestionTiming,
      postFeedbackCountdown: !previewPossession,
      player0: {
        id: 'student-local',
        pseudonym: cfg.pseudonym,
        appearancePreset: cfg.appearancePreset,
      },
      player1: {
        id: 'ai-opponent',
        pseudonym: previewPossession ? 'CourtBot' : `CourtBot (${cfg.aiDifficulty.slice(0, 3).toUpperCase()})`,
        isAi: true,
        appearancePreset: opponentAppearance(cfg.appearancePreset),
      },
    });

    this.soloEngine.startMatch();
  }

  private selectLobbyMode(mode: 'solo' | 'online'): void {
    if (mode === 'online' && !MULTIPLAYER_ENABLED) return;
    if (this.onlineLobby) return;
    const select = document.getElementById('select-pack') as HTMLSelectElement;
    const wasOnline = document.getElementById('tab-online')?.getAttribute('aria-selected') === 'true';
    if (mode === 'online' && !wasOnline) this.soloPackSelection = select.value;
    for (const option of select.options) {
      option.disabled = mode === 'online' && !BUNDLED_QUESTION_PACKS.some(p => p.packId === option.value);
    }
    if (mode === 'online' && select.selectedOptions[0]?.disabled) select.value = BUNDLED_QUESTION_PACKS[0].packId;
    if (mode === 'solo' && wasOnline && this.soloPackSelection) select.value = this.soloPackSelection;
    for (const m of ['solo', 'online'] as const) {
      const selected = m === mode;
      const tab = document.getElementById(`tab-${m}`);
      tab?.classList.toggle('active', selected);
      tab?.setAttribute('aria-selected', String(selected));
      tab?.setAttribute('tabindex', selected ? '0' : '-1');
      document.getElementById(`panel-${m}-actions`)?.classList.toggle('hidden', !selected);
    }
    document.getElementById('ai-difficulty-group')?.classList.toggle('hidden', mode !== 'solo');
  }

  private returnToLobby(): void {
    this.showcase = null;
    this.input.reset();
    this.closeOnlineConnection();
    this.onlineSnapshot = null;
    this.onlineLobby = null;
    document.getElementById('lobby-mode-tabs')?.classList.toggle('hidden', !MULTIPLAYER_ENABLED);
    document.getElementById('online-waiting-room')?.classList.add('hidden');
    document.getElementById('online-room-entry')?.classList.remove('hidden');
    document.getElementById('lobby-config-grid')?.classList.remove('hidden');
    document.getElementById('lobby-character-picker')?.classList.remove('hidden');
    document.getElementById('lobby-options')?.classList.remove('hidden');
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
      const result = this.soloEngine.submitAnswer({
        slot: 0,
        duelId,
        optionId,
      });
      if (result.accepted) this.updateDomOverlaysForSolo(this.soloEngine,
        this.soloEngine.activeDuel?.releaseSnapshot.blockEligibility.eligible ?? false);
    }
  }

  private tickFrame(realDeltaMs: number, nowMs: number, draw = true): void {
    const realDeltaSec = realDeltaMs / 1000;
    const nowSec = nowMs / 1000;

    // Determine whether we are rendering an active online match or the local solo engine
    if (this.onlineSnapshot) {
      const snap = this.onlineSnapshot;
      this.updateStreetHud(snap.phase, snap.players[this.onlineSlot], snap.players[snap.scoreState.currentAttacker]);
      this.syncInputAndOverlaysFromOnline(snap);

      const moveIntent = this.input.consumeMoveInput(snap.phase, realDeltaMs);
      if (snap.phase === 'Possession' || (snap.phase === 'QuestionReady' && moveIntent.defense === 'jump')) {
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
        nowSec,
        draw
      );
      this.playFootContacts(snap.phase);
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
      isAttacker: eng.scoreState.currentAttacker === 0,
      duelId: activeDuel?.duelId ?? null,
      readingProtected,
      displayedOptions: activeDuel?.displayedOptionsBySlot[0] ?? [],
      gameplayLocked: eng.possessionCountdownRemainingMs > 0,
    });

    const paused = ['settings-modal', 'tutorial-modal'].some((id) => !document.getElementById(id)?.classList.contains('hidden'));
    const userInput0 = this.input.consumeMoveInput(eng.phase, paused ? 0 : realDeltaMs);
    const previewInput = !paused
      ? this.showcase?.next(eng.players, eng.phase, eng.scoreState.currentAttacker, realDeltaSec, userInput0)
      : null;
    const moveInput0 = previewInput ?? userInput0;
    const neutralInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };

    if (eng.phase !== 'Lobby' && !paused) {
      eng.step(realDeltaMs, [moveInput0, neutralInput]);
    }

    // Trigger sound effects on phase/outcome transitions
    this.handlePhaseAudioEffects(
      eng.phase,
      eng.players,
      eng.feedbackState,
      eng.getBallPosition3D(),
      eng.scoreState.currentAttacker
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
      nowSec,
      draw
    );
    this.playFootContacts(eng.phase);
  }

  private handlePhaseAudioEffects(
    phase: MatchPhase,
    players: [PlayerSimState, PlayerSimState],
    feedback: FeedbackBannerState | null,
    ballPosition: Vector3D,
    attackerSlot: PlayerSlot
  ): void {
    const paused = document.hidden || ['settings-modal', 'tutorial-modal'].some(
      id => !document.getElementById(id)?.classList.contains('hidden')
    );
    this.sound.setPaused(paused);
    const cues = this.cueTracker.update(phase, players, attackerSlot, ballPosition, paused);
    const pan = Math.max(-0.5, Math.min(0.5, ballPosition.x / 10));
    if (!paused) {
      for (const s of [0, 1] as const) {
        const pl = players[s];
        if (pl.trickCombo >= 2 && pl.trickCombo > this.lastComboBySlot[s]) {
          this.sound.playComboChain(pl.trickCombo, pan);
        }
        if (pl.onFire && !this.lastOnFireBySlot[s]) {
          this.sound.playOnFireIgnite();
        }
        this.lastComboBySlot[s] = pl.trickCombo;
        this.lastOnFireBySlot[s] = pl.onFire;
      }
    }
    for (const cue of cues) {
      if (cue === 'bounce') this.sound.playBounce(pan);
      else if (cue === 'cut') this.sound.playCut(pan);
      else if (cue === 'swipe') this.sound.playBlockSwat();
      else if (cue === 'gather') {
        this.sound.playGather(pan);
        this.dunkImpactPlayed = false;
      }
      else if (cue === 'takeoff') this.sound.playShotRelease();
      else if (cue === 'land') this.sound.playLanding(pan);
      else {
        this.dunkImpactPlayed = true;
        if (cue === 'basket') {
          this.sound.playDunkSlam();
          this.renderer.triggerBasketCelebration(true);
        }
        else if (cue === 'block') {
          this.sound.playBlockSwat();
          this.renderer.triggerBlockEffect();
        }
        else {
          this.sound.playRimClank();
          this.renderer.triggerRimMissEffect();
        }
      }
    }
    if (!paused && (phase === 'QuestionReady' || phase === 'Duel')) this.sound.startSlowMoAtmosphere();
    else this.sound.stopSlowMoAtmosphere();
    if (this.lastPhase === 'Possession' && phase === 'QuestionReady') {
      this.dunkImpactPlayed = false;
    }

    if (
      (this.lastPhase === 'Duel' || this.lastPhase === 'QuestionReady') &&
      phase === 'Resolution'
    ) {
      this.sound.stopSlowMoAtmosphere();
    }

    const dunk = players.find(p => p.finishKind === 'dunk');
    if (
      phase === 'Feedback' &&
      feedback &&
      this.lastFeedbackDuelId !== feedback.duelId
    ) {
      this.lastFeedbackDuelId = feedback.duelId;
      this.sound.stopSlowMoAtmosphere();
      if (this.dunkImpactPlayed && dunk) {
        // The slam/swat already played at the visible contact frame.
      } else if (feedback.outcome === 'basket') {
        this.sound.playSwish();
        this.renderer.triggerBasketCelebration(false);
      } else if (feedback.outcome === 'block') {
        this.sound.playBlockSwat();
        this.renderer.triggerBlockEffect();
      } else if (feedback.outcome === 'miss') {
        this.sound.playRimClank();
        this.renderer.triggerRimMissEffect();
      } else {
        this.sound.playBuzzer();
      }
    }

    this.lastPhase = phase;
  }
  private playFootContacts(phase: MatchPhase): void {
    for (const cue of this.renderer.consumeFootContacts()) {
      if (phase === 'Possession') this.sound.playFootstep(cue.slot === 0 ? -0.16 : 0.16, cue.intensity);
    }
  }

  private updateDomOverlaysForSolo(
    eng: AuthoritativeMatchEngine,
    blockEligible: boolean
  ): void {
    const att = eng.scoreState.currentAttacker;
    const gettingReady = eng.phase === 'Possession' && eng.possessionCountdownRemainingMs > 0;
    this.input.setGameplayLocked(gettingReady);
    document.getElementById('possession-countdown')?.classList.toggle('hidden', !gettingReady);
    if (gettingReady) {
      const seconds = eng.possessionCountdownRemainingMs > 1000 ? 2 : 1;
      for (const [id, text] of [
        ['possession-countdown-label', att === 0 ? 'Get ready to attack' : 'Get ready to defend'],
        ['possession-countdown-number', String(seconds)],
        ['possession-countdown-status', `Play starts in ${seconds} second${seconds === 1 ? '' : 's'}.`],
      ]) {
        const el = document.getElementById(id);
        if (el && el.textContent !== text) el.textContent = text;
      }
    }
    for (const id of ['btn-touch-shoot', 'btn-touch-trick']) {
      const btn = document.getElementById(id) as HTMLButtonElement | null;
      if (btn) btn.disabled = gettingReady;
    }
    this.updateStreetHud(eng.phase, eng.players[0], eng.players[att]);
    if (gettingReady) document.getElementById('street-status')?.classList.add('hidden');
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
    document.getElementById('hud-top')?.classList.toggle('hidden', eng.phase === 'Lobby');
    document
      .getElementById('lobby-overlay')
      ?.classList.toggle('hidden', eng.phase !== 'Lobby');
    document
      .getElementById('btn-return-lobby')
      ?.classList.toggle('hidden', eng.phase === 'Lobby');
    document
      .getElementById('possession-hint-pill')
      ?.classList.toggle('hidden', eng.phase !== 'Possession' || gettingReady);

    const showTouch =
      (eng.phase === 'Possession' || (eng.phase === 'QuestionReady' && att !== 0)) &&
      (this.touchOverlayEnabled || 'ontouchstart' in window);
    if (showTouch) document.getElementById('possession-hint-pill')?.classList.add('hidden');
    document
      .getElementById('touch-controls')
      ?.classList.toggle('hidden', !showTouch);

    // Question panel
    const immediateReview = eng.phase !== 'Feedback' ? eng.getSoloAnswerReview() : null;
    const inQuestion =
      eng.phase === 'Duel' &&
      activeDuel !== null && !immediateReview;
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
        physicalBlock: activeDuel.physicalBlock,
        youAreAttacker: att === 0,
        adaptiveTiming: eng.adaptiveQuestionTiming,
      });
    }

    // Feedback overlay
    document
      .getElementById('feedback-overlay')
      ?.classList.toggle('hidden', eng.phase !== 'Feedback' && !immediateReview);
    if (eng.phase === 'Feedback' && eng.feedbackState) {
      this.renderFeedbackPanel(eng.feedbackState);
    } else if (immediateReview && activeDuel) {
      this.renderAnswerReview(activeDuel.duelId, immediateReview, null,
        eng.phase === 'Duel' ? 'CourtBot is thinking. Your answer is locked.' : 'Shot resolving…');
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

  private updateStreetHud(phase: MatchPhase, you: PlayerSimState, attacker: PlayerSimState): void {
    const badge = document.getElementById('street-status');
    if (!badge) return;
    const active = phase === 'Possession' || phase === 'QuestionReady' || phase === 'Duel' || phase === 'Resolution';
    badge.classList.toggle('hidden', !active || phase === 'Duel');
    const defending = you.slot !== attacker.slot;
    const dunkRange = isDrivingInPaint(attacker);
    const selection = this.input.getTrickSelection();
    const primary = document.getElementById('btn-touch-shoot');
    if (primary) {
      primary.textContent = defending ? 'BLOCK' : dunkRange ? 'DUNK' : 'SHOOT';
      primary.setAttribute('aria-label', defending ? 'Jump to block; hold during take-off' : 'Shoot or dunk when driving towards the basket in the blue paint');
    }
    const trickButton = document.getElementById('btn-touch-trick');
    if (trickButton) {
      trickButton.textContent = defending ? 'STEAL' : selection ? `TRICK ×${selection.count}` : 'TRICK';
      trickButton.setAttribute('aria-label', defending ? 'Swipe to steal' : 'Trick: one tap crossover, two spin, three eurostep, four step back in half a second');
    }
    const physicalSwat = this.onlineSnapshot?.activeDuel?.physicalBlock ?? this.soloEngine?.activeDuel?.physicalBlock ?? false;
    const liveCallout =
      attacker.calloutSec > 0 && attacker.calloutText
        ? attacker.calloutText
        : you.calloutSec > 0 && you.calloutText
          ? you.calloutText
          : null;
    const isHot = Boolean(
      liveCallout ||
      attacker.onFire ||
      attacker.trickCombo >= 2 ||
      you.defenseResult === 'steal' ||
      you.defenseResult === 'timed-block'
    );
    badge.classList.toggle('callout-hot', isHot);

    const label =
      physicalSwat && (phase === 'QuestionReady' || phase === 'Duel')
        ? 'SWAT CONNECTED • QUESTION STILL COUNTS'
        : defending && attacker.defenseResult === 'steal' && attacker.defenseElapsedSec < 1.2
          ? 'BALL STOLEN! GET BACK ON DEFENSE'
          : you.defenseResult === 'steal' && you.defenseElapsedSec < 1.2
            ? 'COOKIE SNATCH! DRIVE TO THE RIM!'
            : you.defenseResult === 'timed-block' && (phase === 'QuestionReady' || phase === 'Duel')
              ? 'GET THAT OUT! TIMED SWAT'
              : you.defenseAction === 'swipe'
                ? `SWIPE ${you.defenseResult === 'miss' ? 'MISSED' : 'ATTEMPT'} • RECOVER ${you.defenseRecoverySec.toFixed(1)}s`
                : you.defenseAction === 'jump'
                  ? 'BLOCK ATTEMPT • KEEP MOVING'
                  : you.wrongFootSec > 0
                    ? 'OFF BALANCE • KEEP MOVING'
                  : liveCallout
                    ? `${attacker.onFire ? '🔥 ' : ''}${liveCallout}`
                    : attacker.finishKind === 'dunk'
                      ? `${attacker.onFire ? '🔥 ' : ''}${DUNK_LABELS[attacker.dunkStyle]} • ${defending && phase === 'QuestionReady' ? 'HOLD SPACE TO BLOCK!' : 'ABOVE THE RIM'}`
                      : phase !== 'Possession'
                        ? 'SHOT DUEL • ANSWER TO SCORE / BLOCK'
                        : defending
                          ? attacker.trickOverexposedSec > 0
                            ? '⚡ BALL EXPOSED! C: STEAL'
                            : you.defenseCooldownSec > 0
                              ? `DEFENSE RECHARGING ${you.defenseCooldownSec.toFixed(1)}s`
                              : 'C: STEAL • SPACE: BLOCK'
                          : you.wrongFootSec > 0
                            ? 'WRONG FOOTED'
                            : selection
                              ? `${selection.count} TAP${selection.count > 1 ? 'S' : ''} • ${STREET_MOVES[selection.move].label} • ${Math.ceil(selection.remainingMs / 100) / 10}s`
                              : you.streetMove
                              ? `${you.trickCombo >= 2 ? `${you.trickCombo}x CHAIN • ` : ''}${STREET_MOVES[you.streetMove].label}`
                              : dunkRange
                                ? `${you.onFire ? '🔥 ON FIRE • ' : ''}DUNK READY • SPACE`
                                : `${you.onFire ? '🔥 ON FIRE • ' : ''}SPACE: SHOOT • C: TAP FOR A TRICK`;
    if (badge.textContent !== label) badge.textContent = label;
  }

  private syncInputAndOverlaysFromOnline(
    snap: AuthoritativeMatchStateSnapshot
  ): void {
    const slot = snap.yourSlot;
    const att = snap.scoreState.currentAttacker;

    this.input.syncDuelContext({
      phase: snap.phase,
      isAttacker: att === slot,
      duelId: snap.activeDuel?.duelId ?? null,
      readingProtected: snap.activeDuel?.readingProtected ?? true,
      displayedOptions: snap.activeDuel?.publicQuestion.options ?? [],
    });

    this.handlePhaseAudioEffects(
      snap.phase,
      snap.players,
      snap.feedbackState,
      snap.ballPosition,
      snap.scoreState.currentAttacker
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

    document.getElementById('hud-top')?.classList.remove('hidden');
    document.getElementById('lobby-overlay')?.classList.add('hidden');
    document.getElementById('btn-return-lobby')?.classList.remove('hidden');
    document
      .getElementById('possession-hint-pill')
      ?.classList.toggle('hidden', snap.phase !== 'Possession');
    const showTouch = (snap.phase === 'Possession' || (snap.phase === 'QuestionReady' && att !== slot)) && (this.touchOverlayEnabled || 'ontouchstart' in window);
    document.getElementById('touch-controls')?.classList.toggle('hidden', !showTouch);
    if (showTouch) document.getElementById('possession-hint-pill')?.classList.add('hidden');

    const inQuestion =
      snap.phase === 'Duel' &&
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
        physicalBlock: snap.activeDuel.physicalBlock,
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
    p0Card?.classList.toggle('on-fire', params.players[0].onFire);
    p1Card?.classList.toggle('on-fire', params.players[1].onFire);

    for (const slot of [0, 1] as const) {
      const pl = params.players[slot];
      const flowEl = document.getElementById(`hud-p${slot}-flow-fill`);
      if (flowEl) {
        flowEl.style.width = `${Math.min(100, (pl.correctAnswerStreak ?? 0) / 3 * 100)}%`;
        flowEl.parentElement?.setAttribute('title', `${pl.correctAnswerStreak ?? 0} correct answers in a row — 3 ignites On Fire`);
        flowEl.classList.toggle('on-fire', pl.onFire);
      }
      const comboEl = document.getElementById(`hud-p${slot}-combo`);
      if (comboEl) {
        const showCombo = pl.onFire || pl.correctAnswerStreak > 0 || pl.trickCombo >= 2;
        comboEl.classList.toggle('hidden', !showCombo);
        if (showCombo) {
          comboEl.textContent =
            pl.onFire && pl.trickCombo >= 2
              ? `🔥 ${pl.trickCombo}x`
              : pl.onFire
                ? '🔥 FIRE'
                : pl.correctAnswerStreak > 0 ? `✓ ${pl.correctAnswerStreak}/3` : `⚡ ${pl.trickCombo}x`;
        }
      }
    }

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
    const comboIdx = Math.min(
      STREET_FLOW_CONFIG.comboSetupBonus.length - 1,
      attPlayer.trickCombo
    );
    const liveSetupBonus = STREET_FLOW_CONFIG.comboSetupBonus[comboIdx];
    const baseProb = Math.round(
      computeBaseShotProbability({
        zone,
        heavilyContested: params.blockEligible,
        releasedWhileSprinting: attPlayer.isSprinting && !attPlayer.finishKind,
        setupBonus: liveSetupBonus,
        onFire: attPlayer.onFire,
      }) * 100
    );
    const bonusTag =
      liveSetupBonus > 0
        ? ` (+${Math.round(liveSetupBonus * 100)}pp combo)`
        : '';
    setTxt(
      'hud-zone-badge',
      `${pointValue}PT ${zone.toUpperCase()} • Base ${baseProb}%${bonusTag}`
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
    physicalBlock: boolean;
    youAreAttacker: boolean;
    adaptiveTiming?: boolean;
  }): void {
    const q = params.publicQuestion;
    const setTxt = (id: string, val: string) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== val) el.textContent = val;
    };

    setTxt('q-course-badge', `${q.course} • Week ${q.week}`);
    setTxt('q-topic-badge', q.topic);
    document.getElementById('q-pace-badge')?.classList.toggle('hidden', !params.adaptiveTiming);
    setTxt(
      'q-contest-badge',
      params.physicalBlock
        ? '🛡️ Swat connected • your answer still counts'
        : params.blockEligibleAtRelease
          ? '🛡️ Defender in Block Range (≤2.6m)'
          : '📏 Question block unavailable at release'
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
          ? '✓ Answer locked'
          : params.readingProtected
            ? '📖 Reading — choices locked'
            : params.physicalBlock
              ? '🧠 Answer for learning + Fire'
            : params.youAreAttacker
              ? '🏀 Correct answers boost shots'
              : params.blockEligibleAtRelease
                ? '🛡️ Correct first to block'
                : '🧠 Answer for learning + Fire';
    }

    const oppStatus = document.getElementById('q-opponent-status');
    if (oppStatus) {
      oppStatus.classList.toggle('submitted', params.opponentSubmitted);
      oppStatus.textContent = params.opponentSubmitted
        ? '✓ Opponent submitted'
        : '⏳ Opponent deciding...';
    }
  }

  private lastReviewDuelId: string | null = null;

  private renderFeedbackPanel(fb: FeedbackBannerState): void {
    const slot = this.onlineSnapshot?.yourSlot ?? 0;
    const answer = fb.learningBySlot?.[slot];
    this.renderAnswerReview(fb.duelId, answer ? {
      questionStem: fb.questionStem ?? '', correctOptionText: fb.correctOptionText,
      explanation: fb.explanation, sourceRef: fb.sourceRef, topic: fb.topic, answer,
    } : null, fb);
  }

  private renderAnswerReview(duelId: string, review: QuestionAnswerReview | null,
    fb: FeedbackBannerState | null, pendingMessage = ''): void {
    const setTxt = (id: string, val: string) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== val) el.textContent = val;
    };

    const status = review?.answer.status;
    setTxt('fb-topic', review?.topic ?? '');
    setTxt('fb-outcome-pill', fb ? `Court result: ${fb.headline}` : '');
    document.getElementById('fb-outcome-pill')?.classList.toggle('hidden', !fb);
    const slot = this.onlineSnapshot?.yourSlot ?? 0;
    const learning = fb?.learningBySlot?.[slot];
    const verdict = document.getElementById('fb-learning-verdict');
    if (verdict) {
      setTxt('fb-learning-verdict', !review ? 'Possession complete' : status === 'correct' ? '✓ Correct' : status === 'incorrect' ? '✗ Incorrect' : '— No answer submitted');
      verdict.dataset.status = status ?? 'none';
    }
    setTxt('fb-correct-text', review?.correctOptionText ?? '');
    document.getElementById('fb-correct-line')?.classList.toggle('hidden', !review || status === 'correct');
    setTxt('fb-choice-reason', review?.answer.reason ?? '');
    document.getElementById('fb-choice-reason')?.classList.toggle('hidden', !review);
    setTxt('fb-question-text', review?.questionStem ?? '');
    setTxt('fb-your-answer', review?.answer.selectedOptionText ? `Your answer: ${review.answer.selectedOptionText}` : '');
    setTxt('fb-explanation-text', review?.explanation ?? '');
    document.getElementById('fb-explanation-text')?.classList.toggle('hidden', !review || review.explanation === review.answer.reason);
    setTxt('fb-source-ref', review ? `Source: ${review.sourceRef}` : '');
    setTxt('fb-streak-text', !learning ? '' : learning.onFire ? `🔥 On Fire · ${learning.correctAnswerStreak} in a row` : learning.correctAnswerStreak ? `${learning.correctAnswerStreak}/3 to On Fire` : '');
    setTxt('fb-wait-status', pendingMessage || (fb?.continueReady?.[slot] ? 'Waiting for the other student…' :
      fb?.timingAdjustment === 'more-time' ? 'Next question: more time' :
      fb?.timingAdjustment === 'less-time' ? 'Next question: quicker pace' : ''));
    const next = document.getElementById('btn-next-possession') as HTMLButtonElement | null;
    if (next) {
      const waiting = !fb || Boolean(fb.continueReady?.[slot]);
      next.disabled = waiting;
      setTxt('btn-next-possession', waiting ? 'Waiting…' : 'Next possession →');
    }
    const detail = document.getElementById('fb-detail') as HTMLDetailsElement | null;
    detail?.classList.toggle('hidden', !review);
    // Keep the same review open while CourtBot answers and the shot plays out.
    // Focus/announce only once, rather than once per animation frame or timer tick.
    if (duelId !== this.lastReviewDuelId) {
      this.lastReviewDuelId = duelId;
      if (detail) detail.open = false;
      const card = document.querySelector('.feedback-card');
      if (card) card.scrollTop = 0;
      verdict?.focus({ preventScroll: true });
    }
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
      bDetails.textContent = `${you.playerPseudonym} (${you.basketballScore} pts) vs ${opp.playerPseudonym} (${opp.basketballScore} pts) • ${events.length} total possessions (${blocks} blocks, ${events.filter(e => e.basketballOutcome === 'steal-turnover').length} steals).`;
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
      // Retrieval first: keep answers folded away and put missed questions first.
      const questions = events.filter(e => e.questionId).sort((a, b) =>
        Number(a.playerRecords[yourSlot].status === 'correct') - Number(b.playerRecords[yourSlot].status === 'correct'));
      for (const ev of questions) {
        if (!ev.questionId) continue;
        const rec = ev.playerRecords[yourSlot];
        const div = document.createElement('details');
        div.className = `review-item ${rec.status === 'correct' ? 'correct' : ''}`;
        div.innerHTML = `
          <summary><strong>${rec.status === 'correct' ? '✓ Correct' : rec.status === 'incorrect' ? '↻ Revisit' : '— Unanswered'} · W${ev.week} · ${this.escapeHtml(ev.topic)}</strong></summary>
          <div>${this.escapeHtml(ev.stem)}</div>
          <div style="color:#93c5fd;">${rec.status === 'correct' ? 'Your answer' : 'Correct answer'}: ${this.escapeHtml(ev.correctOptionText)}</div>
          ${rec.status === 'incorrect' ? `<div>Your answer: ${this.escapeHtml(rec.selectedOptionText ?? '')}</div>` : ''}
          <div style="color:#cbd5e1;">${this.escapeHtml(ev.explanation)} <span style="color:#94a3b8;">(${this.escapeHtml(ev.sourceRef)})</span></div>
        `;
        reviewList.appendChild(div);
      }
    }

    const practiceBtn = document.getElementById('btn-practice-missed');
    const missedCount = new Set(you.missedQuestions.map(q => q.questionId)).size;
    practiceBtn?.classList.toggle('hidden', missedCount === 0);
    if (practiceBtn) practiceBtn.textContent = `↻ Retry ${missedCount} missed question${missedCount === 1 ? '' : 's'}`;
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
      'readingMs',
      'answerWindowMs',
      'adaptiveQuestionTiming',
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
            ev.questionTiming?.readingMs ?? '',
            ev.questionTiming?.answerWindowMs ?? '',
            ev.questionTiming?.adaptive ?? '',
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
    const roomCode = this.onlineRoomCode;
    const reconnectToken = this.onlineReconnectToken;
    const recoverConfirmations = (): boolean => {
      // A late response must never restore actions after Leave or into a different room.
      if (!this.httpTransportActive || !roomCode || !reconnectToken ||
          roomCode !== this.onlineRoomCode || reconnectToken !== this.onlineReconnectToken) return false;
      const recovered = this.httpControlRetry.recover(batch, this.httpOutgoingQueue);
      this.httpOutgoingQueue = recovered.queue;
      return recovered.requeued > 0;
    };
    try {
      const res = await fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: this.httpClientId,
          roomCode,
          reconnectToken,
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
        const missingRoom = data.messages.some(isTransientRoomMiss) &&
          !data.messages.some(m => m.type === 'MATCH_SNAPSHOT' || m.type === 'ROOM_JOINED');
        const retryScheduled = missingRoom && recoverConfirmations();
        if (!data.messages.some(m => m.type === 'ERROR') &&
            batch.some(m => m.type === 'CONTINUE_FEEDBACK' || m.type === 'SET_READY')) {
          this.showConnectionBanner(null);
        }
        for (const msg of data.messages) {
          if (retryScheduled && isTransientRoomMiss(msg)) continue;
          this.handleServerMessage(msg);
        }
      }
    } catch {
      const retryScheduled = recoverConfirmations();
      this.showConnectionBanner(
        retryScheduled ? 'Connection interrupted. Retrying your confirmation…' :
          'Could not reach multiplayer. Try again or play the computer.'
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
          if (prev.input.shoot || prev.input.trick || prev.input.defense || prev.input.dunk) {
            msg = {
              type: 'MOVE_INTENT',
              input: { ...msg.input, shoot: prev.input.shoot || msg.input.shoot, trick: prev.input.trick ?? msg.input.trick,
                defense: prev.input.defense ?? msg.input.defense, dunk: prev.input.dunk || msg.input.dunk,
                dunkStyle: prev.input.dunkStyle ?? msg.input.dunkStyle },
            };
          }
          this.httpOutgoingQueue.splice(existingIdx, 1);
        }
      }
      this.httpOutgoingQueue.push(msg);
      const isUrgent =
        msg.type !== 'MOVE_INTENT' ||
        (msg.type === 'MOVE_INTENT' && (msg.input.shoot || msg.input.dunk || Boolean(msg.input.trick) || Boolean(msg.input.defense)));
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
    this.httpControlRetry.reset();
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
    if (!MULTIPLAYER_ENABLED) return;
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
    if (!MULTIPLAYER_ENABLED) return;
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
    if (msg.type === 'ROOM_LEFT') {
      this.returnToLobby();
      return;
    }
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
    document.getElementById('lobby-mode-tabs')?.classList.add('hidden');
    this.onlineReady = lobby.players[this.onlineSlot]?.ready ?? false;
    const ready = document.getElementById('btn-toggle-ready');
    if (ready) {
      ready.textContent = this.onlineReady ? '✓ Ready' : 'Ready to play';
      ready.setAttribute('aria-pressed', String(this.onlineReady));
    }
    document.getElementById('online-room-entry')?.classList.add('hidden');
    document.getElementById('lobby-config-grid')?.classList.add('hidden');
    document.getElementById('lobby-character-picker')?.classList.add('hidden');
    document.getElementById('lobby-options')?.classList.add('hidden');
    const topic = document.getElementById('online-room-topic');
    if (topic) topic.textContent = lobby.packTitle.replace(/^SPX101\s+/, '').replace(/\s*\(.*/, '');
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
      this.selectLobbyMode('solo');
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
    this.input.reset();
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
      ['shoot', 'Shoot / Auto Dunk / Block'],
      ['trick', 'Trick / Steal (tap 1–4 times)'],
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
        return normaliseKeyBindings(JSON.parse(raw));
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
