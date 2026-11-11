/**
 * Public app configuration. The OAuth client ID is public by design (it ships in the browser).
 * Never put a client secret here.
 */
export const environment = {
  /** "Web application" OAuth client from Google Cloud project streambot-511716 (spec §8.5). */
  googleClientId: '479687203251-qkbpv8n4nhtve43e5ivka8l8p7l9br9q.apps.googleusercontent.com',
  /** Channels shown in the picker before the first sign-in (spec §2.1). */
  seedChannels: [
    { id: 'UCRoE-dG8Ds_yh0Nzvds6Iuw', title: 'ManyTheGuy', note: 'Live streams, VODs' },
    { id: 'UCGbUGZwxXcp2K5NYj4clsCQ', title: 'DoomerTron2000', note: 'Generated videos & Shorts' },
  ],
  contactEmail: 'eder.rebernisek@gmail.com',
  discordUrl: 'https://discord.gg/SPYnZ5Vy7',
  /** Flip to true once the YouTube API compliance audit is approved (spec §0.1). */
  apiAuditApproved: false,
};
