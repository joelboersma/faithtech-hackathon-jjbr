import "server-only";
import { SinchClient } from "@sinch/sdk-core";
import { sinchEnvSchema } from "@/lib/env";

let client: SinchClient | undefined;

export function getSinch() {
  if (!client) {
    const env = sinchEnvSchema.parse(process.env);
    client = new SinchClient({
      projectId: env.SINCH_PROJECT_ID,
      keyId: env.SINCH_KEY_ID,
      keySecret: env.SINCH_KEY_SECRET,
    });
  }
  return client;
}
