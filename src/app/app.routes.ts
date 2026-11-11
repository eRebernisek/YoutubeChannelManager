import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { AuthService } from './core/auth.service';

/** Pages that need a signed-in channel send the user to Home to sign in. */
const signedIn: CanActivateFn = () =>
  inject(AuthService).signedIn() || inject(Router).createUrlTree(['/']);

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/home/home').then((m) => m.Home) },
  {
    path: 'privacy',
    loadComponent: () => import('./features/policy/policy').then((m) => m.Policy),
    data: { file: 'privacy.html' },
  },
  {
    path: 'terms',
    loadComponent: () => import('./features/policy/policy').then((m) => m.Policy),
    data: { file: 'terms.html' },
  },
  {
    path: 'channels',
    loadComponent: () => import('./features/channels/channels').then((m) => m.Channels),
  },
  {
    path: 'dashboard',
    canActivate: [signedIn],
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'videos',
    canActivate: [signedIn],
    loadComponent: () => import('./features/videos/video-list').then((m) => m.VideoList),
  },
  {
    path: 'videos/:id',
    canActivate: [signedIn],
    loadComponent: () => import('./features/videos/video-edit').then((m) => m.VideoEdit),
  },
  {
    path: 'upload',
    canActivate: [signedIn],
    loadComponent: () => import('./features/upload/upload').then((m) => m.Upload),
  },
  {
    path: 'settings',
    canActivate: [signedIn],
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  { path: '**', redirectTo: '' },
];
