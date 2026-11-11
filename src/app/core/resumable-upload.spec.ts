import { ResumableUpload } from './resumable-upload';

interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  size: number;
}

type Reply = { status: number; body?: string; headers?: Record<string, string> } | 'network-error';

/** Fake XHR that answers from a queue of replies and records each request. */
function installFakeXhr(replies: Reply[]): Sent[] {
  const sent: Sent[] = [];
  class FakeXhr {
    status = 0;
    responseText = '';
    upload: { onprogress?: (e: { loaded: number }) => void } = {};
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    private method = '';
    private url = '';
    private headers: Record<string, string> = {};
    private replyHeaders: Record<string, string> = {};
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v;
    }
    getResponseHeader(k: string) {
      return this.replyHeaders[k] ?? null;
    }
    abort() {
      this.onabort?.();
    }
    send(body: Blob | string | null) {
      const size = body instanceof Blob ? body.size : (body?.length ?? 0);
      sent.push({ method: this.method, url: this.url, headers: this.headers, size });
      const reply = replies.shift();
      queueMicrotask(() => {
        if (!reply || reply === 'network-error') return this.onerror?.();
        this.status = reply.status;
        this.responseText = reply.body ?? '';
        this.replyHeaders = reply.headers ?? {};
        this.upload.onprogress?.({ loaded: size });
        this.onload?.();
      });
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return sent;
}

const MB = 1024 * 1024;
const meta = {
  snippet: { title: 't', description: '', categoryId: '20' },
  status: { privacyStatus: 'private' as const },
};
const deps = () => ({
  token: vi.fn(async () => 'tok'),
  tokenRejected: vi.fn(async () => 'tok2'),
  onStarted: vi.fn(),
});

describe('ResumableUpload', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a session, sends 8 MB chunks and returns the video', async () => {
    const sent = installFakeXhr([
      { status: 200, headers: { Location: 'https://upload/session1' } },
      { status: 308, headers: { Range: `bytes=0-${8 * MB - 1}` } },
      { status: 200, body: JSON.stringify({ id: 'vid123' }) },
    ]);
    const d = deps();
    const up = new ResumableUpload(new File([new Uint8Array(9 * MB)], 'a.mp4', { type: 'video/mp4' }), meta, d);
    const video = await up.start();

    expect(video.id).toBe('vid123');
    expect(up.state()).toBe('done');
    expect(up.sent()).toBe(9 * MB);
    expect(d.onStarted).toHaveBeenCalledTimes(1);
    expect(sent[0].headers['X-Upload-Content-Length']).toBe(String(9 * MB));
    expect(sent[1]).toMatchObject({ method: 'PUT', url: 'https://upload/session1', size: 8 * MB });
    expect(sent[1].headers['Content-Range']).toBe(`bytes 0-${8 * MB - 1}/${9 * MB}`);
    expect(sent[2].headers['Content-Range']).toBe(`bytes ${8 * MB}-${9 * MB - 1}/${9 * MB}`);
  });

  it('asks for the offset after a network error and continues from there', async () => {
    vi.useFakeTimers();
    const sent = installFakeXhr([
      { status: 200, headers: { Location: 'https://upload/s' } },
      'network-error',
      { status: 308, headers: { Range: 'bytes=0-1023' } },
      { status: 201, body: JSON.stringify({ id: 'v' }) },
    ]);
    const up = new ResumableUpload(new File([new Uint8Array(4096)], 'a.mp4'), meta, deps());
    const done = up.start();
    await vi.runAllTimersAsync();
    expect((await done).id).toBe('v');
    expect(sent[2].headers['Content-Range']).toBe('bytes */4096');
    expect(sent[3].headers['Content-Range']).toBe('bytes 1024-4095/4096');
    vi.useRealTimers();
  });

  it('fails without retrying on a 403', async () => {
    installFakeXhr([
      { status: 403, body: JSON.stringify({ error: { code: 403, message: 'x', errors: [{ reason: 'quotaExceeded', message: 'x' }] } }) },
    ]);
    const up = new ResumableUpload(new File([new Uint8Array(10)], 'a.mp4'), meta, deps());
    await expect(up.start()).rejects.toThrow(/quota is used up/);
    expect(up.state()).toBe('failed');
  });
});
