import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ChannelsService } from '../core/channels.service';

/** Header dropdown that switches the managed channel (spec §2.1). */
@Component({
  selector: 'app-channel-picker',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick($event)', '(keydown.escape)': 'open.set(false)' },
  template: `
    <button
      type="button"
      class="trigger"
      [attr.aria-expanded]="open()"
      aria-haspopup="menu"
      [disabled]="auth.busy()"
      (click)="open.set(!open())"
    >
      @if (auth.signedIn() && channels.active(); as ch) {
        <span class="avatar" style="--size: 26px">
          @if (ch.avatarUrl) {
            <img [src]="ch.avatarUrl" alt="" referrerpolicy="no-referrer" />
          } @else {
            {{ ch.title.charAt(0) }}
          }
        </span>
        <span class="name ellipsis">{{ channels.displayName(ch) }}</span>
        @if (auth.lockReason()) {
          <span title="Locked while a job runs" aria-label="locked">🔒</span>
        }
      } @else {
        <span class="name">Sign in</span>
      }
      <span aria-hidden="true" class="muted">▾</span>
    </button>

    @if (open()) {
      <div class="menu" role="menu">
        @if (!auth.signedIn()) {
          <button type="button" class="item" (click)="add()">Sign in with Google</button>
        } @else {
          @if (auth.lockReason(); as reason) {
            <p class="alert warn small">{{ reason }} is running. Switching will ask first.</p>
          }
          @for (ch of channels.channels(); track ch.id) {
            <button
              type="button"
              role="menuitemradio"
              class="item"
              [attr.aria-checked]="ch.id === channels.activeId()"
              [class.current]="ch.id === channels.activeId()"
              (click)="pick(ch.id)"
            >
              <span class="avatar" style="--size: 28px">
                @if (ch.avatarUrl) {
                  <img [src]="ch.avatarUrl" alt="" referrerpolicy="no-referrer" />
                } @else {
                  {{ ch.title.charAt(0) }}
                }
              </span>
              <span class="text">
                <span class="ellipsis">{{ channels.displayName(ch) }}</span>
                <span class="muted small ellipsis">{{ ch.handle || ch.note || ch.id }}</span>
              </span>
              <span
                class="dot"
                [class.on]="auth.hasToken(ch.id)"
                [attr.title]="auth.hasToken(ch.id) ? 'Signed in this session' : 'Needs sign-in'"
              ></span>
            </button>
          }
          <hr />
          <button type="button" class="item" (click)="add()">+ Add / switch channel</button>
          <a class="item" routerLink="/channels" (click)="open.set(false)">Manage channels…</a>
          <button type="button" class="item danger" (click)="signOut()">Sign out</button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-block;
    }
    .trigger {
      gap: 0.45rem;
      max-width: 240px;
      padding: 0.3rem 0.6rem 0.3rem 0.35rem;
      background: var(--surface);
    }
    .avatar {
      border-radius: 50%;
    }
    .name {
      max-width: 140px;
    }
    .menu {
      position: absolute;
      right: 0;
      top: calc(100% + 6px);
      z-index: 30;
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: min(320px, calc(100vw - 2rem));
      padding: 0.35rem;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    }
    .item {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 0.6rem;
      padding: 0.45rem 0.55rem;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text);
      font-weight: 500;
      text-align: left;
      text-decoration: none;
      white-space: normal;
      &:hover,
      &.current {
        background: var(--surface-2);
      }
      &.danger {
        color: var(--danger);
      }
    }
    .text {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--surface-3);
      &.on {
        background: var(--ok);
      }
    }
    hr {
      width: 100%;
      border: 0;
      border-top: 1px solid var(--line);
      margin: 0.25rem 0;
    }
    .alert {
      margin: 0 0 0.25rem;
      padding: 0.5rem;
    }
  `,
})
export class ChannelPicker {
  protected readonly auth = inject(AuthService);
  protected readonly channels = inject(ChannelsService);
  protected readonly open = signal(false);
  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    inject(Router)
      .events.pipe(
        filter((e) => e instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.open.set(false));
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  protected pick(id: string): void {
    this.open.set(false);
    void this.auth.switchTo(id);
  }

  protected add(): void {
    this.open.set(false);
    void this.auth.addChannel();
  }

  protected signOut(): void {
    this.open.set(false);
    this.auth.signOut();
  }
}
