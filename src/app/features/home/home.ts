import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth.service';
import { ChannelsService } from '../../core/channels.service';

/** Public landing page. Google reviews it, so it must work without sign-in (spec §3). */
@Component({
  selector: 'app-home',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page hero">
      <h1>YouTube Channel Manager</h1>
      <p class="lead">
        A personal tool by Eder Rebernisek Mariano (ManyTheGuy) to manage his own YouTube channels:
        edit videos and Shorts, upload and schedule videos from a metadata file, run live streams
        and the live chat bot, and manage playlists, comments, captions and channel branding.
      </p>
      <p class="muted">
        Everything runs in your browser. Sign-in uses Google's official popup, and your data is
        never sent to any server other than YouTube's.
      </p>

      <div class="row">
        @if (auth.signedIn()) {
          <a class="btn primary" routerLink="/dashboard">Open dashboard</a>
        } @else {
          <button type="button" class="primary" [disabled]="auth.busy()" (click)="auth.addChannel()">
            Sign in with Google
          </button>
        }
        @if (auth.signedIn()) {
          <a class="btn" routerLink="/channels">Channels</a>
        }
      </div>

      @if (!auth.configured) {
        <p class="alert warn">
          Google sign-in isn't configured yet. Add the OAuth client ID to
          <code>src/environments/environment.ts</code> (see GITHUB_PAGES.md).
        </p>
      }

      @if (auth.signedIn()) {
        <div class="card stack">
          <h2>Channels</h2>
          @for (ch of channels.channels(); track ch.id) {
            <a class="list-item" [href]="'https://www.youtube.com/channel/' + ch.id" target="_blank" rel="noopener">
              <span class="avatar">
                @if (ch.avatarUrl) {
                  <img [src]="ch.avatarUrl" alt="" referrerpolicy="no-referrer" />
                } @else {
                  {{ ch.title.charAt(0) }}
                }
              </span>
              <span>
                <strong>{{ channels.displayName(ch) }}</strong>
                @if (ch.note) {
                  <span class="muted small"> · {{ ch.note }}</span>
                }
              </span>
            </a>
          } @empty {
            <p class="muted">No channels yet. Sign in again and pick one in Google's list.</p>
          }
        </div>
      }

      <p class="row small">
        <a [href]="discordUrl" target="_blank" rel="noopener">Discord</a>
        <a routerLink="/privacy">Privacy policy</a>
        <a routerLink="/terms">Terms of service</a>
        <span class="muted">Contact: {{ contactEmail }}</span>
      </p>
    </section>
  `,
  styles: `
    .hero {
      max-width: 760px;
    }
    .lead {
      font-size: 1.1rem;
      line-height: 1.5;
    }
  `,
})
export class Home {
  protected readonly auth = inject(AuthService);
  protected readonly channels = inject(ChannelsService);
  protected readonly discordUrl = environment.discordUrl;
  protected readonly contactEmail = environment.contactEmail;

  constructor() {
    // Signing in from Home lands on the dashboard.
    const router = inject(Router);
    let wasSignedIn = this.auth.signedIn();
    effect(() => {
      const now = this.auth.signedIn();
      if (now && !wasSignedIn) void router.navigateByUrl('/dashboard');
      wasSignedIn = now;
    });
  }
}
