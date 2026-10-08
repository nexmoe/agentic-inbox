import { createContext } from "react-router";
import type { Env } from "../workers/types";

export const cloudflareContext = createContext<{
	env: Env;
	ctx: ExecutionContext;
}>();
