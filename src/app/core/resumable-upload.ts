import { signal } from '@angular/core';
import { ApiError, toApiError } from './api-error';
import { Video, VideoSnippet, VideoStatus } from './youtube.models';

const UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
/** Must be a multiple of 256 KiB. */
const CHUNK = 8 * 1024 * 1024;
const MAX_RETRIES = 6;

export type UploadState = 'idle' | 'starting' | 'uploading' | 'paused' | 'retrying' | 'done' | 'failed';

export interface UploadDeps {
  /** A valid token for the channel the upload started on. */
  token: () => Promise<string>;
  /** A fresh token after a 401. */
  tokenRejected: () => Promise<string>;
  /** Called once when the upload session is created (that's when YouTube charges the quota). */
  onStarted?: () => void;
}

interface XhrResult {
  status: number;
  body: string;
  range: string | null;
  location: string | null;
}

class AbortedError extends Error {}

/**
 * YouTube resumable upload (uploadType=resumable) in 8 MB chunks with progress, pause/resume and
 * retry with backoff. Uses XHR because fetch has no upload progress events.
 */
export class ResumableUpload {
  readonly state = signal<UploadState>('idle');
  readonly sent = signal(0);
  readonly error = signal<string | null>(null);
  readonly total: number;

  private sessionUrl: string | null = null;
  private xhr: XMLHttpRequest | null = null;
  private paused = false;
  private resolveDone?: (v: Video) => void;
  private rejectDone?: (e: Error) => void;
  readonly done: Promise<Video>;

  constructor(
    private readonly file: File,
    private readonly metadata: { snippet: VideoSnippet; status: VideoStatus },
    private readonly deps: UploadDeps,
  ) {
    this.total = file.size;
    this.done = new Promise<Video>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    // Callers attach handlers later; avoid unhandled-rejection noise in the meantime.
    this.done.catch(() => undefined);
  }

  start(): Promise<Video> {
    if (this.state() === 'idle') void this.run();
    return this.done;
  }

  pause(): void {
    if (this.state() !== 'uploading' && this.state() !== 'retrying') return;
    this.paused = true;
    this.xhr?.abort();
    this.state.set('paused');
  }

  resume(): void {
    if (this.state() !== 'paused' && this.state() !== 'failed') return;
    this.paused = false;
    this.error.set(null);
    void this.run();
  }

  /** Stops for good. YouTube discards an unfinished upload session on its own. */
  cancel(): void {
    this.paused = true;
    this.xhr?.abort();
    this.fail('Upload cancelled.');
  }

  private async run(): Promise<void> {
    let attempt = 0;
    while (!this.paused) {
      try {
        if (!this.sessionUrl) {
          this.state.set('starting');
          this.sent.set(0);
          this.sessionUrl = await this.createSession();
          this.deps.onStarted?.();
        } else if (attempt > 0 || this.state() === 'paused' || this.state() === 'failed') {
          this.sent.set(await this.queryOffset());
        }
        this.state.set('uploading');
        const video = await this.sendChunks();
        this.state.set('done');
        this.resolveDone?.(video);
        return;
      } catch (e) {
        if (e instanceof AbortedError || this.paused) return;
        const retriable =
          !(e instanceof ApiError) ||
          [0, 401, 429].includes(e.status) ||
          e.status >= 500;
        if (!retriable || attempt >= MAX_RETRIES) {
          this.state.set('failed');
          this.error.set(e instanceof Error ? e.message : String(e));
          // A failed upload can be resumed by the user (resume()), so don't reject yet unless fatal.
          if (!retriable || !this.sessionUrl) this.fail(this.error()!);
          return;
        }
        attempt++;
        this.state.set('retrying');
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)));
      }
    }
  }

  private fail(message: string): void {
    this.state.set('failed');
    this.error.set(message);
    this.rejectDone?.(new Error(message));
  }

  private async createSession(): Promise<string> {
    const body = JSON.stringify(this.metadata);
    const headers = (token: string) => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(this.total),
      'X-Upload-Content-Type': this.file.type || 'video/*',
    });
    let res = await this.send('POST', UPLOAD_URL, headers(await this.deps.token()), body);
    if (res.status === 401) res = await this.send('POST', UPLOAD_URL, headers(await this.deps.tokenRejected()), body);
    if (res.status !== 200 || !res.location) throw this.toError(res);
    return res.location;
  }

  private async sendChunks(): Promise<Video> {
    for (;;) {
      const start = this.sent();
      const end = Math.min(start + CHUNK, this.total);
      const token = await this.deps.token();
      const res = await this.send(
        'PUT',
        this.sessionUrl!,
        { Authorization: `Bearer ${token}`, 'Content-Range': `bytes ${start}-${end - 1}/${this.total}` },
        this.file.slice(start, end),
        (loaded) => this.sent.set(start + loaded),
      );
      if (res.status === 200 || res.status === 201) {
        this.sent.set(this.total);
        return JSON.parse(res.body) as Video;
      }
      if (res.status === 308) {
        this.sent.set(this.offsetFrom(res.range, end));
        continue;
      }
      if (res.status === 401) await this.deps.tokenRejected();
      throw this.toError(res);
    }
  }

  /** Asks YouTube how many bytes it has (after a pause or network error). */
  private async queryOffset(): Promise<number> {
    const token = await this.deps.token();
    const res = await this.send('PUT', this.sessionUrl!, {
      Authorization: `Bearer ${token}`,
      'Content-Range': `bytes */${this.total}`,
    });
    if (res.status === 308) return this.offsetFrom(res.range, 0);
    if (res.status === 200 || res.status === 201) return this.total;
    if (res.status === 404 || res.status === 410) {
      // The session expired: start over with a new one.
      this.sessionUrl = null;
      throw new ApiError('The upload session expired. Restarting the upload.', 503);
    }
    throw this.toError(res);
  }

  /** "bytes=0-12345" → 12346. Falls back to `fallback` if the header can't be read. */
  private offsetFrom(range: string | null, fallback: number): number {
    const m = /bytes=\d+-(\d+)/.exec(range ?? '');
    return m ? Number(m[1]) + 1 : fallback;
  }

  private toError(res: XhrResult): ApiError {
    let body = null;
    try {
      body = JSON.parse(res.body);
    } catch {
      // not JSON
    }
    return toApiError(res.status, body);
  }

  private send(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: Blob | string,
    onProgress?: (loaded: number) => void,
  ): Promise<XhrResult> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.xhr = xhr;
      xhr.open(method, url);
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      if (onProgress) xhr.upload.onprogress = (e) => onProgress(e.loaded);
      xhr.onload = () =>
        resolve({
          status: xhr.status,
          body: xhr.responseText,
          range: xhr.getResponseHeader('Range'),
          location: xhr.getResponseHeader('Location'),
        });
      xhr.onerror = () => reject(toApiError(0, null));
      xhr.onabort = () => reject(new AbortedError());
      xhr.send(body ?? null);
    });
  }
}
