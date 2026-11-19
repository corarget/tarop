import { handleTelegramWebhook } from "./app";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/health") {
			return Response.json({ status: "ok" });
		}

		if (request.method === "POST" && url.pathname === "/telegram/webhook") {
			return handleTelegramWebhook(request, env);
		}

		return Response.json(
			{
				name: "tarop",
				status: "ready",
				endpoints: ["GET /health", "POST /telegram/webhook"],
			},
			{ status: 404 },
		);
	},
} satisfies ExportedHandler<Env>;
