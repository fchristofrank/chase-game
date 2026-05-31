import { Injectable, signal } from '@angular/core';
import Peer, { DataConnection } from 'peerjs';
import { Subject } from 'rxjs';

// Prefix avoids collisions with other apps on the public PeerJS broker.
const ID_PREFIX = 'chase-game-v1-';

function generateRoomCode(length = 6): string {
  // Removed confusable chars (0, O, 1, I, L)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

@Injectable({ providedIn: 'root' })
export class PeerService {
  private peer: Peer | null = null;
  private connection: DataConnection | null = null;

  /** Whether this peer is the host (the one who created the room). */
  isHost = signal(false);
  /** Whether we have a live connection to the other peer. */
  isConnected = signal(false);
  /** Visible room code (without internal prefix). */
  roomCode = signal('');

  /** Messages from the other peer. */
  data$ = new Subject<any>();
  /** Fires when the other peer disconnects. */
  disconnect$ = new Subject<void>();

  /**
   * Create a room as host. Returns the 6-char room code.
   * Retries with a new code if PeerJS reports the id is taken.
   */
  async initAsHost(maxRetries = 5): Promise<string> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const code = generateRoomCode();
      const fullId = ID_PREFIX + code;
      try {
        await this.openPeer(fullId);
        this.isHost.set(true);
        this.roomCode.set(code);
        // Wait for an incoming connection.
        this.peer!.on('connection', (conn) => {
          this.connection = conn;
          conn.on('open', () => this.attachConnection(conn));
        });
        return code;
      } catch (err: any) {
        // 'unavailable-id' means the random code happened to be in use — retry.
        if (err?.type === 'unavailable-id') {
          this.cleanup();
          continue;
        }
        this.cleanup();
        throw err;
      }
    }
    throw new Error('Could not create a room. Try again.');
  }

  /** Join an existing room by code. */
  async joinHost(code: string): Promise<void> {
    const clean = code.trim().toUpperCase();
    if (!clean) throw new Error('Empty code');
    await this.openPeer(); // anonymous id for the joiner
    return new Promise((resolve, reject) => {
      const conn = this.peer!.connect(ID_PREFIX + clean, { reliable: true });
      this.connection = conn;
      const timeout = setTimeout(() => {
        reject(new Error('Could not reach host. Check the code.'));
      }, 8000);
      conn.on('open', () => {
        clearTimeout(timeout);
        this.attachConnection(conn);
        this.roomCode.set(clean);
        resolve();
      });
      conn.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  send(data: unknown) {
    if (this.connection?.open) {
      this.connection.send(data);
    }
  }

  destroy() {
    this.cleanup();
  }

  // ---- internals ----

  private openPeer(id?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.peer = id ? new Peer(id) : new Peer();
      this.peer.on('open', () => resolve());
      this.peer.on('error', (err) => {
        reject(err);
      });
    });
  }

  private attachConnection(conn: DataConnection) {
    this.isConnected.set(true);
    conn.on('data', (msg) => this.data$.next(msg));
    conn.on('close', () => {
      this.isConnected.set(false);
      this.disconnect$.next();
    });
    conn.on('error', () => {
      this.isConnected.set(false);
      this.disconnect$.next();
    });
  }

  private cleanup() {
    try { this.connection?.close(); } catch {}
    try { this.peer?.destroy(); } catch {}
    this.connection = null;
    this.peer = null;
    this.isConnected.set(false);
    this.isHost.set(false);
    this.roomCode.set('');
  }
}
