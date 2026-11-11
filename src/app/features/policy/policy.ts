import { ChangeDetectionStrategy, Component, input, resource } from '@angular/core';

/**
 * Renders public/privacy.html or public/terms.html inside the app, so the static files Google links
 * to and the in-app pages share one source and can't drift apart (spec §5).
 */
@Component({
  selector: 'app-policy',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (doc.value(); as html) {
      <article class="page policy" [innerHTML]="html"></article>
    } @else if (doc.error()) {
      <p class="alert error">
        Couldn't load this page. Open <a [href]="file()">{{ file() }}</a> directly.
      </p>
    } @else {
      <div class="spinner"></div>
    }
  `,
})
export class Policy {
  /** Route data: which static file to show. */
  readonly file = input.required<string>();

  protected readonly doc = resource({
    params: () => this.file(),
    loader: async ({ params: file }) => {
      const res = await fetch(new URL(file, document.baseURI));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = new DOMParser().parseFromString(await res.text(), 'text/html');
      return parsed.querySelector('main')?.innerHTML ?? '';
    },
  });
}
