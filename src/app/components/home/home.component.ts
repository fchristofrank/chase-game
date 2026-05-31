import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PeerService } from '../../services/peer.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page">
      <div class="card">
        <h1 class="title">CHASE</h1>
        <p class="subtitle">Two players. One chases. One escapes.</p>

        @if (mode() === 'menu') {
          <div class="actions">
            <button class="btn btn-primary" (click)="host()">Host a Room</button>
            <div class="divider"><span>or</span></div>
            <div class="join-row">
              <input
                class="input"
                placeholder="Room code (e.g. AB3X9K)"
                [(ngModel)]="joinCode"
                (keyup.enter)="join()"
                maxlength="6"
                autocapitalize="characters"
              />
              <button class="btn btn-secondary" (click)="join()" [disabled]="joinCode.length === 0">
                Join
              </button>
            </div>
          </div>
        }

        @if (mode() === 'hosting') {
          <div class="hosting">
            <p class="label">Share this code with your friend</p>
            <div class="code-box" (click)="copyCode()">
              <span class="code">{{ peerService.roomCode() }}</span>
              <button class="copy-btn">{{ copied() ? '✓ Copied' : 'Copy' }}</button>
            </div>
            <p class="waiting">
              <span class="dot"></span> Waiting for the other player to join…
            </p>
            <button class="btn btn-ghost" (click)="back()">Cancel</button>
          </div>
        }

        @if (mode() === 'joining') {
          <div class="hosting">
            <p class="waiting"><span class="dot"></span> Connecting…</p>
          </div>
        }

        @if (errorMsg()) {
          <p class="error">{{ errorMsg() }}</p>
        }

        <div class="hint">
          <strong>How to play:</strong> Move with WASD or arrow keys. Chaser wins by tagging the runner.
          Runner wins by surviving 60 seconds.
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background:
        radial-gradient(circle at 20% 20%, rgba(255, 51, 85, 0.12), transparent 40%),
        radial-gradient(circle at 80% 80%, rgba(51, 170, 255, 0.12), transparent 40%),
        #07070d;
    }
    .card {
      width: 100%;
      max-width: 460px;
      background: rgba(20, 20, 30, 0.85);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(120, 120, 160, 0.2);
      border-radius: 20px;
      padding: 36px 32px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }
    .title {
      font-size: 56px;
      letter-spacing: 8px;
      margin: 0;
      text-align: center;
      background: linear-gradient(90deg, #ff3355, #ffaa33, #33aaff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-weight: 800;
    }
    .subtitle {
      text-align: center;
      color: #9090a8;
      margin: 4px 0 32px;
      font-size: 14px;
      letter-spacing: 0.5px;
    }
    .actions { display: flex; flex-direction: column; gap: 16px; }
    .btn {
      padding: 14px 20px;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.1s, box-shadow 0.2s;
      letter-spacing: 0.3px;
    }
    .btn:hover { transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
    .btn-primary {
      background: linear-gradient(135deg, #ff3355, #ff6633);
      color: white;
      box-shadow: 0 6px 20px rgba(255, 51, 85, 0.3);
    }
    .btn-secondary {
      background: linear-gradient(135deg, #33aaff, #5588ff);
      color: white;
      box-shadow: 0 6px 20px rgba(51, 170, 255, 0.3);
    }
    .btn-ghost {
      background: transparent;
      color: #9090a8;
      border: 1px solid rgba(120, 120, 160, 0.3);
    }
    .btn-ghost:hover { background: rgba(120, 120, 160, 0.1); }
    .divider {
      display: flex;
      align-items: center;
      gap: 12px;
      color: #555;
      font-size: 12px;
      letter-spacing: 1px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: rgba(120, 120, 160, 0.2);
    }
    .join-row { display: flex; gap: 10px; }
    .input {
      flex: 1;
      padding: 14px 16px;
      background: rgba(10, 10, 16, 0.8);
      border: 1px solid rgba(120, 120, 160, 0.25);
      border-radius: 12px;
      color: #e8e8f0;
      font-size: 15px;
      letter-spacing: 2px;
      text-transform: uppercase;
      outline: none;
      font-family: 'SF Mono', Menlo, monospace;
    }
    .input:focus { border-color: #33aaff; box-shadow: 0 0 0 3px rgba(51, 170, 255, 0.15); }
    .hosting { display: flex; flex-direction: column; gap: 20px; align-items: center; }
    .label { color: #9090a8; font-size: 13px; margin: 0; }
    .code-box {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      background: rgba(10, 10, 16, 0.8);
      border: 1px dashed rgba(120, 120, 160, 0.4);
      border-radius: 12px;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .code-box:hover { border-color: #33aaff; }
    .code {
      font-family: 'SF Mono', Menlo, monospace;
      font-size: 28px;
      letter-spacing: 8px;
      font-weight: 700;
      color: #fff;
    }
    .copy-btn {
      padding: 8px 12px;
      background: rgba(51, 170, 255, 0.15);
      border: 1px solid rgba(51, 170, 255, 0.3);
      border-radius: 8px;
      color: #aaccff;
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
    }
    .waiting {
      color: #9090a8;
      font-size: 14px;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .dot {
      width: 8px; height: 8px;
      background: #5dd460;
      border-radius: 50%;
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.3); }
    }
    .error {
      margin-top: 16px;
      padding: 12px;
      background: rgba(255, 51, 85, 0.1);
      border: 1px solid rgba(255, 51, 85, 0.3);
      border-radius: 8px;
      color: #ff8899;
      font-size: 13px;
      text-align: center;
    }
    .hint {
      margin-top: 28px;
      padding: 14px 16px;
      background: rgba(10, 10, 16, 0.5);
      border-radius: 10px;
      color: #8080a0;
      font-size: 12px;
      line-height: 1.5;
    }
    .hint strong { color: #b0b0c8; }
  `],
})
export class HomeComponent {
  protected peerService = inject(PeerService);
  private router = inject(Router);

  mode = signal<'menu' | 'hosting' | 'joining'>('menu');
  errorMsg = signal('');
  copied = signal(false);
  joinCode = '';

  constructor() {
    // Reset any leftover peer state from a previous session.
    this.peerService.destroy();

    // Navigate to /game as soon as the other player connects.
    effect(() => {
      if (this.peerService.isConnected() && this.mode() !== 'menu') {
        this.router.navigate(['/game']);
      }
    });
  }

  async host() {
    this.mode.set('hosting');
    this.errorMsg.set('');
    try {
      await this.peerService.initAsHost();
    } catch (err: any) {
      this.errorMsg.set(err?.message ?? 'Could not create room.');
      this.mode.set('menu');
      this.peerService.destroy();
    }
  }

  async join() {
    const code = this.joinCode.trim().toUpperCase();
    if (!code) {
      this.errorMsg.set('Enter a room code.');
      return;
    }
    this.mode.set('joining');
    this.errorMsg.set('');
    try {
      await this.peerService.joinHost(code);
      // effect() above will navigate.
    } catch (err: any) {
      this.errorMsg.set(err?.message ?? 'Could not join room.');
      this.mode.set('menu');
      this.peerService.destroy();
    }
  }

  copyCode() {
    navigator.clipboard.writeText(this.peerService.roomCode()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    });
  }

  back() {
    this.peerService.destroy();
    this.mode.set('menu');
    this.errorMsg.set('');
  }
}
