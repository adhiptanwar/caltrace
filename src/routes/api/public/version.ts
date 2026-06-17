import { createFileRoute } from "@tanstack/react-router";

declare const __APP_BUILD_ID__: string;

export const Route = createFileRoute("/api/public/version")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ buildId: __APP_BUILD_ID__ }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store, no-cache, must-revalidate",
          },
        }),
    },
  },
});
