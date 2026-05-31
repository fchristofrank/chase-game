import {
  Component, ElementRef, HostListener, OnDestroy, OnInit,
  ViewChild, computed, inject, signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { PeerService } from '../../services/peer.service';

// ---- Game constants ----
const ARENA_W = 800;
const ARENA_H = 600;
const PLAYER_R = 15;
const CHASER_SPEED = 215; // px/sec
const RUNNER_SPEED = 230; // runner gets a small advantage
const TAG_DIST = PLAYER_R * 2 - 2;
const ROUND_DURATION = 60; // seconds
const SEND_INTERVAL_MS = 50; // 20 Hz position updates

type Role = 'chaser' | 'runner';
type Status = 'waiting' | 'countdown' | 'playing' | 'ended';
interface Vec2 { x: number; y: number; }
interface Obstacle { x: number; y: number; w: number; h: number; }

const OBSTACLES: Obstacle[] = [
  { x: 160, y: 100, w: 70, h: 180 },
  { x: 570, y: 320, w: 70, h: 180 },
  { x: 365, y: 250, w: 70, h: 100 },
  { x: 100, y: 460, w: 160, h: 28 },
  { x: 540, y: 120, w: 160, h: 28 },
  { x: 360, y: 470, w: 80, h: 80 },
];

@Component({
  selector: 'app-game',
  standalone: true,
  template: `
    <div class="page">
      <div class="hud">
        <div class="badge" [class.chaser]="myRole() === 'chaser'" [class.runner]="myRole() === 'runner'">
          {{ myRole() === 'chaser' ? '🔥 CHASER — TAG THEM' : '💨 RUNNER — SURVIVE' }}
        </div>
        <div class="timer" [class.urgent]="timeLeft() <= 10 && status() === 'playing'">
          {{ timeLeft() }}s
        </div>
        <button class="leave" (click)="leave()">Leave</button>
      </div>

      <div class="arena-wrap">
        <canvas #gameCanvas [width]="800" [height]="600"></canvas>

        @if (status() === 'waiting') {
          <div class="overlay">
            <div class="overlay-card">
              <h2>Get ready…</h2>
              <p>Assigning roles</p>
            </div>
          </div>
        }

        @if (status() === 'countdown') {
          <div class="overlay">
            <div class="countdown" [class.go]="countdownText() === 'GO!'">
              {{ countdownText() }}
            </div>
          </div>
        }

        @if (status() === 'ended' && !disconnected()) {
          <div class="overlay">
            <div class="overlay-card">
              <h1 [class.win]="iWon()" [class.lose]="!iWon()">
                {{ iWon() ? 'YOU WIN!' : 'YOU LOSE' }}
              </h1>
              <p class="result-msg">{{ winMessage() }}</p>
              @if (isHost()) {
                <button class="btn primary" (click)="restart()">Play Again (swap roles)</button>
              } @else {
                <p class="hint-text">Waiting for host to start next round…</p>
              }
              <button class="btn ghost" (click)="leave()">Back to Menu</button>
            </div>
          </div>
        }

        @if (disconnected()) {
          <div class="overlay">
            <div class="overlay-card">
              <h2>Other player disconnected</h2>
              <button class="btn primary" (click)="leave()">Back to Menu</button>
            </div>
          </div>
        }
      </div>

      <div class="footer">
        WASD or Arrow Keys to move
      </div>
    </div>
  `,
  styles: [`
    .page {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
      gap: 12px;
      background:
        radial-gradient(circle at 20% 20%, rgba(255, 51, 85, 0.08), transparent 40%),
        radial-gradient(circle at 80% 80%, rgba(51, 170, 255, 0.08), transparent 40%),
        #07070d;
    }
    .hud {
      display: flex;
      align-items: center;
      gap: 16px;
      width: 800px;
      max-width: 100%;
    }
    .badge {
      flex: 1;
      padding: 10px 16px;
      border-radius: 10px;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 1px;
      text-align: center;
    }
    .badge.chaser {
      background: rgba(255, 51, 85, 0.15);
      color: #ff8899;
      border: 1px solid rgba(255, 51, 85, 0.4);
    }
    .badge.runner {
      background: rgba(51, 170, 255, 0.15);
      color: #88ccff;
      border: 1px solid rgba(51, 170, 255, 0.4);
    }
    .timer {
      font-family: 'SF Mono', Menlo, monospace;
      font-size: 28px;
      font-weight: 700;
      color: #e8e8f0;
      min-width: 80px;
      text-align: center;
      padding: 6px 14px;
      background: rgba(20, 20, 30, 0.6);
      border-radius: 10px;
      border: 1px solid rgba(120, 120, 160, 0.2);
      transition: color 0.2s, border-color 0.2s;
    }
    .timer.urgent {
      color: #ff5566;
      border-color: rgba(255, 51, 85, 0.5);
      animation: shake 0.5s ease-in-out infinite;
    }
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-2px); }
      75% { transform: translateX(2px); }
    }
    .leave {
      padding: 8px 14px;
      background: transparent;
      border: 1px solid rgba(120, 120, 160, 0.3);
      border-radius: 8px;
      color: #9090a8;
      cursor: pointer;
      font-size: 13px;
    }
    .leave:hover { background: rgba(120, 120, 160, 0.1); }
    .arena-wrap {
      position: relative;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(120, 120, 160, 0.2);
    }
    canvas { display: block; }
    .overlay {
      position: absolute;
      inset: 0;
      background: rgba(7, 7, 13, 0.75);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .overlay-card {
      background: rgba(20, 20, 30, 0.9);
      padding: 32px 40px;
      border-radius: 16px;
      border: 1px solid rgba(120, 120, 160, 0.25);
      text-align: center;
      max-width: 380px;
    }
    .overlay-card h1 { margin: 0 0 12px; font-size: 42px; letter-spacing: 3px; }
    .overlay-card h2 { margin: 0 0 8px; font-size: 22px; }
    .overlay-card p { color: #9090a8; margin: 0 0 20px; }
    .win {
      background: linear-gradient(90deg, #5dd460, #33aaff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .lose {
      background: linear-gradient(90deg, #ff3355, #aa3377);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .result-msg { color: #b0b0c8 !important; font-size: 14px; }
    .countdown {
      font-size: 160px;
      font-weight: 800;
      color: #fff;
      text-shadow: 0 0 40px rgba(51, 170, 255, 0.6);
      animation: pop 1s ease-out;
    }
    .countdown.go {
      font-size: 120px;
      color: #5dd460;
      text-shadow: 0 0 60px rgba(93, 212, 96, 0.8);
    }
    @keyframes pop {
      0% { transform: scale(0.3); opacity: 0; }
      40% { transform: scale(1.15); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }
    .btn {
      padding: 12px 20px;
      border: none;
      border-radius: 10px;
      font-weight: 600;
      cursor: pointer;
      margin: 6px;
      font-size: 14px;
      transition: transform 0.1s;
    }
    .btn:hover { transform: translateY(-1px); }
    .btn.primary {
      background: linear-gradient(135deg, #33aaff, #5588ff);
      color: white;
      box-shadow: 0 4px 14px rgba(51, 170, 255, 0.3);
    }
    .btn.ghost {
      background: transparent;
      color: #9090a8;
      border: 1px solid rgba(120, 120, 160, 0.3);
    }
    .hint-text {
      color: #9090a8;
      font-style: italic;
      margin: 16px 0;
      font-size: 13px;
    }
    .footer {
      color: #555;
      font-size: 12px;
      letter-spacing: 1px;
    }
  `],
})
export class GameComponent implements OnInit, OnDestroy {
  @ViewChild('gameCanvas', { static: true })
  private canvasRef!: ElementRef<HTMLCanvasElement>;

  private peerService = inject(PeerService);
  private router = inject(Router);

  // ---- UI signals ----
  status = signal<Status>('waiting');
  myRole = signal<Role>('chaser');
  timeLeft = signal<number>(ROUND_DURATION);
  countdownText = signal<string>('3');
  winner = signal<Role | null>(null);
  disconnected = signal<boolean>(false);

  isHost = computed(() => this.peerService.isHost());
  iWon = computed(() => this.winner() === this.myRole());
  winMessage = computed(() =>
    this.winner() === 'chaser'
      ? 'The chaser caught the runner!'
      : 'The runner survived the round!'
  );

  // ---- Game state (mutated every frame; not signals) ----
  private myPos: Vec2 = { x: 0, y: 0 };
  private otherPos: Vec2 = { x: 0, y: 0 };
  private keys = { up: false, down: false, left: false, right: false };
  private lastFrameTime = 0;
  private lastSentTime = 0;
  private animFrame = 0;
  private gameStartedAt = 0;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private subs = new Subscription();
  private ctx!: CanvasRenderingContext2D;

  ngOnInit() {
    // If somehow we landed here without an active connection, bounce home.
    if (!this.peerService.isConnected()) {
      this.router.navigate(['/']);
      return;
    }

    this.ctx = this.canvasRef.nativeElement.getContext('2d')!;

    this.subs.add(
      this.peerService.data$.subscribe((msg) => this.handleMessage(msg))
    );
    this.subs.add(
      this.peerService.disconnect$.subscribe(() => this.disconnected.set(true))
    );

    this.setupRound(true);

    this.lastFrameTime = performance.now();
    this.animFrame = requestAnimationFrame(this.tick);
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.animFrame);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.subs.unsubscribe();
  }

  // ---- Round lifecycle ----

  /** @param firstRound true on initial mount; on restart we already have role from message. */
  private setupRound(firstRound: boolean) {
    this.winner.set(null);
    this.disconnected.set(false);

    if (this.isHost()) {
      // Host picks roles randomly each round.
      const hostChaser = Math.random() < 0.5;
      this.myRole.set(hostChaser ? 'chaser' : 'runner');
      this.peerService.send({
        type: 'roleAssign',
        yourRole: hostChaser ? 'runner' : 'chaser',
      });
    }
    // Joiner waits for 'roleAssign' message (handled in handleMessage).

    // Spawn positions: opposite corners.
    if (this.isHost()) {
      this.myPos = { x: 80, y: ARENA_H / 2 };
      this.otherPos = { x: ARENA_W - 80, y: ARENA_H / 2 };
    } else {
      this.myPos = { x: ARENA_W - 80, y: ARENA_H / 2 };
      this.otherPos = { x: 80, y: ARENA_H / 2 };
    }

    if (this.isHost()) {
      this.startCountdown();
    } else if (firstRound) {
      this.status.set('waiting');
    }
  }

  private startCountdown() {
    this.status.set('countdown');
    let count = 3;
    this.countdownText.set(String(count));
    this.peerService.send({ type: 'countdown', value: count });

    this.countdownTimer = setInterval(() => {
      count--;
      if (count > 0) {
        this.countdownText.set(String(count));
        this.peerService.send({ type: 'countdown', value: count });
      } else if (count === 0) {
        this.countdownText.set('GO!');
        this.peerService.send({ type: 'countdown', value: 0 });
      } else {
        if (this.countdownTimer) clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        this.beginRound();
      }
    }, 1000);
  }

  private beginRound() {
    this.status.set('playing');
    this.gameStartedAt = performance.now();
    this.timeLeft.set(ROUND_DURATION);
    if (this.isHost()) {
      this.peerService.send({ type: 'startGame' });
    }
  }

  private endGame(winner: Role) {
    if (this.status() === 'ended') return;
    this.winner.set(winner);
    this.status.set('ended');
    this.peerService.send({ type: 'gameOver', winner });
  }

  restart() {
    if (!this.isHost()) return;
    this.setupRound(false);
  }

  leave() {
    this.peerService.destroy();
    this.router.navigate(['/']);
  }

  // ---- Networking ----

  private handleMessage(msg: any) {
    switch (msg?.type) {
      case 'roleAssign':
        this.myRole.set(msg.yourRole);
        break;
      case 'countdown':
        this.status.set('countdown');
        this.countdownText.set(msg.value > 0 ? String(msg.value) : 'GO!');
        break;
      case 'startGame':
        this.beginRound();
        break;
      case 'position':
        this.otherPos.x = msg.x;
        this.otherPos.y = msg.y;
        break;
      case 'gameOver':
        this.winner.set(msg.winner);
        this.status.set('ended');
        break;
    }
  }

  // ---- Game loop ----

  private tick = (now: number) => {
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;

    if (this.status() === 'playing') {
      this.update(dt, now);
    }
    this.render();

    this.animFrame = requestAnimationFrame(this.tick);
  };

  private update(dt: number, now: number) {
    // Build direction from input.
    let dx = 0, dy = 0;
    if (this.keys.up) dy -= 1;
    if (this.keys.down) dy += 1;
    if (this.keys.left) dx -= 1;
    if (this.keys.right) dx += 1;
    // Diagonal normalization.
    if (dx !== 0 && dy !== 0) {
      const inv = Math.SQRT1_2;
      dx *= inv; dy *= inv;
    }

    const speed = this.myRole() === 'chaser' ? CHASER_SPEED : RUNNER_SPEED;
    const step = speed * dt;

    // Axis-separated movement so we can slide along obstacles.
    let nx = this.myPos.x + dx * step;
    let ny = this.myPos.y + dy * step;

    nx = clamp(nx, PLAYER_R, ARENA_W - PLAYER_R);
    ny = clamp(ny, PLAYER_R, ARENA_H - PLAYER_R);

    if (!this.hitsObstacle(nx, this.myPos.y)) this.myPos.x = nx;
    if (!this.hitsObstacle(this.myPos.x, ny)) this.myPos.y = ny;

    // Send position throttled to 20 Hz.
    if (now - this.lastSentTime > SEND_INTERVAL_MS) {
      this.peerService.send({ type: 'position', x: this.myPos.x, y: this.myPos.y });
      this.lastSentTime = now;
    }

    // Host owns the game-end checks (timer + tag detection).
    if (this.isHost()) {
      const elapsed = (now - this.gameStartedAt) / 1000;
      const remaining = Math.max(0, Math.ceil(ROUND_DURATION - elapsed));
      if (remaining !== this.timeLeft()) this.timeLeft.set(remaining);

      const d = Math.hypot(
        this.myPos.x - this.otherPos.x,
        this.myPos.y - this.otherPos.y
      );
      if (d < TAG_DIST) {
        this.endGame('chaser');
      } else if (remaining === 0) {
        this.endGame('runner');
      }
    }
  }

  private hitsObstacle(x: number, y: number): boolean {
    for (const o of OBSTACLES) {
      // Closest point on rect to circle center.
      const cx = clamp(x, o.x, o.x + o.w);
      const cy = clamp(y, o.y, o.y + o.h);
      const ddx = x - cx, ddy = y - cy;
      if (ddx * ddx + ddy * ddy < PLAYER_R * PLAYER_R) return true;
    }
    return false;
  }

  // ---- Rendering ----

  private render() {
    const ctx = this.ctx;

    // Background.
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);

    // Grid.
    ctx.strokeStyle = 'rgba(120, 140, 200, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= ARENA_W; x += 40) {
      ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, ARENA_H);
    }
    for (let y = 0; y <= ARENA_H; y += 40) {
      ctx.moveTo(0, y + 0.5); ctx.lineTo(ARENA_W, y + 0.5);
    }
    ctx.stroke();

    // Arena outline.
    ctx.strokeStyle = 'rgba(120, 140, 200, 0.2)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, ARENA_W - 2, ARENA_H - 2);

    // Obstacles.
    for (const o of OBSTACLES) {
      ctx.fillStyle = '#1e1e30';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = 'rgba(120, 140, 200, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1);
    }

    // Tension line when chaser is close.
    if (this.status() === 'playing') {
      const d = Math.hypot(
        this.myPos.x - this.otherPos.x,
        this.myPos.y - this.otherPos.y
      );
      if (d < 120) {
        const alpha = (120 - d) / 120;
        ctx.strokeStyle = `rgba(255, 80, 100, ${alpha * 0.6})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(this.myPos.x, this.myPos.y);
        ctx.lineTo(this.otherPos.x, this.otherPos.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Players. Draw the "other" first so "me" sits on top.
    const otherRole: Role = this.myRole() === 'chaser' ? 'runner' : 'chaser';
    this.drawPlayer(this.otherPos, otherRole, false);
    this.drawPlayer(this.myPos, this.myRole(), true);
  }

  private drawPlayer(pos: Vec2, role: Role, isMe: boolean) {
    const ctx = this.ctx;
    const color = role === 'chaser' ? '#ff3355' : '#33aaff';

    // Glow halo.
    const haloR = PLAYER_R * 2.6;
    const grad = ctx.createRadialGradient(pos.x, pos.y, PLAYER_R * 0.5, pos.x, pos.y, haloR);
    grad.addColorStop(0, hexToRgba(color, 0.55));
    grad.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, haloR, 0, Math.PI * 2);
    ctx.fill();

    // Body.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, PLAYER_R, 0, Math.PI * 2);
    ctx.fill();

    // Outline if it's me.
    if (isMe) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, PLAYER_R + 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Specular highlight.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(pos.x - PLAYER_R * 0.3, pos.y - PLAYER_R * 0.3, PLAYER_R * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Input ----

  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    if (this.setKey(e.key, true)) e.preventDefault();
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent) {
    this.setKey(e.key, false);
  }

  @HostListener('window:blur')
  onBlur() {
    this.keys.up = this.keys.down = this.keys.left = this.keys.right = false;
  }

  private setKey(key: string, down: boolean): boolean {
    switch (key.toLowerCase()) {
      case 'w': case 'arrowup':    this.keys.up = down; return true;
      case 's': case 'arrowdown':  this.keys.down = down; return true;
      case 'a': case 'arrowleft':  this.keys.left = down; return true;
      case 'd': case 'arrowright': this.keys.right = down; return true;
    }
    return false;
  }
}

// ---- helpers ----
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
