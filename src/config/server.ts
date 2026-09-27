import "server-only";
import { parseEnvironment } from "./env";
export const env = parseEnvironment(process.env);
