import { handle, json } from "../_lib/core.js";
import { requireUser } from "../_lib/auth.js";

export const onRequestGet = handle(async ({ request, env }) => json(await requireUser(request, env)));
