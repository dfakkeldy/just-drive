// The site without multiplayer (deploy/wrangler.no-rooms.jsonc): every request goes to the files, as before.
export default {
  fetch: (request: Request, env: { ASSETS: Fetcher }): Promise<Response> => env.ASSETS.fetch(request),
} satisfies ExportedHandler<{ ASSETS: Fetcher }>;
