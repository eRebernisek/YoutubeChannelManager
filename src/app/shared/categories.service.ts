import { Injectable, inject, resource } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { YoutubeApiService } from '../core/youtube-api.service';

/** Assignable video categories, loaded once per session (1 unit). */
@Injectable({ providedIn: 'root' })
export class CategoriesService {
  private readonly api = inject(YoutubeApiService);
  private readonly auth = inject(AuthService);

  readonly list = resource({
    params: () => (this.auth.signedIn() ? true : undefined),
    loader: async () => {
      const res = await this.api.categories();
      return res.items
        .filter((c) => c.snippet.assignable)
        .sort((a, b) => a.snippet.title.localeCompare(b.snippet.title));
    },
  });
}
