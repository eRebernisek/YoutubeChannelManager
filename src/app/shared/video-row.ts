import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatSaoPaulo } from '../core/time.util';
import { VideoKindsService } from '../core/video-kinds.service';
import { Video } from '../core/youtube.models';
import { videoKind } from '../core/video.util';

/** One video in a list: thumbnail, title, kind, privacy/schedule badge. Links to the editor. */
@Component({
  selector: 'app-video-row',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="list-item clickable" [routerLink]="['/videos', video().id]">
      @if (thumb()) {
        <img class="thumb" [src]="thumb()" alt="" loading="lazy" referrerpolicy="no-referrer" />
      } @else {
        <span class="thumb"></span>
      }
      <span class="stack" style="gap: 0.25rem; min-width: 0; flex: 1">
        <span class="ellipsis">{{ video().snippet.title }}</span>
        <span class="row small">
          <span class="badge">{{ kind() }}</span>
          @if (scheduled(); as at) {
            <span class="badge info">Scheduled · {{ at }}</span>
          } @else {
            <span class="badge" [class.ok]="video().status.privacyStatus === 'public'">
              {{ video().status.privacyStatus }}
            </span>
          }
          @if (video().statistics?.viewCount; as views) {
            <span class="muted">{{ views }} views</span>
          }
        </span>
      </span>
    </a>
  `,
})
export class VideoRow {
  readonly video = input.required<Video>();
  private readonly kinds = inject(VideoKindsService).kinds;

  protected readonly thumb = computed(() => {
    const t = this.video().snippet.thumbnails;
    return t?.medium?.url ?? t?.default?.url ?? '';
  });
  protected readonly kind = computed(() => videoKind(this.video(), this.kinds()));
  protected readonly scheduled = computed(() => {
    const at = this.video().status.publishAt;
    return at && Date.parse(at) > Date.now() ? formatSaoPaulo(at) : null;
  });
}
