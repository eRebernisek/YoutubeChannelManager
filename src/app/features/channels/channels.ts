import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { ChannelsService, KnownChannel } from '../../core/channels.service';

/** Known channels: add/switch, default, label, order, forget (spec §2.1). */
@Component({
  selector: 'app-channels',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="page-head">
        <h1>Channels</h1>
        <span class="spacer"></span>
        <button type="button" class="primary" [disabled]="auth.busy()" (click)="auth.addChannel()">
          + Add / switch channel
        </button>
      </div>

      <p class="muted">
        A Google sign-in belongs to one channel. To add another of your channels, click
        <em>Add / switch channel</em> and pick it in Google's list ("Choose an account or brand
        account"). Channels you've signed in to are remembered here; access tokens are not.
      </p>

      <div class="card stack">
        @for (ch of channels.channels(); track ch.id; let first = $first; let last = $last) {
          <div class="channel">
            <span class="avatar" style="--size: 44px">
              @if (ch.avatarUrl) {
                <img [src]="ch.avatarUrl" alt="" referrerpolicy="no-referrer" />
              } @else {
                {{ ch.title.charAt(0) }}
              }
            </span>
            <div class="stack info">
              <div class="row">
                <strong>{{ channels.displayName(ch) }}</strong>
                @if (ch.id === channels.activeId()) {
                  <span class="badge ok">Active</span>
                }
                @if (ch.id === channels.defaultId()) {
                  <span class="badge info">Default</span>
                }
                @if (!ch.verified) {
                  <span class="badge warn" title="Not signed in to yet">Not verified</span>
                } @else if (auth.hasToken(ch.id)) {
                  <span class="badge">Signed in</span>
                }
              </div>
              <span class="muted small mono">{{ ch.handle || '' }} {{ ch.id }}</span>
              <div class="form-grid">
                <label class="field">
                  Label
                  <input
                    [value]="ch.label ?? ''"
                    [placeholder]="ch.title"
                    (change)="channels.rename(ch.id, $any($event.target).value)"
                  />
                </label>
                <label class="field">
                  Use / note
                  <input
                    [value]="ch.note ?? ''"
                    placeholder="e.g. Live streams"
                    (change)="channels.setNote(ch.id, $any($event.target).value)"
                  />
                </label>
              </div>
              <div class="row">
                <button type="button" class="sm" (click)="auth.switchTo(ch.id)">
                  {{ auth.hasToken(ch.id) ? 'Switch to' : 'Sign in to this channel' }}
                </button>
                <button
                  type="button"
                  class="sm"
                  [disabled]="ch.id === channels.defaultId()"
                  (click)="channels.setDefault(ch.id)"
                >
                  Make default
                </button>
                <button type="button" class="sm ghost" [disabled]="first" (click)="channels.move(ch.id, -1)" aria-label="Move up">↑</button>
                <button type="button" class="sm ghost" [disabled]="last" (click)="channels.move(ch.id, 1)" aria-label="Move down">↓</button>
                <span class="spacer"></span>
                <button type="button" class="sm danger" (click)="forget(ch)">Forget</button>
              </div>
            </div>
          </div>
        } @empty {
          <p class="muted">No channels yet. Click <em>Add / switch channel</em>.</p>
        }
      </div>
    </section>
  `,
  styles: `
    .channel {
      display: flex;
      gap: 0.85rem;
      padding-bottom: 0.85rem;
      border-bottom: 1px solid var(--line);
      &:last-child {
        border-bottom: 0;
        padding-bottom: 0;
      }
    }
    .avatar {
      border-radius: 50%;
    }
    .info {
      flex: 1;
      min-width: 0;
      gap: 0.5rem;
    }
  `,
})
export class Channels {
  protected readonly auth = inject(AuthService);
  protected readonly channels = inject(ChannelsService);

  protected forget(ch: KnownChannel): void {
    const name = this.channels.displayName(ch);
    if (confirm(`Forget ${name}? Its saved settings stay, and you can add it again any time.`)) {
      this.auth.forgetChannel(ch.id);
    }
  }
}
