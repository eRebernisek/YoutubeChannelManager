import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { ChannelsService } from './core/channels.service';
import { QuotaService } from './core/quota.service';
import { ToastService } from './core/toast.service';
import { ChannelPicker } from './shared/channel-picker';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ChannelPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly channels = inject(ChannelsService);
  protected readonly quota = inject(QuotaService);
  protected readonly toast = inject(ToastService);

  protected readonly nav = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/videos', label: 'Videos' },
    { path: '/upload', label: 'Upload' },
    { path: '/settings', label: 'Settings' },
  ];

  constructor() {
    // The tab title always names the active channel, so it's clear where edits go (spec §2.1).
    const title = inject(Title);
    effect(() => {
      const name = this.auth.signedIn() ? this.channels.displayName(this.channels.active()) : '';
      title.setTitle(name ? `${name} · YouTube Channel Manager` : 'YouTube Channel Manager');
    });
  }
}
