import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateRequestDetails } from "npm:web-push@4.0.0";
import { handlePushWorker } from "./push-worker.ts";

Deno.serve((request) => handlePushWorker(request,
  createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""),
  { publicKey: Deno.env.get("VAPID_PUBLIC_KEY") || "", privateKey: Deno.env.get("VAPID_PRIVATE_KEY") || "", subject: Deno.env.get("VAPID_SUBJECT") || "" },
  Deno.env.get("PUSH_WORKER_TOKEN") || "", generateRequestDetails));
