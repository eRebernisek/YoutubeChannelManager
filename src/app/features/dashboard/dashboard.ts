import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { errorMessage } from '../../core/api-error';
import { ChannelsService } from '../../core/channels.service';
import { QuotaService } from '../../core/quota.service';
import { formatSaoPaulo, nextQuotaReset } from '../../core/time.util';
import { YoutubeApiService } from '../../core/youtube-api.service';

@Component({
  selector: 'app-dashboard',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="page-head">
        <h1>Dashboard</h1>
        <span class="spacer"></span>
        <button type="button" class="sm" (click)="data.reload()" [disabled]="data.isLoading()">
          Refresh
        </button>
      </div>

      @if (data.error(); as err) {
        <p class="alert error">{{ message(err) }}</p>
      }

      @if (data.value(); as d) {
        <div class="grid">
          <div class="card row">
            <span class="avatar" style="--size: 56px; border-radius: 50%">
              <img [src]="d.channel.snippet.thumbnails.default?.url" alt="" referrerpolicy="no-referrer" />
            </span>
            <div class="stack" style="gap: 0.15rem">
              <strong>{{ d.channel.snippet.title }}</strong>
              <span class="muted small">{{ d.channel.snippet.customUrl }}</span>
              <a class="small" [href]="'https://studio.youtube.com/channel/' + d.channel.id" target="_blank" rel="noopener">
                Open in YouTube Studio
              </a>
            </div>
          </div>
          <div class="card row" style="justify-content: space-around">
            <div class="stat">
              <span class="muted small">Subscribers</span>
              <strong>
                {{ d.channel.statistics?.hiddenSubscriberCount ? 'hidden' : (+(d.channel.statistics?.subscriberCount ?? 0) | number) }}
              </strong>
            </div>
            <div class="stat">
              <span class="muted small">Views</span>
              <strong>{{ +(d.channel.statistics?.viewCount ?? 0) | number }}</strong>
            </div>
            <div class="stat">
              <span class="muted small">Videos</span>
              <strong>{{ +(d.channel.statistics?.videoCount ?? 0) | number }}</strong>
            </div>
          </div>
          <div class="card stack">
            <div class="row">
              <strong>Live</strong>
              @if (d.liveUnavailable) {
                <span class="badge warn">Not available</span>
              } @else if (d.live.length) {
                <span class="badge danger">● LIVE</span>
              } @else {
                <span class="badge">Offline</span>
              }
            </div>
            @if (d.liveUnavailable) {
              <p class="muted small">
                Live status needs live streaming enabled on this channel. Channel stats still load.
              </p>
            } @else {
              @for (b of d.live; track b.id) {
                <a [href]="'https://www.youtube.com/watch?v=' + b.id" target="_blank" rel="noopener" class="ellipsis">{{ b.snippet.title }}</a>
              }
              @for (b of d.upcoming; track b.id) {
                <span class="small ellipsis">
                  <span class="muted">Upcoming {{ when(b.snippet.scheduledStartTime) }}:</span>
                  {{ b.snippet.title }}
                </span>
              }
            }
          </div>
        </div>
      } @else if (data.isLoading()) {
        <div class="spinner"></div>
      }

      <div class="card stack">
        <h2>API quota today (estimate)</h2>
        <div class="progress" [attr.aria-label]="quota.used() + ' of ' + quota.limit">
          <span [style.width.%]="quotaPct()"></span>
        </div>
        <p class="small">
          <strong>{{ quota.used() | number }}</strong> of {{ quota.limit | number }} units used ·
          {{ quota.remaining() | number }} left · resets {{ resetAt() }} (São Paulo time).
          Shared by all your channels.
        </p>
        @if (quota.byMethod().length) {
          <table class="small">
            @for (row of quota.byMethod(); track row[0]) {
              <tr>
                <td class="mono">{{ row[0] }}</td>
                <td style="text-align: right">{{ row[1] | number }}</td>
              </tr>
            }
          </table>
        }
        <p class="muted small">
          Only counts calls made from this browser. Costs are editable in Settings if Google changes them.
        </p>
      </div>
    </section>
  `,
})
export class Dashboard {
  private readonly api = inject(YoutubeApiService);
  private readonly channels = inject(ChannelsService);
  protected readonly quota = inject(QuotaService);

  protected readonly quotaPct = computed(() =>
    Math.min(100, (this.quota.used() / this.quota.limit) * 100),
  );
  protected readonly resetAt = computed(() => {
    this.quota.used();
    return formatSaoPaulo(nextQuotaReset());
  });

  protected readonly data = resource({
    params: () => this.channels.activeId() ?? undefined,
    loader: async () => {
      // Live APIs fail on channels without live streaming; don't block channel stats.
      const [channel, live, upcoming] = await Promise.all([
        this.api.myChannel(),
        this.api.broadcasts('active', 5).catch(() => null),
        this.api.broadcasts('upcoming', 5).catch(() => null),
      ]);
      return {
        channel,
        live: live?.items ?? [],
        upcoming: upcoming?.items ?? [],
        liveUnavailable: live === null && upcoming === null,
      };
    },
  });

  protected when(iso?: string): string {
    return iso ? formatSaoPaulo(iso) : '';
  }

  protected message(e: unknown): string {
    return errorMessage(e);
  }
}
